import { stat } from "node:fs/promises";

import { EvidenceAccessor } from "./EvidenceAccessor";
import { EvidenceFileTarget } from "./EvidenceFileTarget";
import { EvidenceInventory } from "../graph/EvidenceInventory";
import { EvidenceInventoryMerge } from "../internal/EvidenceInventoryMerge";
import { EvidenceMarkdownTarget } from "../adapters/markdown/EvidenceMarkdownTarget";
import { EvidencePrismaTarget } from "../adapters/prisma/EvidencePrismaTarget";
import { EvidenceSwaggerTarget } from "../adapters/swagger/EvidenceSwaggerTarget";
import type { IEvidenceTargetCandidate } from "../internal/IEvidenceTargetCandidate";
import type { IEvidenceAddress } from "../structures/IEvidenceAddress";
import type { IEvidenceDiagnostic } from "../structures/IEvidenceDiagnostic";
import type { IEvidenceHost } from "../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
import type { IEvidenceTargetResolution } from "../structures/IEvidenceTargetResolution";
import type { IEvidenceTargetStatement } from "../structures/IEvidenceTargetStatement";
import type { IEvidenceUnit } from "../structures/IEvidenceUnit";
import type { IEvidenceWithdrawal } from "../structures/IEvidenceWithdrawal";
import type { EvidenceArtifactType } from "../typings/EvidenceArtifactType";
import type { EvidenceTargetResolutionStatus } from "../typings/EvidenceTargetResolutionStatus";

/**
 * Resolves citation targets against one merged, selected reference population.
 *
 * A resolver combines scans for a reference, recognizes the target grammar used
 * by its artifact type, then separates four outcomes: a malformed target, an
 * inaccessible or missing file, a file outside the population, and an address
 * that has no selected public declaration. Graph evaluation consumes the result
 * rather than probing files or reinterpreting citation spelling itself.
 *
 * Resolution preserves all plausible origins and public file spellings until it
 * can prove one semantic identity. That avoids making aliases, hard links, or
 * multi-origin documentation silently select an arbitrary declaration.
 *
 * @example
 *   const resolver: EvidenceTargetResolver = new EvidenceTargetResolver([
 *     inventory,
 *   ]);
 *   const result: IEvidenceTargetResolution = await resolver.resolve(
 *     statement,
 *     host,
 *     selectedIds,
 *   );
 */
export class EvidenceTargetResolver {
  /**
   * Merged address index used for symbol and withdrawal lookup.
   *
   * It retains the inventory merger's alias and ambiguity semantics, which the
   * resolver must not reproduce from a single physical-file spelling.
   */
  private readonly index: EvidenceInventory;

  /**
   * Immutable snapshot from which membership and completeness are evaluated.
   *
   * All derived file maps come from this same snapshot, preventing a target
   * decision from mixing metadata acquired at different inventory states.
   */
  private readonly inventory: IEvidenceInventory;

  /**
   * Configured artifact fallback when selected IDs reveal no unique type.
   *
   * A mixed selected population intentionally has no specialized grammar, so it
   * falls back to ordinary file-qualified target parsing instead of guessing.
   */
  private readonly type: EvidenceArtifactType | undefined;

  /**
   * Normalized public addresses admitted by the reference's selected sources.
   *
   * Ordinary targets may resolve only in this set; physical file existence
   * alone never makes an unselected source part of the coverage denominator.
   */
  private readonly selectedFiles = new Set<string>();

  /**
   * Normalized physical source files known to the merged inventory.
   *
   * This distinguishes an existing scanned-but-unselected file from a path that
   * has disappeared or was never part of the evidence input.
   */
  private readonly physicalFiles = new Set<string>();

  /**
   * Authored public file spellings grouped by their normalized file identity.
   *
   * A target must be tested through every public spelling because address
   * lookup preserves authored paths as part of the public identity contract.
   */
  private readonly publicFiles = new Map<string, Set<string>>();

