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
 * 3. Put exclusion and exclusion-review tags in the detached file and require
 *    source-located errors rather than coverage.
 * 4. Empty a selected document and require its missing-H1 diagnostic, then remove
 *    every matching evidence file and require an incomplete result.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs the checker after each detached-source mutation and asserts coverage, incomplete status, diagnostic category and source location, including a selected empty document.
 * @evidence contracts/testing.md#independent-expectations The fixture declares exactly one selected function, so the absent H1 address, ownerless H2 and exclusion cannot be its positive evidence.
 * @evidence contracts/testing.md#distinguishing-cases Valid, unresolved-owner, absent-owner, empty-document, forbidden exclusion and review kinds, and empty-glob states distinguish structural binding failures from normal missing coverage.
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
          # src/execute.ts#execute

          ## @evidenceExclude rules.md#rule

          Does not apply.
        `,
      });
      const exclusion = await EvidenceChecker.evaluate(plan);
      TestValidator.equals(
        "detached exclusion exit",
        exclusion.report.exitCode,
        2,
      );
      TestValidator.predicate(
        "detached exclusion diagnostic",
        exclusion.report.diagnostics.some(
          (diagnostic) => diagnostic.code === "evidence-files-exclusion",
        ),
      );

      await EvidenceTestFileSystem.save(directory, {
        "evidence/execute.md": dedent`
          # src/execute.ts#execute

          ## @evidence rules.md#rule

          Implements the rule.

          <!-- @evidenceExcludeReview rules.md#rule Reviewed an exclusion. -->
        `,
      });
      const exclusionReview = await EvidenceChecker.evaluate(plan);
      TestValidator.equals(
        "detached exclusion review exit",
        exclusionReview.report.exitCode,
        2,
      );
      TestValidator.predicate(
        "detached exclusion review diagnostic",
        exclusionReview.report.diagnostics.some(
          (diagnostic) => diagnostic.code === "evidence-files-exclusion-review",
        ),
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
