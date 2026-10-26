import { EvidenceSourceAcquisition } from "./EvidenceSourceAcquisition";
import { EvidenceSourceObservationScope } from "./EvidenceSourceObservationScope";
import type { IEvidenceCapturedSource } from "./IEvidenceCapturedSource";
import type { BigIntStats } from "node:fs";
import { lstat, readlink, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { IEvidenceSourceAddress } from "../structures/IEvidenceSourceAddress";
import type { IEvidenceSourceDependency } from "../structures/IEvidenceSourceDependency";
import type { IEvidenceSourceDiagnostic } from "../structures/IEvidenceSourceDiagnostic";
import type { IEvidenceSourceFile } from "../structures/IEvidenceSourceFile";
import type { IEvidenceSourceRoot } from "../structures/IEvidenceSourceRoot";
import type { IEvidenceSourceSnapshot } from "../structures/IEvidenceSourceSnapshot";
import type { EvidenceFileGlob } from "./EvidenceFileGlob";
import { EvidenceSourceFailure } from "./EvidenceSourceFailure";
import { EvidenceSourcePath } from "./EvidenceSourcePath";

/**
 * Collects one configured filesystem population into a stable source snapshot.
 *
 * Logical aliases remain attached to a single physical file identity, while
 * dependency tracking retains intermediate paths so watch mode can recover from
 * missing files, symlink changes, and read failures.
 *
 * @evidence contracts/common.md#principled-implementation Logical traversal paths form public addresses while device and inode identity coalesces aliases, and every intermediate path is recorded as a watch dependency so failures can recover.
 * @evidence contracts/common.md#clear-and-simple-design The class owns discovery for one root; glob matching, path lexing and source failures are separate collaborators, and private helpers own walking, reading, link resolution and reporting.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Failures become retained source diagnostics that mark the snapshot incomplete; case mismatches and symlink cycles are reported instead of being normalized away.
 * @evidence contracts/common.md#meaningful-documentation The class comment explains aliases and dependency tracking; public methods and every private method and helper are documented, while private fields are named by role.
 * @evidence contracts/performance.md#efficient-algorithms Traversal visits each candidate entry once, pruning directories no pattern can match; exact-case checks read each ancestor directory once per resolved path.
 * @evidence contracts/performance.md#reuse-equivalent-work One collector reuses its file map so aliases of the same physical file are read once.
 * @evidence contracts/performance.md#bound-retention-and-release-resources File handles are closed in finally; the collector retains captured content only until its snapshot is handed to the adapter.
 */
export class EvidenceSourceCollector {
  /** Captured bytes/listings shared only with this materialization. */
  private readonly acquisition: EvidenceSourceAcquisition =
    EvidenceSourceAcquisition.current() ?? new EvidenceSourceAcquisition();
  private readonly directory: string;
  private readonly root: IEvidenceSourceRoot;
  private readonly files = new Map<string, IEvidenceSourceFile>();
  private readonly versions = new Map<string, string>();
  private readonly dependencies = new Map<string, IEvidenceSourceDependency>();
  private readonly diagnostics: IEvidenceSourceDiagnostic[] = [];

  /**
   * Initializes collection for one declared root relative to its configuration
   * file.
   *
   * Construction records lexical and display paths only; scanning later
   * resolves the filesystem so a caller can configure globs before any access
   * occurs.
   */
  public constructor(configFile: string, declared: string) {
    this.directory = path.dirname(path.resolve(configFile));
    const absolute = EvidenceSourcePath.root(configFile, declared);
    this.root = {
      declared,
      absolute,
      display: EvidenceSourcePath.display(this.directory, absolute),
    };
  }

  /**
   * Recursively discovers files selected by ordered globs and records root
   * failures.
   *
   * The collector retains failed root paths as dependencies so watch mode can
   * observe the repair instead of requiring a configuration edit.
   *
   * @evidence contracts/common.md#principled-implementation The root is resolved physically and verified to be a directory before a recursive walk applies the ordered globs.
   * @evidence contracts/common.md#clear-and-simple-design Scan sets up the root; walking and reading are private methods.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts A root failure is reported as root-unreadable and retained as a watch dependency rather than aborting silently.
   * @evidence contracts/common.md#meaningful-documentation The comment explains retaining failed roots for repair.
   * @evidence contracts/performance.md#efficient-algorithms Linear in visited entries with directory pruning.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each scan captures the filesystem once for one analysis.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Every opened file is closed by read; results stay in the collector until snapshot.
   */
  public async scan(globs: EvidenceFileGlob): Promise<void> {
    await this.watch(this.root.absolute, true);
    try {
      const physical = await this.resolvePhysical(this.root.absolute);
      const info = await stat(physical, { bigint: true });
      if (!info.isDirectory())
        throw new Error("The population root is not a directory.");
      this.root.physical = physical;
      await this.watch(physical, true);
      await this.walk(this.root.absolute, "", physical, info, globs, new Set());
    } catch (cause) {
      this.report("root-unreadable", this.root.absolute, cause);
    }
  }

  /**
   * Loads one exact local source path and retains failures as watch
   * dependencies.
   *
   * Exact selection rejects remote URLs and reports filesystem errors without
   * aborting sibling source collection work.
   *
   * @evidence contracts/common.md#principled-implementation One local path is resolved under the root, its root and file type are verified, and it is read like a discovered file.
   * @evidence contracts/common.md#clear-and-simple-design Exact loading reuses read and resolvePhysical.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Remote URLs are rejected here because adapters own remote documents; errors become path-unreadable diagnostics without aborting siblings.
   * @evidence contracts/common.md#meaningful-documentation The comment explains URL rejection and failure retention.
   * @evidence contracts/performance.md#efficient-algorithms Constant number of filesystem calls plus one file read.
   * @evidence contracts/performance.md#reuse-equivalent-work Repeated aliases of an already read file reuse its captured content.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The file handle is closed by read in finally.
   */
  public async exact(file: string): Promise<void> {
    if (/^https?:\/\//i.test(file))
      throw new Error(
        "The filesystem source loader accepts local files; remote documents require their adapter.",
      );
    const absolute = EvidenceSourcePath.resolve(this.root.absolute, file);
    await this.watch(absolute, false);
    await this.watch(EvidenceSourcePath.slash(path.dirname(absolute)), false);
    try {
      const rootPhysical: string = await this.resolvePhysical(
        this.root.absolute,
      );
      const rootInfo: BigIntStats = await stat(rootPhysical, { bigint: true });
      if (!rootInfo.isDirectory())
        throw new EvidenceSourceFailure(
          "root-unreadable",
          "The population root is not a directory.",
        );
      this.root.physical = rootPhysical;
      await this.watch(rootPhysical, true);
      const physical = await this.resolvePhysical(absolute);
      const info = await stat(physical, { bigint: true });
      if (!info.isFile())
        throw new EvidenceSourceFailure(
          "not-file",
          "The selected path is not a regular file.",
        );
      await this.read(
        absolute,
        EvidenceSourcePath.display(this.root.absolute, absolute),
        physical,
        info,
      );
    } catch (cause) {
      this.report("path-unreadable", absolute, cause);
    }
  }

  /**
   * Returns collected files, dependencies, and diagnostics for one analysis
   * pass.
   *
   * Addresses, files, and dependencies are sorted with bytewise comparisons so
   * equivalent source snapshots do not vary with filesystem traversal order.
   *
   * @evidence contracts/common.md#principled-implementation Addresses, files and dependencies are sorted bytewise and each file's fingerprint path comes from its first logical address, giving traversal-independent snapshots.
   * @evidence contracts/common.md#clear-and-simple-design Snapshot only orders and packages collected data.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Completeness is false whenever any discovery diagnostic exists.
   * @evidence contracts/common.md#meaningful-documentation The comment explains deterministic ordering.
   * @evidence contracts/performance.md#efficient-algorithms O(n log n) sorting of files, addresses and dependencies.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work A snapshot is produced once per collection.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The returned snapshot takes the collected records; the collector is not reused afterward.
   */
  public snapshot(): IEvidenceSourceSnapshot {
    const files: IEvidenceSourceFile[] = [...this.files.values()];
    for (const file of files) {
      file.addresses.sort((left, right) =>
        compare(left.relative, right.relative),
      );
      const declaring: IEvidenceSourceAddress | undefined = file.addresses[0];
      if (declaring !== undefined) file.fingerprintPath = declaring.display;
    }
    files.sort((left, right) =>
      compare(
        left.addresses[0]?.relative ?? left.physicalPath,
        right.addresses[0]?.relative ?? right.physicalPath,
      ),
    );
    return {
      root: this.root,
      files,
      dependencies: [...this.dependencies.values()].sort((left, right) =>
        compare(left.path, right.path),
      ),
      diagnostics: this.diagnostics,
      complete: this.diagnostics.length === 0,
    };
  }

  /**
   * Walks a physical directory through its logical address while preventing
   * symlink cycles.
   *
   * The traversal retains both spellings: logical paths form public addresses,
   * while physical identity detects recursive links and duplicate files.
   */
  private async walk(
    absolute: string,
    relative: string,
    physical: string,
    info: BigIntStats,
    globs: EvidenceFileGlob,
    ancestors: ReadonlySet<string>,
  ): Promise<void> {
    const id = identity(info, physical);
    if (ancestors.has(id))
      throw new EvidenceSourceFailure(
        "symlink-cycle",
        "A directory link returns to an ancestor; remove the cycle or exclude this subtree.",
      );
    await this.watch(absolute, true);
    await this.watch(physical, true);
    const next = new Set(ancestors);
    next.add(id);
    const entries: string[] = (await this.acquisition.directory(physical)).sort(
      compare,
    );
    for (const name of entries) {
      const location = relative === "" ? name : relative + "/" + name;
      const selected = globs.matches(location);
      const descend = globs.couldMatchDescendant(location);
      if (!selected && !descend) continue;
      const filename = EvidenceSourcePath.slash(path.join(absolute, name));
      const target = EvidenceSourcePath.slash(path.join(physical, name));
      await this.watch(filename, false);
      await this.watch(target, false);
      try {
        // readdir supplies exact names under an already resolved parent.
        const entry = await lstat(target, { bigint: true });
        const linked = entry.isSymbolicLink();
        const resolved = linked
          ? await this.resolvePhysical(target, new Set(), false)
          : target;
        const metadata = linked
          ? await stat(resolved, { bigint: true })
          : entry;
        if (metadata.isDirectory()) {
          if (descend)
            await this.walk(
              filename,
              location,
              resolved,
              metadata,
              globs,
              next,
            );
        } else if (selected) {
          if (!metadata.isFile())
            throw new EvidenceSourceFailure(
              "not-file",
              "The selected path is not a regular file.",
            );
          await this.read(filename, location, resolved, metadata);
        }
      } catch (cause) {
        this.report("path-unreadable", filename, cause);
      }
    }
  }

  /**
   * Reads one stable physical file after validating metadata before and after
   * I/O.
   *
   * Alias addresses coalesce only when their device and inode version remains
   * stable, preventing a changing file from yielding an incoherent snapshot.
   */
  private async read(
    absolute: string,
    relative: string,
    physical: string,
    info: BigIntStats,
  ): Promise<void> {
    await this.watch(absolute, false);
    await this.watch(physical, false);
    const address: IEvidenceSourceAddress = {
      absolute,
      relative,
      display: EvidenceSourcePath.display(this.directory, absolute),
    };
    const id = identity(info, physical);
    const existing = this.files.get(id);
    if (existing !== undefined) {
      if (this.versions.get(id) !== version(info))
        throw new EvidenceSourceFailure(
          "source-changed",
          "The file changed between selected aliases; retry discovery.",
        );
      existing.addresses.push(address);
      return;
    }
    const captured: IEvidenceCapturedSource = await this.acquisition.read(
      physical,
      info,
    );
    this.files.set(id, {
      id,
      physicalPath: physical,
      fingerprintPath: address.display,
      ...(this.root.physical === undefined
        ? {}
        : {
            fingerprintRoot: {
              physicalPath: this.root.physical,
              fingerprintPath: this.root.display,
            },
          }),
      content: captured.content,
      digest: captured.digest,
      addresses: [address],
    });
    this.versions.set(id, version(captured.metadata));
  }

  /**
   * Resolves each symlink component while tracking links and configured path
   * casing.
   *
   * Exact-case validation protects portable source identities, and link
   * tracking reports cycles before recursive filesystem resolution can loop.
   */
  private async resolvePhysical(
    absolute: string,
    links: ReadonlySet<string> = new Set(),
    checkCase: boolean = true,
  ): Promise<string> {
    const parsed = path.parse(absolute);
    let current = parsed.root;
    const segments = absolute
      .slice(parsed.root.length)
      .split(/[\\/]/)
      .filter((part) => part !== "");
    for (const segment of segments) {
      await this.watch(EvidenceSourcePath.slash(current), false);
      if (checkCase) {
        const names: string[] = await this.acquisition.directory(current);
        if (!names.includes(segment)) {
          const actual = names.find(
            (name) => name.toLowerCase() === segment.toLowerCase(),
          );
          if (actual !== undefined)
            throw new EvidenceSourceFailure(
              "case-mismatch",
              `Path segment '${segment}' is spelled '${actual}' on disk; use that exact case.`,
            );
        }
      }
      current = path.join(current, segment);
      await this.watch(EvidenceSourcePath.slash(current), false);
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        if (links.has(current))
          throw new EvidenceSourceFailure(
            "symlink-cycle",
            "The selected path contains a cyclic symbolic link.",
          );
        const next = new Set(links);
        next.add(current);
        current = await this.resolvePhysical(
          path.resolve(path.dirname(current), await readlink(current)),
          next,
          false,
        );
      }
    }
    return EvidenceSourcePath.slash(await realpath(current));
  }

  /**
   * Merges a dependency observation and retains recursive monitoring when
   * required.
   *
   * Multiple reads of one path share a dependency record; any directory
   * consumer can promote it to recursive watching without losing earlier
   * observations.
   */
  private async watch(location: string, recursive: boolean): Promise<void> {
    await EvidenceSourceObservationScope.observe({ path: location, recursive });
    const existing = this.dependencies.get(location);
    this.dependencies.set(location, {
      path: location,
      recursive: recursive || existing?.recursive === true,
    });
  }

  /**
   * Converts an expected collection failure into a retained diagnostic.
   *
   * Sibling paths continue scanning, while `EvidenceSourceFailure` preserves
   * its specific diagnostic code instead of becoming the caller-supplied
   * fallback category.
   */
  private report(
    fallback: IEvidenceSourceDiagnostic["code"],
    location: string,
    cause: unknown,
  ): void {
    const message = cause instanceof Error ? cause.message : String(cause);
    this.diagnostics.push({
      code: cause instanceof EvidenceSourceFailure ? cause.code : fallback,
      path: location,
      message: `Could not discover '${location}': ${message}`,
    });
  }
}

/**
 * Produces stable file identity from device and inode metadata when available.
 *
 * Source collection falls back to the resolved physical path on filesystems
 * without inode support, allowing aliases to coalesce consistently per host.
 */
function identity(info: BigIntStats, physical: string): string {
  return info.ino === 0n ? "path:" + physical : `file:${info.dev}:${info.ino}`;
}

/**
 * Sorts filesystem names without locale rules.
 *
 * Bytewise ordering keeps source snapshots stable across machines whose locale
 * settings would otherwise order the same directory entries differently.
 */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Encodes metadata needed to detect a file changed through a second alias.
 *
 * Alias coalescing compares this value before accepting another address for a
 * file already captured in the current source snapshot.
 */
function version(info: BigIntStats): string {
  return `${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
}
