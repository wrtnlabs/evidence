import { EvidenceChecker } from "@wrtnlabs/evidence";
import type { IEvidenceConfigPlan } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Resolves a code reference from the detached document while keeping its H1
 * owner anchored at the configuration directory.
 *
 * 1. Cite a selected TypeScript reference from an evidence document in a sibling
 *    directory with Unicode paths and CRLF lines, and require one accepted
 *    edge.
 * 2. Move that document into a nested directory and adjust only its reference
 *    target; the H1 address remains unchanged.
 * 3. Add an original source exclusion for the same target and require the existing
 *    conflict policy to reject the combined statements.
 *
 * @evidence contracts/testing.md#behavioral-verification Evaluates a detached code target before and after moving its document, then combines it with an original source exclusion and asserts a conflict.
 * @evidence contracts/testing.md#independent-expectations The H1 always names the same execute function from the config directory, while the code citation changes relative to the detached file and both positive and exclusion target the same rule function.
 * @evidence contracts/testing.md#distinguishing-cases A moved document with a stable H1, Unicode paths, CRLF content and changed relative code citation distinguishes the two path bases; the source exclusion checks mixed-carrier conflict policy.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers this exported test; it calls EvidenceChecker in-process and cleans all fixture files through the test filesystem.
 */
export async function test_checker_evidence_files_code_target(): Promise<void> {
  const location: string = join(
    __dirname,
    `evidence-code-target-${randomUUID()}`,
  );
  await EvidenceTestFileSystem.experiment(
    location,
    {
      "evidence.config.ts": "export default {};\n",
      "src/실행.ts": "export function execute(): void {}\n",
      "src/규칙.ts": "export function rule(): void {}\n",
      "evidence/진술.md":
        "# src/실행.ts#execute {#execute}\r\n\r\n## @evidence ../src/규칙.ts#rule\r\n\r\nCalls the rule.\r\n",
    },
    async (directory: string): Promise<void> => {
      const plan: IEvidenceConfigPlan = {
        configFile: join(directory, "evidence.config.ts"),
        claims: [
          {
            index: 0,
            population: {
              type: "typescript",
              files: ["src/실행.ts"],
              symbol: "function",
              evidenceFiles: ["evidence/**/*.md"],
              reference: {
                type: "typescript",
                files: ["src/규칙.ts"],
                symbol: "function",
              },
            },
            severity: "error",
            symbols: ["function"],
            references: [
              {
                index: 0,
                population: {
                  type: "typescript",
                  files: ["src/규칙.ts"],
                  symbol: "function",
                },
                severity: "error",
                symbols: ["function"],
              },
            ],
          },
        ],
      };
      const original = await EvidenceChecker.evaluate(plan);
      TestValidator.equals(
        "sibling document exit",
        original.report.exitCode,
        0,
      );
      TestValidator.equals(
        "sibling document edge",
        original.graph.claims[0]?.obligations[0]?.edges.length,
        1,
      );

      await rm(join(directory, "evidence/진술.md"));
      await EvidenceTestFileSystem.save(directory, {
        "evidence/nested/진술.md":
          "# src/실행.ts#execute\r\n\r\n## @evidence ../../src/규칙.ts#rule\r\n\r\nCalls the rule.\r\n",
      });
      const moved = await EvidenceChecker.evaluate(plan);
      TestValidator.equals("nested document exit", moved.report.exitCode, 0);
      TestValidator.equals(
        "nested document edge",
        moved.graph.claims[0]?.obligations[0]?.edges.length,
        1,
      );

      await EvidenceTestFileSystem.save(directory, {
        "src/실행.ts":
          "/** @evidenceExclude 규칙.ts#rule Handled elsewhere. */\nexport function execute(): void {}\n",
      });
      const conflict = await EvidenceChecker.evaluate(plan);
      TestValidator.predicate(
        "native exclusion conflicts with detached evidence",
        conflict.report.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === "graph-conflicting-acknowledgements",
        ),
      );
    },
  );
}
