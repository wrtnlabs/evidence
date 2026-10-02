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
import type { IEvidenceEcmaScriptComment } from "./IEvidenceEcmaScriptComment";
import type { IEvidenceEcmaScriptFileAnalysis } from "./IEvidenceEcmaScriptFileAnalysis";
import { EvidenceEcmaScriptExportResolver } from "./EvidenceEcmaScriptExportResolver";
import { EvidenceEcmaScriptFileScanner } from "./EvidenceEcmaScriptFileScanner";
import { EvidenceEcmaScriptModuleResolver } from "./EvidenceEcmaScriptModuleResolver";
import { EvidenceEcmaScriptDependencyLoader } from "./EvidenceEcmaScriptDependencyLoader";
import type { IEvidenceSourceDiagnostic } from "../../structures/IEvidenceSourceDiagnostic";
import type { IEvidenceSourceAddress } from "../../structures/IEvidenceSourceAddress";
import type { IEvidenceEcmaScriptModuleResolution } from "./IEvidenceEcmaScriptModuleResolution";
import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { IEvidencePublicAddress } from "../../structures/IEvidencePublicAddress";
import type { EvidenceEcmaScriptType } from "./EvidenceEcmaScriptType";

/**
 * Shares declaration, export, and JSDoc materialization between TypeScript and
 * JavaScript.
 *
 * JavaScript first resolves file/package module modes; TypeScript uses its
 * static module rules. File scanning records units and physical comment
 * attachment, then export resolution determines which identities are publicly
 * reachable within the configured root. Only afterward are annotations
 * materialized as hosts and statements, preserving aliases without duplicating
 * semantic declarations.
 *
 * Source, package-scope, and syntax failures all contribute to completeness.
 * Package dependencies remain observable for watch, and each analysis owns its
 * parser and copied input rather than retaining prior mutable inventories.
 */
export abstract class EvidenceEcmaScriptAdapter<
  Type extends EvidenceEcmaScriptType,
