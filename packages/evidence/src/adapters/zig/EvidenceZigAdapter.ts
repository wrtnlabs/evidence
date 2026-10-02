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
import type { IEvidenceZigDeclaration } from "./IEvidenceZigDeclaration";
import type { IEvidenceZigDocumentation } from "./IEvidenceZigDocumentation";
import type { IEvidenceZigFileAnalysis } from "./IEvidenceZigFileAnalysis";
import { EvidenceZigDocumentation } from "./EvidenceZigDocumentation";
import { EvidenceZigFileScanner } from "./EvidenceZigFileScanner";

/**
 * Materializes explicit Zig container declarations and their documentation
 * hosts.
 *
 * File scanning establishes lexical visibility, supported aliases, and source
 * attachment before publication. The adapter reconciles those declaration
 * records into units and public addresses, then applies documentation and
 * withdrawals through their real owners. It preserves unsupported source forms
 * as incomplete findings rather than evaluating comptime code to guess a public
 * surface.
 */
export class EvidenceZigAdapter implements IEvidenceAdapter<"zig"> {
  /**
   * Zig discriminator for the pinned declared-source extraction rules.
   *
   * It fixes grammar and container semantics for both graph roles; it does not
   * authorize build execution or inferred declarations outside selected
   * source.
   */
  public get type(): "zig" {
    return "zig";
  }

  /**
   * Extracts a fresh Zig inventory from a validated copy of the snapshot.
   *
   * Semantic publication precedes documentation so aliases keep the original
   * owner and withdrawals. Completeness includes every scan's outcome, and the
   * invocation releases parser resources on all completion paths.
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
          "Restore access to the selected Zig source before evaluating coverage.",
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
      // Alias publication must preserve the defining unit before its documentation
      // and inherited withdrawals can be projected onto eligible hosts.
      const published = this.materializeUnits(inventory, analyses);
      this.materializeDocumentation(inventory, analyses, published);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  /**
   * Converts parser failures into an explicitly incomplete source analysis.
   *
   * Other selected files can still contribute their records, while this source
   * retains a location-aware diagnostic instead of silently disappearing.
   */
  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidenceZigFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: "zig", file, content: source.content },
        (session) => new EvidenceZigFileScanner(session, source).scan(),
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
            code: `zig-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `Zig parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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
   * Reconciles aliases into units while retaining every physical declaration
   * address.
   *
   * Canonical identity deduplicates alias projections, whereas each supported
   * public accessor contributes an address and its original source site remains
   * reviewable.
   */
  private materializeUnits(
    inventory: IEvidenceInventory,
    analyses: IEvidenceZigFileAnalysis[],
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
          !declaration.alias &&
          previousDeclarations.size !== 0 &&
          !previousDeclarations.has(declaration.site.id)
        )
          this.problem(
            inventory,
            analysis,
            "zig-declaration-conflict",
            `Zig public identity '${declaration.identity.join(".")}' has more than one selected declaration.`,
            "Select one source declaration for this file-qualified identity before checking coverage.",
          );
        previousDeclarations.add(declaration.site.id);
        declarationIds.set(id, previousDeclarations);

        let unit = units.get(id);
        if (unit === undefined) {
          unit = {
            id,
            type: "zig",
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
   * Processing withdrawals first prevents a hidden owner or descendant from
   * retaining a claim host after its semantic unit becomes ineligible.
   */
  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidenceZigFileAnalysis[],
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
   * Materializes public declaration sites that carry no documentation.
   *
   * These hosts preserve uncovered eligible units after attachment and
   * withdrawal processing, grouping declarations that share one physical source
   * site.
   */
  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analysis: IEvidenceZigFileAnalysis,
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
    const groups = new Map<string, IEvidenceZigDeclaration[]>();
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
   * A documentation carrier can affect several units at one site; each group
   * becomes one host with deduplicated published unit identities.
   */
  private attachmentGroups(
    documentation: IEvidenceZigDocumentation,
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
   * Creates a host for an attached or explicitly unsupported documentation
   * carrier.
   *
   * Unattached tag-bearing source receives an unsupported host so diagnostics
   * retain a physical location instead of being discarded during
   * materialization.
   */
  private host(
    source: IEvidenceSourceFile,
    documentation: IEvidenceZigDocumentation,
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
              "Move the annotation into Zig documentation attached to a supported public Zig declaration.",
          }),
    };
  }

  /**
   * Parses Evidence tags after the adapter establishes their documentation
   * host.
   *
   * Host identity and unit membership are required by tag parsing, so parsing
   * cannot occur while alias and withdrawal eligibility remain unresolved.
   */
  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidenceZigDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    return EvidenceTagParser.parse(
      source.content,
      host,
      EvidenceZigDocumentation.read(source, documentation, host.id),
    );
  }

  /**
   * Detects Evidence or withdrawal annotations outside masked examples.
   *
   * The result decides whether an unattached carrier must survive as a host for
   * diagnostics or withdrawal processing rather than being ignored as prose.
   */
  private annotation(
    analysis: IEvidenceZigFileAnalysis,
    documentation: IEvidenceZigDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceZigDocumentation.read(
        analysis.source,
        documentation,
        documentation.id,
      ).text,
      true,
    );
  }

  /**
   * Detects claims that remain relevant when a carrier's unit is withdrawn.
   *
   * Evidence claims are excluded here, leaving acknowledgement and review tags
   * available for validation without publishing a hidden declaration host.
   */
  private claimAnnotation(
    analysis: IEvidenceZigFileAnalysis,
    documentation: IEvidenceZigDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceZigDocumentation.read(
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
   * Matching only line-leading tags prevents ordinary prose mentions from
   * materializing diagnostics or claim hosts.
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
   * Follows explicit parent ownership to propagate withdrawal eligibility.
   *
   * A visited set breaks malformed parent cycles while any withdrawal on an
   * ancestor hides the complete descendant surface from host publication.
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
   * Builds a canonical unit identity without merging declarations across files.
   *
   * Source identity prefixes the lexical declaration path so aliases can unify
   * within their selected file while physically distinct files stay
   * independent.
   */
  private unitId(declaration: IEvidenceZigDeclaration): string {
    return `zig:${declaration.site.file}:${declaration.symbol}:${JSON.stringify(declaration.identity)}`;
  }

  /**
   * Records a declaration conflict and marks the analysis incomplete.
   *
   * The adapter preserves the conflict diagnostic rather than selecting one
   * ambiguous physical declaration as the sole canonical public unit.
   */
  private problem(
    inventory: IEvidenceInventory,
    analysis: IEvidenceZigFileAnalysis,
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
