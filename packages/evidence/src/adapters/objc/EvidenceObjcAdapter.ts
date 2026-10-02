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
import type { IEvidenceObjcDeclaration } from "./IEvidenceObjcDeclaration";
import type { IEvidenceObjcDocumentation } from "./IEvidenceObjcDocumentation";
import type { IEvidenceObjcFileAnalysis } from "./IEvidenceObjcFileAnalysis";
import { EvidenceObjcDocumentation } from "./EvidenceObjcDocumentation";
import { EvidenceObjcFileScanner } from "./EvidenceObjcFileScanner";

/**
 * Extracts Objective-C public declarations into merged units and comment hosts.
 *
 * Interface, category, and implementation records require a shared ownership
 * model before documentation can be attributed to semantic API subjects. The
 * adapter retains each physical site while normalizing published identities and
 * preserving failures that prevent complete extraction.
 */
export class EvidenceObjcAdapter implements IEvidenceAdapter<"objc"> {
  /**
   * Configured language discriminator for Objective-C extraction.
   *
   * It selects Objective-C rules even when headers or .m files overlap other
   * registered language extensions.
   */
  public get type(): "objc" {
    return "objc";
  }

  /**
   * Builds an owned Objective-C inventory from captured source contents.
   *
   * Unit publication precedes documentation materialization, and source or
   * parser failures retain incomplete state. The runtime closes after accepted
   * scans settle.
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
          "Restore access to the selected Objective-C source before evaluating coverage.",
        location: { file: diagnostic.path },
      })),
      dependencies: input.dependencies,
      complete: input.complete,
    };
    const parser = new EvidenceParser();
    try {
      const analyses = await Promise.all(
        input.files.map((source) => this.scan(parser, source)),
      );
      for (const analysis of analyses) {
        inventory.diagnostics.push(...analysis.diagnostics);
        inventory.complete &&= analysis.complete;
      }
      // Documentation sites must use the published owner identity rather than
      // treating interface and implementation fragments as unrelated subjects.
      const published = this.materializeUnits(inventory, analyses);
      this.materializeDocumentation(inventory, analyses, published);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  /**
   * Extracts declaration records within one borrowed Objective-C parse session.
   *
   * Failures retain the physical source and parser range when available,
   * marking the analysis incomplete instead of accepting an empty public
   * surface.
   */
  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidenceObjcFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: "objc", file, content: source.content },
        (session) => new EvidenceObjcFileScanner(session, source).scan(),
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
            code: `objc-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `Objective-C parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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
   * Reconciles public interfaces with compatible extension and implementation
   * sites.
   *
   * The resulting map connects every retained physical declaration to its unit.
   */
  private materializeUnits(
    inventory: IEvidenceInventory,
    analyses: IEvidenceObjcFileAnalysis[],
  ): Map<string, string> {
    const published = new Map<string, string>();
    const publicDeclarations = analyses.flatMap((analysis) =>
      analysis.declarations.filter((declaration) => declaration.public),
    );
    const publicIdentities = new Set(
      publicDeclarations.map((declaration) => this.unitId(declaration)),
    );
    for (const analysis of analyses)
      for (const declaration of analysis.declarations)
        declaration.public ||=
          declaration.merge && publicIdentities.has(this.unitId(declaration));
    for (const declaration of analyses
      .flatMap((analysis) => analysis.declarations)
      .filter((declaration) => declaration.public))
      published.set(declaration.id, this.unitId(declaration));

    const units = new Map<string, IEvidenceUnit>();
    const declarationIds = new Map<string, Set<string>>();
    const definitions = new Set<string>();
    const addresses = new Set<string>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        if (!declaration.public) continue;
        const id = this.unitId(declaration);
        if (declaration.definition && definitions.has(id))
          this.problem(
            inventory,
            analysis,
            "objc-definition-conflict",
            `Objective-C identity '${declaration.identity.join(".")}' has multiple implementations.`,
            "Select one implementation for this identity before checking coverage.",
          );
        if (declaration.definition) definitions.add(id);
        const parentId =
          declaration.ownerDeclarationId === undefined
            ? undefined
            : published.get(declaration.ownerDeclarationId);
        const previousDeclarations =
          declarationIds.get(id) ?? new Set<string>();
        if (
          ["interface", "protocol", "category"].includes(declaration.form) &&
          previousDeclarations.size !== 0 &&
          !previousDeclarations.has(declaration.id)
        )
          this.problem(
            inventory,
            analysis,
            "objc-declaration-conflict",
            `Objective-C public identity '${declaration.identity.join(".")}' has more than one selected declaration.`,
            "Select one source declaration for this declared-source identity before checking coverage.",
          );
        if (["interface", "protocol", "category"].includes(declaration.form))
          previousDeclarations.add(declaration.id);
        declarationIds.set(id, previousDeclarations);

        let unit = units.get(id);
        if (unit === undefined) {
          unit = {
            id,
            type: "objc",
            symbol: declaration.symbol,
            identity: declaration.identity,
            name: declaration.name,
            sites: [structuredClone(declaration.site)],
            withdrawals: [],
            ...(parentId === undefined ? {} : { parentId }),
          };
          units.set(id, unit);
        } else if (!unit.sites.some((site) => site.id === declaration.site.id))
          unit.sites.push(structuredClone(declaration.site));

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
   * Applies merged withdrawals before creating eligible annotation hosts.
   *
   * Hidden units cannot receive ordinary claim hosts after inheritance is
   * resolved.
   */
  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidenceObjcFileAnalysis[],
    published: Map<string, string>,
  ): void {
    const units = new Map(inventory.units.map((unit) => [unit.id, unit]));
    for (const analysis of analyses)
      for (const documentation of analysis.documentation) {
        const groups = this.attachmentGroups(documentation, published);
        if (groups.size === 0 && !this.annotation(analysis, documentation))
          continue;
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
   * Keeps every undocumented public declaration in the host denominator.
   *
   * Grouping by site prevents merged units from manufacturing duplicate hosts.
   */
  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analysis: IEvidenceObjcFileAnalysis,
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
    const groups = new Map<string, IEvidenceObjcDeclaration[]>();
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
   * Groups carrier attachments by their physical declaration site.
   *
   * A host can therefore identify all published units attached at one source
   * span.
   */
  private attachmentGroups(
    documentation: IEvidenceObjcDocumentation,
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
   * Records supported ownership or an actionable unsupported carrier.
   *
   * Tagged comments without a supported owner remain visible to the graph
   * reporter.
   */
  private host(
    source: IEvidenceSourceFile,
    documentation: IEvidenceObjcDocumentation,
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
              "Move the annotation into Doxygen attached to a supported public Objective-C declaration.",
          }),
    };
  }

  /**
   * Parses mapped Doxygen after ownership and example masking are established.
   *
   * Tag parsing receives a host with its resolved unit IDs and original range.
   */
  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidenceObjcDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    return EvidenceTagParser.parse(
      source.content,
      host,
      EvidenceObjcDocumentation.read(source, documentation, host.id),
    );
  }

  /**
   * Recognizes annotations and withdrawals on otherwise unsupported carriers.
   *
   * Such carriers require a diagnostic instead of silently dropping author
   * intent.
   */
  private annotation(
    analysis: IEvidenceObjcFileAnalysis,
    documentation: IEvidenceObjcDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceObjcDocumentation.read(
        analysis.source,
        documentation,
        documentation.id,
      ).text,
      true,
    );
  }

  /**
   * Detects graph annotations that cannot silently disappear on withdrawn
   * units.
   *
   * Review and claim tags remain reportable even when their attached unit is
   * hidden.
   */
  private claimAnnotation(
    analysis: IEvidenceObjcFileAnalysis,
    documentation: IEvidenceObjcDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceObjcDocumentation.read(
        analysis.source,
        documentation,
        documentation.id,
      ).text,
      false,
    );
  }

  /**
   * Finds tag boundaries in mapped comment text.
   *
   * Matching only line starts avoids treating prose or examples as annotations.
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
   * Follows real parent identities when propagating withdrawals.
   *
   * The visited set prevents malformed ownership cycles from recursing
   * indefinitely.
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
   * Keeps selector kinds and segmented nominal identities unambiguous.
   *
   * Symbol kind separates otherwise equal Objective-C name paths in the
   * inventory.
   */
  private unitId(declaration: IEvidenceObjcDeclaration): string {
    return `objc:${declaration.symbol}:${JSON.stringify(declaration.identity)}`;
  }

  /**
   * Prevents an ambiguous declaration family from reporting complete analysis.
   *
   * The diagnostic preserves the selected source boundary and repair guidance.
   */
  private problem(
    inventory: IEvidenceInventory,
    analysis: IEvidenceObjcFileAnalysis,
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
