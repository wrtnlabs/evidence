import { dedent } from "@typia/utils";
import { TestValidator } from "@nestia/e2e";
import { EvidenceChecker } from "@wrtnlabs/evidence";
import type {
  IEvidenceReference,
  IEvidenceCheckAnalysis,
  IEvidenceConfigPlan,
  IEvidenceConfigPlanReference,
  IEvidenceGraphReference,
} from "@wrtnlabs/evidence";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Routes exact root-relative Markdown targets without retaining stale file
 * membership.
 *
 * Equivalent reference inventories may share membership sets during
 * preparation, but source edits and later invocations must change which
 * population owns a tag.
 *
 * 1. Check a claim citing rules.md against two Markdown roots and a repeated
 *    reference to the exact root; require only both exact populations to
 *    resolve.
 * 2. Move the exact file to the other root and check the same plan again; require
 *    target routing to follow the fresh selected source inventory.
 * 3. Restore the source and require the original routing and diagnostic report.
 *
 * @evidence contracts/testing.md#behavioral-verification Evaluates one plan across file-set edits and asserts per-reference target resolutions, including repeated equivalent inventories and recovery.
 * @evidence contracts/testing.md#independent-expectations Exact selected root-relative file membership outranks an extension-only match, and repeated configured boundaries retain independent resolutions.
 * @evidence contracts/testing.md#distinguishing-cases Covers exact versus weak matches, separate roots, repeated inventories, file removal/addition and restored state. Existing target and command suites own malformed spellings, physical aliases and dependency-only sources.
 * @evidence contracts/testing.md#execution-ownership The exported test_target_affinity_refresh is discovered by DynamicExecutor and calls EvidenceChecker.evaluate directly; files are created and removed through EvidenceTestFileSystem without CLI subprocesses.
 */
export async function test_target_affinity_refresh(): Promise<void> {
  await EvidenceTestFileSystem.experiment(
    "target-affinity-refresh",
    {
      "evidence.config.ts": "export default {};",
      "claim.md":
        dedent`
        ## Work
        <!-- @evidence rules.md#rule Implements the rule. -->
      ` + "\n",
      "first/rules.md":
        dedent`
        ## Rule {#rule}
        Required behavior.
      ` + "\n",
      "second/other.md":
        dedent`
        ## Other
        Other behavior.
      ` + "\n",
    },
    async (directory: string): Promise<void> => {
      const references: IEvidenceConfigPlanReference[] = [
        "first",
        "second",
        "first",
      ].map((root: string, index: number): IEvidenceConfigPlanReference => ({
        index,
        severity: "error",
        symbols: ["h2"],
        population: { type: "markdown", root, files: ["*.md"], symbol: "h2" },
      }));
      const plan: IEvidenceConfigPlan = {
        configFile: join(directory, "evidence.config.ts"),
        claims: [
          {
            index: 0,
            severity: "error",
            symbols: ["h2"],
            population: {
              type: "markdown",
              files: ["claim.md"],
              symbol: "h2",
              reference: references.map(
                (reference: IEvidenceConfigPlanReference): IEvidenceReference =>
                  reference.population,
              ),
            },
            references,
          },
        ],
      };
      const first: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(plan);
      TestValidator.equals(
        "both exact populations participate",
        first.graphInput.claims[0]?.references.map(
          (reference: IEvidenceGraphReference): number =>
            reference.resolutions.length,
        ),
        [1, 0, 1],
      );
      await EvidenceTestFileSystem.erase(join(directory, "first/rules.md"));
      await EvidenceTestFileSystem.save(directory, {
        "first/other.md":
          dedent`
        ## Other
        Other behavior.
      ` + "\n",
        "second/rules.md":
          dedent`
        ## Rule {#rule}
        Required behavior.
      ` + "\n",
      });
      const moved: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(plan);
      TestValidator.equals(
        "fresh membership changes routing",
        moved.graphInput.claims[0]?.references.map(
          (reference: IEvidenceGraphReference): number =>
            reference.resolutions.length,
        ),
        [0, 1, 0],
      );
      await EvidenceTestFileSystem.erase(join(directory, "first/other.md"));
      await EvidenceTestFileSystem.erase(join(directory, "second/rules.md"));
      await EvidenceTestFileSystem.save(directory, {
        "first/rules.md":
          dedent`
        ## Rule {#rule}
        Required behavior.
      ` + "\n",
      });
      const restored: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(plan);
      TestValidator.equals(
        "restored routing",
        restored.graphInput.claims[0]?.references.map(
          (reference: IEvidenceGraphReference): number =>
            reference.resolutions.length,
        ),
        [1, 0, 1],
      );
      TestValidator.equals("restored report", restored.report, first.report);
    },
  );
}
