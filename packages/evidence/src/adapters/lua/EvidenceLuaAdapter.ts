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
import type { IEvidenceLuaDeclaration } from "./IEvidenceLuaDeclaration";
import type { IEvidenceLuaDocumentation } from "./IEvidenceLuaDocumentation";
import type { IEvidenceLuaFileAnalysis } from "./IEvidenceLuaFileAnalysis";
import { EvidenceLuaDocumentation } from "./EvidenceLuaDocumentation";
import { EvidenceLuaFileScanner } from "./EvidenceLuaFileScanner";

/**
 * Materializes statically established Lua declarations and documentation
 * owners.
 *
 * The scanner records supported globals, returned-table fields, and local alias
 * relationships without executing the module. Materialization publishes their
 * semantic units before LuaDoc becomes evidence hosts, so a shared source value
 * is not assigned an arbitrary table owner merely because a comment names it.
 * Source and syntax uncertainty remain part of the final inventory status.
 */
export class EvidenceLuaAdapter implements IEvidenceAdapter<"lua"> {
  /**
   * Lua discriminator for static global and module-table extraction.
   *
   * It selects Lua grammar and documentation rules. Tables remain property
   * units rather than becoming type declarations by analogy with another
   * language.
   */
  public get type(): "lua" {
    return "lua";
  }

