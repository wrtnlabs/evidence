import typia from "typia";

import { EvidenceInventory } from "../../graph/EvidenceInventory";
import { EvidenceParser } from "../../parsers/EvidenceParser";
import { EvidenceParserError } from "../../parsers/EvidenceParserError";
import { EvidenceTagParser } from "../../parsers/EvidenceTagParser";
import type { IEvidenceAdapter } from "../../structures/IEvidenceAdapter";
import type { IEvidenceHost } from "../../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidencePublicAddress } from "../../structures/IEvidencePublicAddress";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceSnapshot } from "../../structures/IEvidenceSourceSnapshot";
import type { IEvidenceTagParseResult } from "../../structures/IEvidenceTagParseResult";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { IEvidenceSwiftDeclaration } from "./IEvidenceSwiftDeclaration";
import type { IEvidenceSwiftDocumentation } from "./IEvidenceSwiftDocumentation";
import type { IEvidenceSwiftFileAnalysis } from "./IEvidenceSwiftFileAnalysis";
import { EvidenceSwiftDocumentation } from "./EvidenceSwiftDocumentation";
import { EvidenceSwiftFileScanner } from "./EvidenceSwiftFileScanner";
import { EvidenceSwiftOwnership } from "./EvidenceSwiftOwnership";

/**
 * Reconciles Swift extension ownership and DocC within one configured module.
 *
 * The scanner records explicit declarations before snapshot-wide ownership
 * resolution links extensions and nominal types. Materialization includes the
 * root identity so equal declarations in separate module selections stay
 * distinct. Documentation then attaches to the reconciled owners, while source
 * dependencies retain every physical file needed to invalidate the analysis.
 */
export class EvidenceSwiftAdapter implements IEvidenceAdapter<"swift"> {
  /**
   * Swift discriminator for explicit public and open source declarations.
   *
   * The module boundary comes from the snapshot root. This value selects Swift
   * grammar and visibility rules without inferring generated members.
   */
  public get type(): "swift" {
    return "swift";
  }

