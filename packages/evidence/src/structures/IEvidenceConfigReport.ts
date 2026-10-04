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
 */
export interface IEvidenceConfigReport {
  /**
   * Maximum number of diagnostics to print, in report order.
   *
   * Omission prints every diagnostic selected by the other bound. A positive
   * integer is required.
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
