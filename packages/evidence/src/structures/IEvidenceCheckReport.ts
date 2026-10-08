import type { EvidenceCheckStatus } from "../typings/EvidenceCheckStatus";
import type { EvidenceCommandExitCode } from "../typings/EvidenceCommandExitCode";
import type { IEvidenceCheckClaim } from "./IEvidenceCheckClaim";
import type { IEvidenceCheckCounts } from "./IEvidenceCheckCounts";
import type { IEvidenceConfigReport } from "./IEvidenceConfigReport";
import type { IEvidenceDiagnostic } from "./IEvidenceDiagnostic";

/**
 * Versioned coverage report shared by the checker and its output renderers.
 *
 * Completion describes whether the selected populations could be analyzed;
 * success additionally requires no error diagnostics. A complete report can
 * therefore fail coverage, while warning-only findings can still pass. Claims
 * retain configuration indices so consumers can attribute each independent
 * obligation without relying on an optional display name.
 */
export interface IEvidenceCheckReport {
  /**
   * Serialization contract understood by report consumers.
   *
   * Readers can check this discriminator before interpreting counts or claims.
   */
  schemaVersion: 1;

  /**
   * Operation that produced this report.
   *
   * This distinguishes check output from query reports and operational
   * failures.
   */
  command: "check";

  /**
   * Configuration file resolved for this evaluation.
   *
   * The path provides context for claim indices and is retained in text output.
   */
  configFile: string;

  /**
   * Whether all active claims and obligations were analyzed completely.
   *
   * A complete analysis can still report missing evidence and return failure.
   */
  status: EvidenceCheckStatus;

  /**
   * Whether the complete analysis contains no error diagnostics.
   *
   * Warnings alone do not fail the check; incomplete analysis always does.
   */
  success: boolean;

  /**
   * Process outcome corresponding to completeness and error severity.
   *
   * Zero passes, one means a complete check found errors, and two means the
   * analysis was incomplete.
   */
  exitCode: EvidenceCommandExitCode;

  /**
   * Aggregate participation, coverage, and diagnostic counts.
   *
   * Coverage totals sum active obligations, so a unit required by two
   * references contributes once to each obligation rather than once to the
   * whole report.
   */
  counts: IEvidenceCheckCounts;

  /**
   * Evaluated claims with their independent reference results.
   *
   * Entries carry authored indices even when configuration planning removed
   * disabled entries before evaluation.
   */
  claims: IEvidenceCheckClaim[];

  /**
   * Findings sorted by configuration, source, and diagnostic coordinates.
   *
   * Both output formats consume this order so asynchronous extraction does not
   * reorder otherwise equivalent reports.
   */
  diagnostics: IEvidenceDiagnostic[];

  /**
   * Number of diagnostics withheld by a report window.
   *
   * Omission means every diagnostic is listed. `counts` still totals the
   * withheld findings.
   */
  omittedDiagnostics?: number;

  /**
   * Printing bounds the configuration requested for this check.
   *
   * Renderers apply them unless the command supplies its own. Omission means
   * the configuration requested no narrowing.
   */
  bounds?: IEvidenceConfigReport;

  /**
   * Authored targets used to restrict this check's outcome.
   *
   * Omission describes the full configured check. When present, counts and exit
   * status describe selected units while policy retains its full context.
   */
  only?: string[];

  /**
   * Whether only-targets exclude descendants from the focused check.
   *
   * Omission includes descendants when only is present.
   */
  shallow?: true;
}
