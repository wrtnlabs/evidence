import typia from "typia";

import { EvidenceInventoryIndex } from "../../internal/EvidenceInventoryIndex";
import { EvidenceTagParser } from "../../parsers/EvidenceTagParser";
import type { IEvidencePrismaCommentRun } from "./IEvidencePrismaCommentRun";
import type { IEvidencePrismaFileAnalysis } from "./IEvidencePrismaFileAnalysis";
import type { IEvidencePrismaLocatedDeclaration } from "./IEvidencePrismaLocatedDeclaration";
import type { IEvidencePrismaModel } from "./IEvidencePrismaModel";
import type { IEvidencePrismaOwnedUnit } from "./IEvidencePrismaOwnedUnit";
import type { IEvidencePrismaSchemaFile } from "./IEvidencePrismaSchemaFile";
import { EvidenceInventoryMerge } from "../../internal/EvidenceInventoryMerge";
import { EvidencePrismaFileScanner } from "./EvidencePrismaFileScanner";
import { EvidencePrismaModelLoader } from "./EvidencePrismaModelLoader";
import { EvidenceSourceText } from "../../internal/EvidenceSourceText";
import type { IEvidenceAdapter } from "../../structures/IEvidenceAdapter";
import type { IEvidenceDocumentation } from "../../structures/IEvidenceDocumentation";
import type { IEvidenceHost } from "../../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceSnapshot } from "../../structures/IEvidenceSourceSnapshot";
import type { IEvidenceTagParseResult } from "../../structures/IEvidenceTagParseResult";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { EvidenceDatabaseSymbol } from "../../typings/EvidenceDatabaseSymbol";

/**
 * Extracts Prisma models, columns, relations, and declaration documentation.
 *
 * Selected files form one schema for the Prisma model loader, while a separate
 * source scan retains exact declaration and comment coordinates.
 * Materialization joins those views so semantic schema units remain tied to
 * their physical hosts. A schema-loading failure produces incomplete analysis
 * instead of an empty pass.
 *
 * @evidence contracts/common.md#principled-implementation Prisma's own WASM parser decides which models, columns and relations exist for the whole selected schema, while a position scan supplies exact sites and comments; materialization joins the two.
 * @evidence contracts/common.md#clear-and-simple-design The adapter joins semantic and positional views; parsing, scanning and target spelling are separate modules.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts A rejected schema yields an incomplete inventory, and a missed position keeps the unit with a file-level fallback instead of dropping it.
 * @evidence contracts/common.md#meaningful-documentation The class comment explains the two views; every member is documented.
 * @evidence contracts/performance.md#efficient-algorithms Linear in schema size: one whole-schema parse plus one position scan per file.
 * @evidence contracts/performance.md#reuse-equivalent-work Parse results are cached by parser identity and schema digest, so unchanged schemas are not reparsed.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The adapter holds no state between analyses; the loader's cache is bounded separately.
 */
export class EvidencePrismaAdapter implements IEvidenceAdapter<"prisma"> {
  /**
   * Artifact discriminator selecting Prisma schema extraction.
   *
   * Prisma target spelling and database selectors apply to the resulting
   * inventory.
   */
  public get type(): "prisma" {
    return "prisma";
  }

