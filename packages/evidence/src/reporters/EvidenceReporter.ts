import type { IEvidenceCheckReport } from "../structures/IEvidenceCheckReport";
import type { IEvidenceDiagnostic } from "../structures/IEvidenceDiagnostic";
import type { IEvidenceConfigReport } from "../structures/IEvidenceConfigReport";
import type { EvidenceReportFormat } from "../typings/EvidenceReportFormat";

/**
 * Serializes an evaluated check for terminal users or machine consumers.
 *
 * Both formats read the same report and preserve its diagnostic order.
 * Rendering does not evaluate coverage or change process status, which keeps
 * presentation separate from the check programmer's completeness and severity
 * decisions.
 */
export namespace EvidenceReporter {
  /**
   * Selects the requested representation of a completed report object.
   *
   * The returned string includes its final newline and is ready for a stream or
   * output file. This function performs no I/O.
   */
  export function render(
    report: IEvidenceCheckReport,
    format: EvidenceReportFormat,
    window: IEvidenceConfigReport = {},
  ): string {
    const bounded: IEvidenceCheckReport = narrow(report, window);
    return format === "json" ? json(bounded) : text(bounded);
  }

  /**
   * Withholds diagnostics beyond the requested unit and count bounds.
   *
   * Units are admitted in order of their first diagnostic, and findings naming
   * no unit stay eligible. Counts, status, and exit code are copied unchanged
   * so the omission cannot make a failing check look clean.
   */
  export function narrow(
    report: IEvidenceCheckReport,
    window: IEvidenceConfigReport,
  ): IEvidenceCheckReport {
    // Command options override the configuration's bounds one by one.
    const limit: number | undefined = window.limit ?? report.bounds?.limit;
    const units: number | undefined = window.unit ?? report.bounds?.unit;
    if (limit === undefined && units === undefined) return report;
    const admitted: Set<string> = new Set();
    const selected: IEvidenceDiagnostic[] = [];
    for (const diagnostic of report.diagnostics) {
      const unit: string | undefined = diagnostic.unitId ?? diagnostic.hostId;
      if (unit !== undefined && !admitted.has(unit)) {
        if (units !== undefined && admitted.size >= units) continue;
        admitted.add(unit);
      }
      selected.push(diagnostic);
    }
    const diagnostics: IEvidenceDiagnostic[] =
      limit === undefined ? selected : selected.slice(0, limit);
    const omitted: number = report.diagnostics.length - diagnostics.length;
    return omitted === 0
      ? report
      : { ...report, diagnostics, omittedDiagnostics: omitted };
  }

  /**
   * Serializes the versioned report as indented JSON.
   *
   * No fields are projected away, so consumers retain claim boundaries and
   * structured diagnostic coordinates alongside the aggregate counts.
   */
  export function json(report: IEvidenceCheckReport): string {
    return JSON.stringify(report, null, 2) + "\n";
  }

  /**
   * Renders summary counts followed by actionable diagnostic blocks.
   *
   * Each finding includes configuration context, location, subject, and repair.
   * Missing source coordinates fall back to file or aggregate context rather
   * than implying an invented line number.
   */
  export function text(report: IEvidenceCheckReport): string {
    const counts = report.counts;
    const lines: string[] = [
      `Evidence Graph check ${report.status}.`,
      `Config: ${report.configFile}`,
      ...(report.only === undefined
        ? []
        : [
            `Only: ${report.only.join(", ")}${report.shallow === true ? " (shallow)" : " (including descendants)"}.`,
          ]),
      `Claims: ${counts.activeClaims}/${counts.claims} active.`,
      `Obligations: ${counts.activeObligations}/${counts.obligations} active, ${counts.incompleteObligations} incomplete.`,
      `Coverage: ${counts.coveredUnits}/${counts.units} units covered, ${counts.missingUnits} missing.`,
      `Diagnostics: ${counts.errors} errors, ${counts.warnings} warnings.`,
    ];
    if (report.omittedDiagnostics !== undefined)
      lines.push(
        `Showing ${report.diagnostics.length} of ${report.diagnostics.length + report.omittedDiagnostics} diagnostics; ${report.omittedDiagnostics} omitted by --limit/--unit.`,
      );
    for (const diagnostic of report.diagnostics)
      lines.push("", ...diagnosticLines(report, diagnostic));
    return lines.join("\n") + "\n";
  }
}

/**
 * Expands one finding into the common terminal diagnostic layout.
 *
 * Keeping context, location, and subject on separate lines lets aggregate and
 * source-level findings share the layout without losing their repair guidance.
 */
function diagnosticLines(
  report: IEvidenceCheckReport,
  diagnostic: IEvidenceDiagnostic,
): string[] {
  return [
    `${diagnostic.severity.toUpperCase()} [${diagnostic.code}] ${context(report, diagnostic)}`,
    `Location: ${location(diagnostic)}`,
    `Subject: ${subject(diagnostic)}`,
    diagnostic.message,
    `Repair: ${diagnostic.repair}`,
  ];
}

/**
 * Labels a diagnostic with its authored claim and reference coordinates.
 *
 * Claim names supplement numeric identities. If a reference result is
 * unavailable, the authored index still identifies the boundary without an
 * artifact label.
 */
function context(
  report: IEvidenceCheckReport,
  diagnostic: IEvidenceDiagnostic,
): string {
  const claim = report.claims.find(
    (candidate) => candidate.claim === diagnostic.claim,
  );
  if (claim === undefined) return "unscoped analysis";
  const claimText = `claim[${claim.claim}]${claim.name === undefined ? "" : ` '${claim.name}'`} (${claim.type})`;
  if (diagnostic.reference === undefined) return claimText;
  const reference = claim.obligations.find(
    (candidate) => candidate.reference === diagnostic.reference,
  );
  return reference === undefined
    ? `${claimText} -> reference[${diagnostic.reference}]`
    : `${claimText} -> reference[${reference.reference}] (${reference.type})`;
}

/**
 * Chooses the most precise location supplied by a diagnostic.
 *
 * File-only failures and aggregate findings remain readable when extraction
 * could not provide a concrete source span.
 */
function location(diagnostic: IEvidenceDiagnostic): string {
  const location = diagnostic.location;
  if (location === undefined) return "configuration or aggregate graph";
  const start = location.range?.start;
  return start === undefined
    ? location.file
    : `${location.file}:${start.line}:${start.column}`;
}

/**
 * Identifies the host and authored target involved in a finding.
 *
 * Target text is JSON-escaped so quotes and control characters remain visible.
 * Findings without either coordinate apply to the configured population.
 */
function subject(diagnostic: IEvidenceDiagnostic): string {
  const values: string[] = [];
  if (diagnostic.hostId !== undefined) values.push(`host ${diagnostic.hostId}`);
  if (diagnostic.target !== undefined)
    values.push(`target ${JSON.stringify(diagnostic.target)}`);
  return values.length === 0 ? "configured population" : values.join(", ");
}
