import {
  EvidenceChecker,
  EvidenceCommand,
  EvidenceFingerprint,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckReport,
  IEvidenceCommandResult,
  IEvidenceConfig,
  IEvidenceDiagnostic,
  IEvidenceCheckAnalysis,
  IEvidenceGraphClaim,
  IEvidenceGraphReference,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { join } from "node:path";
import typia from "typia";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Projects checklist failures from selected items rather than whole-host
 * totals.
 *
 * Each selected host still owes the focused item. An unrelated missing sibling
 * must neither fail an answered item nor appear in a focused diagnostic.
 *
 * 1. Let two hosts answer the parent but only one answer its child; require the
 *    shallow parent to pass and the parent subtree to fail on the child.
 * 2. Focus the child and require its one missing-host finding without sibling
 *    names or unselected coverage units.
 * 3. Add the second child's answer and require focused recovery while an unrelated
 *    checklist item remains unanswered.
 * 4. Require reviews and give both child answers current fingerprints; require the
 *    child to pass while unreviewed parent answers fail a shallow check.
 */
export async function test_command_only_checklist(): Promise<void> {
  const config: IEvidenceConfig = {
    claims: [
      {
        type: "typescript",
        files: ["src/*.ts"],
        symbol: "function",
        reference: {
          type: "markdown",
          root: "docs",
          files: ["*.md"],
          symbol: ["h2", "h3"],
          checklist: true,
        },
      },
    ],
  };
  const source: string = dedent`
    /**
     * @evidence checklist.md#parent Answers the parent item.
     * @evidence checklist.md#child Answers the child item.
     */
    export function first(): void {}
    /** @evidence checklist.md#parent Answers the parent item. */
    export function second(): void {}
  `;
  await EvidenceTestFileSystem.experiment(
    "only checklist",
    {
      "evidence.config.json": JSON.stringify(config),
      "docs/checklist.md":
        "## Parent {#parent}\nParent item.\n### Child {#child}\nChild item.\n## Unrelated {#unrelated}\nUnrelated item.\n",
      "src/main.ts": source,
    },
    async (directory: string): Promise<void> => {
      async function run(
        target: string,
        ...options: string[]
      ): Promise<IEvidenceCheckReport> {
        const result: IEvidenceCommandResult = await EvidenceCommand.run(
          ["--only", target, "--format", "json", ...options],
          directory,
        );
        return typia.json.assertParse<IEvidenceCheckReport>(result.stdout);
      }
      const parent: IEvidenceCheckReport = await run(
        "checklist.md#parent",
        "--shallow",
      );
      TestValidator.equals(
        "answered parent",
        [parent.counts.units, parent.counts.coveredUnits, parent.exitCode],
        [1, 1, 0],
      );
      const subtree: IEvidenceCheckReport = await run("checklist.md#parent");
      TestValidator.equals(
        "subtree answers",
        [subtree.counts.units, subtree.counts.missingUnits, subtree.exitCode],
        [2, 1, 1],
      );
      const child: IEvidenceCheckReport = await run("checklist.md#child");
      TestValidator.equals("one missing host", child.diagnostics.length, 1);
      TestValidator.predicate(
        "focused missing item",
        child.diagnostics.every(
          (diagnostic: IEvidenceDiagnostic): boolean =>
            diagnostic.code === "graph-checklist-missing" &&
            diagnostic.message.includes("Child") &&
            !diagnostic.message.includes("Unrelated"),
        ),
      );
      await EvidenceTestFileSystem.save(directory, {
        "src/main.ts": source.replace(
          "/** @evidence checklist.md#parent Answers the parent item. */",
          "/**\n * @evidence checklist.md#parent Answers the parent item.\n * @evidence checklist.md#child Answers the child item.\n */",
        ),
      });
      TestValidator.equals(
        "focused repair",
        (await run("checklist.md#child")).exitCode,
        0,
      );

      const reviewed: IEvidenceConfig = {
        claims: [
          {
            type: "typescript",
            files: ["src/*.ts"],
            symbol: "function",
            reference: {
              type: "markdown",
              root: "docs",
              files: ["*.md"],
              symbol: ["h2", "h3"],
              checklist: true,
              requireReview: true,
            },
          },
        ],
      };
      await EvidenceTestFileSystem.save(directory, {
        "evidence.config.json": JSON.stringify(reviewed),
      });
      const analysis: IEvidenceCheckAnalysis = await EvidenceChecker.analyze(
        join(directory, "evidence.config.json"),
      );
      const claim: IEvidenceGraphClaim | undefined =
        analysis.graphInput.claims[0];
      const reference: IEvidenceGraphReference | undefined =
        claim === undefined ? undefined : claim.references[0];
      if (reference === undefined)
        throw new Error("Missing checklist reference.");
      const unit: IEvidenceUnit | undefined = reference.inventory.units.find(
        (candidate: IEvidenceUnit): boolean => candidate.name === "Child",
      );
      if (unit === undefined) throw new Error("Missing checklist child.");
      const fingerprint: string = EvidenceFingerprint.inspect(
        reference.inventory,
        unit.id,
      ).fingerprint;
      await EvidenceTestFileSystem.save(directory, {
        "src/main.ts": dedent`
        /**
         * @evidence checklist.md#parent Answers the parent item.
         * @evidence checklist.md#child Answers the child item.
         * @evidenceReview checklist.md#child #${fingerprint} Checked the child answer.
         */
        export function first(): void {}
        /**
         * @evidence checklist.md#parent Answers the parent item.
         * @evidence checklist.md#child Answers the child item.
         * @evidenceReview checklist.md#child #${fingerprint} Checked the child answer.
         */
        export function second(): void {}
      `,
      });
      TestValidator.equals(
        "parent review does not govern child",
        (await run("checklist.md#child")).exitCode,
        0,
      );
      TestValidator.equals(
        "parent still needs its review",
        (await run("checklist.md#parent", "--shallow")).exitCode,
        1,
      );
    },
  );
}
