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
import type { IEvidenceDartDeclaration } from "./IEvidenceDartDeclaration";
import type { IEvidenceDartDocumentation } from "./IEvidenceDartDocumentation";
import type { IEvidenceDartFileAnalysis } from "./IEvidenceDartFileAnalysis";
import { EvidenceDartDocumentation } from "./EvidenceDartDocumentation";
import { EvidenceDartFileScanner } from "./EvidenceDartFileScanner";
import { EvidenceDartLibraries } from "./EvidenceDartLibraries";

/**
 * Resolves Dart library topology before publishing declarations and
 * documentation.
 *
 * File scans record directives and physical declarations. Reciprocal part
 * resolution establishes defining-library ownership, then unit materialization
 * and show/hide export publication expose aliases without duplicating
 * identities. Documentation is attached after those owners exist. Missing
 * library inputs remain dependencies so a later watch cycle can observe their
 * creation.
 */
export class EvidenceDartAdapter implements IEvidenceAdapter<"dart"> {
  /**
   * Dart artifact discriminator for library-aware extraction.
   *
   * The public entry point uses this fixed language for grammar selection and
   * inventory records, independently of claim or reference role.
   */
  public get type(): "dart" {
    return "dart";
  }

  /**
   * Builds an owned Dart inventory from captured source and library directives.
   *
   * Topology resolution runs before declarations are grouped by library.
   * Source, topology, and syntax failures preserve incomplete status, and
   * parser cleanup runs even if publication or documentation materialization
   * throws.
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
          "Restore access to the selected Dart source before evaluating coverage.",
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
      // Part declarations inherit the defining library's identity and privacy.
      // Validate that relationship before grouping declarations or exporting aliases.
      EvidenceDartLibraries.resolve(analyses, inventory);
      for (const analysis of analyses) {
        inventory.diagnostics.push(...analysis.diagnostics);
        inventory.complete &&= analysis.complete;
      }
      const published = this.materializeUnits(inventory, analyses);
      EvidenceDartLibraries.publish(analyses, inventory, published);
      this.materializeDocumentation(inventory, analyses, published);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  /**
   * Converts parser failures into incomplete source analysis.
   *
   * The returned record preserves file and parser-range diagnostics for the
   * inventory.
   */
  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidenceDartFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: "dart", file, content: source.content },
        (session) => new EvidenceDartFileScanner(session, source).scan(),
      );
    } catch (cause) {
      const parserError =
        cause instanceof EvidenceParserError ? cause : undefined;
      return {
        source,
        declarations: [],
        documentation: [],
        directives: [],
        library: source.physicalPath,
        diagnostics: [
          {
            code: `dart-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `Dart parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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
   * Reconciles library declarations and retains every physical declaration
   * address.
   *
   * This occurs before unit materialization so parts and exports share library
   * identity.
   */
  private materializeUnits(
    inventory: IEvidenceInventory,
    analyses: IEvidenceDartFileAnalysis[],
  ): Map<string, string> {
    const published = new Map<string, string>();
    const publicDeclarations = analyses.flatMap((analysis) =>
      analysis.declarations.filter((declaration) => declaration.public),
    );
    for (const declaration of publicDeclarations)
      published.set(declaration.id, this.unitId(declaration));

    const units = new Map<string, IEvidenceUnit>();
    const addresses = new Set<string>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        if (!declaration.public) continue;
        const id = this.unitId(declaration);
        const parentId =
          declaration.ownerDeclarationId === undefined
            ? undefined
            : published.get(declaration.ownerDeclarationId);
        let unit = units.get(id);
        if (unit === undefined) {
          unit = {
            id,
            type: "dart",
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
   * Resolves withdrawals before publishing attached annotation hosts.
   *
   * Hidden Dart declarations cannot create claim or review hosts.
   */
  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidenceDartFileAnalysis[],
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
   * These hosts keep missing documentation visible to graph evaluation.
   */
  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analysis: IEvidenceDartFileAnalysis,
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
    const groups = new Map<string, IEvidenceDartDeclaration[]>();
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
   * One documentation carrier can attach to declarations that share a source
   * span.
   */
  private attachmentGroups(
    documentation: IEvidenceDartDocumentation,
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
   * Unsupported carriers remain available for a source-located diagnostic.
   */
  private host(
    source: IEvidenceSourceFile,
    documentation: IEvidenceDartDocumentation,
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
              "Move the annotation into Dart documentation attached to a supported public Dart declaration.",
          }),
    };
  }

  /**
   * Parses Evidence tags only after the adapter establishes their host.
   *
   * Tag parsing requires the resolved attachment and unit ownership.
   */
  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidenceDartDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    return EvidenceTagParser.parse(
      source.content,
      host,
      EvidenceDartDocumentation.read(source, documentation, host.id),
    );
  }

  /**
   * Detects Evidence or withdrawal annotations outside masked examples.
   *
   * Detached annotation carriers still need an unsupported host diagnostic.
   */
  private annotation(
    analysis: IEvidenceDartFileAnalysis,
    documentation: IEvidenceDartDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceDartDocumentation.read(
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
   * Such carriers cannot also produce ordinary claim hosts.
   */
  private claimAnnotation(
    analysis: IEvidenceDartFileAnalysis,
    documentation: IEvidenceDartDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceDartDocumentation.read(
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
   * Boundary matching prevents prose and examples from becoming tag syntax.
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
   * The visited set terminates malformed ownership cycles.
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
   * Separates defining libraries and programming kinds while merging
   * complementary accessors.
   *
   * Unit IDs remain stable across parts that contribute one public Dart
   * declaration.
   */
  private unitId(declaration: IEvidenceDartDeclaration): string {
    return `dart:${declaration.library}:${declaration.symbol}:${JSON.stringify(declaration.identity)}`;
  }
}