  /**
   * Loads one combined schema from a validated, cloned source snapshot.
   *
   * Incomplete discovery is returned without attempting to certify partial
   * schema content. Complete input is deduplicated by physical identity, parsed
   * for models, and joined to source locations before annotations are
   * materialized.
   *
   * @evidence contracts/common.md#principled-implementation Analyze deduplicates physical files, loads the parser model, scans positions, and materializes units, documentation hosts and withdrawals.
   * @evidence contracts/common.md#clear-and-simple-design Phases are private methods; loading and scanning are delegated.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Loader failures become diagnostics and incompleteness.
   * @evidence contracts/common.md#meaningful-documentation The comment explains deduplication and failure handling.
   * @evidence contracts/performance.md#efficient-algorithms Linear in schema size.
   * @evidence contracts/performance.md#reuse-equivalent-work The model loader reuses cached results for an unchanged schema set.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Detached records outlive the WASM call; nothing native is retained.
   */
  public async analyze(
    snapshot: IEvidenceSourceSnapshot,
  ): Promise<IEvidenceInventory> {
    const input = structuredClone(typia.assert(snapshot));
    const inventory = this.inventory(input);
    if (!input.complete || input.files.length === 0)
      return new EvidenceInventoryIndex([inventory]).snapshot();

    const files = this.schemaFiles(input.files);
    let models: IEvidencePrismaModel[];
    try {
      models = (
        await EvidencePrismaModelLoader.load(input.root.absolute, files)
      ).models;
    } catch (cause) {
      inventory.complete = false;
      inventory.diagnostics.push({
        code: "prisma-parse-failed",
        severity: "error",
        message: `The configured Prisma schema could not be parsed: ${this.message(cause)}`,
        repair:
          "Correct the schema, or restore a compatible @prisma/prisma-schema-wasm dependency when parser resolution or validation failed.",
        ...(files[0] === undefined
          ? {}
          : { location: { file: files[0].source.physicalPath } }),
      });
      return new EvidenceInventoryIndex([inventory]).snapshot();
    }

    // The model parser owns schema semantics; the source scanner owns exact
    // spans. Join both before attaching tags so normalized models do not invent
    // comment coordinates or erase the original declaration boundaries.
    const analyses = files.map((file) =>
      new EvidencePrismaFileScanner(file.source).scan(),
    );
    const owned = this.units(inventory, models, analyses, files);
    this.materialize(inventory, analyses, owned);
    return new EvidenceInventoryIndex([inventory]).snapshot();
  }

