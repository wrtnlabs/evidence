import { EvidenceCommand } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckReport,
  IEvidenceCommandResult,
  IEvidenceConfig,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import typia from "typia";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Selects database and API units through their artifact-specific target
 * grammars.
 *
 * File-qualified accessor inference must not replace Prisma model addresses or
 * Swagger operation tokens, and selection must isolate their obligations.
 *
 * 1. Configure Prisma and Swagger references under one claim with one covered
 *    model and operation, leaving unrelated model and operation units
 *    uncovered.
 * 2. Focus the model, its column, and its shallow form; require the corresponding
 *    semantic denominators and passing outcomes.
 * 3. Focus covered and uncovered operations, then combine a model column and
 *    operation; require independent selected boundaries and coverage totals.
 */
export async function test_command_only_artifacts(): Promise<void> {
  const config: IEvidenceConfig = {
    claims: [
      {
        type: "typescript",
        files: ["src/*.ts"],
        symbol: "function",
        reference: [
          {
            type: "prisma",
            files: ["schema.prisma"],
            symbol: ["model", "column"],
          },
          { type: "swagger", file: "openapi.yaml" },
        ],
      },
    ],
  };
  await EvidenceTestFileSystem.experiment(
    "only artifacts",
    {
      "evidence.config.json": JSON.stringify(config),
      "schema.prisma": dedent`
      model Account {
        id String @id
        name String
      }
      model Unrelated {
        id String @id
      }
    `,
      "openapi.yaml": dedent`
      openapi: 3.1.0
      info:
        title: Items
        version: 1.0.0
      paths:
        /items:
          get:
            responses:
              '200':
                description: Items
          delete:
            responses:
              '204':
                description: Removed
    `,
      "src/main.ts": dedent`
      /** @evidence prisma:Account Persists accounts. */
      export function persist(): void {}
      /** @evidence GET:/items Lists items. */
      export function list(): void {}
    `,
    },
    async (directory: string): Promise<void> => {
      async function run(...args: string[]): Promise<IEvidenceCheckReport> {
        const result: IEvidenceCommandResult = await EvidenceCommand.run(
          ["--only", ...args, "--format", "json"],
          directory,
        );
        return typia.json.assertParse<IEvidenceCheckReport>(result.stdout);
      }
      const model: IEvidenceCheckReport = await run("prisma:Account");
      TestValidator.equals(
        "model subtree",
        [model.counts.units, model.counts.coveredUnits, model.exitCode],
        [3, 3, 0],
      );
      TestValidator.equals(
        "only database boundary",
        model.counts.obligations,
        1,
      );
      TestValidator.equals(
        "column",
        (await run("prisma:Account.id")).counts.units,
        1,
      );
      TestValidator.equals(
        "shallow model",
        (await run("prisma:Account", "--shallow")).counts.units,
        1,
      );
      TestValidator.equals(
        "covered operation",
        (await run("GET:/items")).exitCode,
        0,
      );
      TestValidator.equals(
        "uncovered operation",
        (await run("DELETE:/items")).exitCode,
        1,
      );
      const combined: IEvidenceCheckReport = await run(
        "prisma:Account.id",
        "GET:/items",
      );
      TestValidator.equals(
        "cross-family selection",
        [
          combined.counts.obligations,
          combined.counts.units,
          combined.counts.coveredUnits,
          combined.exitCode,
        ],
        [2, 2, 2, 0],
      );
    },
  );
}