  /**
   * Selected Markdown roots grouped by Markdown's root-relative path spelling.
   *
   * Markdown targets are intentionally resolved from reference roots rather
   * than relative to the documentation host, so one logical target may map to
   * several physical selected files before ambiguity is decided.
   */
  private readonly markdownFiles = new Map<string, Set<string>>();

  /**
   * Builds lookup state for one reference's inventory snapshots.
   *
   * The optional type supplies a grammar only when selected unit IDs do not
   * establish one. Construction records membership and aliases but performs no
   * filesystem access; `resolve` defers that work until a citation needs it.
   */
  public constructor(
    inventories: IEvidenceInventory[],
    type?: EvidenceArtifactType,
  ) {
    this.index = new EvidenceInventory(inventories);
    this.inventory = this.index.snapshot();
    this.type = type;
    for (const source of this.inventory.sources) {
      this.physicalFiles.add(EvidenceFileTarget.normalize(source.physicalPath));
      for (const address of source.addresses)
        if (address.selected !== false)
          this.selectedFiles.add(
            EvidenceFileTarget.normalize(address.absolute),
          );
    }
    // Preserve every public spelling for an address because the index resolves
    // public addresses, while membership checks operate on normalized paths.
    for (const address of this.inventory.addresses) {
      const file = EvidenceFileTarget.normalize(address.file);
      let spellings = this.publicFiles.get(file);
      if (spellings === undefined) {
        spellings = new Set<string>();
        this.publicFiles.set(file, spellings);
      }
      spellings.add(address.file);
    }
    // Markdown references are rooted at selected source addresses. Identify their
    // physical sources first so non-Markdown files cannot enter this path map.
    const markdownSources = new Set(
      this.inventory.units
        .filter((unit) => unit.type === "markdown")
        .flatMap((unit) =>
          unit.sites.map((site) => EvidenceFileTarget.normalize(site.file)),
        ),
    );
    for (const source of this.inventory.sources) {
      if (
        !markdownSources.has(EvidenceFileTarget.normalize(source.physicalPath))
      )
        continue;
      for (const address of source.addresses) {
        if (address.selected === false) continue;
        const relative = EvidenceMarkdownTarget.normalize(address.relative);
        let files = this.markdownFiles.get(relative);
        if (files === undefined) {
          files = new Set<string>();
          this.markdownFiles.set(relative, files);
        }
        files.add(address.absolute);
      }
    }
  }