  /**
   * Builds a module-scoped Swift inventory from a captured source population.
   *
   * Extension ownership resolves before units are published. Inaccessible
   * input, unsupported ownership, and syntax failures remain incomplete
   * findings; the invocation releases its parser regardless of the
   * materialization outcome.
   */
  public async analyze(
    snapshot: IEvidenceSourceSnapshot,
  ): Promise<IEvidenceInventory> {
    const input = structuredClone(typia.assert(snapshot));
    const inventory: IEvidenceInventory = {
      schemaVersion: 1,
      sources: input.files,
      annotationRanges: [],
      units: [],
      addresses: [],
      hosts: [],
      declarations: [],
      reviews: [],
      diagnostics: input.diagnostics.map((diagnostic) => ({
        code: `source-${diagnostic.code}`,
        severity: "error",
        message: diagnostic.message,
        repair:
          "Restore access to the selected Swift source before evaluating coverage.",
        location: { file: diagnostic.path },
      })),
      dependencies: [
        ...input.dependencies,
        ...input.files.map((source) => ({
          path: source.physicalPath,
          recursive: false,
        })),
      ],
      complete: input.complete,
    };
    const parser = new EvidenceParser();
    try {
      const analyses = await Promise.all(
        input.files.map((source) => this.scan(parser, source)),
      );
      // Extensions need the complete selected nominal type set. Resolving before
      // publication also keeps source order from choosing a different owner.
      EvidenceSwiftOwnership.resolve(analyses);
      for (const analysis of analyses) {
        inventory.diagnostics.push(...analysis.diagnostics);
        inventory.complete &&= analysis.complete;
      }
      const published = this.materializeUnits(
        inventory,
        analyses,
        input.root.physical ?? input.root.absolute,
      );
      this.materializeDocumentation(inventory, analyses, published);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  /**
   * Converts parser failures into incomplete source analysis.
   *
   * The returned record preserves a source-specific diagnostic so parsing
   * failure cannot shrink coverage.
   */
  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidenceSwiftFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: "swift", file, content: source.content },
        (session) => new EvidenceSwiftFileScanner(session, source).scan(),
      );
    } catch (cause) {
      const parserError =
        cause instanceof EvidenceParserError ? cause : undefined;
      return {
        source,
        declarations: [],
        documentation: [],
        diagnostics: [
          {
            code: `swift-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `Swift parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            repair:
              "Ensure grammar and adapter support for the reported source construct before evaluating coverage.",
            location: {
              file: source.physicalPath,
              ...(parserError?.range === undefined
                ? {}
                : { range: parserError.range }),
            },
          },
        ],
        complete: false,
      };
    }
  }

  /**
   * Reconciles overload families and retains each physical declaration address.
   *
   * Conflicting public identities remain incomplete instead of being merged by
   * source order.
   */
  private materializeUnits(
    inventory: IEvidenceInventory,
    analyses: IEvidenceSwiftFileAnalysis[],
    moduleRoot: string,
  ): Map<string, string> {
    const published = new Map<string, string>();
    const publicDeclarations = analyses.flatMap((analysis) =>
      analysis.declarations.filter((declaration) => declaration.public),
    );
    for (const declaration of publicDeclarations)
      published.set(declaration.id, this.unitId(declaration, moduleRoot));

    const units = new Map<string, IEvidenceUnit>();
    const records = new Map(
      publicDeclarations.map((declaration) => [declaration.id, declaration]),
    );
    const declarationIds = new Map<string, Set<string>>();
    const addresses = new Set<string>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        if (!declaration.public) continue;
        const id = this.unitId(declaration, moduleRoot);
        const parentId =
          declaration.ownerDeclarationId === undefined
            ? undefined
            : published.get(declaration.ownerDeclarationId);
        const previousDeclarations =
          declarationIds.get(id) ?? new Set<string>();
        if (
          declaration.symbol !== "function" &&
          !declaration.extension &&
          previousDeclarations.size !== 0 &&
          !previousDeclarations.has(declaration.id) &&
          !this.protocolDefault(declaration, previousDeclarations, records)
        )
          this.problem(
            inventory,
            analysis,
            "swift-declaration-conflict",
            `Swift public identity '${declaration.identity.join(".")}' has more than one selected declaration.`,
            "Select one source declaration for this module identity before checking coverage.",
          );
        if (!declaration.extension) previousDeclarations.add(declaration.id);
        declarationIds.set(id, previousDeclarations);

        let unit = units.get(id);
        if (unit === undefined) {
          unit = {
            id,
            type: "swift",
            symbol: declaration.symbol,
            identity: declaration.identity,
            name: declaration.name,
            sites: [structuredClone(declaration.site)],
            withdrawals: [],
            ...(parentId === undefined ? {} : { parentId }),
          };
          units.set(id, unit);
        } else {
          if (unit.parentId !== parentId)
            this.problem(
              inventory,
              analysis,
              "swift-ownership-conflict",
              `Swift accessor '${declaration.address.join(".")}' has distinct lexical owners.`,
              "Rename the colliding declaration or implement disambiguated ownership addressing before checking coverage.",
            );
          if (!unit.sites.some((site) => site.id === declaration.site.id))
            unit.sites.push(structuredClone(declaration.site));
        }

        for (const sourceAddress of analysis.source.addresses) {
          const address: IEvidencePublicAddress = {
            unitId: id,
            file: sourceAddress.absolute,
            segments: declaration.address,
          };
          const key = JSON.stringify(address);
          if (addresses.has(key)) continue;
          addresses.add(key);
          inventory.addresses.push(address);
        }
      }
    inventory.units.push(...units.values());
    return published;
  }

  /**
   * Allows a protocol requirement and its explicit extension property
   * implementation to share a unit.
   *
   * Other repeated non-function declarations remain conflicts because they do
   * not establish this pairing.
   */
  private protocolDefault(
    declaration: IEvidenceSwiftDeclaration,
    previous: Set<string>,
    records: Map<string, IEvidenceSwiftDeclaration>,
  ): boolean {
    if (declaration.symbol !== "property" || previous.size !== 1) return false;
    const first = records.get([...previous][0] ?? "");
    if (first === undefined) return false;
    const pair = [first, declaration];
    return (
      pair.some((entry) => entry.form === "protocol_property_declaration") &&
      pair.some(
        (entry) =>
          entry.form === "property_declaration" &&
          records.get(entry.ownerDeclarationId ?? "")?.extension === true,
      )
    );
  }

  /**
   * Resolves withdrawals before publishing attached annotation hosts.
   *
   * Hidden units remain unavailable to ordinary tags while their withdrawal
   * location stays diagnostic context.
   */
  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidenceSwiftFileAnalysis[],
    published: Map<string, string>,
  ): void {
    const units = new Map(inventory.units.map((unit) => [unit.id, unit]));
    for (const analysis of analyses)
      for (const documentation of analysis.documentation) {
        const groups = this.attachmentGroups(documentation, published);
        if (groups.size === 0) continue;
        inventory.annotationRanges.push({
          file: analysis.source.physicalPath,
          range: documentation.range,
        });
        for (const [siteId, unitIds] of groups) {
          const parsed = this.parse(
            analysis.source,
            documentation,
            this.host(analysis.source, documentation, siteId, unitIds),
          );
          for (const unitId of unitIds) {
            const unit = units.get(unitId);
            if (unit !== undefined)
              unit.withdrawals.push(...parsed.withdrawals);
          }
        }
      }

    const hidden = new Set<string>();
    for (const unit of inventory.units)
      if (this.withdrawn(unit.id, units, new Set<string>()))
        hidden.add(unit.id);
    for (const analysis of analyses) {
      for (const documentation of analysis.documentation) {
        const publishedGroups = this.attachmentGroups(documentation, published);
        const groups = new Map<string, string[]>();
        for (const [siteId, unitIds] of publishedGroups) {
          const visible = unitIds.filter((unitId) => !hidden.has(unitId));
          if (visible.length !== 0) groups.set(siteId, visible);
        }
        if (
          groups.size === 0 &&
          publishedGroups.size !== 0 &&
          !this.claimAnnotation(analysis, documentation)
        )
          continue;
        if (groups.size === 0) {
          if (!this.annotation(analysis, documentation)) continue;
          const host = this.host(analysis.source, documentation, undefined, []);
          inventory.hosts.push(host);
          const parsed = this.parse(analysis.source, documentation, host);
          inventory.declarations.push(...parsed.declarations);
          inventory.reviews.push(...parsed.reviews);
          inventory.diagnostics.push(...parsed.diagnostics);
          continue;
        }
        for (const [siteId, unitIds] of groups) {
          const host = this.host(
            analysis.source,
            documentation,
            siteId,
            unitIds,
          );
          inventory.hosts.push(host);
          const parsed = this.parse(analysis.source, documentation, host);
          inventory.declarations.push(...parsed.declarations);
          inventory.reviews.push(...parsed.reviews);
          inventory.diagnostics.push(...parsed.diagnostics);
        }
      }
      this.materializeUndocumentedHosts(inventory, analysis, published, hidden);
    }
  }

  /**
   * Retains public declaration sites even when they carry no documentation.
   *
   * Host policies can therefore distinguish an eligible untagged site from
   * missing extraction.
   */
  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analysis: IEvidenceSwiftFileAnalysis,
    published: Map<string, string>,
    hidden: Set<string>,
  ): void {
    const documented = new Set(
      analysis.documentation.flatMap((documentation) =>
        documentation.attachments.flatMap((attachment) => {
          const unitId = published.get(attachment.declarationId);
          return unitId !== undefined && !hidden.has(unitId)
            ? [attachment.declarationId]
            : [];
        }),
      ),
    );
    const groups = new Map<string, IEvidenceSwiftDeclaration[]>();
    for (const declaration of analysis.declarations) {
      const unitId = published.get(declaration.id);
      if (
        unitId === undefined ||
        hidden.has(unitId) ||
        documented.has(declaration.id)
      )
        continue;
      const declarations = groups.get(declaration.site.id) ?? [];
      declarations.push(declaration);
      groups.set(declaration.site.id, declarations);
    }
    for (const declarations of groups.values()) {
      const first = declarations[0];
      if (first === undefined) continue;
      const unitIds = Array.from(
        new Set(
          declarations.flatMap((declaration) => {
            const unitId = published.get(declaration.id);
            return unitId === undefined ? [] : [unitId];
          }),
        ),
      );
      inventory.hosts.push({
        id: `${first.site.id}:host`,
        file: analysis.source.physicalPath,
        range: first.site.range,
        origins: analysis.source.addresses.map((address) => address.absolute),
        siteId: first.site.id,
        unitIds,
        attachment: "attached",
      });
    }
  }

  /**
   * Groups published semantic owners by their physical declaration site.
   *
   * One documentation carrier can attach to several selected units at the same
   * source occurrence.
   */
  private attachmentGroups(
    documentation: IEvidenceSwiftDocumentation,
    published: Map<string, string>,
  ): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const attachment of documentation.attachments) {
      const unitId = published.get(attachment.declarationId);
      if (unitId === undefined) continue;
      const unitIds = groups.get(attachment.siteId) ?? [];
      if (!unitIds.includes(unitId)) unitIds.push(unitId);
      groups.set(attachment.siteId, unitIds);
    }
    return groups;
  }

  /**
   * Creates an attached or explicitly unsupported documentation carrier.
   *
   * Unsupported annotation carriers retain repair guidance rather than being
   * discarded.
   */
  private host(
    source: IEvidenceSourceFile,
    documentation: IEvidenceSwiftDocumentation,
    siteId: string | undefined,
    unitIds: string[],
  ): IEvidenceHost {
    const attached = siteId !== undefined && unitIds.length !== 0;
    return {
      id: `${documentation.id}:host:${siteId ?? "unsupported"}`,
      file: source.physicalPath,
      range: documentation.range,
      origins: source.addresses.map((address) => address.absolute),
      unitIds,
      attachment: attached ? "attached" : "unsupported",
      ...(attached ? { siteId } : {}),
      ...(attached
        ? {}
        : {
            problem:
              "Move the annotation into DocC attached to a supported public Swift declaration.",
          }),
    };
  }

  /**
   * Parses Evidence tags only after the adapter establishes their host.
   *
   * Host ownership determines the source context in which authored targets
   * resolve.
   */
  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidenceSwiftDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    return EvidenceTagParser.parse(
      source.content,
      host,
      EvidenceSwiftDocumentation.read(source, documentation, host.id),
    );
  }

  /**
   * Detects Evidence or withdrawal annotations outside masked examples.
   *
   * The result decides whether an otherwise unsupported carrier needs a
   * diagnostic host.
   */
  private annotation(
    analysis: IEvidenceSwiftFileAnalysis,
    documentation: IEvidenceSwiftDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceSwiftDocumentation.read(
        analysis.source,
        documentation,
        documentation.id,
      ).text,
      true,
    );
  }

  /**
   * Detects acknowledgements and reviews on withdrawn carriers.
   *
   * Withdrawal directives themselves are excluded so they can be processed as
   * visibility state.
   */
  private claimAnnotation(
    analysis: IEvidenceSwiftFileAnalysis,
    documentation: IEvidenceSwiftDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceSwiftDocumentation.read(
        analysis.source,
        documentation,
        documentation.id,
      ).text,
      false,
    );
  }

  /**
   * Recognizes supported annotation names at documentation line boundaries.
   *
   * Restricting the match avoids treating inline prose or example fragments as
   * annotations.
   */
  private annotationPattern(raw: string, withdrawal: boolean): boolean {
    return withdrawal
      ? /(?:^|[\r\n])[ \t]*@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link|internal|hidden|ignore)\b/u.test(
          raw,
        )
      : /(?:^|[\r\n])[ \t]*@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link)\b/u.test(
          raw,
        );
  }

  /**
   * Follows explicit parent ownership to propagate withdrawal.
   *
   * The visited set rejects cycles while preserving the nearest valid hidden
   * ancestor.
   */
  private withdrawn(
    id: string,
    units: Map<string, IEvidenceUnit>,
    visited: Set<string>,
  ): boolean {
    if (visited.has(id)) return false;
    visited.add(id);
    const unit = units.get(id);
    if (unit === undefined) return false;
    if (unit.withdrawals.length !== 0) return true;
    return unit.parentId === undefined
      ? false
      : this.withdrawn(unit.parentId, units, visited);
  }

  /**
   * Separates programming kinds while unifying module-scoped overload
   * identities.
   *
   * The module root keeps equal source-relative declarations in different
   * selections distinct.
   */
  private unitId(
    declaration: IEvidenceSwiftDeclaration,
    moduleRoot: string,
  ): string {
    return `swift:${JSON.stringify([moduleRoot, declaration.symbol, ...declaration.identity])}`;
  }

  /**
   * Marks a declaration conflict as incomplete analysis.
   *
   * The diagnostic remains associated with the source analysis that supplied
   * the conflict.
   */
  private problem(
    inventory: IEvidenceInventory,
    analysis: IEvidenceSwiftFileAnalysis,
    code: string,
    message: string,
    repair: string,
  ): void {
    inventory.complete = false;
    inventory.diagnostics.push({
      code,
      severity: "error",
      message,
      repair,
      location: { file: analysis.source.physicalPath },
    });
  }
}