  /**
   * Seeds inventory state while preserving discovery failures and dependencies.
   *
   * No declarations are certified at this stage; the schema-loading phase adds
   * semantic units only after it can interpret the complete selected schema.
   */
  private inventory(input: IEvidenceSourceSnapshot): IEvidenceInventory {
    return {
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
          "Restore access to every selected Prisma source before evaluating coverage.",
        location: { file: diagnostic.path },
      })),
      dependencies: input.dependencies,
      complete: input.complete,
    };
  }

  /**
   * Deduplicates physical schema files and chooses deterministic logical parser
   * names.
   *
   * Multiple selected link spellings must not submit the same declarations
   * twice. All addresses are retained while the first sorted selected relative
   * path names the schema input supplied to the model loader.
   */
  private schemaFiles(
    sources: IEvidenceSourceFile[],
  ): IEvidencePrismaSchemaFile[] {
    const records = new Map<string, IEvidenceSourceFile>();
    for (const source of sources) {
      const previous = records.get(source.id);
      if (previous === undefined) records.set(source.id, source);
      else previous.addresses.push(...source.addresses);
    }
    return Array.from(records.values())
      .map((source) => {
        source.addresses = EvidenceInventoryMerge.sourceAddresses(
          source.addresses,
        );
        return {
          name:
            source.addresses
              .filter((address) => address.selected !== false)
              .map((address) => address.relative)
              .sort(EvidenceInventoryMerge.compare)[0] ?? source.physicalPath,
          source,
        };
      })
      .sort((x, y) => EvidenceInventoryMerge.compare(x.name, y.name));
  }

  private units(
    inventory: IEvidenceInventory,
    models: IEvidencePrismaModel[],
    analyses: IEvidencePrismaFileAnalysis[],
    files: IEvidencePrismaSchemaFile[],
  ): Map<string, IEvidencePrismaOwnedUnit> {
    const locations = new Map(
      analyses.flatMap((analysis) =>
        analysis.locations.map((location) => [
          location.key,
          { analysis, location },
        ]),
      ),
    );
    const first = files[0]?.source;
    const output = new Map<string, IEvidencePrismaOwnedUnit>();
    for (const model of models) {
      const parent = this.unit(
        "model",
        [model.name],
        undefined,
        model.documentation,
        model.digest,
        locations,
        first,
      );
      this.publish(inventory, output, parent);
      for (const field of model.fields) {
        const child = this.unit(
          field.symbol,
          [model.name, field.name],
          parent.unit.id,
          field.documentation,
          field.digest,
          locations,
          first,
        );
        this.publish(inventory, output, child);
      }
    }
    return output;
  }

  private unit(
    symbol: EvidenceDatabaseSymbol,
    identity: string[],
    parentId: string | undefined,
    documentation: string,
    digest: string,
    locations: Map<string, IEvidencePrismaLocatedDeclaration>,
    fallback: IEvidenceSourceFile | undefined,
  ): IEvidencePrismaOwnedUnit {
    const key = identity.join(".");
    const found = locations.get(key);
    const source = found === undefined ? fallback : found.analysis.source;
    if (source === undefined)
      throw new Error("A parsed Prisma unit has no selected source file.");
    const text = EvidenceSourceText.of(source.content);
    const range = found === undefined ? text.range(0, 0) : found.location.range;
    const id = `prisma:${key}`;
    const site: IEvidenceUnitSite = {
      id: `${id}:site:${source.id}:${range.start.offset}:${range.end.offset}`,
      file: source.physicalPath,
      range,
      content: [range],
    };
    const unit: IEvidenceUnit = {
      id,
      ...(parentId === undefined ? {} : { parentId }),
      type: "prisma",
      symbol,
      identity,
      name: key,
      contentDigest: digest,
      sites: [site],
      withdrawals: [],
    };
    return { key, documentation, unit, site };
  }

  private publish(
    inventory: IEvidenceInventory,
    units: Map<string, IEvidencePrismaOwnedUnit>,
    owned: IEvidencePrismaOwnedUnit,
  ): void {
    if (units.has(owned.key)) return;
    units.set(owned.key, owned);
    inventory.units.push(owned.unit);
    inventory.addresses.push({
      unitId: owned.unit.id,
      file: "prisma:",
      segments: owned.unit.identity,
    });
  }

  private materialize(
    inventory: IEvidenceInventory,
    analyses: IEvidencePrismaFileAnalysis[],
    owned: Map<string, IEvidencePrismaOwnedUnit>,
  ): void {
    const units = new Map(
      Array.from(owned.values()).map((entry) => [entry.unit.id, entry.unit]),
    );
    for (const analysis of analyses)
      for (const run of analysis.comments) {
        if (run.form !== "doc") continue;
        for (const range of run.commentRanges)
          inventory.annotationRanges.push({
            file: analysis.source.physicalPath,
            range,
          });
        const entry = owned.get(run.key);
        if (entry === undefined) continue;
        const parsed = this.parse(
          analysis.source,
          run,
          this.host(analysis.source, run, entry, true),
          true,
        );
        entry.unit.withdrawals.push(...parsed.withdrawals);
      }
    for (const entry of owned.values())
      if (entry.unit.withdrawals.length === 0) this.recoverWithdrawal(entry);

    const hidden = new Set(
      Array.from(owned.values())
        .filter((entry) => this.withdrawn(entry.unit.id, units, new Set()))
        .map((entry) => entry.unit.id),
    );
    const documented = new Set<string>();
    for (const analysis of analyses)
      for (const run of analysis.comments) {
        const entry = owned.get(run.key);
        if (run.form === "doc" && entry !== undefined)
          documented.add(entry.key);
        const annotation = this.annotation(run.text);
        const claimAnnotation = this.claimAnnotation(run.text);
        const attached =
          run.form === "doc" &&
          entry !== undefined &&
          !hidden.has(entry.unit.id);
        if (!attached && !run.fileLevel && !annotation) continue;
        if (
          run.form === "doc" &&
          entry !== undefined &&
          hidden.has(entry.unit.id) &&
          !claimAnnotation
        )
          continue;
        const host = this.host(analysis.source, run, entry, attached);
        inventory.hosts.push(host);
        const parsed = this.parse(analysis.source, run, host, attached);
        if (run.fileLevel) this.fileDeclarations(inventory, parsed);
        else inventory.declarations.push(...parsed.declarations);
        inventory.reviews.push(...parsed.reviews);
        inventory.diagnostics.push(...parsed.diagnostics);
        this.reportBuried(inventory, analysis.source, run);
      }
    for (const entry of owned.values()) {
      if (hidden.has(entry.unit.id) || documented.has(entry.key)) continue;
      const source = inventory.sources.find(
        (candidate) => candidate.physicalPath === entry.site.file,
      );
      inventory.hosts.push({
        id: `prisma:${entry.unit.id}:position`,
        file: entry.site.file,
        range: entry.site.range,
        ...(source === undefined
          ? {}
          : {
              origins: source.addresses.map((address) => address.absolute),
            }),
        siteId: entry.site.id,
        unitIds: [entry.unit.id],
        attachment: "attached",
      });
    }
  }

  private host(
    source: IEvidenceSourceFile,
    run: IEvidencePrismaCommentRun,
    entry: IEvidencePrismaOwnedUnit | undefined,
    attached: boolean,
  ): IEvidenceHost {
    const carrier = run.fileLevel;
    return {
      id: `prisma:${source.id}:comment:${run.range.start.offset}`,
      file: source.physicalPath,
      range: run.range,
      origins: source.addresses.map((address) => address.absolute),
      ...(attached && entry !== undefined ? { siteId: entry.site.id } : {}),
      unitIds: attached && entry !== undefined ? [entry.unit.id] : [],
      attachment: attached || carrier ? "attached" : "unsupported",
      ...(attached || carrier ? {} : { problem: this.hostProblem(run, entry) }),
    };
  }

  private parse(
    source: IEvidenceSourceFile,
    run: IEvidencePrismaCommentRun,
    host: IEvidenceHost,
    allowWithdrawal: boolean,
  ): IEvidenceTagParseResult {
    const documentation: IEvidenceDocumentation = {
      hostId: host.id,
      text: run.text,
      offsets: run.offsets,
      ends: run.ends,
      tagBoundaries: false,
      allowWithdrawal,
    };
    return EvidenceTagParser.parse(source.content, host, documentation);
  }

  private fileDeclarations(
    inventory: IEvidenceInventory,
    parsed: IEvidenceTagParseResult,
  ): void {
    for (const declaration of parsed.declarations)
      if (declaration.kind === "evidenceExclude")
        inventory.declarations.push(declaration);
      else
        inventory.diagnostics.push({
          code: "prisma-file-evidence",
          severity: "error",
          message:
            "Positive evidence cannot be attached to a file-level Prisma exclusion carrier.",
          repair:
            "Move @evidence directly above the model, column, or relation it describes.",
          location: declaration.location,
          hostId: declaration.hostId,
          target: declaration.target,
        });
  }

  private recoverWithdrawal(entry: IEvidencePrismaOwnedUnit): void {
    for (const line of entry.documentation.split("\n")) {
      const match = /^@(internal|hidden|ignore)(?:[ \t]|$)/u.exec(line.trim());
      const tag = match?.[1];
      if (tag !== "internal" && tag !== "hidden" && tag !== "ignore") continue;
      entry.unit.withdrawals.push({
        tag,
        location: { file: entry.site.file, range: entry.site.range },
      });
      return;
    }
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

  private hostProblem(
    run: IEvidencePrismaCommentRun,
    entry: IEvidencePrismaOwnedUnit | undefined,
  ): string {
    if (run.form === "line")
      return "Write the citation in a '///' or '/* */' documentation comment; Prisma discards '//' comments.";
    if (run.key === "")
      return "Move the citation directly above a model, view, column, or relation; this comment documents no declaration.";
    if (entry === undefined)
      return `Move the citation to a model, view, column, or relation; '${run.key}' is outside the Prisma Evidence population.`;
    return "Remove the citation from the withdrawn declaration or restore that declaration to the public schema surface.";
  }

  private annotation(text: string): boolean {
    return /(?:^|\n)[ \t]*(?:[/*]+[ \t]*)?(?:#{2,4}[ \t]+)?@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link|internal|hidden|ignore)\b/u.test(
      text,
    );
  }

  private claimAnnotation(text: string): boolean {
    return /(?:^|\n)[ \t]*(?:[/*]+[ \t]*)?(?:#{2,4}[ \t]+)?@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link)\b/u.test(
      text,
    );
  }

  private reportBuried(
    inventory: IEvidenceInventory,
    source: IEvidenceSourceFile,
    run: IEvidencePrismaCommentRun,
  ): void {
    const sourceText = EvidenceSourceText.of(source.content);
    let offset = 0;
    for (const line of run.text.split("\n")) {
      const trimmed = line.trim();
      if (
        /^(?:#{2,4}[ \t]+)?@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link)\b/u.test(
          trimmed,
        )
      ) {
        offset += line.length + 1;
        continue;
      }
      const exposed = trimmed.replace(/^[/*]+[ \t]*/u, "");
      if (
        /^(?:#{2,4}[ \t]+)?@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link)\b/u.test(
          exposed,
        )
      ) {
        const first = line.search(/\S/u);
        const start = run.offsets[offset + Math.max(0, first)];
        const end = run.ends[offset + line.length - 1];
        inventory.diagnostics.push({
          code: "prisma-buried-annotation",
          severity: "error",
          message:
            "An Evidence tag is buried behind extra comment punctuation.",
          repair:
            "Remove the extra leading slash or asterisk so the Evidence tag opens its documentation line.",
          location: {
            file: source.physicalPath,
            range:
              start === undefined || end === undefined
                ? run.range
                : sourceText.range(start, end),
          },
        });
      }
      offset += line.length + 1;
    }
  }

  private message(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }
}
