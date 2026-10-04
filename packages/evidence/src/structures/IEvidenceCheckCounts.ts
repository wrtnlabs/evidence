/**
 * Aggregate participation and coverage totals for a check report.
 *
 * Unit counts sum active obligations rather than deduplicating across the whole
 * graph. Two references to the same population therefore retain two
 * requirements. Diagnostic totals include every finding at the corresponding
 * severity, including findings a report window withheld from `diagnostics`.
 */
export interface IEvidenceCheckCounts {
  /**
   * Number of claim results retained by the plan.
   *
   * Disabled authored entries removed before evaluation are not included.
   */
  claims: number;

  /**
   * Number of retained claims activated during evaluation.
   *
   * This is the numerator displayed beside the total claim count.
   */
  activeClaims: number;

  /**
   * Number of reference results across retained claims.
   *
   * Repeated reference entries count separately even when their populations
   * match.
   */
  obligations: number;

  /**
   * Number of obligations participating in coverage totals.
   *
   * Inactive obligations remain in the total count but do not contribute units.
   */
  activeObligations: number;

  /**
   * Number of active obligations whose analysis could not complete.
   *
   * This exposes incomplete extraction separately from ordinary missing
   * evidence.
   */
  incompleteObligations: number;

  /**
   * Sum of selected reference-unit counts in active obligations.
   *
   * The same semantic identity can contribute to several independent
   * requirements.
   */
  units: number;

  /**
   * Sum of covered-unit counts in active obligations.
   *
   * Coverage accepted in one obligation does not satisfy another automatically.
   */
  coveredUnits: number;

  /**
   * Sum of uncovered-unit counts in active obligations.
   *
   * This reports missing requirements within the materialized populations;
   * completeness still determines whether those populations are trustworthy.
   */
  missingUnits: number;

  /**
   * Number of error diagnostics in the report.
   *
   * Any error makes a complete check fail with exit code one.
   */
  errors: number;

  /**
   * Number of warning diagnostics in the report.
   *
   * Warnings remain visible without making an otherwise complete check fail.
   */
  warnings: number;
}
