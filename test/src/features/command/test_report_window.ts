import {
  EvidenceCommand,
  EvidenceReporter,
  EvidenceWatchReporter,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckReport,
  IEvidenceDiagnostic,
  IEvidenceWatchCheckCycle,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import typia from "typia";

/**
 * Bounds printed diagnostics without hiding the size of the full result.
 *
 * An agent that reads a bounded report must still see the complete totals and
 * how many findings were withheld, while the bounds select by unit and count.
 *
 * 1. Parse the two bounds on check and reject non-positive, fractional, duplicate,
 *    and other-command uses.
 * 2. Window five findings over units u0 and u1, a host-only statement finding, and
 *    an unscoped finding: a unit bound admits units in first-seen order, keeps
 *    all findings of an admitted unit, and keeps unscoped findings; a count
 *    bound keeps a report-order prefix; both bounds compose.
 * 3. Require counts to remain complete, an omission count and text notice when
 *    findings are withheld, and an untouched report when nothing is.
 */
export function test_report_window(): void {
  TestValidator.equals(
    "bounds parse",
    EvidenceCommand.parse(["--limit", "3", "--unit", "2"]),
    { operation: "check", cwd: ".", format: "text", limit: 3, unit: 2 },
  );
  for (const args of [
    ["--limit", "0"],
    ["--unit", "-1"],
    ["--limit", "1.5"],
    ["list", "--limit", "1"],
    ["--unit", "1", "--unit", "2"],
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
      units: 5,
      coveredUnits: 0,
      missingUnits: 5,
      errors: 5,
      warnings: 0,
    },
    claims: [],
    diagnostics: [
      diagnostic("a", { unitId: "u0" }),
      diagnostic("b", {}),
      diagnostic("c", { unitId: "u1" }),
      diagnostic("d", { unitId: "u0" }),
      diagnostic("e", { hostId: "h0" }),
    ],
  };
  const codes = (value: IEvidenceCheckReport): string[] =>
    value.diagnostics.map((item: IEvidenceDiagnostic): string => item.code);

  const byUnit: IEvidenceCheckReport = EvidenceReporter.narrow(report, {
    unit: 1,
  });
  TestValidator.equals("first unit whole plus unscoped", codes(byUnit), [
    "a",
    "b",
    "d",
  ]);
  TestValidator.equals("unit omission", byUnit.omittedDiagnostics, 2);

  const byLimit: IEvidenceCheckReport = EvidenceReporter.narrow(report, {
    limit: 2,
  });
  TestValidator.equals("prefix", codes(byLimit), ["a", "b"]);

  const both: IEvidenceCheckReport = EvidenceReporter.narrow(report, {
    unit: 2,
    limit: 3,
  });
  TestValidator.equals("composed", codes(both), ["a", "b", "c"]);
  TestValidator.equals("composed omission", both.omittedDiagnostics, 2);

  TestValidator.equals("complete counts", both.counts, report.counts);
  TestValidator.equals("exit preserved", both.exitCode, 1);
  TestValidator.predicate(
    "text notice",
    EvidenceReporter.text(both).includes("Showing 3 of 5 diagnostics"),
  );

  // Watch cycles narrow their embedded report and leave failed cycles alone.
  const cycle: IEvidenceWatchCheckCycle = {
    schemaVersion: 1,
    command: "check",
    watch: true,
    cycle: 1,
    status: "complete",
    success: false,
    exitCode: 1,
    report,
  };
  const framed: IEvidenceWatchCheckCycle =
    typia.json.assertParse<IEvidenceWatchCheckCycle>(
      EvidenceWatchReporter.render(cycle, "json", { unit: 1 }),
    );
  TestValidator.equals("watch narrowed", codes(framed.report), ["a", "b", "d"]);
  TestValidator.equals("watch counts", framed.report.counts, report.counts);
  TestValidator.predicate(
    "watch text notice",
    EvidenceWatchReporter.render(cycle, "text", { limit: 1 }).includes(
      "Showing 1 of 5 diagnostics",
    ),
  );

  // A window that withholds nothing leaves the report alone.
  const roomy: IEvidenceCheckReport = EvidenceReporter.narrow(report, {
    unit: 9,
    limit: 9,
  });
  TestValidator.equals("nothing omitted", roomy, report);
}

function diagnostic(
  code: string,
  scope: Pick<IEvidenceDiagnostic, "unitId" | "hostId">,
): IEvidenceDiagnostic {
  return { code, severity: "error", message: code, repair: code, ...scope };
}
