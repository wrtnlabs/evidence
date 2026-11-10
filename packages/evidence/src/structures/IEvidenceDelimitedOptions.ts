/**
 * Column roles that turn a CSV or TSV file into keyed row units.
 *
 * Both settings name header cells exactly as written in the file's first
 * record, case-sensitively and after removing a UTF-8 byte order mark. A named
 * header that is missing from a file makes that file's population incomplete.
 * Configuration validation rejects empty names, a repeated key column, and an
 * evidence column that is also a key column.
 *
 * Claims and references share these settings because the evidence column shapes
 * row fingerprints on both sides: its cells are never fingerprinted, so a row's
 * own annotations cannot expire a review of that row.
 *
 * @example
 *   const options: IEvidenceDelimitedOptions = {
 *     key: ["system", "dashboard"],
 *     evidenceColumn: "evidence",
 *   };
 *   // A row with system "crm" and dashboard "sales" is data/links.csv#crm:sales.
 *
 * @evidence contracts/common.md#principled-implementation Header names, not column positions, select the identity and carrier columns, so inserting or reordering columns keeps every address.
 * @evidence contracts/common.md#clear-and-simple-design The two settings are shared by the claim and reference interfaces and by the adapter constructor instead of being repeated.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts A missing header makes the population incomplete instead of selecting fewer rows.
 * @evidence contracts/common.md#meaningful-documentation The comment states name matching, validation, the fingerprint role shared by claims and references, and gives an example; each field documents its effect.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceDelimitedOptions {
  /**
   * Header of the identity column, or a nonempty array of headers forming a
   * composite key.
   *
   * - The trimmed key cell is the row's address after `#`; composite parts are
   *   joined with `:` in configured order.
   * - Each part must be nonempty, unique within the file, and free of whitespace,
   *   control characters, `#`, and `"`. Composite parts also exclude `:`.
   * - Rows violating these rules are reported at their line and make the
   *   population incomplete.
   */
  key: string | string[];

  /**
   * Header of the column whose cells carry annotations.
   *
   * - A cell holds zero or more annotations. A tag token at the start of the cell
   *   or after whitespace starts the next annotation; text before the first tag
   *   is reported.
   * - Its cells never enter row fingerprints.
   * - Omit it when rows cite nothing in the file itself; claim rows can still
   *   answer through `evidenceFiles`.
   */
  evidenceColumn?: string;
}
