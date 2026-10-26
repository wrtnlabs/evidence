import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { open, readdir } from "node:fs/promises";
import type { IEvidenceCapturedSource } from "./IEvidenceCapturedSource";
import { EvidenceSourceFailure } from "./EvidenceSourceFailure";

/**
 * Shares stable physical bytes and directory observations within one
 * materialization.
 *
 * @evidence contracts/common.md#principled-implementation Directory listings are coalesced by exact path; file captures share a physical path and freshly observed device, inode, size, mtime and ctime. Every collector retains independent selection, aliases and root provenance.
 * @evidence contracts/common.md#clear-and-simple-design The async-local capture owns directory and physical-version promises; collectors continue to own root provenance, aliases and selection.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts A fresh physical metadata tuple qualifies each read; changed handles reject, invalid UTF-8 rejects, and captured results never cross materializations.
 * @evidence contracts/common.md#meaningful-documentation Comments describe execution-local ownership, physical-version equivalence and rejection of torn file captures.
 * @evidence contracts/performance.md#efficient-algorithms Each encountered directory is listed once and each physical version is read, decoded and hashed once, plus the selection traversal required by each population.
 * @evidence contracts/performance.md#reuse-equivalent-work Concurrent and completed reads share only an execution-local capture; no configuration result or cross-run filesystem state is cached.
 * @evidence contracts/performance.md#bound-retention-and-release-resources Async-local ownership ends with materialization; byte/listing promises are released with it and each file handle closes in finally.
 */
export class EvidenceSourceAcquisition {
  /** Concurrent materializations never share captured observations. */
  private static readonly scope: AsyncLocalStorage<EvidenceSourceAcquisition> =
    new AsyncLocalStorage();

  /** Exact directory spellings observed during this capture. */
  private readonly directories: Map<string, Promise<string[]>> = new Map();

  /** Stable bytes retained by physical path and freshly observed metadata. */
  private readonly files: Map<string, Promise<IEvidenceCapturedSource>> =
    new Map();

  /**
   * Returns the current capture owner, if orchestration established one.
   *
   * @evidence contracts/common.md#principled-implementation The async-local store identifies the acquisition owner established by the surrounding materialization; absence returns undefined.
   * @evidence contracts/common.md#clear-and-simple-design This accessor exposes scope ownership without creating a second capture.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts It never creates fallback global state or changes the active scope.
   * @evidence contracts/common.md#meaningful-documentation The summary defines the optional result and its orchestration precondition.
   * @evidence contracts/performance.md#efficient-algorithms One async-local lookup takes constant time.
   * @evidence contracts/performance.md#reuse-equivalent-work Repeated callers obtain the same owner only inside the active scope.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The returned owner is borrowed; this accessor acquires no handle or retained entry.
   */
  public static current(): EvidenceSourceAcquisition | undefined {
    return this.scope.getStore();
  }

  /**
   * Runs one complete materialization with isolated acquisition ownership.
   *
   * @evidence contracts/common.md#principled-implementation AsyncLocalStorage.run binds a fresh capture to the supplied asynchronous operation, keeping concurrent materializations independent.
   * @evidence contracts/common.md#clear-and-simple-design This entry establishes lifetime; directory and file methods own acquisition details.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Every invocation creates a fresh owner and executes the supplied operation without caching its result.
   * @evidence contracts/common.md#meaningful-documentation The summary states the complete-materialization lifetime and isolated ownership.
   * @evidence contracts/performance.md#efficient-algorithms Scope setup takes constant work before the operation performs its own acquisition.
   * @evidence contracts/performance.md#reuse-equivalent-work Nested collectors share this owner through async context; separate calls never share captures.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The returned promise follows the operation; after its asynchronous work settles, the scope and its capture maps are no longer needed.
   */
  public static run<Value>(operation: () => Promise<Value>): Promise<Value> {
    return this.scope.run(new EvidenceSourceAcquisition(), operation);
  }

