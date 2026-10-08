import { EvidenceCommand } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckReport,
  IEvidenceCommandResult,
  IEvidenceConfig,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import typia from "typia";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Restricts outcomes to named unit subtrees while respecting configured kinds.
 *
 * A covered child can pass a focused check even when its parent and a sibling
 * fail globally. Selection changes coverage and status before printing bounds.
 *
 * 1. Check a nested project with one covered child and uncovered parent/sibling;
 *    require a failing full check and a passing focused child.
 * 2. Select a parent, shallow parent, overlapping targets, multiple files, and a
 *    structural file ancestor; verify independent semantic denominators.
 * 3. Combine numeric bounds and output-file rendering with selection and require
 *    consistent counts, status, and authored target metadata.
 * 4. Reject unknown, outside-population, missing-file, and empty shallow scopes,
 *    including a bad target beside a valid target.
 */
export async function test_command_only_selection(): Promise<void> {
  const config: IEvidenceConfig = {
    claims: [
      {
        type: "typescript",
        files: ["src/*.ts"],
        symbol: "function",
        reference: {
          type: "markdown",
          root: "docs",
          files: ["*.md"],
          symbol: ["h2", "h3"],
        },
      },
    ],
  };
  await EvidenceTestFileSystem.experiment(
    "only selection",
    {
      "project/evidence.config.json": JSON.stringify(config),
      "project/docs/requirements.md": dedent`
      ## Pricing {#pricing}
      Pricing requirements.
      ### Tax {#tax}
      Tax requirements.
      ## Refund {#refund}
      Refund requirements.
    `,
      "project/docs/other.md": "## Shipping {#shipping}\nShip goods.\n",
      "project/outside.md": "## Outside {#outside}\nOutside selection.\n",
      "project/src/calculator.ts": dedent`
      /** @evidence requirements.md#tax Calculates tax. */
      export function calculate(): number { return 1; }
    `,
    },
    async (directory: string): Promise<void> => {
      async function run(...args: string[]): Promise<IEvidenceCheckReport> {
        const result: IEvidenceCommandResult = await EvidenceCommand.run(
          ["--cwd", "project", "--format", "json", ...args],
          directory,
        );
        const report: IEvidenceCheckReport =
          typia.json.assertParse<IEvidenceCheckReport>(result.stdout);
        TestValidator.equals("reported exit", result.exitCode, report.exitCode);
        return report;
      }

      const full: IEvidenceCheckReport = await run();
      TestValidator.equals("full denominator", full.counts.units, 4);
      TestValidator.equals("full failure", full.exitCode, 1);
      const child: IEvidenceCheckReport = await run(
        "--only",
        "requirements.md#tax",
      );
      TestValidator.equals(
        "covered child",
        [child.counts.units, child.counts.coveredUnits, child.exitCode],
        [1, 1, 0],
      );
      TestValidator.equals("child findings", child.diagnostics, []);
      const subtree: IEvidenceCheckReport = await run(
        "--only",
        "requirements.md#pricing",
      );
      TestValidator.equals(
        "subtree coverage",
        [
          subtree.counts.units,
          subtree.counts.coveredUnits,
          subtree.counts.missingUnits,
        ],
        [2, 1, 1],
      );
      const shallow: IEvidenceCheckReport = await run(
        "--only",
        "requirements.md#pricing",
        "--shallow",
      );
      TestValidator.equals(
        "shallow coverage",
        [shallow.counts.units, shallow.counts.coveredUnits, shallow.exitCode],
        [1, 0, 1],
      );
      const overlap: IEvidenceCheckReport = await run(
        "--only",
        "requirements.md#pricing",
        "requirements.md#tax",
        "./requirements.md#pricing",
      );
      TestValidator.equals(
        "overlap denominator",
        overlap.counts,
        subtree.counts,
      );
      const multiple: IEvidenceCheckReport = await run(
        "--only",
        "requirements.md#tax",
        "other.md#shipping",
      );
      TestValidator.equals(
        "multiple files",
        [
          multiple.counts.units,
          multiple.counts.coveredUnits,
          multiple.counts.missingUnits,
        ],
        [2, 1, 1],
      );
      const ancestor: IEvidenceCheckReport = await run(
        "--only",
        "requirements.md",
      );
      TestValidator.equals("structural ancestor", ancestor.counts.units, 3);
      const bounded: IEvidenceCheckReport = await run(
        "--only",
        "requirements.md",
        "--unit",
        "1",
        "--limit",
        "1",
      );
      TestValidator.equals(
        "bounds preserve focused totals",
        bounded.counts,
        ancestor.counts,
      );
      TestValidator.equals(
        "bounds preserve focused exit",
        bounded.exitCode,
        ancestor.exitCode,
      );
      TestValidator.equals("bounded findings", bounded.diagnostics.length, 1);

      const output: IEvidenceCommandResult = await EvidenceCommand.run(
        [
          "--cwd",
          "project",
          "--only",
          "requirements.md#tax",
          "--format",
          "json",
          "--output",
          "report.json",
        ],
        directory,
      );
      TestValidator.equals(
        "file output",
        [output.exitCode, output.stdout, output.stderr],
        [0, "", ""],
      );
      const saved: IEvidenceCheckReport =
        typia.json.assertParse<IEvidenceCheckReport>(
          await readFile(join(directory, "project/report.json"), "utf8"),
        );
      TestValidator.equals("file report", saved, child);
      const text: IEvidenceCommandResult = await EvidenceCommand.run(
        ["--cwd", "project", "--only", "requirements.md#tax"],
        directory,
      );
      TestValidator.predicate(
        "text identifies scope",
        text.stdout.includes("Only: requirements.md#tax"),
      );

      for (const args of [
        ["requirements.md#typo"],
        ["missing.md#missing"],
        ["../outside.md#outside"],
        ["requirements.md#tax", "requirements.md#typo"],
        ["requirements.md", "--shallow"],
      ]) {
        const failed: IEvidenceCheckReport = await run("--only", ...args);
        TestValidator.equals("bad selection fails", failed.exitCode, 1);
        TestValidator.predicate(
          "selection diagnostic",
          failed.diagnostics.some(
            (diagnostic): boolean => diagnostic.code === "check-only-target",
          ),
        );
      }
    },
  );
}
