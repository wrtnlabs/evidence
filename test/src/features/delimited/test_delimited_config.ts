import {
  EvidenceConfigLoader,
  createEvidenceConfigPlan,
} from "@wrtnlabs/evidence";
import type { IEvidenceConfig, IEvidenceConfigPlan } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Validates CSV and TSV configuration and resolves their row defaults.
 *
 * 1. Plan a CSV claim and a TSV reference without symbols; require `row` for both
 *    sides.
 * 2. Plan configurations with an empty key list, a repeated key column, an empty
 *    key name, an evidence column that is also a key, and an empty evidence
 *    column; require one rejection naming every offending field.
 * 3. Load JSON configurations with a CSV reference missing `key`, an unsupported
 *    `symbol`, and a `checklist`; require the loader to reject each.
 * 4. Load a well-formed delimited configuration; require it to be accepted.
 *
 * @evidence contracts/testing.md#behavioral-verification Calls createEvidenceConfigPlan and EvidenceConfigLoader with delimited configurations and asserts planned symbols, aggregated messages and rejections.
 * @evidence contracts/testing.md#independent-expectations Expected defaults and failures follow the documented option rules: rows are the only symbol, keys are nonempty and distinct, and the evidence column is never a key column.
 * @evidence contracts/testing.md#distinguishing-cases Covers defaults on both sides, five option violations in one configuration, three shape violations, and a valid configuration; adapter behavior belongs to the other delimited tests.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers the exported test_delimited_config under test/src/features and it calls maintained source in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_delimited_config(): Promise<void> {
  const plan: IEvidenceConfigPlan = createEvidenceConfigPlan(
    {
      claims: [
        {
          type: "csv",
          files: ["data/*.csv"],
          key: "id",
          reference: { type: "tsv", files: ["data/*.tsv"], key: "id" },
        },
      ],
    },
    "/project/evidence.config.ts",
  );
  TestValidator.equals(
    "row is the default on both sides",
    [plan.claims[0]?.symbols, plan.claims[0]?.references[0]?.symbols],
    [["row"], ["row"]],
  );

  const invalid: IEvidenceConfig = {
    claims: [
      {
        type: "tsv",
        files: ["a.tsv"],
        key: [],
        reference: [
          { type: "csv", files: ["b.csv"], key: ["id", "id"] },
          { type: "csv", files: ["c.csv"], key: "" },
          { type: "tsv", files: ["d.tsv"], key: "id", evidenceColumn: "id" },
          { type: "tsv", files: ["e.tsv"], key: "id", evidenceColumn: "" },
        ],
      },
    ],
  };
  let message: string = "";
  try {
    createEvidenceConfigPlan(invalid, "/project/evidence.config.ts");
  } catch (cause) {
    message = cause instanceof Error ? cause.message : String(cause);
  }
  for (const field of [
    "claims[0].key",
    "claims[0].reference[0].key",
    "claims[0].reference[1].key",
    "claims[0].reference[2].evidenceColumn",
    "claims[0].reference[3].evidenceColumn",
  ])
    TestValidator.predicate(`rejects ${field}`, message.includes(`${field}:`));

  const reference = { type: "csv", files: ["b.csv"], key: "id" };
  await EvidenceTestFileSystem.experiment(
    "delimited-config",
    {
      "missing-key.json": json({ ...reference, key: undefined }),
      "symbol.json": json({ ...reference, symbol: "h2" }),
      "checklist.json": json({ ...reference, checklist: true }),
      "valid.json": json(reference),
    },
    async (directory: string): Promise<void> => {
      for (const name of ["missing-key.json", "symbol.json", "checklist.json"])
        await TestValidator.error(`loader rejects ${name}`, () =>
          EvidenceConfigLoader.load(join(directory, name)),
        );
      await EvidenceConfigLoader.load(join(directory, "valid.json"));
    },
  );
}

/** Serializes a Markdown claim with the given reference. */
function json(reference: Record<string, unknown>): string {
  return JSON.stringify({
    claims: [{ type: "markdown", files: ["a.md"], reference }],
  });
}
