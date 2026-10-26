import { dedent } from "@typia/utils";
import { TestValidator } from "@nestia/e2e";
import { EvidenceChecker, EvidenceQuery } from "@wrtnlabs/evidence";
import type {
  IEvidenceReference,
  IEvidenceCheckAnalysis,
  IEvidenceDiagnostic,
  IEvidenceSourceLocation,
  IEvidenceCheckReport,
  IEvidenceConfigPlan,
  IEvidenceConfigPlanReference,
  IEvidenceInspectReport,
} from "@wrtnlabs/evidence";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Keeps repeated focused queries practical on a large Markdown population.
 *
 * A generous wall-clock ceiling catches the former address cross product while
 * explicit results protect the complete ledger and public copy boundaries.
 *
 * 1. Check 1,000 sources with eight headings each against 800 independent
 *    four-item references; require exactly 3,200 missing acknowledgements.
 * 2. Inspect two headings and focus both in one retained query; require exact
 *    identities, unchanged global diagnostics and the configured focus order.
 * 3. Mutate the original analysis and returned nested source coordinates, then
 *    require the retained query to reproduce its original inspection.
 * 4. Require query construction and these operations to finish within 15 seconds,
 *    excluding source IO and initial graph evaluation.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs real Markdown checking, repeated inspection and focused checking, asserting missing obligations, exact targets, stable diagnostics, nested mutation isolation and a query latency ceiling.
 * @evidence contracts/testing.md#independent-expectations The authored fixture has 800 references of four uncited items, and two explicitly named heading targets; the ceiling detects the measured address cross product rather than claiming a microbenchmark speedup.
 * @evidence contracts/testing.md#distinguishing-cases Covers 1,000 sources, 9,000 addresses, 800 repeated reference boundaries, 3,200 diagnostics, two different targets, repeat inspection and mutations on both sides of the public boundary. Alias, withdrawal and malformed target cases belong to existing query tests.
 * @evidence contracts/testing.md#execution-ownership The exported test_performance_large_markdown is discovered by DynamicExecutor and calls maintained checker and query logic in-process; fixture files use EvidenceTestFileSystem and no CLI is spawned.
 */
export async function test_performance_large_markdown(): Promise<void> {
  const records: Record<string, string> = {
    "evidence.config.ts": "export default {};",
    "rules.md": Array.from(
      { length: 4 },
      (_value: unknown, index: number): string =>
        dedent`
          ## Rule ${index} {#rule-${index}}
          Required behavior ${index}.
        ` + "\n",
    ).join("\n"),
  };
  for (let file: number = 0; file < 1000; ++file)
    records[`docs/source-${file}.md`] = Array.from(
      { length: 8 },
      (_value: unknown, index: number): string =>
        dedent`
          ## Item ${index} {#item-${index}}
          Source ${file} behavior ${index}.
        ` + "\n",
    ).join("\n");
  await EvidenceTestFileSystem.experiment(
    "performance-large-markdown",
    records,
    async (directory: string): Promise<void> => {
      const references: IEvidenceConfigPlanReference[] = Array.from(
        { length: 800 },
        (_value: unknown, index: number): IEvidenceConfigPlanReference => ({
          index,
          severity: "error",
          symbols: ["h2"],
          population: { type: "markdown", files: ["rules.md"], symbol: "h2" },
        }),
      );
      const plan: IEvidenceConfigPlan = {
        configFile: join(directory, "evidence.config.ts"),
        claims: [
          {
            index: 0,
            severity: "error",
            symbols: ["h2"],
            population: {
              type: "markdown",
              files: ["docs/*.md"],
              symbol: "h2",
              reference: references.map(
                (entry: IEvidenceConfigPlanReference): IEvidenceReference =>
                  entry.population,
              ),
            },
            references,
          },
        ],
      };
      const analysis: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(plan);
      TestValidator.equals(
        "all independent missing obligations",
        analysis.report.diagnostics.length,
        3200,
      );
      TestValidator.equals(
        "missing diagnostics",
        analysis.report.diagnostics.every(
          (diagnostic: IEvidenceDiagnostic): boolean =>
            diagnostic.code === "graph-missing-acknowledgement",
        ),
        true,
      );
      TestValidator.equals(
        "large address population",
        analysis.graphInput.claims[0]?.inventory.addresses.length,
        9000,
      );
      const begin: number = performance.now();
      const query: EvidenceQuery = new EvidenceQuery(analysis, directory);
      const targets: string[] = [
        "docs/source-0.md#item-0",
        "docs/source-999.md#item-7",
      ];
      const first: IEvidenceInspectReport = await query.inspect(
        targets[0] ?? "",
      );
      const second: IEvidenceInspectReport = await query.inspect(
        targets[1] ?? "",
      );
      TestValidator.equals(
        "first exact heading",
        first.inspections[0]?.units[0]?.item.target,
        targets[0],
      );
      TestValidator.equals(
        "second exact heading",
        second.inspections[0]?.units[0]?.item.target,
        targets[1],
      );
      TestValidator.equals(
        "global diagnostics retained",
        first.diagnostics.length,
        3200,
      );
      const focused: IEvidenceCheckReport = await query.check(targets);
      TestValidator.equals("focus order", focused.only, targets);
      TestValidator.equals(
        "uncited reference diagnostics are outside claim focus",
        focused.exitCode,
        0,
      );
      const baseline: IEvidenceInspectReport = structuredClone(first);
      analysis.graphInput.claims.length = 0;
      analysis.report.diagnostics.length = 0;
      const location: IEvidenceSourceLocation | undefined =
        first.inspections[0]?.units[0]?.item.locations[0];
      if (location === undefined)
        throw new Error("Missing inspected source location.");
      location.file = "mutated.md";
      if (location.range !== undefined) location.range.start.offset = 999;
      first.diagnostics.length = 0;
      TestValidator.equals(
        "public mutation cannot corrupt cached query",
        await query.inspect(targets[0] ?? ""),
        baseline,
      );
      TestValidator.predicate(
        "indexed query batch stays below 15 seconds",
        performance.now() - begin < 15000,
      );
    },
  );
}