> implements IEvidenceAdapter<Type> {
  /**
   * Selects the language variant and diagnostic name for the shared pipeline.
   *
   * Public JavaScript and TypeScript entry points expose their fixed literal
   * type through the abstract accessor. Construction itself performs no package
   * resolution or grammar acquisition.
   */
  public constructor(
    /**
     * Human-readable language name included in extraction diagnostics.
     *
     * The discriminator supplies behavior; this label explains failures without
     * changing identity, selection, or target resolution.
     */
    private readonly name: string,
  ) {}

  /**
   * Language variant controlling grammar and publication semantics.
   *
   * JavaScript additionally resolves module modes from file/package context;
   * TypeScript follows the selected TypeScript/TSX source forms. Concrete
   * adapters preserve their literal discriminator for callers.
   */
  public abstract get type(): Type;

  /**
   * Extracts a fresh public module inventory from the supplied source
   * snapshots.
   *
   * The input is copied before package resolution or parsing. Export
   * reachability filters semantic units only after all local declarations are
   * available, and failures remain in completeness and diagnostics. Native
   * parser resources close whether publication succeeds or throws.
   */
  public async analyze(
    snapshot: IEvidenceSourceSnapshot,
  ): Promise<IEvidenceInventory> {
    const input = structuredClone(typia.assert(snapshot));
    // JavaScript export semantics depend on package scope as well as syntax.
    // Capture that dependency before choosing a file scanner's module mode.
    const moduleResolution =
      this.type === "javascript"
        ? await new EvidenceEcmaScriptModuleResolver().resolve(input.files)
        : undefined;
    const sourceDiagnostics: IEvidenceInventory["diagnostics"] =
      input.diagnostics.map((diagnostic) => ({
        code: `source-${diagnostic.code}`,
        severity: "error",
        message: diagnostic.message,
        repair: `Restore access to the selected ${this.name} source before evaluating coverage.`,
        location: { file: diagnostic.path },
      }));
    const parser = new EvidenceParser();
    const inventory: IEvidenceInventory = {
      schemaVersion: 1,
      sources: input.files,
      annotationRanges: [],
      units: [],
      addresses: [],
      hosts: [],
      declarations: [],
      reviews: [],
      diagnostics: [
        ...sourceDiagnostics,
        ...(moduleResolution?.diagnostics ?? []),
      ],
      dependencies: [
        ...input.dependencies,
        ...(moduleResolution?.dependencies ?? []),
      ],
      complete: input.complete && (moduleResolution?.complete ?? true),
    };
    try {
      const analyses: IEvidenceEcmaScriptFileAnalysis[] = await Promise.all(
        input.files.map((source) =>
          this.scan(
            parser,
            source,
            this.type === "javascript" && moduleResolution !== undefined
              ? (moduleResolution.modes.get(source.id) ?? "commonjs")
              : "esm",
          ),
        ),
      );
      const dependencyCount: number = input.dependencies.length;
      await EvidenceEcmaScriptDependencyLoader.expand(
        input,
        analyses,
        this.type,
        async (
          source: IEvidenceSourceFile,
        ): Promise<IEvidenceEcmaScriptFileAnalysis> => {
          const resolution: IEvidenceEcmaScriptModuleResolution | undefined =
            this.type === "javascript"
              ? await new EvidenceEcmaScriptModuleResolver().resolve([source])
              : undefined;
          if (resolution !== undefined) {
            inventory.dependencies.push(...resolution.dependencies);
            inventory.diagnostics.push(...resolution.diagnostics);
            inventory.complete &&= resolution.complete;
          }
          return this.scan(
            parser,
            source,
            resolution === undefined
              ? "esm"
              : (resolution.modes.get(source.id) ?? "commonjs"),
          );
        },
      );
      inventory.dependencies.push(...input.dependencies.slice(dependencyCount));
      inventory.complete &&= input.complete;
      inventory.diagnostics.push(
        ...input.diagnostics
          .slice(sourceDiagnostics.length)
          .map(
            (
              diagnostic: IEvidenceSourceDiagnostic,
            ): IEvidenceInventory["diagnostics"][number] => ({
              code: `source-${diagnostic.code}`,
              severity: "error",
              message: diagnostic.message,
              repair: `Restore access to the local ${this.name} export dependency before evaluating coverage.`,
              location: { file: diagnostic.path },
            }),
          ),
      );
      for (const analysis of analyses) {
        inventory.annotationRanges.push(
          ...analysis.comments
            .filter((comment) => comment.syntax.opening === "/**")
            .map((comment) => ({
              file: analysis.source.physicalPath,
              range: comment.range,
            })),
        );
        inventory.units.push(...analysis.units.map((entry) => entry.unit));
        inventory.diagnostics.push(...analysis.diagnostics);
        inventory.complete &&= analysis.complete;
      }
      // Resolve public reachability against the full local inventory first.
      // Filtering earlier would lose declarations reached only through re-exports.
      const published = new EvidenceEcmaScriptExportResolver(
        analyses,
        inventory,
        input.root,
        this.type,
      ).publish();
      // Support files resolve aliases but never enroll their own declarations.
      // Selection follows physical declaration owners, not barrel addresses.
      const owners: Set<string> = new Set(
        input.files
          .filter((source: IEvidenceSourceFile): boolean =>
            this.selected(source),
          )
          .map((source: IEvidenceSourceFile): string => source.physicalPath),
      );
      inventory.units = inventory.units.filter(
        (unit: IEvidenceUnit): boolean =>
          published.has(unit.id) &&
          unit.sites.some((site: IEvidenceUnitSite): boolean =>
            owners.has(site.file),
          ),
      );
      const retained: Set<string> = new Set(
        inventory.units.map((unit: IEvidenceUnit): string => unit.id),
      );
      inventory.addresses = inventory.addresses.filter(
        (address: IEvidencePublicAddress): boolean =>
          retained.has(address.unitId),
      );
      const stablePublished: Set<string> = this.stabilizeRuntimeUnits(
        inventory,
        analyses,
        retained,
      );
      this.materializeComments(inventory, analyses, stablePublished);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  /**
   * Restores stable JavaScript IDs after runtime-rebinding selection completes.
   *
   * Occurrence suffixes keep documentation on replaced values isolated during
   * export resolution. Once that resolver has selected the public winners, this
   * pass canonicalizes their units, parents, addresses, comment attachments,
   * and fallback host positions together. Attachments on unpublished
   * occurrences retain private IDs and cannot become eligible through the
   * transition.
   */
  private stabilizeRuntimeUnits(
    inventory: IEvidenceInventory,
    analyses: IEvidenceEcmaScriptFileAnalysis[],
    published: Set<string>,
  ): Set<string> {
    const stableIds: Map<string, string> = new Map<string, string>();
    const owners: Set<string> = new Set<string>();
    for (const id of published) {
      const stable: string = id.replace(/:binding:\d+$/u, "");
      if (owners.has(stable))
        throw new Error(
          `${this.name} runtime bindings share semantic identity: ${stable}`,
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
      for (const comment of analysis.comments)
        for (const attachment of comment.attachments)
          attachment.unitId =
            stableIds.get(attachment.unitId) ?? attachment.unitId;
      for (const position of analysis.positions)
        position.unitIds = position.unitIds.map(
          (unitId: string): string => stableIds.get(unitId) ?? unitId,
        );
    }
    return owners;
  }

  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
    mode: IEvidenceEcmaScriptFileAnalysis["mode"],
  ): Promise<IEvidenceEcmaScriptFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: this.type, file, content: source.content },
        (session) =>
          new EvidenceEcmaScriptFileScanner(
            session,
            source,
            this.type,
            mode,
          ).scan(),
      );
    } catch (cause) {
      const parserError =
        cause instanceof EvidenceParserError ? cause : undefined;
      return {
        source,
        mode,
        units: [],
        excludedRoots: [],
        exports: [],
        imports: [],
        positions: [],
        comments: [],
        diagnostics: [
          {
            code: `${this.type as string}-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `${this.name} parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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
   * Keeps owner selection separate from support-only dependency addresses.
   *
   * Older in-memory snapshots without addresses retain their selected status;
   * loaded dependency files explicitly mark every address as support-only.
   */
  private selected(source: IEvidenceSourceFile): boolean {
    return (
      source.addresses.length === 0 ||
      source.addresses.some(
        (address: IEvidenceSourceAddress): boolean =>
          address.selected !== false,
      )
    );
  }

  private materializeComments(
    inventory: IEvidenceInventory,
    analyses: IEvidenceEcmaScriptFileAnalysis[],
    published: Set<string>,
  ): void {
    const units = new Map(inventory.units.map((unit) => [unit.id, unit]));
    for (const analysis of analyses)
      for (const comment of analysis.comments) {
        if (!this.selected(analysis.source)) continue;
        const attachments = comment.attachments.filter((entry) =>
          published.has(entry.unitId),
        );
        if (
          attachments.length === 0 &&
          !this.annotation(analysis.source, comment)
        )
          continue;
        const siteId = attachments[0]?.siteId;
        const unitIds = Array.from(
          new Set(attachments.map((entry) => entry.unitId)),
        );
        const candidate = this.host(analysis.source, comment, siteId, unitIds);
        if (candidate.attachment === "attached") {
          const parsed = this.parse(analysis.source, comment, candidate);
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
      for (const comment of analysis.comments) {
        const publishedAttachments = comment.attachments.filter((entry) =>
          published.has(entry.unitId),
        );
        if (!this.selected(analysis.source)) continue;
        const attachments = publishedAttachments.filter(
          (entry) =>
            entry.withdrawalOnly !== true &&
            entry.positionId !== undefined &&
            !hidden.has(entry.unitId),
        );
        if (
          attachments.length === 0 &&
          publishedAttachments.length !== 0 &&
          !this.claimAnnotation(analysis.source, comment)
        )
          continue;
        if (
          attachments.length === 0 &&
          !this.annotation(analysis.source, comment)
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
        const host = this.host(analysis.source, comment, siteId, unitIds);
        inventory.hosts.push(host);
        const parsed = this.parse(analysis.source, comment, host);
        inventory.declarations.push(...parsed.declarations);
        inventory.reviews.push(...parsed.reviews);
        inventory.diagnostics.push(...parsed.diagnostics);
      }
    this.materializeUndocumentedHosts(inventory, analyses, published, hidden);
  }

  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analyses: IEvidenceEcmaScriptFileAnalysis[],
    published: Set<string>,
    hidden: Set<string>,
  ): void {
    const documented = new Set(
      analyses.flatMap((analysis) =>
        analysis.comments.flatMap((comment) =>
          comment.attachments.flatMap((attachment) =>
            attachment.withdrawalOnly !== true &&
            attachment.positionId !== undefined &&
            published.has(attachment.unitId) &&
            !hidden.has(attachment.unitId)
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
    comment: IEvidenceEcmaScriptComment,
    siteId: string | undefined,
    unitIds: string[],
  ): IEvidenceHost {
    const attached = siteId !== undefined && unitIds.length !== 0;
    return {
      id: comment.id,
      file: source.physicalPath,
      range: comment.range,
      origins: source.addresses.map((address) => address.absolute),
      unitIds,
      attachment: attached ? "attached" : "unsupported",
      ...(attached ? { siteId } : {}),
      ...(attached
        ? {}
        : {
            problem: `Move the annotation into JSDoc attached to a supported public ${this.name} declaration.`,
          }),
    };
  }

  private parse(
    source: IEvidenceSourceFile,
    comment: IEvidenceEcmaScriptComment,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    const documentation = EvidenceDocumentation.read(
      source.content,
      host.id,
      host.range,
      comment.syntax,
    );
    return EvidenceTagParser.parse(source.content, host, documentation);
  }

  private annotation(
    source: IEvidenceSourceFile,
    comment: IEvidenceEcmaScriptComment,
  ): boolean {
    const raw = source.content.slice(
      comment.range.start.offset,
      comment.range.end.offset,
    );
    return /(?:^|[\r\n])[ \t]*(?:(?:\/\/|\/\*+|\*)[ \t]*)?@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link|internal|hidden|ignore)\b/u.test(
      raw,
    );
  }

  private claimAnnotation(
    source: IEvidenceSourceFile,
    comment: IEvidenceEcmaScriptComment,
  ): boolean {
    const raw = source.content.slice(
      comment.range.start.offset,
      comment.range.end.offset,
    );
    return /(?:^|[\r\n])[ \t]*(?:(?:\/\/|\/\*+|\*)[ \t]*)?@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link)\b/u.test(
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
