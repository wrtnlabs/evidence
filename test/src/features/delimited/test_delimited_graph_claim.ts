import { EvidenceChecker } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckAnalysis,
  IEvidenceConfig,
  IEvidenceDiagnostic,
  IEvidenceMarkdownReference,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Lets ledger rows answer Markdown references from an evidence column or from
 * separate evidence files.
 *
 * 1. Check TSV rows whose evidence column answers three references to the same
 *    goals: ordinary coverage, `singleEvidencePerSymbol`, and
 *    `noEvidenceExclude`; require a clean pass.
 * 2. Make one row cite two goals; require only the single-evidence obligation to
 *    fail for that row.
 * 3. Replace a row's evidence with an exclusion; require ordinary coverage to
 *    accept it and `noEvidenceExclude` to refuse it.
 * 4. Check rows rooted at `data` without an evidence column against a Markdown
 *    checklist, answered by `evidenceFiles` whose H1s use config-relative row
 *    addresses; require every row to answer every item, then remove one answer
 *    and require a checklist miss for that row only.
 * 5. Let two rows of one ledger cite each other under `requireReview`; read both
 *    expected fingerprints from the missing-review diagnostics, write the
 *    reviews into the rows' own evidence cells, and require a clean pass.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs EvidenceChecker on JSON configurations over real files and asserts exit codes and per-reference diagnostic codes as row annotations change.
 * @evidence contracts/testing.md#independent-expectations Expected outcomes follow the README policy table: singleEvidencePerSymbol counts distinct positive units per host, noEvidenceExclude refuses exclusions, checklist requires every host to answer every item, and fingerprints exclude the evidence column; review fingerprints are taken from the checker's own missing-review diagnostics.
 * @evidence contracts/testing.md#distinguishing-cases Covers passing ordinary, cardinality and refusal policies, a host citing two units, an exclusion accepted by one reference and refused by another, checklist answers through detached files including one missing answer, and mutual row reviews that edit each other's evidence cells; reference-side rows belong to test_delimited_graph_reference.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers the exported test_delimited_graph_claim under test/src/features and it calls EvidenceChecker in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_delimited_graph_claim(): Promise<void> {
  const goals: IEvidenceMarkdownReference = {
    type: "markdown",
    files: ["context/goals.md"],
    symbol: "h2",
  };
  const config: IEvidenceConfig = {
    claims: [
      {
        type: "tsv",
        files: ["data/projects.tsv"],
        key: "id",
        evidenceColumn: "evidence",
        reference: [
          goals,
          { ...goals, singleEvidencePerSymbol: true },
          { ...goals, noEvidenceExclude: true },
        ],
      },
    ],
  };
  await EvidenceTestFileSystem.experiment(
    "delimited-claim",
    {
      "evidence.config.json": JSON.stringify(config),
      "context/goals.md": goalsDocument(),
      "data/projects.tsv": ledger(
        "@evidence context/goals.md#growth Buys growth.",
        "@evidence context/goals.md#cost Cuts cost.",
      ),
    },
    async (directory: string): Promise<void> => {
      const passing: IEvidenceCheckAnalysis = await check(directory);
      TestValidator.equals(
        "evidence column satisfies every policy",
        [passing.report.exitCode, passing.report.diagnostics],
        [0, []],
      );

      await EvidenceTestFileSystem.save(directory, {
        "data/projects.tsv": ledger(
          "@evidence context/goals.md#growth Buys growth.",
          "@evidence context/goals.md#cost Cuts cost. @evidence context/goals.md#growth Also grows.",
        ),
      });
      TestValidator.equals(
        "two goals break only single evidence",
        boundaries(await check(directory)),
        ["1:graph-single-evidence-per-symbol"],
      );

      await EvidenceTestFileSystem.save(directory, {
        "data/projects.tsv": ledger(
          "@evidence context/goals.md#growth Buys growth.",
          "@evidenceExclude context/goals.md#cost Cost is owned by finance.",
        ),
      });
      // Ordinary coverage accepts the exclusion; the row then cites no positive
      // unit, which singleEvidencePerSymbol counts as zero.
      TestValidator.equals(
        "exclusion is accepted by ordinary coverage only",
        boundaries(await check(directory)).sort(
          (left: string, right: string): number => left.localeCompare(right),
        ),
        [
          "1:graph-single-evidence-per-symbol",
          "2:graph-forbidden-exclusion",
          "2:graph-missing-acknowledgement",
        ],
      );
    },
  );

  const checklist: IEvidenceConfig = {
    claims: [
      {
        type: "tsv",
        root: "data",
        files: ["projects.tsv"],
        key: "id",
        evidenceFiles: ["evidence/*.md"],
        reference: { ...goals, checklist: true },
      },
    ],
  };
  const answers = (withSecondCost: boolean): string =>
    [
      "# data/projects.tsv#P1",
      "",
      "## @evidence context/goals.md#growth",
      "",
      "Buys growth.",
      "",
      "## @evidence context/goals.md#cost",
      "",
      "Keeps spend flat.",
      "",
      "# data/projects.tsv#P2",
      "",
      "## @evidence context/goals.md#growth",
      "",
      "Grows retention.",
      "",
      ...(withSecondCost
        ? ["## @evidence context/goals.md#cost", "", "Cuts cost.", ""]
        : []),
    ].join("\n");
  await EvidenceTestFileSystem.experiment(
    "delimited-checklist",
    {
      "evidence.config.json": JSON.stringify(checklist),
      "context/goals.md": goalsDocument(),
      "data/projects.tsv": "id\ttitle\nP1\tAlpha\nP2\tBeta\n",
      "evidence/projects.md": answers(true),
    },
    async (directory: string): Promise<void> => {
      const complete: IEvidenceCheckAnalysis = await check(directory);
      TestValidator.equals(
        "every row answers every checklist item",
        [complete.report.exitCode, complete.report.diagnostics],
        [0, []],
      );
      await EvidenceTestFileSystem.save(directory, {
        "evidence/projects.md": answers(false),
      });
      const partial: IEvidenceCheckAnalysis = await check(directory);
      const misses: IEvidenceDiagnostic[] = partial.report.diagnostics.filter(
        (diagnostic: IEvidenceDiagnostic): boolean =>
          diagnostic.code === "graph-checklist-missing",
      );
      TestValidator.equals("one row misses one item", misses.length, 1);
      TestValidator.equals(
        "the miss is located on row P2",
        misses.map(
          (diagnostic: IEvidenceDiagnostic): number =>
            diagnostic.location?.range?.start.line ?? 0,
        ),
        [3],
      );
    },
  );

  // Rows that cite and review each other change each other's evidence cells, so
  // only fingerprints that ignore the evidence column can be satisfied together.
  const mutual: IEvidenceConfig = {
    claims: [
      {
        type: "tsv",
        files: ["data/projects.tsv"],
        key: "id",
        evidenceColumn: "evidence",
        reference: {
          type: "tsv",
          files: ["data/projects.tsv"],
          key: "id",
          evidenceColumn: "evidence",
          requireReview: true,
        },
      },
    ],
  };
  const mutualLedger = (fingerprints: Map<string, string>): string =>
    ledger(
      cite("P2", fingerprints.get("data/projects.tsv#P2")),
      cite("P1", fingerprints.get("data/projects.tsv#P1")),
    );
  await EvidenceTestFileSystem.experiment(
    "delimited-mutual-review",
    {
      "evidence.config.json": JSON.stringify(mutual),
      "data/projects.tsv": mutualLedger(new Map()),
    },
    async (directory: string): Promise<void> => {
      const unreviewed: IEvidenceCheckAnalysis = await check(directory);
      const fingerprints: Map<string, string> = new Map(
        unreviewed.report.diagnostics.flatMap(
          (diagnostic: IEvidenceDiagnostic): Array<[string, string]> => {
            const found: RegExpExecArray | null = /'#([0-9a-f]{7})'/u.exec(
              diagnostic.message,
            );
            return diagnostic.code === "graph-missing-review" &&
              diagnostic.target !== undefined &&
              found?.[1] !== undefined
              ? [[diagnostic.target, found[1]]]
              : [];
          },
        ),
      );
      TestValidator.equals("both rows need a review", fingerprints.size, 2);
      await EvidenceTestFileSystem.save(directory, {
        "data/projects.tsv": mutualLedger(fingerprints),
      });
      const reviewed: IEvidenceCheckAnalysis = await check(directory);
      TestValidator.equals(
        "mutual reviews stay current",
        [reviewed.report.exitCode, reviewed.report.diagnostics],
        [0, []],
      );
    },
  );
}