  /**
   * Resolves one statement using its owning host and selected unit IDs.
   *
   * The host must match the statement because diagnostics and relative origins
   * belong to that attachment. Specialized Markdown, Prisma, and Swagger target
   * forms are parsed only for a uniquely identified artifact type. Ordinary
   * file targets are attempted for each declared host origin, then deduplicated
   * before index lookup and filesystem classification.
   *
   * Incomplete inventories win before an empty or missing-member result. A scan
   * that omitted declarations cannot prove coverage merely because the
   * remaining selected population has no match.
   */
  public async resolve(
    statement: IEvidenceTargetStatement,
    host: IEvidenceHost,
    ids: string[],
  ): Promise<IEvidenceTargetResolution> {
    if (statement.hostId !== host.id)
      throw new Error(
        "The target statement does not belong to the supplied host.",
      );
    if (host.attachment !== "attached")
      return this.failure(
        "unsupported-host",
        [],
        [],
        [],
        this.diagnostic(
          statement,
          "target-unsupported-host",
          "The file-qualified target belongs to an unsupported documentation host.",
          host.problem ??
            "Attach the annotation to documentation owned by a supported declaration.",
        ),
      );

    const type = this.referenceType(ids);
    const addresses: IEvidenceAddress[] = [];
    try {
      if (type === "markdown") {
        const target = EvidenceMarkdownTarget.parse(statement.target);
        for (const file of this.markdownFiles.get(target.file) ?? [])
          addresses.push({ file, segments: target.segments });
        if (addresses.length === 0) {
          if (!this.inventory.complete) return this.incomplete(statement, []);
          return this.failure(
            "missing-file",
            [],
            [],
            [],
            this.diagnostic(
              statement,
              "target-missing-file",
              `Markdown target file '${target.file}' is not among the selected reference files.`,
              "Correct the root-relative Markdown path or include that file in the reference.",
            ),
          );
        }
      } else if (type === "prisma") {
        addresses.push(EvidencePrismaTarget.parse(statement.target));
      } else if (type === "swagger") {
        addresses.push(EvidenceSwaggerTarget.parse(statement.target));
      } else {
        // A host can represent merged documentation origins. Retain every unique
        // lexical origin until candidate resolution exposes a genuine ambiguity.
        const origins = EvidenceInventoryMerge.unique(
          host.origins ?? [host.file],
          (origin) => EvidenceFileTarget.normalize(origin),
        );
        for (const origin of origins)
          addresses.push(EvidenceFileTarget.parse(statement.target, origin));
      }
    } catch (cause) {
      return this.failure(
        "malformed",
        [],
        [],
        [],
        this.diagnostic(
          statement,
          "target-malformed",
          `The file-qualified target '${statement.target}' is malformed.`,
          cause instanceof Error
            ? cause.message
            : "Use a valid file-qualified public accessor.",
        ),
      );
    }
    const uniqueAddresses = EvidenceInventoryMerge.unique(
      addresses,
      (address) => JSON.stringify([address.file, address.segments]),
    );
    // Completeness precedes any negative conclusion: a failed scan may have
    // omitted the declaration that would otherwise satisfy this target.
    if (!this.inventory.complete)
      return this.incomplete(statement, uniqueAddresses);
    if (type === "prisma" || type === "swagger") {
      const candidates: IEvidenceTargetCandidate[] = uniqueAddresses.map(
        (address) => ({
          address,
          resolution: this.index.resolve(address, ids),
        }),
      );
      return this.resolveCandidates(statement, uniqueAddresses, candidates);
    }
    const candidates: IEvidenceTargetCandidate[] = [];
    for (const address of uniqueAddresses) {
      const file = EvidenceFileTarget.normalize(address.file);
      if (!this.selectedFiles.has(file)) continue;
      const spellings = this.publicFiles.get(file) ?? new Set([address.file]);
      for (const spelling of spellings)
        candidates.push({
          address: { file: spelling, segments: address.segments },
          resolution: this.index.resolve(
            { file: spelling, segments: address.segments },
            ids,
          ),
        });
    }
    if (candidates.length !== 0)
      return this.resolveCandidates(statement, uniqueAddresses, candidates);

    // No selected address matched. Inspect the explicit candidate paths only to
    // distinguish a missing file from a known but out-of-population source.
    const existing = await Promise.all(
      uniqueAddresses.map((address) => this.exists(address.file)),
    );
    if (existing.includes("incomplete"))
      return this.failure(
        "incomplete",
        uniqueAddresses,
        [],
        [],
        this.diagnostic(
          statement,
          "target-file-access",
          "The target file could not be inspected while resolving the citation.",
          "Restore access to the target path and retry the Evidence Graph check.",
        ),
      );
    const known = uniqueAddresses.some((address, index) => {
      const file = EvidenceFileTarget.normalize(address.file);
      return this.physicalFiles.has(file) || existing[index] === "file";
    });
    return this.failure(
      known ? "out-of-population" : "missing-file",
      uniqueAddresses,
      [],
      [],
      this.diagnostic(
        statement,
        known ? "target-out-of-population" : "target-missing-file",
        known
          ? `Target file '${this.files(uniqueAddresses)}' is outside the selected reference files.`
          : `Target file '${this.files(uniqueAddresses)}' is not an existing regular file.`,
        known
          ? "Add the file to this reference's files or cite a selected public address."
          : "Correct the path relative to the citing file or restore the missing file.",
      ),
    );
  }

