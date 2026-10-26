import type { BigIntStats } from "node:fs";

/**
 * Stable physical bytes shared only within one materialization.
 *
 * @evidence contracts/common.md#principled-implementation Content, digest and final metadata describe the same checked physical read.
 * @evidence contracts/common.md#clear-and-simple-design Logical addresses and root provenance belong to each collector separately.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Only metadata-equivalent requests share a capture.
 * @evidence contracts/common.md#meaningful-documentation Each field identifies the captured data or its freshness witness.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A data contract chooses no algorithm.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A data contract computes no result.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The acquisition scope owns instances, not this type declaration.
 */
export interface IEvidenceCapturedSource {
  /** Strictly decoded original UTF-8 text, including its BOM. */
  content: string;

  /** SHA-256 of the original bytes before decoding. */
  digest: string;

  /** Metadata checked after the file handle finished reading. */
  metadata: BigIntStats;
}
