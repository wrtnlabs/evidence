/**
 * Bounds that narrow which check diagnostics a report prints.
 *
 * The bounds only trim presentation. Aggregate counts, status, and exit code
 * still describe the complete analysis, and a narrowed report states how many
 * diagnostics it withheld, so an agent reading it can focus locally without
 * mistaking the result for a clean one. The same shape is accepted in the
 * configuration's `report` setting and, with higher priority, as command
 * options.
 *
 * @example
 *   const report: IEvidenceConfigReport = { unit: 1, limit: 20 };
 *
 * @evidence contracts/common.md#principled-implementation Two optional positive bounds narrow printed diagnostics while counts and exit status still describe the whole analysis.
 * @evidence contracts/common.md#clear-and-simple-design One shape serves configuration and command options, with command values taking priority.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Bounds trim presentation only; a narrowed report states what it withheld.
 * @evidence contracts/common.md#meaningful-documentation The comment explains the presentation-only effect and gives an example; both bounds document their ordering rules.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceConfigReport {
  /**
   * Maximum diagnostics per finite check page, in report order.
   *
   * Omission prints every diagnostic selected by the other bound. Watch output
   * keeps the first bounded group. A positive integer is required.
   */
  limit?: number | undefined;

  /**
   * Maximum number of distinct units whose diagnostics are printed.
   *
   * A unit is the unit a finding names, or the documentation host for statement
   * findings. Units are admitted in the order their first diagnostic appears,
   * and every diagnostic of an admitted unit is kept. Findings naming neither
   * are never counted against this bound. A positive integer is required.
   */
  unit?: number | undefined;
}
