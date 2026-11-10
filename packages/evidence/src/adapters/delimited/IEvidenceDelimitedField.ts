/**
 * One decoded field of a CSV or TSV record and its raw source span.
 *
 * The span covers the field as authored, including CSV enclosing quotes, so
 * diagnostics and annotation hosts point at the cell a person edits. The value
 * is the field after RFC 4180 unquoting; TSV values equal their raw text.
 *
 * @evidence contracts/common.md#principled-implementation A decoded value beside its raw half-open span lets fingerprints use field meaning while locations keep authored coordinates.
 * @evidence contracts/common.md#clear-and-simple-design The record is reader output only; validation and materialization belong to the scanner.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts No field content is normalized beyond the dialect's own unquoting.
 * @evidence contracts/common.md#meaningful-documentation The comment explains raw spans versus decoded values; each field is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceDelimitedField {
  /**
   * Field content after removing CSV quotes and undoubling `""`.
   *
   * Line breaks inside a quoted CSV field are kept exactly as written.
   */
  value: string;

  /** UTF-16 offset where the authored field, or its opening quote, starts. */
  start: number;

  /**
   * Exclusive UTF-16 offset where the authored field, or its closing quote,
   * ends.
   */
  end: number;

  /**
   * Whether the field was enclosed in CSV double quotes.
   *
   * Annotation mapping uses this to skip the quotes and map each `""` pair to
   * the single quote it decodes to.
   */
  quoted: boolean;
}
