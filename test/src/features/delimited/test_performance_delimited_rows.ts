import { EvidenceChecker, EvidenceDelimitedAdapter } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckAnalysis,
  IEvidenceConfigPlan,
  IEvidenceInventory,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";
import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Keeps a 100,000-row ledger practical as a reference population.
 *
 * Generous wall-clock ceilings catch quadratic reading or resolution, while
 * exact counts prove that no row was skipped to save time.
 *
 * 1. Analyze a 100,000-row single-column TSV, whose fields contain no
 *    delimiter, and a 100,000-row CSV with quoted fields; require every row as
 *    a unit and each analysis within 20 seconds.
 * 2. Check a Markdown decision that cites the CSV file aggregate and two rows;
 *    require all 100,000 rows covered and the whole check within 60 seconds.
 *
 * @evidence contracts/testing.md#behavioral-verification Analyzes large ledgers through the adapter and the checker and asserts exact unit and coverage counts beside latency ceilings.
 * @evidence contracts/testing.md#independent-expectations Row counts come from the generated fixtures, and the aggregate coverage follows the README rule that a file citation covers its rows; the ceilings detect super-linear work rather than claim a speedup.
 * @evidence contracts/testing.md#distinguishing-cases Covers a single-column file that would expose a per-field delimiter search, quoted CSV fields, and aggregate plus row citations at scale; correctness of small cases belongs to the other delimited tests.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers the exported test_performance_delimited_rows under test/src/features and it calls maintained source in-process; fixture files use EvidenceTestFileSystem and no CLI is spawned.
 */
export async function test_performance_delimited_rows(): Promise<void> {
  const count: number = 100_000;
  const single: string = [
    "id",
    ...Array.from({ length: count }, (_: unknown, index: number): string => `R${index}`),
    "",
  ].join("\n");
  let begin: number = performance.now();
  const tsv: IEvidenceInventory = await new EvidenceDelimitedAdapter("tsv", {
    key: "id",
  }).analyze(EvidenceTestSourceSnapshot.create("rows.tsv", single));
  const tsvSeconds: number = (performance.now() - begin) / 1000;
  TestValidator.equals(
    "single-column rows",
    tsv.units.filter((unit) => unit.symbol === "row").length,
    count,
  );
  TestValidator.predicate(
    `single-column analysis within 20s (${tsvSeconds.toFixed(2)}s)`,
    tsvSeconds < 20,
  );

  const csv: string = [
    "id,title,owner",
    ...Array.from(
      { length: count },
      (_: unknown, index: number): string =>
        `R${index},"Project ${index}, phase ""${index % 7}""",owner-${index % 13}`,
    ),
    "",
  ].join("\n");
  await EvidenceTestFileSystem.experiment(
    "performance-delimited-rows",
    {
      "evidence.config.ts": "export default {};",
      "data/projects.csv": csv,
      "decisions/all.md": [
        "<!--",
        "@evidence data/projects.csv Every project is in scope.",
        "@evidence data/projects.csv#R0 The first project leads.",
        `@evidence data/projects.csv#R${count - 1} The last project closes.`,
        "-->",
        "",
      ].join("\n"),
    },
    async (directory: string): Promise<void> => {
      begin = performance.now();
      const analysis: IEvidenceCheckAnalysis = await EvidenceChecker.evaluate(
        plan(directory),
      );
      const seconds: number = (performance.now() - begin) / 1000;
      TestValidator.equals(
        "every row covered",
        [
          analysis.report.exitCode,
          analysis.report.counts.units,
          analysis.report.counts.coveredUnits,
        ],
        [0, count, count],
      );
      TestValidator.predicate(
        `checking 100,000 rows within 60s (${seconds.toFixed(2)}s)`,
        seconds < 60,
      );
    },
  );
}

/** Plans one Markdown claim referencing the large CSV ledger. */
function plan(directory: string): IEvidenceConfigPlan {
  return {
    configFile: join(directory, "evidence.config.ts"),
    claims: [
      {
        index: 0,
        severity: "error",
        symbols: ["file"],
        population: {
          type: "markdown",
          files: ["decisions/*.md"],
          symbol: "file",
          reference: { type: "csv", files: ["data/projects.csv"], key: "id" },
        },
        references: [
          {
            index: 0,
            severity: "error",
            symbols: ["row"],
            population: { type: "csv", files: ["data/projects.csv"], key: "id" },
          },
        ],
      },
    ],
  };
}
