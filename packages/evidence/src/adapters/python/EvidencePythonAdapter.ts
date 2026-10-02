import typia from "typia";

import { EvidenceDocumentation } from "../../parsers/EvidenceDocumentation";
import { EvidenceInventory } from "../../graph/EvidenceInventory";
import { EvidenceParser } from "../../parsers/EvidenceParser";
import { EvidenceParserError } from "../../parsers/EvidenceParserError";
import { EvidenceTagParser } from "../../parsers/EvidenceTagParser";
import type { IEvidenceAdapter } from "../../structures/IEvidenceAdapter";
import type { IEvidenceDocumentation } from "../../structures/IEvidenceDocumentation";
import type { IEvidenceHost } from "../../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceSnapshot } from "../../structures/IEvidenceSourceSnapshot";
import type { IEvidenceTagParseResult } from "../../structures/IEvidenceTagParseResult";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { IEvidencePythonDocumentation } from "./IEvidencePythonDocumentation";
import type { IEvidencePythonFileAnalysis } from "./IEvidencePythonFileAnalysis";
import { EvidencePythonExportResolver } from "./EvidencePythonExportResolver";
import { EvidencePythonFileScanner } from "./EvidencePythonFileScanner";

/**
 * Extracts Python declarations through bounded static export and re-export
 * analysis.
 *
 * File scanning records candidate units, bindings, and docstring ownership
 * before EvidencePythonExportResolver determines which identities are publicly
 * reachable. Only published owners receive eligible documentation hosts; parser
 * and export failures remain incomplete inventory diagnostics instead of
 * shrinking coverage.
 */
export class EvidencePythonAdapter implements IEvidenceAdapter<"python"> {
  /**
   * Artifact family selecting Python parsing and public-surface rules.
   *
   * The common adapter contract uses this discriminator independently of query
   * selectors.
   */
  public get type(): "python" {
    return "python";
  }

  /**
   * Builds an owned inventory from the supplied Python source snapshot.
   *
   * The method validates and clones input, scans with a bounded parser runtime,
   * resolves public exports, and materializes annotations on their published
   * owners. Native resources close in cleanup even when extraction fails.
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
          "Restore access to the selected Python source before evaluating coverage.",
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
        inventory.units.push(...analysis.units.map((entry) => entry.unit));
        inventory.diagnostics.push(...analysis.diagnostics);
        inventory.complete &&= analysis.complete;
      }
      // Public reachability must be settled before docstrings become eligible
      // hosts; merely scanning a local declaration cannot make it public evidence.
      const published = new EvidencePythonExportResolver(
        analyses,
        inventory,
        input.root,
      ).publish();
      inventory.units = inventory.units.filter((unit) =>
        published.has(unit.id),
      );
      const stablePublished: Set<string> = this.stabilizeRuntimeUnits(
        inventory,
        analyses,
        published,
      );
      this.materializeDocumentation(inventory, analyses, stablePublished);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  /**
   * Restores stable semantic IDs after runtime-rebinding selection is complete.
   *
   * The scanner gives executable occurrences private suffixes so documentation
   * on a replaced definition cannot attach to its survivor. Export resolution
   * first chooses the winning occurrences; this pass then removes only their
   * suffixes and rewrites the selected units, parents, addresses, and
   * attachment candidates together. Unpublished attachments retain their
   * occurrence IDs and therefore cannot regain eligibility after
   * canonicalization.
   */
  private stabilizeRuntimeUnits(
    inventory: IEvidenceInventory,
    analyses: IEvidencePythonFileAnalysis[],
    published: Set<string>,
  ): Set<string> {
    const stableIds: Map<string, string> = new Map<string, string>();
    const owners: Set<string> = new Set<string>();
    for (const id of published) {
      const stable: string = id.replace(/:binding:\d+$/u, "");
      if (owners.has(stable))
        throw new Error(
          `Python runtime bindings share semantic identity: ${stable}`,
        );
      owners.add(stable);
      stableIds.set(id, stable);
    }
    for (const unit of inventory.units) {
      const stable: string | undefined = stableIds.get(unit.id);
      if (stable === undefined) continue;
      unit.id = stable;
      if (unit.parentId !== undefined)
        unit.parentId = stableIds.get(unit.parentId) ?? unit.parentId;
    }
    for (const address of inventory.addresses)
      address.unitId = stableIds.get(address.unitId) ?? address.unitId;
    for (const analysis of analyses) {
      for (const documentation of analysis.documentation)
        for (const attachment of documentation.attachments)
          attachment.unitId =
            stableIds.get(attachment.unitId) ?? attachment.unitId;
      for (const position of analysis.positions)
        position.unitIds = position.unitIds.map(
          (unitId: string): string => stableIds.get(unitId) ?? unitId,
        );
    }
    return owners;
  }