  /**
   * Converts address-index lookups into one semantic target resolution.
   *
   * Multiple candidates may be aliases of one unit, which resolves
   * successfully. Multiple unit IDs or an index-level ambiguity remain
   * ambiguous. A withdrawal shadows an otherwise found unit, because a citation
   * cannot acknowledge a declaration that has been explicitly removed from
   * public coverage.
   */
  private resolveCandidates(
    statement: IEvidenceTargetStatement,
    addresses: IEvidenceAddress[],
    candidates: IEvidenceTargetCandidate[],
  ): IEvidenceTargetResolution {
    const units = this.uniqueUnits(
      candidates.flatMap((candidate) => candidate.resolution.units),
    );
    const withdrawals = this.uniqueWithdrawals(
      candidates.flatMap((candidate) => candidate.resolution.withdrawals),
    );
    if (
      units.length > 1 ||
      candidates.some(
        (candidate) => candidate.resolution.status === "ambiguous",
      )
    )
      return this.failure(
        "ambiguous",
        addresses,
        units,
        withdrawals,
        this.diagnostic(
          statement,
          "target-ambiguous",
          `The file-qualified target '${statement.target}' names more than one semantic identity.`,
          "Select one symbol kind or cite an unambiguous public accessor.",
        ),
      );
    if (units.length === 1) {
      const hidden = candidates.some(
        (candidate) => candidate.resolution.status === "hidden",
      );
      if (hidden)
        return this.failure(
          "hidden",
          addresses,
          units,
          withdrawals,
          this.diagnostic(
            statement,
            "target-hidden",
            `The file-qualified target '${statement.target}' names a withdrawn declaration.`,
            "Cite a public selected declaration or remove the stale acknowledgement.",
          ),
        );
      return {
        status: "resolved",
        addresses,
        units,
        withdrawals: [],
        diagnostics: [],
      };
    }
    // Specialized pseudo-files choose a format-specific repair message only after
    // ordinary candidate resolution found no selected semantic identity.
    const prisma = addresses.every((address) => address.file === "prisma:");
    const swagger = addresses.every((address) => address.file === "swagger:");
    return this.failure(
      "missing-member",
      addresses,
      [],
      [],
      this.diagnostic(
        statement,
        "target-missing-member",
        prisma
          ? `The selected Prisma schema has no public selected address '${statement.target}'.`
          : swagger
            ? `The selected Swagger document has no operation '${statement.target}'.`
            : `Selected target file '${this.files(addresses)}' has no public selected address '${this.accessor(addresses)}'.`,
        prisma
          ? "Correct the model or member name, or include its symbol kind in this reference."
          : swagger
            ? "Correct the uppercase method or exact path, or select the intended Swagger document."
            : "Correct the accessor, export a supported public declaration, or include its symbol kind in this reference.",
      ),
    );
  }

  /**
   * Creates a failed resolution with its one explanatory diagnostic.
   *
   * Callers receive candidate addresses, units, and withdrawals even for
   * failure states so reports can explain the evidence considered without
   * reconstructing this resolver's normalization and alias work.
   */
  private failure(
    status: Exclude<EvidenceTargetResolutionStatus, "resolved">,
    addresses: IEvidenceAddress[],
    units: IEvidenceUnit[],
    withdrawals: IEvidenceWithdrawal[],
    diagnostic: IEvidenceDiagnostic,
  ): IEvidenceTargetResolution {
    return {
      status,
      addresses,
      units,
      withdrawals,
      diagnostics: [diagnostic],
    };
  }

  /**
   * Creates the conservative result required when inventory acquisition failed.
   *
   * Existing inventory diagnostics are retained with the target-specific error
   * so authors see both the acquisition cause and why this citation was not
   * trusted.
   */
  private incomplete(
    statement: IEvidenceTargetStatement,
    addresses: IEvidenceAddress[],
  ): IEvidenceTargetResolution {
    return {
      status: "incomplete",
      addresses,
      units: [],
      withdrawals: [],
      diagnostics: [
        ...this.inventory.diagnostics,
        this.diagnostic(
          statement,
          "target-incomplete",
          "The target cannot be trusted because its reference inventory is incomplete.",
          "Resolve the reference inventory diagnostics before evaluating this citation.",
        ),
      ],
    };
  }

