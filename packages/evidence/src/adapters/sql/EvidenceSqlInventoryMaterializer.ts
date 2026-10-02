import typia from "typia";

import { EvidenceInventory } from "../../graph/EvidenceInventory";
import { EvidenceParser } from "../../parsers/EvidenceParser";
import { EvidenceParserError } from "../../parsers/EvidenceParserError";
import { EvidenceTagParser } from "../../parsers/EvidenceTagParser";
import type { IEvidenceHost } from "../../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidencePublicAddress } from "../../structures/IEvidencePublicAddress";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceSnapshot } from "../../structures/IEvidenceSourceSnapshot";
import type { IEvidenceTagParseResult } from "../../structures/IEvidenceTagParseResult";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { IEvidenceSqlDeclaration } from "./IEvidenceSqlDeclaration";
import type { IEvidenceSqlDocumentation } from "./IEvidenceSqlDocumentation";
import type { IEvidenceSqlFileAnalysis } from "./IEvidenceSqlFileAnalysis";
import { EvidenceSqlDocumentation } from "./EvidenceSqlDocumentation";
import type { IEvidenceSqlAdapterOptions } from "./IEvidenceSqlAdapterOptions";

/**
 * Materializes SQL-family inventories using an explicitly selected dialect
 * scanner.
 *
 * Dialect options own parsing and optional cross-file ownership resolution.
 * This shared layer manages parser lifetime, semantic declaration grouping,
 * public addresses, and documentation materialization. It analyzes source
 * declarations without connecting to a database or executing the supplied SQL.
 */
export class EvidenceSqlInventoryMaterializer {
  /**
   * Selects a dialect scanner and its optional cross-file ownership resolver.
   *
   * Construction records extraction policy without loading source or allocating
   * a parser runtime; analyze owns those resources for each snapshot.
   */
  public constructor(
    /**
     * Dialect-specific grammar discriminator and extraction hooks.
     *
     * The resolver, when present, runs after all file scans and before unit
     * publication.
     */
    private readonly options: IEvidenceSqlAdapterOptions,
  ) {}

  /**
   * Builds an owned SQL inventory through dialect scanning and shared
   * materialization.
   *
   * Source and parser failures retain incomplete state. Optional ownership
   * resolution precedes public grouping and annotation attachment, and native
   * parser resources close in cleanup after accepted scans settle.
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
          "Restore access to the selected database source before evaluating coverage.",
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
      // ALTER or COMMENT ownership may depend on declarations in another file.
      // Dialect resolution must finish before public IDs and hosts are finalized.
      this.options.resolve?.(analyses);
      for (const analysis of analyses) {
        inventory.diagnostics.push(...analysis.diagnostics);
        inventory.complete &&= analysis.complete;
      }
      const published = this.materializeUnits(inventory, analyses);
      this.materializeDocumentation(inventory, analyses, published);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  /**
   * Invokes the configured dialect scanner within a borrowed parse session.
   *
   * A failed parse becomes a dialect-prefixed diagnostic with source
   * coordinates and incomplete state, preserving its effect on the coverage
   * denominator.
   */
  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidenceSqlFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: this.options.type, file, content: source.content },
        (session) => this.options.scan(session, source),
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
            code: `${this.options.type}-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `Database parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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
   * Publishes public schema identities with explicit parents and physical
   * aliases.
   *
   * Source-local declaration IDs are mapped before parents are assigned.
   * Repeated declarations require an explicit merge allowance; otherwise a
   * conflict remains a diagnostic instead of silently combining independent
   * schema definitions.
   */
  private materializeUnits(
    inventory: IEvidenceInventory,
    analyses: IEvidenceSqlFileAnalysis[],
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
          declaration.merge !== true &&
          previousDeclarations.size !== 0 &&
          !previousDeclarations.has(declaration.id)
        )
          this.problem(
            inventory,
            analysis,
            `${this.options.type}-declaration-conflict`,
            `Database identity '${declaration.identity.join(".")}' has more than one selected declaration.`,
            "Select one source declaration for this schema identity before checking coverage.",
          );
        if (declaration.merge !== true)
          previousDeclarations.add(declaration.id);
        declarationIds.set(id, previousDeclarations);

        let unit = units.get(id);
        if (unit === undefined) {
          unit = {
            id,
            type: this.options.type,
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

        for (const sourceAddress of analysis.source.addresses)
          for (const segments of [
            declaration.address,
            ...(declaration.aliases ?? []),
          ]) {
            const address: IEvidencePublicAddress = {
              unitId: id,
              file: sourceAddress.absolute,
              segments,
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
   * Resolves withdrawals before publishing attached annotation hosts.
   *
   * Hidden declaration sites cannot receive claim or review hosts in the
   * inventory.
   */
  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidenceSqlFileAnalysis[],
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
   * Retains public declaration sites even when they carry no documentation.
   *
   * These hosts keep missing documentation visible to later graph evaluation.
   */
  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analysis: IEvidenceSqlFileAnalysis,
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
    const groups = new Map<string, IEvidenceSqlDeclaration[]>();
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
   * One comment can attach to merged declarations that share a single source
   * range.
   */
  private attachmentGroups(
    documentation: IEvidenceSqlDocumentation,
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
   * Unsupported carriers remain materialized so diagnostics can direct users to
   * a valid site.
   */
  private host(
    source: IEvidenceSourceFile,
    documentation: IEvidenceSqlDocumentation,
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
              "Move the annotation into documentation attached to a supported database declaration.",
          }),
    };
  }

  /**
   * Parses Evidence tags only after the adapter establishes their host.
   *
   * Tag parsing needs the resolved host identity and attachment decision.
   */
  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidenceSqlDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    return EvidenceTagParser.parse(
      source.content,
      host,
      EvidenceSqlDocumentation.read(source, documentation, host.id),
    );
  }

  /**
   * Detects Evidence or withdrawal annotations outside masked examples.
   *
   * The result retains otherwise detached carriers that require a diagnostic
   * host.
   */
  private annotation(
    analysis: IEvidenceSqlFileAnalysis,
    documentation: IEvidenceSqlDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceSqlDocumentation.read(
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
   * Withdrawal-only carriers do not create ordinary claim hosts.
   */
  private claimAnnotation(
    analysis: IEvidenceSqlFileAnalysis,
    documentation: IEvidenceSqlDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceSqlDocumentation.read(
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
   * Boundary matching prevents prose and examples from becoming annotation
   * syntax.
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
   * A visited set preserves termination when malformed ownership would
   * otherwise cycle.
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
   * Separates database kinds while unifying schema identities.
   *
   * Unit IDs remain stable across physical declaration sites for one database
   * selector.
   */
  private unitId(declaration: IEvidenceSqlDeclaration): string {
    return `${this.options.type}:${declaration.symbol}:${JSON.stringify(declaration.identity)}`;
  }

  /**
   * Marks a declaration conflict as incomplete analysis.
   *
   * A conflict must not allow the remaining declarations to appear as a
   * complete population.
   */
  private problem(
    inventory: IEvidenceInventory,
    analysis: IEvidenceSqlFileAnalysis,
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