/** Two H2 goals with explicit anchors. */
function goalsDocument(): string {
  return dedent`
    ## Growth {#growth}

    Grow the customer base.

    ## Cost {#cost}

    Keep spending flat.
  `;
}

/** One evidence cell citing a row and, when known, reviewing it. */
function cite(key: string, fingerprint: string | undefined): string {
  const target: string = `data/projects.tsv#${key}`;
  return fingerprint === undefined
    ? `@evidence ${target} Depends on ${key}.`
    : `@evidence ${target} Depends on ${key}. @evidenceReview ${target} #${fingerprint} Read ${key}.`;
}

/** A two-row ledger with the given evidence cells. */
function ledger(first: string, second: string): string {
  return [
    "id\tevidence\ttitle",
    `P1\t${first}\tAlpha`,
    `P2\t${second}\tBeta`,
    "",
  ].join("\n");
}

/** Lists failing diagnostics as reference-index and code pairs. */
function boundaries(analysis: IEvidenceCheckAnalysis): string[] {
  return analysis.report.diagnostics
    .filter(
      (diagnostic: IEvidenceDiagnostic): boolean =>
        diagnostic.severity === "error",
    )
    .map(
      (diagnostic: IEvidenceDiagnostic): string =>
        `${diagnostic.reference ?? "-"}:${diagnostic.code}`,
    );
}

/** Checks the fixture's JSON configuration. */
async function check(directory: string): Promise<IEvidenceCheckAnalysis> {
  return EvidenceChecker.analyze(join(directory, "evidence.config.json"));
}