  /**
   * Attaches target-resolution details to the statement's original source span.
   *
   * Keeping this construction centralized ensures every failure points to the
   * authored target and owning host, rather than an internal normalized
   * address.
   */
  private diagnostic(
    statement: IEvidenceTargetStatement,
    code: string,
    message: string,
    repair: string,
  ): IEvidenceDiagnostic {
    return {
      code,
      severity: "error",
      message,
      repair,
      location: statement.location,
      hostId: statement.hostId,
      target: statement.target,
    };
  }

  /**
   * Classifies one candidate path without treating access failure as absence.
   *
   * Only regular files can be citation targets. Permission and I/O errors
   * become `incomplete` so a transient inspection failure cannot be reported as
   * a user typo or shrink the reference population.
   */
  private async exists(
    file: string,
  ): Promise<"file" | "other" | "missing" | "incomplete"> {
    try {
      return (await stat(file)).isFile() ? "file" : "other";
    } catch (cause) {
      const code = this.errorCode(cause);
      return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "incomplete";
    }
  }

  /**
   * Finds the specialized target grammar implied by selected semantic units.
   *
   * An empty selection uses the configured fallback. A homogeneous selection
   * supplies its own type; a mixed selection deliberately returns undefined so
   * no one artifact grammar is applied to an unrelated citation.
   */
  private referenceType(ids: string[]): EvidenceArtifactType | undefined {
    const selected = new Set(ids);
    const types = new Set<EvidenceArtifactType>();
    for (const unit of this.inventory.units) {
      if (!selected.has(unit.id)) continue;
      types.add(unit.type);
    }
    if (types.size === 0) return this.type;
    return types.size === 1 ? types.values().next().value : undefined;
  }

  /**
   * Extracts a EvidenceNode-style error code without assuming an arbitrary
   * thrown value.
   *
   * Filesystem APIs may reject with non-Error values, which must remain an
   * incomplete inspection rather than cause the resolver's classifier to
   * throw.
   */
  private errorCode(cause: unknown): string | undefined {
    if (!(cause instanceof Error) || !("code" in cause)) return undefined;
    const code: unknown = cause.code;
    return typeof code === "string" ? code : undefined;
  }

  /**
   * Collapses alias candidates to their semantic unit identity.
   *
   * Address multiplicity does not make a target ambiguous when every spelling
   * designates the same unit.
   */
  private uniqueUnits(units: IEvidenceUnit[]): IEvidenceUnit[] {
    return EvidenceInventoryMerge.unique(units, (unit) => unit.id);
  }

  /**
   * Removes repeated withdrawal records gathered through alias candidates.
   *
   * Withdrawals lack one shared unit ID in this result shape, so structural
   * serialization preserves the merger's full withdrawal identity.
   */
  private uniqueWithdrawals(
    withdrawals: IEvidenceWithdrawal[],
  ): IEvidenceWithdrawal[] {
    return EvidenceInventoryMerge.unique(withdrawals, (withdrawal) =>
      JSON.stringify(withdrawal),
    );
  }

  /**
   * Formats candidate files in stable lexical order for a diagnostic.
   *
   * Sorting prevents host-origin iteration order from changing a report's text.
   */
  private files(addresses: IEvidenceAddress[]): string {
    return addresses
      .map((address) => address.file)
      .sort(EvidenceInventoryMerge.compare)
      .join("', '");
  }

  /**
   * Formats the representative accessor after candidate paths share its
   * segments.
   *
   * Missing candidates and file-only addresses have no accessor. Their display
   * stays empty rather than passing an empty segment list to the accessor
   * formatter.
   */
  private accessor(addresses: IEvidenceAddress[]): string {
    const first: IEvidenceAddress | undefined = addresses[0];
    return first === undefined || first.segments.length === 0
      ? ""
      : EvidenceAccessor.format(first.segments);
  }
}