  /**
   * Analyzes a copied Lua snapshot and returns reconciled public records.
   *
   * Declaration materialization precedes comment attachment, and common
   * inventory validation checks the resulting ownership. The parser closes
   * after success or failure; returned records contain no borrowed syntax
   * nodes.
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
          "Restore access to the selected Lua source before evaluating coverage.",
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
      // Publish the scanner-established owners before documentation is interpreted.
      // Tag text cannot decide which table owns an otherwise ambiguous value.
      const published = this.materializeUnits(inventory, analyses);
      this.materializeDocumentation(inventory, analyses, published);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  /**
   * Converts one parser failure into incomplete Lua source analysis.
   *
   * The returned diagnostic retains the parser category and available range so
   * a failed file cannot be mistaken for an empty inventory during graph
   * evaluation.
   */
  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidenceLuaFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: "lua", file, content: source.content },
        (session) => new EvidenceLuaFileScanner(session, source).scan(),
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
            code: `lua-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `Lua parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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
   * Materializes literal aliases into units and physical public addresses.
   *
   * Shared declarations retain one unit identity while each selected source
   * address remains visible; conflicting declarations make the inventory
   * incomplete.
   */
  private materializeUnits(
    inventory: IEvidenceInventory,
    analyses: IEvidenceLuaFileAnalysis[],
  ): Map<string, string> {
    const published = new Map<string, string>();
    const publicDeclarations = analyses.flatMap((analysis) =>
      analysis.declarations.filter((declaration) => declaration.public),
    );
    for (const declaration of publicDeclarations)
      published.set(declaration.id, this.unitId(declaration));

    const units = new Map<string, IEvidenceUnit>();
    const declarationIds = new Map<string, Set<string>>();
    const addresses = new Set<string>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        if (!declaration.public) continue;
        const id = this.unitId(declaration);
        const parentId =
          declaration.ownerDeclarationId === undefined
            ? undefined
            : published.get(declaration.ownerDeclarationId);
        const previousDeclarations =
          declarationIds.get(id) ?? new Set<string>();
        if (
          previousDeclarations.size !== 0 &&
          !previousDeclarations.has(declaration.id)
        )
          this.problem(
            inventory,
            analysis,
            "lua-declaration-conflict",
            `Lua public identity '${declaration.identity.join(".")}' has more than one selected declaration.`,
            "Select one source declaration for this file identity before checking coverage.",
          );
        previousDeclarations.add(declaration.id);
        declarationIds.set(id, previousDeclarations);

        let unit = units.get(id);
        if (unit === undefined) {
          unit = {
            id,
            type: "lua",
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
   * Resolves withdrawals before publishing attached documentation hosts.
   *
   * Withdrawal propagation hides affected units first, then tag parsing
   * publishes only visible attachment groups or an explicit unsupported
   * annotation host.
   */
  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidenceLuaFileAnalysis[],
    published: Map<string, string>,
  ): void {
    const units = new Map(inventory.units.map((unit) => [unit.id, unit]));
    for (const analysis of analyses)
      for (const documentation of analysis.documentation) {
        const groups = this.attachmentGroups(documentation, published);
        if (groups.size === 0 && !this.annotation(analysis, documentation))
          continue;
        if (groups.size !== 0)
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
   * Publishes hosts for visible public declaration sites without documentation.
   *
   * These attached hosts preserve physical origin and unit membership for later
   * graph and query consumers even when no tag carrier was parsed at the site.
   */
  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analysis: IEvidenceLuaFileAnalysis,
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
    const groups = new Map<string, IEvidenceLuaDeclaration[]>();
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
   * Multiple attachments at one site share a host and deduplicate unit IDs,
   * while unpublished declarations do not create annotation ownership.
   */
  private attachmentGroups(
    documentation: IEvidenceLuaDocumentation,
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
   * Creates an attached or explicitly unsupported documentation host.
   *
   * A host is attached only when it has both a declaration site and published
   * units; otherwise its repair guidance explains why tags cannot affect
   * coverage.
   */
  private host(
    source: IEvidenceSourceFile,
    documentation: IEvidenceLuaDocumentation,
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
              "Move the annotation into Lua documentation attached to a supported public Lua declaration.",
          }),
    };
  }

  /**
   * Parses Evidence tags after the adapter establishes their host boundary.
   *
   * EvidenceLuaDocumentation supplies normalized, example-masked text, ensuring
   * tags inherit the attached or unsupported ownership selected by this
   * adapter.
   */
  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidenceLuaDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    return EvidenceTagParser.parse(
      source.content,
      host,
      EvidenceLuaDocumentation.read(source, documentation, host.id),
    );
  }

  /**
   * Detects Evidence and withdrawal annotations outside masked examples.
   *
   * This broader scan decides whether an otherwise unattached carrier still
   * needs an unsupported host and diagnostic processing.
   */
  private annotation(
    analysis: IEvidenceLuaFileAnalysis,
    documentation: IEvidenceLuaDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceLuaDocumentation.read(
        analysis.source,
        documentation,
        documentation.id,
      ).text,
      true,
    );
  }

  /**
   * Detects acknowledgement and review annotations on withdrawn carriers.
   *
   * Withdrawal-only tags are excluded so hidden declarations do not retain a
   * carrier unless it can still contribute a claim-level annotation or review.
   */
  private claimAnnotation(
    analysis: IEvidenceLuaFileAnalysis,
    documentation: IEvidenceLuaDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceLuaDocumentation.read(
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
   * The withdrawal mode includes hidden and ignore forms; ordinary claim
   * parsing recognizes only evidence, exclusion, review, link, and internal
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
   * Follows explicit parent ownership to determine effective withdrawal.
   *
   * A visited set prevents malformed ownership cycles from recursing forever,
   * while a withdrawn ancestor hides each descendant from documentation hosts.
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
   * Builds a file-scoped unit identity that distinguishes programming kinds.
   *
   * Identity segments and the declaration symbol remain separate, allowing one
   * Lua file to expose similarly named properties and functions without
   * collision.
   */
  private unitId(declaration: IEvidenceLuaDeclaration): string {
    return `lua:${declaration.site.file}:${declaration.symbol}:${JSON.stringify(declaration.identity)}`;
  }

  /**
   * Records a declaration conflict and marks the Lua inventory incomplete.
   *
   * The diagnostic identifies the selected source file and preserves caller
   * repair guidance, preventing ambiguous public identity from entering
   * coverage.
   */
  private problem(
    inventory: IEvidenceInventory,
    analysis: IEvidenceLuaFileAnalysis,
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
