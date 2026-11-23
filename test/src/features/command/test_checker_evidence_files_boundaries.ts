import { EvidenceChecker } from "@wrtnlabs/evidence";
import type { IEvidenceConfigPlan } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Rejects detached evidence that cannot be assigned to an original claim unit.
 *
 * 1. Confirm a valid H1 and H2 evidence heading covers one requirement.
 * 2. Change the H1 to an absent source and then remove it; require incomplete
 *    results with owner and unowned-statement diagnostics respectively.
 * 3. Put an exclusion heading and its exclusion-review comment before the first H1
 *    and require one unowned-statement error for each, even though a valid
 *    owner section follows.
 * 4. Empty a selected document and require its missing-H1 diagnostic, then remove
 *    every matching evidence file and require an incomplete result.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs the checker after each detached-source mutation and asserts coverage, incomplete status, diagnostic category, count and source location, including a selected empty document.
 * @evidence contracts/testing.md#independent-expectations The fixture declares exactly one selected function, so the absent H1 address and ownerless statements cannot be its evidence, and the README requires every detached statement to sit beneath an H1.
 * @evidence contracts/testing.md#distinguishing-cases Valid, unresolved-owner, absent-owner, leading exclusion and exclusion review beside a later valid owner, empty-document, and empty-glob states distinguish structural binding failures from normal missing coverage; accepted detached exclusions belong to test_checker_evidence_files_exclusions.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers this exported test; it invokes maintained checker logic directly and cleans its fixture tree.
 */
export async function test_checker_evidence_files_boundaries(): Promise<void> {
  const location: string = join(
    __dirname,
    `evidence-boundaries-${randomUUID()}`,
  );
  await EvidenceTestFileSystem.experiment(
    location,
    {
      "evidence.config.ts": "export default {};\n",
      "src/execute.ts": "export function execute(): number { return 1; }\n",
      "rules.md": "## Rule {#rule}\n\nDo the work.\n",
      "evidence/execute.md": dedent`
        # src/execute.ts#execute

        ## @evidence rules.md#rule

        Implements the rule.
      `,
    },
    async (directory: string): Promise<void> => {
      const plan: IEvidenceConfigPlan = {
        configFile: join(directory, "evidence.config.ts"),
        claims: [
          {
            index: 0,
            population: {
              type: "typescript",
              files: ["src/**/*.ts"],
              symbol: "function",
              evidenceFiles: ["evidence/**/*.md"],
              reference: {
                type: "markdown",
                files: ["rules.md"],
                symbol: "h2",
              },
            },
            severity: "error",
            symbols: ["function"],
            references: [
              {
                index: 0,
                population: {
                  type: "markdown",
                  files: ["rules.md"],
                  symbol: "h2",
                },
                severity: "error",
                symbols: ["h2"],
              },
            ],
          },
        ],
      };
      const valid = await EvidenceChecker.evaluate(plan);
      TestValidator.equals("valid detached exit", valid.report.exitCode, 0);

      await EvidenceTestFileSystem.save(directory, {
        "evidence/execute.md": dedent`
          # src/missing.ts#execute

          ## @evidence rules.md#rule

          Implements the rule.
        `,
      });
      const missingOwner = await EvidenceChecker.evaluate(plan);
      TestValidator.equals(
        "missing owner exit",
        missingOwner.report.exitCode,
        2,
      );
      TestValidator.predicate(
        "missing owner diagnostic",
        missingOwner.report.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === "evidence-files-owner" &&
            diagnostic.location?.file.endsWith("execute.md") === true,
        ),
      );

      await EvidenceTestFileSystem.save(directory, {
        "evidence/execute.md": dedent`
          ## @evidence rules.md#rule

          Implements the rule.
        `,
      });
      const noOwner = await EvidenceChecker.evaluate(plan);
      TestValidator.equals("absent H1 exit", noOwner.report.exitCode, 2);
      TestValidator.predicate(
        "unowned statement diagnostic",
        noOwner.report.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === "evidence-files-unowned-statement",
        ),
      );

      await EvidenceTestFileSystem.save(directory, {
        "evidence/execute.md": dedent`
          ## @evidenceExclude rules.md#rule

          Does not apply.

          <!-- @evidenceExcludeReview rules.md#rule Reviewed the exclusion. -->

          # src/execute.ts#execute

          ## @evidence rules.md#rule

          Implements the rule.
        `,
      });
      const leading = await EvidenceChecker.evaluate(plan);
      TestValidator.equals(
        "leading exclusion exit",
        leading.report.exitCode,
        2,
      );
      TestValidator.equals(
        "leading exclusion and review are unowned",
        leading.report.diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === "evidence-files-unowned-statement" &&
            diagnostic.location?.file.endsWith("execute.md") === true,
        ).length,
        2,
      );

      await EvidenceTestFileSystem.save(directory, {
        "evidence/execute.md": "",
      });
      const emptyDocument = await EvidenceChecker.evaluate(plan);
      TestValidator.equals(
        "empty document exit",
        emptyDocument.report.exitCode,
        2,
      );
      TestValidator.predicate(
        "empty document owner diagnostic",
        emptyDocument.report.diagnostics.some(
          (diagnostic) => diagnostic.code === "evidence-files-missing-owner",
        ),
      );

      const empty: IEvidenceConfigPlan = structuredClone(plan);
      const claim = empty.claims[0];
      if (claim === undefined) throw new Error("Missing fixture claim.");
      claim.population.evidenceFiles = ["evidence/absent/*.md"];
      const noFiles = await EvidenceChecker.evaluate(empty);
      TestValidator.equals(
        "empty evidence files exit",
        noFiles.report.exitCode,
        2,
      );
      TestValidator.predicate(
        "empty evidence files diagnostic",
        noFiles.report.diagnostics.some(
          (diagnostic) => diagnostic.code === "evidence-files-empty",
        ),
      );
    },
  );
}
