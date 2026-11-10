import { EvidenceCommand } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckReport,
  IEvidenceCommandResult,
  IEvidenceConfig,
  IEvidenceGraphReport,
  IEvidenceInspectReport,
  IEvidenceListItem,
  IEvidenceListReport,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import typia from "typia";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Drives row units through the public list, inspect, graph, and focused-check
 * commands.
 *
 * 1. List a CSV reference ledger; require selected row items with root-relative
 *    `path#key` targets, the file as an ancestor, and the row's line as its
 *    location; then filter by `--language csv --kind row`.
 * 2. Inspect every listed row target and the file target; require each to resolve
 *    to its listed unit.
 * 3. Export the graph; require row nodes and the acknowledgement edge.
 * 4. Run `--only` on the cited row and on the uncited row; require exit 0 and 1
 *    with counts limited to that row, while the full check exits 1.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs EvidenceCommand list, inspect, graph and focused checks over a real CSV ledger and asserts parsed JSON reports.
 * @evidence contracts/testing.md#independent-expectations Targets are expected in the README form path#key from the reference root, and each listed target must round-trip through inspect to its own unit ID.
 * @evidence contracts/testing.md#distinguishing-cases Covers selected rows and the ancestor file, language and kind filters, row and file inspection, graph export, and focused checks on a covered and an uncovered row; adapter parsing belongs to the other delimited tests.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers the exported test_delimited_commands under test/src/features and it calls EvidenceCommand.run in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_delimited_commands(): Promise<void> {
  const config: IEvidenceConfig = {
    claims: [
      {
        type: "markdown",
        files: ["decisions/*.md"],
        symbol: "file",
        reference: {
          type: "csv",
          root: "data",
          files: ["*.csv"],
          key: ["system", "dashboard"],
        },
      },
    ],
  };
  await EvidenceTestFileSystem.experiment(
    "delimited-commands",
    {
      "evidence.config.json": JSON.stringify(config),
      "data/links.csv": "system,dashboard,owner\ncrm,sales,ann\ncrm,ops,bob\n",
      "decisions/sales.md":
        "<!-- @evidence links.csv#crm:sales The sales dashboard funds this decision. -->\n",
    },
    async (directory: string): Promise<void> => {
      const listing: IEvidenceListReport =
        typia.json.assertParse<IEvidenceListReport>(
          (await run(directory, ["list", "--format", "json"])).stdout,
        );
      const rows: IEvidenceListItem[] = listing.items.filter(
        (item: IEvidenceListItem): boolean => item.scope.role === "reference",
      );
      TestValidator.equals(
        "row targets and selection",
        rows
          .map((item: IEvidenceListItem): string[] => [
            item.target,
            item.symbol,
            item.selection,
          ])
          .sort((left: string[], right: string[]): number =>
            (left[0] ?? "").localeCompare(right[0] ?? ""),
          ),
        [
          ["links.csv", "file", "ancestor"],
          ["links.csv#crm:ops", "row", "selected"],
          ["links.csv#crm:sales", "row", "selected"],
        ],
      );
      const ops: IEvidenceListItem | undefined = rows.find(
        (item: IEvidenceListItem): boolean =>
          item.target === "links.csv#crm:ops",
      );
      TestValidator.equals(
        "row location is its line",
        ops?.locations.map((location) => location.range?.start.line),
        [3],
      );

      const filtered: IEvidenceListReport =
        typia.json.assertParse<IEvidenceListReport>(
          (
            await run(directory, [
              "list",
              "--language",
              "csv",
              "--kind",
              "row",
              "--format",
              "json",
            ])
          ).stdout,
        );
      TestValidator.equals(
        "filters keep only rows",
        filtered.items
          .map((item: IEvidenceListItem): string => item.target)
          .sort((left: string, right: string): number =>
            left.localeCompare(right),
          ),
        ["links.csv#crm:ops", "links.csv#crm:sales"],
      );

      for (const item of rows) {
        const inspected: IEvidenceInspectReport =
          typia.json.assertParse<IEvidenceInspectReport>(
            (await run(directory, ["inspect", item.target, "--format", "json"]))
              .stdout,
          );
        TestValidator.equals(
          `inspect ${item.target}`,
          inspected.inspections.flatMap((entry) =>
            entry.units.map((unit) => unit.item.unitId),
          ),
          [item.unitId],
        );
      }

      const graph: IEvidenceGraphReport =
        typia.json.assertParse<IEvidenceGraphReport>(
          (await run(directory, ["graph", "--format", "json"])).stdout,
        );
      TestValidator.equals(
        "graph exports one row acknowledgement",
        graph.edges.map((edge) => edge.declaration.target),
        ["links.csv#crm:sales"],
      );

      const full: IEvidenceCommandResult = await run(directory, [
        "--format",
        "json",
      ]);
      TestValidator.equals("full check misses one row", full.exitCode, 1);
      const covered: IEvidenceCheckReport =
        typia.json.assertParse<IEvidenceCheckReport>(
          (
            await run(directory, [
              "--only",
              "links.csv#crm:sales",
              "--format",
              "json",
            ])
          ).stdout,
        );
      TestValidator.equals(
        "focused covered row",
        [covered.exitCode, covered.counts.units, covered.counts.coveredUnits],
        [0, 1, 1],
      );
      const uncovered: IEvidenceCheckReport =
        typia.json.assertParse<IEvidenceCheckReport>(
          (
            await run(directory, [
              "--only",
              "links.csv#crm:ops",
              "--format",
              "json",
            ])
          ).stdout,
        );
      TestValidator.equals(
        "focused uncovered row",
        [
          uncovered.exitCode,
          uncovered.counts.units,
          uncovered.counts.missingUnits,
        ],
        [1, 1, 1],
      );
    },
  );
}

/** Runs one command in the fixture directory. */
async function run(
  directory: string,
  args: string[],
): Promise<IEvidenceCommandResult> {
  return EvidenceCommand.run(args, directory);
}
