/**
 * One-based position of a finite check's displayed diagnostic window.
 *
 * Eligible diagnostics are those left after the unit bound; total diagnostics
 * still describes the complete selected check. An empty requested page omits
 * start and end while preserving the check's status and exit code.
 *
 * @evidence contracts/common.md#principled-implementation One-based page and range coordinates describe the limit slice after unit admission while retaining full and eligible totals.
 * @evidence contracts/common.md#clear-and-simple-design A named record carries presentation metadata without changing graph results.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts An out-of-range page remains explicit instead of inventing a clean result.
 * @evidence contracts/common.md#meaningful-documentation The comment explains one-based positions, unit eligibility and empty-page omission; members state their meanings.
 * @evidenceExclude contracts/performance.md#efficient-algorithms This data contract chooses no algorithm.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work This data contract computes nothing.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources This data contract owns no runtime resource.
 */
export interface IEvidenceReportPage {
  /** Serialization version of page metadata. */
  schemaVersion: 1;

  /** Requested one-based page, including a request beyond the last page. */
  page: number;

  /** Effective diagnostics per page after CLI overrides configuration. */
  limit: number;

  /** At least one page, including when no eligible diagnostics exist. */
  totalPages: number;

  /** Number of diagnostics in the complete selected check. */
  totalDiagnostics: number;

  /** Number remaining after the effective unit bound, before paging. */
  eligibleDiagnostics: number;

  /** Whether the immediately previous page exists in the eligible result. */
  hasPrevious: boolean;

  /** Whether another page follows within the eligible result. */
  hasNext: boolean;

  /** One-based first eligible diagnostic displayed; omitted on an empty page. */
  start?: number;

  /** One-based last eligible diagnostic displayed; omitted on an empty page. */
  end?: number;
}
