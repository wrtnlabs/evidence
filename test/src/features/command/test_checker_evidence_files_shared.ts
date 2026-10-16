import { EvidenceChecker } from "@wrtnlabs/evidence";
import type { IEvidenceConfigPlan } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { randomUUID } from "node:crypto";
import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Shares one detached Markdown ledger between TypeScript and Markdown claims.
 *
 * 1. Bind one H1 to a TypeScript function and another to a Markdown H2 selected
 *    from a claim root different from the configuration directory, alongside a
 *    native Markdown comment on the same H2.
 * 2. Require both references to be covered without either claim treating the other
 *    claim's H1 as an error.
 * 3. Select the Markdown claim through a directory junction and address its H1
 *    through that logical path.
 * 4. Select a Markdown claim source as its own detached document and require an
 *    overlap diagnostic.
 * 5. Replace one H1 with an unknown address and require an incomplete check with a
 *    source-located owner diagnostic.
 *
 * @evidence contracts/testing.md#behavioral-verification Evaluates two claims sharing one evidence file and checks their coverage together with native Markdown evidence, a junction alias, source overlap, and orphan-owner failure.
 * @evidence contracts/testing.md#independent-expectations The configured function and guide H2 own three answers, and the changed address names neither, regardless of adapter output order.
 * @evidence contracts/testing.md#distinguishing-cases Cross-artifact sharing, native Markdown comment coexistence, a junction alias, source overlap, and a genuinely unowned H1 distinguish accepted sharing from silent orphan loss.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers this exported test and it calls EvidenceChecker in-process inside a disposable fixture.
 */
export async function test_checker_evidence_files_shared(): Promise<void> {
  const location: string = join(__dirname, `evidence-shared-${randomUUID()}`);
  await EvidenceTestFileSystem.experiment(
    location,
    {
      "evidence.config.ts": "export default {};\n",
      "src/execute.ts": "export function execute(): number { return 1; }\n",
      "docs/guide.md": dedent`
        # Guide

        ## Pricing {#pricing}

        Explains pricing.

        <!-- @evidence rules/prose.md#native Provides the native explanation. -->
      `,
      "rules/code.md": "## Code {#code}\n\nCode rule.\n",
      "rules/prose.md":
        "## Native {#native}\n\nNative rule.\n\n## Prose {#prose}\n\nProse rule.\n",
      "evidence/ledger.md": dedent`
        # src/execute.ts#execute

        ## @evidence rules/code.md#code

        Implements the code rule.

        # docs/guide.md#pricing

        ## @evidence rules/prose.md#prose

        Explains the prose rule.
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
                files: ["rules/code.md"],
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
                  files: ["rules/code.md"],
                  symbol: "h2",
                },
                severity: "error",
                symbols: ["h2"],
              },
            ],
          },
          {
            index: 1,
            population: {
              type: "markdown",
              root: "docs",
              files: ["guide.md"],
              symbol: "h2",
              evidenceFiles: ["evidence/**/*.md"],
              reference: {
                type: "markdown",
                files: ["rules/prose.md"],
                symbol: "h2",
              },
            },
            severity: "error",
            symbols: ["h2"],
            references: [
              {
                index: 0,
                population: {
                  type: "markdown",
                  files: ["rules/prose.md"],
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
      TestValidator.equals("shared ledger exit", passing.report.exitCode, 0);
      TestValidator.equals(
        "shared ledger claims",
        passing.graph.claims.length,
        2,
      );
      TestValidator.equals(
        "shared ledger covered",
        passing.report.counts.coveredUnits,
        3,
      );

      await symlink(
        join(directory, "docs"),
        join(directory, "docs-link"),
        "junction",
      );
      const linked: IEvidenceConfigPlan = structuredClone(plan);
      const linkedClaim = linked.claims[1];
      if (linkedClaim === undefined)
        throw new Error("Missing linked Markdown fixture claim.");
      linkedClaim.population.root = "docs-link";
      await EvidenceTestFileSystem.save(directory, {
        "evidence/ledger.md": dedent`
          # src/execute.ts#execute

          ## @evidence rules/code.md#code

          Implements the code rule.

          # docs-link/guide.md#pricing

          ## @evidence rules/prose.md#prose

          Explains the prose rule.
        `,
      });
      const throughLink = await EvidenceChecker.evaluate(linked);
      TestValidator.equals("linked owner exit", throughLink.report.exitCode, 0);
      await EvidenceTestFileSystem.save(directory, {
        "evidence/ledger.md": dedent`
          # src/execute.ts#execute

          ## @evidence rules/code.md#code

          Implements the code rule.

          # docs/guide.md#pricing

          ## @evidence rules/prose.md#prose

          Explains the prose rule.
        `,
      });

      const overlapping: IEvidenceConfigPlan = structuredClone(plan);
      const markdownClaim = overlapping.claims[1];
      if (markdownClaim === undefined)
        throw new Error("Missing Markdown fixture claim.");
      markdownClaim.population.evidenceFiles = ["docs/guide.md"];
      const overlap = await EvidenceChecker.evaluate(overlapping);
      TestValidator.equals("source overlap exit", overlap.report.exitCode, 2);
      TestValidator.predicate(
        "source overlap diagnostic",
        overlap.report.diagnostics.some(
          (diagnostic) => diagnostic.code === "evidence-files-overlap",
        ),
      );

      await EvidenceTestFileSystem.save(directory, {
        "evidence/ledger.md": dedent`
          # src/execute.ts#execute

          ## @evidence rules/code.md#code

          Implements the code rule.

          # docs/missing.md#pricing

          ## @evidence rules/prose.md#prose

          Explains the prose rule.
        `,
      });
      const orphan = await EvidenceChecker.evaluate(plan);
      TestValidator.equals("orphan owner exit", orphan.report.exitCode, 2);
      TestValidator.equals(
        "one owner diagnostic",
        orphan.report.diagnostics.filter(
          (diagnostic) => diagnostic.code === "evidence-files-owner",
        ).length,
        1,
      );
      TestValidator.predicate(
        "owner diagnostic has ledger location",
        orphan.report.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === "evidence-files-owner" &&
            diagnostic.location?.file.endsWith("ledger.md") === true,
        ),
      );
    },
  );
}
