/**
 * A syntax error found while reading CSV or TSV records.
 *
 * The reader reports offsets only; the scanner converts them into source
 * locations and marks the inventory incomplete, because a misread record can
 * lose or invent rows.
 *
 * @evidence contracts/common.md#principled-implementation Code, message, repair and a half-open span are what the scanner needs to report a located, repairable syntax error.
 * @evidence contracts/common.md#clear-and-simple-design The reader stays free of inventory and location types; the scanner owns diagnostics.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Every problem reaches the inventory and makes it incomplete.
 * @evidence contracts/common.md#meaningful-documentation The comment explains why offsets suffice and why problems make the population incomplete; each field is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceDelimitedProblem {
  /** Stable diagnostic code. */
  code: string;

  /** What is wrong at the span. */
  message: string;

  /** How to correct the file. */
  repair: string;

  /** UTF-16 offset where the problem starts. */
  start: number;

  /** Exclusive UTF-16 offset where the problem ends. */
  end: number;
}