  /**
   * Copies one Python file's declarations and bindings out of a borrowed parse
   * session.
   *
   * A parse failure returns an explicitly incomplete analysis with its source
   * location, preserving the failure when other files can still be scanned.
   */
  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidencePythonFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: "python", file, content: source.content },
        (session) => new EvidencePythonFileScanner(session, source).scan(),
      );
    } catch (cause) {
      const parserError =
        cause instanceof EvidenceParserError ? cause : undefined;
      return {
        source,
        all: { state: "absent", names: [] },
        bindings: [],
        units: [],
        positions: [],
        documentation: [],
        diagnostics: [
          {
            code: `python-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `Python parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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
   * Attaches parsed documentation only after exported identity selection is
   * known.
   *
   * Withdrawal directives are collected before visible hosts are finalized, so
   * hidden parents cannot leave descendants as eligible evidence carriers.
   */
  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidencePythonFileAnalysis[],
    published: Set<string>,
  ): void {
    const units = new Map(inventory.units.map((unit) => [unit.id, unit]));
    for (const analysis of analyses)
      for (const documentation of analysis.documentation) {
        const attachments = documentation.attachments.filter((entry) =>
          published.has(entry.unitId),
        );
        if (
          attachments.length === 0 &&
          !this.annotation(analysis, documentation)
        )
          continue;
        inventory.annotationRanges.push({
          file: analysis.source.physicalPath,
          range: documentation.range,
        });
        const siteId = attachments[0]?.siteId;
        const unitIds = Array.from(
          new Set(attachments.map((entry) => entry.unitId)),
        );
        const candidate = this.host(
          analysis.source,
          documentation,
          siteId,
          unitIds,
        );
        if (candidate.attachment === "attached") {
          const parsed = this.parse(analysis.source, documentation, candidate);
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
    for (const analysis of analyses)
      for (const documentation of analysis.documentation) {
        const publishedAttachments = documentation.attachments.filter((entry) =>
          published.has(entry.unitId),
        );
        const attachments = publishedAttachments.filter(
          (entry) => !hidden.has(entry.unitId),
        );
        if (
          attachments.length === 0 &&
          publishedAttachments.length !== 0 &&
          !this.claimAnnotation(analysis, documentation)
        )
          continue;
        if (
          attachments.length === 0 &&
          !this.annotation(analysis, documentation)
        )
          continue;
        const siteId = attachments[0]?.siteId;
        const positionId = attachments[0]?.positionId;
        const unitIds = Array.from(
          new Set(
            attachments
              .filter(
                (entry) =>
                  entry.positionId === positionId && entry.siteId === siteId,
              )
              .map((entry) => entry.unitId),
          ),
        );
        const host = this.host(analysis.source, documentation, siteId, unitIds);
        inventory.hosts.push(host);
        const parsed = this.parse(analysis.source, documentation, host);
        inventory.declarations.push(...parsed.declarations);
        inventory.reviews.push(...parsed.reviews);
        inventory.diagnostics.push(...parsed.diagnostics);
      }
    this.materializeUndocumentedHosts(inventory, analyses, published, hidden);
  }

  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analyses: IEvidencePythonFileAnalysis[],
    published: Set<string>,
    hidden: Set<string>,
  ): void {
    const documented = new Set(
      analyses.flatMap((analysis) =>
        analysis.documentation.flatMap((documentation) =>
          documentation.attachments.flatMap((attachment) =>
            published.has(attachment.unitId) && !hidden.has(attachment.unitId)
              ? [attachment.positionId]
              : [],
          ),
        ),
      ),
    );
    for (const analysis of analyses)
      for (const position of analysis.positions) {
        if (documented.has(position.id)) continue;
        const unitIds = position.unitIds.filter(
          (unitId) => published.has(unitId) && !hidden.has(unitId),
        );
        if (unitIds.length === 0) continue;
        inventory.hosts.push({
          id: `${position.id}:host`,
          file: analysis.source.physicalPath,
          range: position.range,
          origins: analysis.source.addresses.map((address) => address.absolute),
          siteId: position.siteId,
          unitIds,
          attachment: "attached",
        });
      }
  }

  private host(
    source: IEvidenceSourceFile,
    documentation: IEvidencePythonDocumentation,
    siteId: string | undefined,
    unitIds: string[],
  ): IEvidenceHost {
    const attached = siteId !== undefined && unitIds.length !== 0;
    return {
      id: documentation.id,
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
              "Move the annotation into a declaration docstring or an adjacent same-indent comment run on a supported public Python declaration.",
          }),
    };
  }

  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidencePythonDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    const mapped = this.mapping(source, documentation);
    return EvidenceTagParser.parse(source.content, host, mapped);
  }

  private annotation(
    analysis: IEvidencePythonFileAnalysis,
    documentation: IEvidencePythonDocumentation,
  ): boolean {
    return this.annotationPattern(
      this.mapping(analysis.source, documentation).text,
      true,
    );
  }

  private claimAnnotation(
    analysis: IEvidencePythonFileAnalysis,
    documentation: IEvidencePythonDocumentation,
  ): boolean {
    return this.annotationPattern(
      this.mapping(analysis.source, documentation).text,
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

  private mapping(
    source: IEvidenceSourceFile,
    documentation: IEvidencePythonDocumentation,
  ): IEvidenceDocumentation {
    if (documentation.mapping !== undefined)
      return structuredClone(documentation.mapping);
    if (documentation.syntax === undefined)
      throw new Error("Python documentation has no source mapping.");
    return EvidenceDocumentation.read(
      source.content,
      documentation.id,
      documentation.range,
      documentation.syntax,
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
