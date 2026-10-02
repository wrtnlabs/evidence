import typia from "typia";

import { EvidenceDocumentation } from "../../parsers/EvidenceDocumentation";
import { EvidenceInventory } from "../../graph/EvidenceInventory";
import { EvidenceParser } from "../../parsers/EvidenceParser";
import { EvidenceParserError } from "../../parsers/EvidenceParserError";
import { EvidenceTagParser } from "../../parsers/EvidenceTagParser";
import type { IEvidenceAdapter } from "../../structures/IEvidenceAdapter";
import type { IEvidenceHost } from "../../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceSnapshot } from "../../structures/IEvidenceSourceSnapshot";
import type { IEvidenceTagParseResult } from "../../structures/IEvidenceTagParseResult";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { IEvidenceRustDocumentation } from "./IEvidenceRustDocumentation";
import type { IEvidenceRustFileAnalysis } from "./IEvidenceRustFileAnalysis";
import { EvidenceRustFileScanner } from "./EvidenceRustFileScanner";
import { EvidenceRustModuleResolver } from "./EvidenceRustModuleResolver";

/**
 * Builds Rust public inventories by resolving modules, implementations, and
 * uses.
 *
 * File scans retain declaration and documentation candidates without assuming
 * that lexical presence makes an item publicly reachable.
 * EvidenceRustModuleResolver publishes semantic identities across the
 * configured snapshot before doc comments attach to those identities and
 * inherited withdrawal removes eligible hosts.
 */
export class EvidenceRustAdapter implements IEvidenceAdapter<"rust"> {
  /**
   * Artifact discriminator selecting Rust grammar and visibility rules.
   *
   * Population configuration uses this value to choose the crate-oriented
   * adapter.
   */
  public get type(): "rust" {
    return "rust";
  }

  /**
   * Extracts an isolated Rust inventory from captured source contents.
   *
   * Module publication precedes annotation materialization. Source and parser
   * failures retain incomplete state, and the parser runtime closes after all
   * accepted file scans finish.
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
          "Restore access to the selected Rust source before evaluating coverage.",
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
      // Source-local declaration IDs need the resolver's published identity map
      // before documentation attachments can name cross-module semantic owners.
      const published = new EvidenceRustModuleResolver(
        analyses,
        inventory,
      ).publish();
      this.materializeDocumentation(inventory, analyses, published);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  /**
   * Extracts one Rust file while its syntax tree remains borrowed.
   *
   * Module, use, and implementation records survive as serializable values. A
   * parser failure retains a located diagnostic and explicitly incomplete
   * state.
   */
  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidenceRustFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: "rust", file, content: source.content },
        (session) => new EvidenceRustFileScanner(session, source).scan(),
      );
    } catch (cause) {
      const parserError =
        cause instanceof EvidenceParserError ? cause : undefined;
      return {
        source,
        declarations: [],
        documentation: [],
        externalModules: [],
        implementations: [],
        uses: [],
        diagnostics: [
          {
            code: `rust-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `Rust parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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
   * Maps Rust documentation attachments through published semantic identities.
   *
   * The first pass collects withdrawals across merged sites; the second creates
   * visible hosts and accepted annotations after inherited hiding is known.
   */
  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidenceRustFileAnalysis[],
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
    // A withdrawal on any published fragment affects the whole identity and its
    // descendants before evidence from another fragment can become eligible.
    const hidden = new Set<string>();
    for (const unit of inventory.units)
      if (this.withdrawn(unit.id, units, new Set<string>()))
        hidden.add(unit.id);
    for (const analysis of analyses)
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
    this.materializeUndocumentedHosts(inventory, analyses, published, hidden);
  }

  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analyses: IEvidenceRustFileAnalysis[],
    published: Map<string, string>,
    hidden: Set<string>,
  ): void {
    for (const analysis of analyses) {
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
      for (const declaration of analysis.declarations) {
        const unitId = published.get(declaration.id);
        if (
          unitId === undefined ||
          hidden.has(unitId) ||
          documented.has(declaration.id)
        )
          continue;
        inventory.hosts.push({
          id: `${declaration.site.id}:host`,
          file: analysis.source.physicalPath,
          range: declaration.site.range,
          origins: analysis.source.addresses.map((address) => address.absolute),
          siteId: declaration.site.id,
          unitIds: [unitId],
          attachment: "attached",
        });
      }
    }
  }

  private attachmentGroups(
    documentation: IEvidenceRustDocumentation,
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

  private host(
    source: IEvidenceSourceFile,
    documentation: IEvidenceRustDocumentation,
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
              "Move the annotation into attached Rust documentation on a supported public declaration.",
          }),
    };
  }

  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidenceRustDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    return EvidenceTagParser.parse(
      source.content,
      host,
      EvidenceDocumentation.read(
        source.content,
        host.id,
        documentation.range,
        documentation.syntax,
      ),
    );
  }

  private annotation(
    analysis: IEvidenceRustFileAnalysis,
    documentation: IEvidenceRustDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceDocumentation.read(
        analysis.source.content,
        documentation.id,
        documentation.range,
        documentation.syntax,
      ).text,
      true,
    );
  }

  private claimAnnotation(
    analysis: IEvidenceRustFileAnalysis,
    documentation: IEvidenceRustDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceDocumentation.read(
        analysis.source.content,
        documentation.id,
        documentation.range,
        documentation.syntax,
      ).text,
      false,
    );
  }

  private annotationPattern(raw: string, withdrawal: boolean): boolean {
    return withdrawal
      ? /(?:^|[\r\n])[ \t]*@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link|internal|hidden|ignore)\b/u.test(
          raw,
        )
      : /(?:^|[\r\n])[ \t]*@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link)\b/u.test(
          raw,
        );
  }

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
}
