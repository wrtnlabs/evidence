import { EvidenceChecker, EvidenceFingerprint } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckAnalysis,
  IEvidenceConfigPlan,
  IEvidenceGraphReference,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Applies combined evidence policies to the original host across both carriers.
 *
 * 1. Answer a Markdown checklist from native and detached evidence on one function
 *    and require complete coverage.
 * 2. Remove the native answer and require a checklist gap on that function.
 * 3. Enforce one target per semantic host across the two carriers; verify that
 *    repeated citations by one function are not two unique owners, then add a
 *    second function to require a unique-evidence diagnostic.
 * 4. Require a review on the detached heading, then provide a current fingerprint
 *    and mutate the requirement to expire it.
 *
 * @evidence contracts/testing.md#behavioral-verification Evaluates combined native and detached statements under checklist, cardinality, uniqueness and review policies, including a changed reference fingerprint.
 * @evidence contracts/testing.md#independent-expectations Two answers on execute are one semantic host despite two physical carriers; a separate second function is a distinct owner, and the reference edit changes its computed fingerprint.
 * @evidence contracts/testing.md#distinguishing-cases A passing mixed checklist, its missing item, cardinality, same-owner and distinct-owner uniqueness, missing review, current review and stale review expose policy projection errors.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers this exported test, which calls EvidenceChecker in-process and cleans its disposable fixture.
 */
export async function test_checker_evidence_files_policies(): Promise<void> {
  const location: string = join(__dirname, `evidence-policies-${randomUUID()}`);
  const requirement: string = dedent`
    ## First {#first}

    First rule.

    ## Second {#second}

    Second rule.
  `;
  await EvidenceTestFileSystem.experiment(
    location,
    {
      "evidence.config.ts": "export default {};\n",
      "docs/rules.md": requirement,
      "src/execute.ts": dedent`
        /** @evidence docs/rules.md#first Implements the first rule. */
        export function execute(): void {}
      `,
      "evidence/execute.md": dedent`
        # src/execute.ts#execute

        ## @evidence docs/rules.md#second

        Implements the second rule.
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
              files: ["src/*.ts"],
              symbol: "function",
              evidenceFiles: ["evidence/*.md"],
              reference: {
                type: "markdown",
                files: ["docs/rules.md"],
                symbol: "h2",
                checklist: true,
              },
            },
            severity: "error",
            symbols: ["function"],
            references: [
              {
                index: 0,
                population: {
                  type: "markdown",
                  files: ["docs/rules.md"],
                  symbol: "h2",
                  checklist: true,
                },
                severity: "error",
                symbols: ["h2"],
              },
            ],
          },
        ],
      };
      const combined = await EvidenceChecker.evaluate(plan);
      TestValidator.equals(
        "mixed checklist passes",
        combined.report.exitCode,
        0,
      );
      TestValidator.equals(
        "mixed checklist edges",
        combined.graph.claims[0]?.obligations[0]?.edges.length,
        2,
      );
      const policy = structuredClone(plan);
      const reference = policy.claims[0]?.references[0];
      if (reference === undefined || reference.population.type !== "markdown")
        throw new Error("Missing Markdown policy fixture reference.");
      reference.population.checklist = false;
      reference.population.singleEvidencePerSymbol = true;
      const cardinality = await EvidenceChecker.evaluate(policy);
      TestValidator.predicate(
        "cross-carrier cardinality",
        cardinality.report.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === "graph-single-evidence-per-symbol",
        ),
      );

      await EvidenceTestFileSystem.save(directory, {
        "src/execute.ts": "export function execute(): void {}\n",
      });
      const gap = await EvidenceChecker.evaluate(plan);
      TestValidator.predicate(
        "missing checklist answer",
        gap.report.diagnostics.some(
          (diagnostic) => diagnostic.code === "graph-checklist-missing",
        ),
      );

      await EvidenceTestFileSystem.save(directory, {
        "src/execute.ts": dedent`
          /** @evidence docs/rules.md#second Also implements the second rule. */
          export function execute(): void {}
        `,
      });
      reference.population.singleEvidencePerSymbol = false;
      reference.population.uniqueEvidence = true;
      const sameOwner = await EvidenceChecker.evaluate(policy);
      TestValidator.predicate(
        "same owner is not duplicate",
        sameOwner.report.diagnostics.every(
          (diagnostic) => diagnostic.code !== "graph-unique-evidence",
        ),
      );
      await EvidenceTestFileSystem.save(directory, {
        "src/execute.ts": dedent`
          export function execute(): void {}
          /** @evidence docs/rules.md#second Another function implements the rule. */
          export function another(): void {}
        `,
      });
      const distinctOwner = await EvidenceChecker.evaluate(policy);
      TestValidator.predicate(
        "distinct owners duplicate",
        distinctOwner.report.diagnostics.some(
          (diagnostic) => diagnostic.code === "graph-unique-evidence",
        ),
      );

      await EvidenceTestFileSystem.save(directory, {
        "src/execute.ts": "export function execute(): void {}\n",
      });
      reference.population.uniqueEvidence = false;
      reference.population.requireReview = true;
      const missingReview = await EvidenceChecker.evaluate(policy);
      TestValidator.predicate(
        "detached review required",
        missingReview.report.diagnostics.some(
          (diagnostic) => diagnostic.code === "graph-missing-review",
        ),
      );
      const analysis: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(policy);
      const referenceInput: IEvidenceGraphReference | undefined =
        analysis.graphInput.claims[0]?.references[0];
      const unit: IEvidenceUnit | undefined =
        referenceInput?.inventory.units.find(
          (candidate: IEvidenceUnit): boolean => candidate.name === "Second",
        );
      if (referenceInput === undefined || unit === undefined)
        throw new Error("Missing fingerprint fixture unit.");
      const fingerprint: string = EvidenceFingerprint.inspect(
        referenceInput.inventory,
        unit.id,
      ).fingerprint;
      await EvidenceTestFileSystem.save(directory, {
        "evidence/execute.md": dedent`
          # src/execute.ts#execute

          ## @evidence docs/rules.md#second

          Implements the second rule.

          <!-- @evidenceReview docs/rules.md#second #${fingerprint} Reviewed the answer. -->
        `,
      });
      const reviewed = await EvidenceChecker.evaluate(policy);
      TestValidator.equals(
        "detached review passes",
        reviewed.report.exitCode,
        1,
      );
      TestValidator.predicate(
        "no review failure after annotation",
        reviewed.report.diagnostics.every(
          (diagnostic) => diagnostic.code !== "graph-missing-review",
        ),
      );
      await EvidenceTestFileSystem.save(directory, {
        "docs/rules.md": requirement.replace(
          "Second rule.",
          "Updated second rule.",
        ),
      });
      const stale = await EvidenceChecker.evaluate(policy);
      TestValidator.predicate(
        "detached review expires",
        stale.report.diagnostics.some(
          (diagnostic) => diagnostic.code === "graph-stale-review",
        ),
      );
    },
  );
}
