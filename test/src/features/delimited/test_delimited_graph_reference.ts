import { EvidenceChecker, EvidenceQuery } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckAnalysis,
  IEvidenceConfig,
  IEvidenceDiagnostic,
  IEvidenceInspection,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Requires documents and code to acknowledge ledger rows through configured
 * CSV and TSV references.
 *
 * 1. Check a Markdown decision that cites one of two TSV rows; require one
 *    missing acknowledgement located on the uncited row's line in the ledger.
 * 2. Cite the TSV file aggregate instead; require both rows covered.
 * 3. Cite both rows, then reorder them and insert a new row; require the cited
 *    rows to stay covered and only the inserted row to be missing.
 * 4. Check a TypeScript function citing a root-relative CSV row whose key is a
 *    URL; require it to resolve and pass instead of being routed as a Swagger
 *    operation, and require inspection of a known and an unknown URL key to
 *    stay in the ledger scope.
 * 5. Check a TSV ledger with a duplicate key; require an incomplete, failing run
 *    rather than a smaller passing population.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs EvidenceChecker on JSON configurations over real files and asserts exit codes, counts, diagnostic codes and the ledger line of the missing row.
 * @evidence contracts/testing.md#independent-expectations Expected coverage follows the README graph rules: a row needs a citation, a file citation covers its rows, and incomplete analysis exits 2; lines are read off the fixtures.
 * @evidence contracts/testing.md#distinguishing-cases Covers a missing row, aggregate coverage, row reordering and insertion, a programming claim with a URL key, inspection of known and unknown URL keys, and a malformed ledger; claim-side policies belong to test_delimited_graph_claim.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers the exported test_delimited_graph_reference under test/src/features and it calls EvidenceChecker in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_delimited_graph_reference(): Promise<void> {
  const config: IEvidenceConfig = {
    claims: [
      {
        type: "markdown",
        files: ["decisions/*.md"],
        symbol: "file",
        reference: { type: "tsv", files: ["data/projects.tsv"], key: "id" },
      },
    ],
  };
  await EvidenceTestFileSystem.experiment(
    "delimited-reference",
    {
      "evidence.config.json": JSON.stringify(config),
      "data/projects.tsv": "id\ttitle\nP1\tAlpha\nP2\tBeta\n",
      "decisions/budget.md": decision(["data/projects.tsv#P1"]),
    },
    async (directory: string): Promise<void> => {
      const missing: IEvidenceCheckAnalysis = await check(directory);
      TestValidator.equals("one row missing", missing.report.exitCode, 1);
      TestValidator.equals(
        "missing row is P2 on line 3",
        missing.report.diagnostics
          .filter(
            (diagnostic: IEvidenceDiagnostic): boolean =>
              diagnostic.code === "graph-missing-acknowledgement",
          )
          .map((diagnostic: IEvidenceDiagnostic): string =>
            [
              (diagnostic.location?.file ?? "").replaceAll("\\", "/").split("/").at(-1),
              diagnostic.location?.range?.start.line,
            ].join(":"),
          ),
        ["projects.tsv:3"],
      );

      await EvidenceTestFileSystem.save(directory, {
        "decisions/budget.md": decision(["data/projects.tsv"]),
      });
      const aggregate: IEvidenceCheckAnalysis = await check(directory);
      TestValidator.equals("aggregate passes", aggregate.report.exitCode, 0);
      TestValidator.equals(
        "aggregate covers both rows",
        aggregate.report.counts.coveredUnits,
        2,
      );

      await EvidenceTestFileSystem.save(directory, {
        "decisions/budget.md": decision([
          "data/projects.tsv#P1",
          "data/projects.tsv#P2",
        ]),
        "data/projects.tsv": "id\ttitle\nP0\tNew\nP2\tBeta\nP1\tAlpha\n",
      });
      const reordered: IEvidenceCheckAnalysis = await check(directory);
      TestValidator.equals(
        "reordering keeps cited rows covered",
        [
          reordered.report.counts.coveredUnits,
          reordered.report.counts.missingUnits,
        ],
        [2, 1],
      );
      TestValidator.predicate(
        "only the inserted row is missing",
        reordered.report.diagnostics.every(
          (diagnostic: IEvidenceDiagnostic): boolean =>
            diagnostic.code !== "graph-missing-acknowledgement" ||
            diagnostic.location?.range?.start.line === 2,
        ),
      );

      await EvidenceTestFileSystem.save(directory, {
        "data/projects.tsv": "id\ttitle\nP1\tAlpha\nP2\tBeta\nP1\tAgain\n",
      });
      const duplicate: IEvidenceCheckAnalysis = await check(directory);
      TestValidator.equals(
        "duplicate key is incomplete",
        [duplicate.report.status, duplicate.report.exitCode],
        ["incomplete", 2],
      );
    },
  );

  const code: IEvidenceConfig = {
    claims: [
      {
        type: "typescript",
        files: ["src/*.ts"],
        symbol: "function",
        reference: { type: "csv", files: ["links.csv"], key: "url" },
      },
    ],
  };
  await EvidenceTestFileSystem.experiment(
    "delimited-url-keys",
    {
      "evidence.config.json": JSON.stringify(code),
      "links.csv": "url,title\nhttps://example.com/a,Example\n",
      "src/links.ts": dedent`
        /** @evidence links.csv#https://example.com/a Renders the registered link. */
        export function render(): void {}
      `,
    },
    async (directory: string): Promise<void> => {
      const analysis: IEvidenceCheckAnalysis = await check(directory);
      TestValidator.equals(
        "URL-keyed row resolves from code",
        [analysis.report.exitCode, analysis.report.diagnostics],
        [0, []],
      );
      const query: EvidenceQuery = new EvidenceQuery(analysis, directory);
      const statuses = async (target: string): Promise<string[]> =>
        (await query.inspect(target)).inspections.map(
          (inspection: IEvidenceInspection): string =>
            `${inspection.scope.type}:${inspection.status}`,
        );
      TestValidator.equals(
        "inspect resolves a URL key",
        await statuses("links.csv#https://example.com/a"),
        ["csv:resolved"],
      );
      TestValidator.equals(
        "inspect keeps an unknown URL key in the ledger scope",
        await statuses("links.csv#https://example.com/b"),
        ["csv:missing-member"],
      );
    },
  );
}

/** Writes a decision document that cites each target. */
function decision(targets: string[]): string {
  return [
    "<!--",
    ...targets.map(
      (target: string): string =>
        `@evidence ${target} The decision reallocates this budget.`,
    ),
    "-->",
    "",
  ].join("\n");
}

/** Checks the fixture's JSON configuration. */
async function check(directory: string): Promise<IEvidenceCheckAnalysis> {
  return EvidenceChecker.analyze(join(directory, "evidence.config.json"));
}
