import {
  EvidenceChecker,
  EvidenceGraph,
  EvidenceQuery,
} from "@wrtnlabs/evidence";
import type { IEvidenceConfigPlan } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Checks that separate Markdown evidence and native documentation answer one
 * TypeScript claim without changing its semantic hosts.
 *
 * 1. Select two public functions and two Markdown requirements.
 * 2. Answer one requirement in JSDoc and the other under an H1 owner in a separate
 *    Markdown file; require complete coverage and one source unit per accepted
 *    edge while retaining the detached physical location and watch dependency.
 * 3. Reject a corrupted direct graph binding, then remove the detached annotation
 *    and require the second unit to become missing under the claim.
 *
 * @evidence contracts/testing.md#behavioral-verification Calls the checker with captured TypeScript and Markdown sources and asserts combined coverage, semantic hosts, graph export provenance, watch dependency, invalid direct binding and missing result after removal.
 * @evidence contracts/testing.md#independent-expectations Two authored requirements require two distinct answers, and their declaration hosts are the two authored functions rather than Markdown heading units.
 * @evidence contracts/testing.md#distinguishing-cases The passing mixed location and missing detached statement distinguish carrier projection from a Markdown claim or source-only annotation scan; additional malformed and policy cases belong to focused tests.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers this exported test, which calls EvidenceChecker directly and uses only the disposable fixture tree.
 */
export async function test_checker_evidence_files(): Promise<void> {
  const location: string = join(__dirname, `evidence-files-${randomUUID()}`);
  await EvidenceTestFileSystem.experiment(
    location,
    {
      "evidence.config.ts": "export default {};\n",
      "docs/requirements.md": dedent`
        ## First {#first}

        The first behavior.

        ## Second {#second}

        The second behavior.
      `,
      "src/operations.ts": dedent`
        /** @evidence docs/requirements.md#first Implements the first behavior. */
        export function first(): number { return 1; }

        export function second(): number { return 2; }
      `,
      "evidence/operations.md": dedent`
        # src/operations.ts#second

        ## @evidence docs/requirements.md#second

        Implements the second behavior.
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
                files: ["docs/requirements.md"],
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
                  files: ["docs/requirements.md"],
                  symbol: "h2",
                },
                severity: "error",
                symbols: ["h2"],
              },
            ],
          },
        ],
      };
      const passing = await EvidenceChecker.evaluate(plan);
      TestValidator.equals("mixed evidence exit", passing.report.exitCode, 0);
      TestValidator.equals(
        "two covered targets",
        passing.report.counts.coveredUnits,
        2,
      );
      const edges = passing.graph.claims[0]?.obligations[0]?.edges ?? [];
      TestValidator.equals("two evidence edges", edges.length, 2);
      TestValidator.predicate(
        "each edge has an original function host",
        edges.every(
          (edge) =>
            edge.hostUnitIds.length === 1 &&
            passing.graphInput.claims[0]?.unitIds.includes(
              edge.hostUnitIds[0] ?? "",
            ) === true,
        ),
      );
      const claim = passing.graphInput.claims[0];
      if (claim === undefined)
        throw new Error("Missing materialized fixture claim.");
      TestValidator.predicate(
        "detached evidence retains physical location",
        edges.some((edge) =>
          claim.inventory.declarations.some(
            (declaration) =>
              declaration.id === edge.declarationId &&
              declaration.location.file.endsWith("operations.md"),
          ),
        ),
      );
      TestValidator.predicate(
        "detached file is a watch dependency",
        claim.inventory.dependencies.some((dependency) =>
          dependency.path.endsWith("operations.md"),
        ),
      );
      const graph = EvidenceQuery.graph(passing, directory);
      TestValidator.predicate(
        "graph export keeps detached site and original host",
        graph.edges.some(
          (edge) =>
            edge.declaration.location.file.endsWith("operations.md") &&
            edge.hostUnitIds.every((id) => claim.unitIds.includes(id)),
        ),
      );
      const corrupted = structuredClone(passing.graphInput);
      const binding = corrupted.claims[0]?.detachedHostBindings?.[0];
      if (binding === undefined)
        throw new Error("Missing detached fixture binding.");
      binding.unitId = "unknown-unit";
      const invalid = EvidenceGraph.evaluate(corrupted);
      TestValidator.predicate(
        "direct graph rejects fabricated owner",
        !invalid.success &&
          invalid.diagnostics.some(
            (diagnostic) => diagnostic.code === "graph-detached-host-binding",
          ),
      );

      await EvidenceTestFileSystem.save(directory, {
        "evidence/operations.md": "# src/operations.ts#second\n",
      });
      const missing = await EvidenceChecker.evaluate(plan);
      TestValidator.equals(
        "missing detached evidence exit",
        missing.report.exitCode,
        1,
      );
      TestValidator.equals(
        "one missing target",
        missing.report.counts.missingUnits,
        1,
      );
    },
  );
}
