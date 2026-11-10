import {
  EvidenceDelimitedAdapter,
  EvidenceFingerprint,
  EvidenceGraph,
  EvidenceMarkdownAdapter,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceDiagnostic,
  IEvidenceGraphResult,
  IEvidenceInventory,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestGraph } from "../../internal/EvidenceTestGraph";
import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Ties row review fingerprints to header-to-value content outside the evidence
 * column.
 *
 * A review must expire when the reviewed row's meaning changes and survive
 * edits that change only annotations, quoting style, line endings, column
 * order, or other rows.
 *
 * 1. Fingerprint a baseline CSV row with an evidence column.
 * 2. Change its evidence cell, its CSV quoting, its line endings, the column
 *    order, and another row; require the same fingerprint each time.
 * 3. Change one of its values and rename one header; require new fingerprints.
 * 4. Fingerprint the file aggregate; require it to change with any row value.
 * 5. Evaluate a Markdown claim that reviews the row with `requireReview`; require
 *    success with the current fingerprint, success after an evidence-cell edit,
 *    and a stale-review diagnostic after a value edit.
 *
 * @evidence contracts/testing.md#behavioral-verification Analyzes ledger variants, compares EvidenceFingerprint results, and evaluates a requireReview graph against current and stale row content.
 * @evidence contracts/testing.md#independent-expectations Equality expectations follow the stated rule that only header-to-value pairs outside the evidence column are reviewed content; the graph expectations follow the README review contract.
 * @evidence contracts/testing.md#distinguishing-cases Covers evidence-cell, quoting, CRLF, column-order and sibling-row edits that must not expire, value and header edits that must, the aggregate, and a stale review in a graph; parsing belongs to test_delimited_units.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers the exported test_delimited_fingerprints under test/src/features and it calls maintained source in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_delimited_fingerprints(): Promise<void> {
  const baseline: string = await fingerprint(
    "id,owner,evidence,goal\nP1,ann,,growth\nP2,bob,,reach\n",
  );
  for (const [label, content] of [
    [
      "evidence cell edit",
      "id,owner,evidence,goal\nP1,ann,@evidence goals.md#growth Reason.,growth\nP2,bob,,reach\n",
    ],
    [
      "quoting style",
      'id,owner,evidence,goal\n"P1","ann","","growth"\nP2,bob,,reach\n',
    ],
    [
      "CRLF line endings",
      "id,owner,evidence,goal\r\nP1,ann,,growth\r\nP2,bob,,reach\r\n",
    ],
    ["column order", "goal,id,evidence,owner\ngrowth,P1,,ann\nreach,P2,,bob\n"],
    [
      "sibling row",
      "id,owner,evidence,goal\nP1,ann,,growth\nP2,carol,,reach\n",
    ],
    ["row order", "id,owner,evidence,goal\nP2,bob,,reach\nP1,ann,,growth\n"],
  ] satisfies Array<[string, string]>)
    TestValidator.equals(
      `${label} keeps the row fingerprint`,
      await fingerprint(content),
      baseline,
    );
  for (const [label, content] of [
    ["value edit", "id,owner,evidence,goal\nP1,ann,,margin\nP2,bob,,reach\n"],
    ["header rename", "id,lead,evidence,goal\nP1,ann,,growth\nP2,bob,,reach\n"],
  ] satisfies Array<[string, string]>)
    TestValidator.notEquals(
      `${label} expires the row fingerprint`,
      await fingerprint(content),
      baseline,
    );
  TestValidator.notEquals(
    "aggregate follows any row value",
    await fingerprint(
      "id,owner,evidence,goal\nP1,ann,,growth\nP2,carol,,reach\n",
      "file",
    ),
    await fingerprint(
      "id,owner,evidence,goal\nP1,ann,,growth\nP2,bob,,reach\n",
      "file",
    ),
  );

  TestValidator.equals(
    "current review passes",
    reviewDiagnostics(
      await review(
        baseline,
        "id,owner,evidence,goal\nP1,ann,,growth\nP2,bob,,reach\n",
      ),
    ),
    [],
  );
  TestValidator.equals(
    "evidence-cell edit keeps the review",
    reviewDiagnostics(
      await review(
        baseline,
        "id,owner,evidence,goal\nP1,ann,@evidence x.md#y Note.,growth\nP2,bob,,reach\n",
      ),
    ),
    [],
  );
  TestValidator.equals(
    "value edit makes the review stale",
    reviewDiagnostics(
      await review(
        baseline,
        "id,owner,evidence,goal\nP1,ann,,margin\nP2,bob,,reach\n",
      ),
    ),
    ["graph-stale-review"],
  );
}

/** Analyzes a ledger with an evidence column. */
async function analyze(content: string): Promise<IEvidenceInventory> {
  return new EvidenceDelimitedAdapter("csv", {
    key: "id",
    evidenceColumn: "evidence",
  }).analyze(EvidenceTestSourceSnapshot.create("data/projects.csv", content));
}

/** Returns the presented fingerprint of row P1 or of the file aggregate. */
async function fingerprint(
  content: string,
  symbol: "file" | "row" = "row",
): Promise<string> {
  const inventory: IEvidenceInventory = await analyze(content);
  const unit: IEvidenceUnit = requireUnit(inventory, symbol);
  return EvidenceFingerprint.inspect(inventory, unit.id).fingerprint;
}

/** Finds the P1 row or the file aggregate. */
function requireUnit(
  inventory: IEvidenceInventory,
  symbol: "file" | "row",
): IEvidenceUnit {
  const unit: IEvidenceUnit | undefined = inventory.units.find(
    (candidate: IEvidenceUnit): boolean =>
      candidate.symbol === symbol &&
      (symbol === "file" || candidate.name === "P1"),
  );
  if (unit === undefined) throw new Error(`Missing ${symbol} fixture unit.`);
  return unit;
}

/** Evaluates a Markdown claim that cites and reviews row P1 under requireReview. */
async function review(
  recorded: string,
  ledger: string,
): Promise<IEvidenceGraphResult> {
  const claim: IEvidenceInventory = await new EvidenceMarkdownAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "docs/decision.md",
      dedent`
        <!--
        @evidence data/projects.csv#P1 The decision reallocates P1's budget.
        @evidenceReview data/projects.csv#P1 #${recorded} Read the row before deciding.
        -->
      `,
    ),
  );
  const reference: IEvidenceInventory = await analyze(ledger);
  const row: IEvidenceUnit = requireUnit(reference, "row");
  const file: IEvidenceUnit | undefined = claim.units.find(
    (unit: IEvidenceUnit): boolean => unit.symbol === "file",
  );
  if (file === undefined) throw new Error("Missing decision file unit.");
  return EvidenceGraph.evaluate({
    claims: [
      {
        severity: "error",
        inventory: claim,
        unitIds: [file.id],
        references: [
          {
            severity: "error",
            inventory: reference,
            unitIds: [row.id],
            resolutions: await EvidenceTestGraph.resolveDeclarations(
              claim,
              reference,
              [row.id],
            ),
            reviewResolutions: await EvidenceTestGraph.resolveReviews(
              claim,
              reference,
              [row.id],
            ),
            requireReview: true,
          },
        ],
      },
    ],
  });
}

/** Lists the diagnostic codes of a graph result. */
function reviewDiagnostics(result: IEvidenceGraphResult): string[] {
  return result.diagnostics.map(
    (diagnostic: IEvidenceDiagnostic): string => diagnostic.code,
  );
}
