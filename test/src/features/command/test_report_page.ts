import { EvidenceCommand, EvidenceReporter } from "@wrtnlabs/evidence";
import type { IEvidenceCheckReport, IEvidenceDiagnostic } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";

/**
 * Pages eligible check diagnostics without changing the complete check result.
 *
 * A user must be able to read consecutive bounded groups after unit admission,
 * including an empty request beyond the final page.
 *
 * 1. Reject malformed, duplicate, watch, and other-command page arguments.
 * 2. Read consecutive pages with a unit bound and require stable disjoint order.
 * 3. Require exact-multiple, empty, and beyond-end metadata and unchanged status.
 *
 * @evidence contracts/testing.md#behavioral-verification Parses page arguments and calls EvidenceReporter.narrow and text on a report with unit-bearing and unscoped diagnostics.
 * @evidence contracts/testing.md#independent-expectations Expected page lists and one-based ranges are hand-derived from the five ordered fixture diagnostics and the configured unit admission.
 * @evidence contracts/testing.md#distinguishing-cases Covers first, middle, final, empty, and beyond-end pages, unit admission before paging, malformed arguments, and stable full totals.
 * @evidence contracts/testing.md#execution-ownership The exported test_report_page is discovered by DynamicExecutor and calls maintained command and reporter logic in-process.
 */
export function test_report_page(): void {
  TestValidator.equals(
    "page parse",
    EvidenceCommand.parse(["--page", "2", "--limit", "3"]),
    { operation: "check", cwd: ".", format: "text", page: 2, limit: 3 },
  );
  for (const args of [
    ["--page", "0"],
    ["--page", "-1"],
    ["--page", "1.5"],
    ["--page", "9007199254740992"],
    ["--page", "1", "--page", "2"],
    ["--page"],
    ["list", "--page", "1"],
    ["--page", "1", "--watch"],
  ])
    TestValidator.error(`reject ${args.join(" ")}`, () =>
      EvidenceCommand.parse(args),
    );

  const report: IEvidenceCheckReport = {
    schemaVersion: 1,
    command: "check",
    configFile: "evidence.config.ts",
    status: "complete",
    success: false,
    exitCode: 1,
    counts: {
      claims: 1,
      activeClaims: 1,
      obligations: 1,
      activeObligations: 1,
      incompleteObligations: 0,
      units: 4,
      coveredUnits: 0,
      missingUnits: 4,
      errors: 5,
      warnings: 0,
    },
    claims: [],
    diagnostics: [
      finding("a", "u0"),
      finding("b"),
      finding("c", "u1"),
      finding("d", "u0"),
      finding("e", "u2"),
    ],
  };
  const codes = (value: IEvidenceCheckReport): string[] =>
    value.diagnostics.map((item: IEvidenceDiagnostic): string => item.code);
  const first: IEvidenceCheckReport = EvidenceReporter.narrow(
    report,
    { unit: 2, limit: 2 },
    1,
  );
  const second: IEvidenceCheckReport = EvidenceReporter.narrow(
    report,
    { unit: 2, limit: 2 },
    2,
  );
  TestValidator.equals("first page", codes(first), ["a", "b"]);
  TestValidator.equals("second page", codes(second), ["c", "d"]);
  TestValidator.equals("eligible count", first.page?.eligibleDiagnostics, 4);
  TestValidator.equals("full count", second.page?.totalDiagnostics, 5);
  TestValidator.equals("page total", second.page?.totalPages, 2);
  TestValidator.predicate(
    "render defaults to first page",
    EvidenceReporter.render(report, "text", { limit: 2 }).includes("Page 1 of 3"),
  );
  TestValidator.equals("second range", [second.page?.start, second.page?.end], [3, 4]);
  TestValidator.equals("prev and next", [second.page?.hasPrevious, second.page?.hasNext], [true, false]);
  TestValidator.equals("omission includes unit", second.omittedDiagnostics, 3);
  TestValidator.equals("status preserved", [second.status, second.exitCode, second.counts], [report.status, report.exitCode, report.counts]);
  TestValidator.predicate(
    "text page position",
    EvidenceReporter.text(second).includes("Page 2 of 2 (limit 2): diagnostics 3-4 of 4 eligible; 5 total"),
  );
  const beyond: IEvidenceCheckReport = EvidenceReporter.narrow(
    report,
    { unit: 2, limit: 2 },
    3,
  );
  TestValidator.equals("beyond empty", codes(beyond), []);
  TestValidator.equals("beyond request", [beyond.page?.page, beyond.page?.totalPages, beyond.page?.start], [3, 2, undefined]);
  TestValidator.equals("beyond failure", [beyond.exitCode, beyond.omittedDiagnostics], [1, 5]);
  TestValidator.predicate("empty page text", EvidenceReporter.text(beyond).includes("Page 3 of 2 (limit 2): empty"));
  const distant: IEvidenceCheckReport = EvidenceReporter.narrow(
    report,
    { unit: 2, limit: 2 },
    100,
  );
  TestValidator.equals("distant page has no adjacent predecessor", distant.page?.hasPrevious, false);
  const partial: IEvidenceCheckReport = EvidenceReporter.narrow(
    report,
    { limit: 2 },
    3,
  );
  TestValidator.equals("partial final page", codes(partial), ["e"]);
  TestValidator.equals("partial range", [partial.page?.start, partial.page?.end, partial.page?.totalPages], [5, 5, 3]);
  const empty: IEvidenceCheckReport = EvidenceReporter.narrow(
    { ...report, diagnostics: [] },
    { limit: 2 },
    1,
  );
  TestValidator.equals("empty page one of one", [empty.page?.page, empty.page?.totalPages, empty.page?.eligibleDiagnostics], [1, 1, 0]);
  TestValidator.equals("empty range omitted", [empty.page?.start, empty.page?.end], [undefined, undefined]);
  TestValidator.error("page requires effective limit", () =>
    EvidenceReporter.narrow(report, {}, 1),
  );
}

/** Creates one ordered finding for report-window behavior. */
function finding(code: string, unitId?: string): IEvidenceDiagnostic {
  return {
    code,
    severity: "error",
    message: code,
    repair: code,
    ...(unitId === undefined ? {} : { unitId }),
  };
}
