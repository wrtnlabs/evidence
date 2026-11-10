import type { IEvidenceDelimitedField } from "./IEvidenceDelimitedField";

/**
 * One physical record of a CSV or TSV file.
 *
 * A CSV record can span several lines when a quoted field contains line
 * breaks. Its span excludes the terminating line break, so a row's diagnostic
 * starts at its first field.
 *
 * @evidence contracts/common.md#principled-implementation A record keeps its ordered fields and its half-open span without the line terminator, which is enough to validate width and locate the row.
 * @evidence contracts/common.md#clear-and-simple-design The record is reader output only; header roles and keys are applied by the scanner.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Fields are kept in authored order; nothing is padded or truncated to the header width.
 * @evidence contracts/common.md#meaningful-documentation The comment explains multi-line records and the span's end; each field is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceDelimitedRecord {
  /** Fields in authored order, including empty fields between delimiters. */
  fields: IEvidenceDelimitedField[];

  /** UTF-16 offset of the record's first character. */
  start: number;

  /** Exclusive UTF-16 offset of the record's last character. */
  end: number;
}