  /**
   * Coalesces exact directory enumeration without deciding glob semantics.
   *
   * @evidence contracts/common.md#principled-implementation An exact path keys a single readdir promise, including a rejected result, for this acquisition lifetime.
   * @evidence contracts/common.md#clear-and-simple-design This method coalesces directory I/O while callers retain glob and path-identity decisions.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No directory is selected or excluded here, and filesystem failures still reject the shared promise.
   * @evidence contracts/common.md#meaningful-documentation The summary distinguishes directory enumeration from glob semantics.
   * @evidence contracts/performance.md#efficient-algorithms First use enumerates the directory once; later access is an expected constant-time map lookup.
   * @evidence contracts/performance.md#reuse-equivalent-work Identical path spellings reuse one listing within this materialization only.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The scope retains one filename array or failure per encountered path and releases it with the acquisition owner.
   */
  public directory(location: string): Promise<string[]> {
    let pending: Promise<string[]> | undefined = this.directories.get(location);
    if (pending === undefined) {
      pending = readdir(location);
      this.directories.set(location, pending);
    }
    return pending;
  }

  /**
   * Shares physical reads only when each caller supplies freshly matching
   * metadata.
   *
   * @evidence contracts/common.md#principled-implementation The physical path and freshly observed device, inode, size, mtime and ctime key a capture that checks handle metadata before and after reading.
   * @evidence contracts/common.md#clear-and-simple-design This method owns equivalence and coalescing; capture owns handle cleanup, UTF-8 validation and hashing.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Changed or replaced files reject rather than reusing bytes under unequal metadata; no cross-run result is consulted.
   * @evidence contracts/common.md#meaningful-documentation The summary states that each caller must supply freshly observed metadata.
   * @evidence contracts/performance.md#efficient-algorithms Key construction is constant in metadata size plus path length; a cache miss reads, decodes and hashes the file linearly.
   * @evidence contracts/performance.md#reuse-equivalent-work Only matching physical-version tuples share pending or completed captures within this owner.
   * @evidence contracts/performance.md#bound-retention-and-release-resources One promise per physical version remains until materialization ends; capture closes its file handle in finally.
   */
  public read(
    location: string,
    info: BigIntStats,
  ): Promise<IEvidenceCapturedSource> {
    const key: string = JSON.stringify([
      location,
      String(info.dev),
      String(info.ino),
      String(info.size),
      String(info.mtimeNs),
      String(info.ctimeNs),
    ]);
    let pending: Promise<IEvidenceCapturedSource> | undefined =
      this.files.get(key);
    if (pending === undefined) {
      pending = capture(location, info);
      this.files.set(key, pending);
    }
    return pending;
  }
}

/** Reads one physical version under a handle and rejects torn or replaced input. */
async function capture(
  location: string,
  expected: BigIntStats,
): Promise<IEvidenceCapturedSource> {
  const handle: FileHandle = await open(location, "r");
  try {
    const before: BigIntStats = await handle.stat({ bigint: true });
    const bytes: Buffer = await handle.readFile();
    const after: BigIntStats = await handle.stat({ bigint: true });
    if (
      before.dev !== expected.dev ||
      before.ino !== expected.ino ||
      before.size !== expected.size ||
      before.mtimeNs !== expected.mtimeNs ||
      before.ctimeNs !== expected.ctimeNs ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(bytes.length) !== after.size
    )
      throw new EvidenceSourceFailure(
        "source-changed",
        "The file changed while it was being read; retry discovery.",
      );
    let content: string;
    try {
      content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      throw new EvidenceSourceFailure(
        "invalid-encoding",
        "The selected file is not valid UTF-8; save it as UTF-8 or correct the files selection.",
      );
    }
    return {
      content,
      digest: createHash("sha256").update(bytes).digest("hex"),
      metadata: after,
    };
  } finally {
    await handle.close();
  }
}
