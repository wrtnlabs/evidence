import type { IEvidenceCheckReport } from "../structures/IEvidenceCheckReport";
import type { IEvidenceDiagnostic } from "../structures/IEvidenceDiagnostic";
import type { IEvidenceConfigReport } from "../structures/IEvidenceConfigReport";
import type { IEvidenceReportPage } from "../structures/IEvidenceReportPage";
import type { EvidenceReportFormat } from "../typings/EvidenceReportFormat";

/**
 * Serializes an evaluated check for terminal users or machine consumers.
 *
 * Both formats read the same report and preserve its diagnostic order.
 * Rendering does not evaluate coverage or change process status, which keeps
 * presentation separate from the check programmer's completeness and severity
 * decisions.
 *
 * @evidence contracts/common.md#principled-implementation Check reports are rendered as indented JSON or as summary counts followed by diagnostic blocks, both preserving the report's diagnostic order.
 * @evidence contracts/common.md#clear-and-simple-design Rendering is separate from evaluation; private helpers format diagnostic blocks.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Rendering never changes status or exit code.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains the separation; every function and helper is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceReporter {
  /**
   * Selects the requested representation of a completed report object.
   *
   * The returned string includes its final newline and is ready for a stream or
   * output file. An effective limit selects page one by default; a supplied
   * page selects another one-based group. This function performs no I/O.
   *
   * @evidence contracts/common.md#principled-implementation The requested format selects json or text, each ending with a newline.
   * @evidence contracts/common.md#clear-and-simple-design Render only dispatches.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No I/O is performed.
   * @evidence contracts/common.md#meaningful-documentation The comment states the newline and no-I/O contract.
   * @evidence contracts/performance.md#efficient-algorithms Rendering is linear in the report's size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each report is rendered once per output.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Rendering returns a string and keeps nothing; the caller owns the output.
   */
  export function render(
    report: IEvidenceCheckReport,
    format: EvidenceReportFormat,
    window: IEvidenceConfigReport = {},
    page?: number,
  ): string {
    const effectiveLimit: number | undefined =
      window.limit ?? report.bounds?.limit;
    const bounded: IEvidenceCheckReport = narrow(
      report,
      window,
      page ?? (effectiveLimit === undefined ? undefined : 1),
    );
    return format === "json" ? json(bounded) : text(bounded);
  }

  /**
   * Withholds diagnostics beyond the requested unit and count bounds.
   *
   * Units are admitted in order of their first diagnostic, and findings naming
   * no unit stay eligible. A supplied one-based page slices that eligible set
   * by the effective limit and records both full and eligible totals. Counts,
   * status, and exit code are copied unchanged so an empty page cannot make a
   * failing check look clean. Omitting page retains the prefix window.
   *
   * @evidence contracts/common.md#principled-implementation Command bounds override configured bounds one by one; units are admitted by first diagnostic, unit-less findings stay eligible, and a one-based page slices the limit-sized eligible sequence.
   * @evidence contracts/common.md#clear-and-simple-design Narrowing returns a new report and leaves rendering to render.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Counts, status and exit code are copied unchanged and omissions are counted, so a narrowed report cannot look clean.
   * @evidence contracts/common.md#meaningful-documentation The comment explains admission order, one-based paging, legacy unpaged calls and preserved totals; the inline comment explains override precedence.
   * @evidence contracts/performance.md#efficient-algorithms Linear in diagnostics with constant-time set lookups; only eligible diagnostics are sliced.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each report is narrowed once per output.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources It returns the original or a shallow copy; nothing is retained.
   */
  export function narrow(
    report: IEvidenceCheckReport,
    window: IEvidenceConfigReport,
    page?: number,
  ): IEvidenceCheckReport {
    // Command options override the configuration's bounds one by one.
    const limit: number | undefined = window.limit ?? report.bounds?.limit;
    const units: number | undefined = window.unit ?? report.bounds?.unit;
    if (
      page !== undefined &&
      (limit === undefined || !Number.isSafeInteger(page) || page < 1)
    )
      throw new Error(
        "A one-based page requires an effective diagnostic limit.",
      );
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
    const totalPages: number =
      limit === undefined ? 1 : Math.max(1, Math.ceil(selected.length / limit));
    const start: number =
      page !== undefined && page <= totalPages ? (page - 1) * (limit ?? 0) : 0;
    const diagnostics: IEvidenceDiagnostic[] =
      limit === undefined
        ? selected
        : page === undefined
          ? selected.slice(0, limit)
          : page > totalPages
            ? []
            : selected.slice(start, start + limit);
    const omitted: number = report.diagnostics.length - diagnostics.length;
    const metadata: IEvidenceReportPage | undefined =
      page === undefined || limit === undefined
        ? undefined
        : {
            schemaVersion: 1,
            page,
            limit,
            totalPages,
            totalDiagnostics: report.diagnostics.length,
            eligibleDiagnostics: selected.length,
            hasPrevious: page > 1 && page - 1 <= totalPages,
            hasNext: page < totalPages,
            ...(diagnostics.length === 0
              ? {}
              : { start: start + 1, end: start + diagnostics.length }),
          };
    return omitted === 0 && metadata === undefined
      ? report
      : {
          ...report,
          diagnostics,
          ...(omitted === 0 ? {} : { omittedDiagnostics: omitted }),
          ...(metadata === undefined ? {} : { page: metadata }),
        };
  }

  /**
   * Serializes the versioned report as indented JSON.
   *
   * No fields are projected away, so consumers retain claim boundaries and
   * structured diagnostic coordinates alongside the aggregate counts.
   *
   * @evidence contracts/common.md#principled-implementation The whole versioned report is serialized as indented JSON without projecting fields away.
   * @evidence contracts/common.md#clear-and-simple-design JSON output is the plain serialization.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No field is dropped for presentation.
   * @evidence contracts/common.md#meaningful-documentation The comment explains completeness of the JSON form.
   * @evidence contracts/performance.md#efficient-algorithms Rendering is linear in the report's size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each report is rendered once per output.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Rendering returns a string and keeps nothing; the caller owns the output.
   */
  export function json(report: IEvidenceCheckReport): string {
    return JSON.stringify(report, null, 2) + "\n";
  }

  /**
   * Renders summary counts followed by actionable diagnostic blocks.
   *
   * Each finding includes configuration context, location, subject, and repair.
   * A finite limited report also states its one-based page and eligible totals.
   * Missing source coordinates fall back to file or aggregate context rather
   * than implying an invented line number.
   *
   * @evidence contracts/common.md#principled-implementation Summary counts precede one block per diagnostic with context, location, subject and repair.
   * @evidence contracts/common.md#clear-and-simple-design Block formatting is a private helper.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Missing coordinates fall back to file or aggregate context instead of an invented line.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the block contents and fallback.
   * @evidence contracts/performance.md#efficient-algorithms Rendering is linear in the report's size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each report is rendered once per output.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Rendering returns a string and keeps nothing; the caller owns the output.
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
        `Showing ${report.diagnostics.length} of ${report.diagnostics.length + report.omittedDiagnostics} diagnostics; ${report.omittedDiagnostics} omitted by --limit/--unit${report.page === undefined ? "" : "/--page"}.`,
      );
    if (report.page !== undefined) {
      const page: IEvidenceReportPage = report.page;
      const range: string =
        page.start === undefined
          ? "empty"
          : `diagnostics ${page.start}-${page.end ?? page.start}`;
      lines.push(
        `Page ${page.page} of ${page.totalPages} (limit ${page.limit}): ${range} of ${page.eligibleDiagnostics} eligible; ${page.totalDiagnostics} total; previous ${page.hasPrevious ? "yes" : "no"}, next ${page.hasNext ? "yes" : "no"}.`,
      );
    }
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
    ...(diagnostic.context ?? []).flatMap((section) => [
      `Reference context: ${section.target} (${section.file}:${section.startLine}-${section.endLine})`,
      section.text,
      ...(section.truncated
        ? [
            `Context truncated: ${section.omittedCharacters} characters and ${section.omittedLines} lines omitted.`,
          ]
        : []),
    ]),
    ...(diagnostic.omittedContext === undefined
      ? []
      : [`${diagnostic.omittedContext} reference sections omitted.`]),
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
