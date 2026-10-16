import { EvidenceCommand } from "@wrtnlabs/evidence";
import type { IEvidenceCheckReport, IEvidenceCommandResult, IEvidenceConfig } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import typia from "typia";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Selects finite check pages from a configured limit and CLI overrides.
 *
 * The file output and context options must see the same selected page as
 * stdout, while a missing limit produces a command failure.
 *
 * 1. Check two unanswered Markdown headings with report.limit set to one.
 * 2. Require pages one and two to contain different diagnostics and excerpts.
 * 3. Override the limit, write an empty page to a file, and preserve failure.
 * 4. Focus one reference before paging and reject a page with no effective limit.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs buffered check commands on a real fixture, then parses stdout and the requested output file to assert page selection, context and failure behavior.
 * @evidence contracts/testing.md#independent-expectations Two distinct authored headings establish two expected missing diagnostics; configured and command limits give hand-calculated page positions.
 * @evidence contracts/testing.md#distinguishing-cases Covers configured limit, CLI override, first and final pages, beyond-end file output, context filtering and missing-limit failure.
 * @evidence contracts/testing.md#execution-ownership The exported test_command_page is discovered by DynamicExecutor and invokes EvidenceCommand directly without a CLI subprocess.
 */
export async function test_command_page(): Promise<void> {
  const base: IEvidenceConfig = {
    claims: [
      {
        type: "typescript",
        files: ["src/*.ts"],
        symbol: "function",
        reference: {
          type: "markdown",
          root: "docs",
          files: ["*.md"],
          symbol: "h2",
        },
      },
    ],
  };
  await EvidenceTestFileSystem.experiment(
    "command page",
    {
      "evidence.config.json": JSON.stringify({ ...base, report: { limit: 1 } }),
      "plain.json": JSON.stringify(base),
      "src/main.ts": "export function treatment(): void {}\n",
      "docs/settings.md":
        "## Safety {#safety}\nCheck the configured safety limit.\n## Consent {#consent}\nObtain consent first.\n",
    },
    async (directory: string): Promise<void> => {
      async function page(...options: string[]): Promise<IEvidenceCheckReport> {
        const result: IEvidenceCommandResult = await EvidenceCommand.run(
          ["--format", "json", ...options],
          directory,
        );
        return typia.json.assertParse<IEvidenceCheckReport>(result.stdout);
      }
      const first: IEvidenceCheckReport = await page("--context");
      const second: IEvidenceCheckReport = await page(
        "--page",
        "2",
        "--context",
      );
      TestValidator.equals("configured first page", first.page?.page, 1);
      TestValidator.equals("configured second page", second.page?.page, 2);
      TestValidator.equals("two total pages", second.page?.totalPages, 2);
      TestValidator.equals("different diagnostics", first.diagnostics.length, 1);
      TestValidator.equals("second diagnostic", second.diagnostics.length, 1);
      TestValidator.predicate(
        "no repeated diagnostic",
        first.diagnostics[0]?.unitId !== second.diagnostics[0]?.unitId,
      );
      TestValidator.predicate(
        "context only on selected page",
        first.diagnostics[0]?.context?.[0]?.text !==
          second.diagnostics[0]?.context?.[0]?.text,
      );
      const output: IEvidenceCommandResult = await EvidenceCommand.run(
        ["--limit", "2", "--page", "2", "--format", "json", "--output", "page.json"],
        directory,
      );
      const saved: IEvidenceCheckReport = typia.json.assertParse<IEvidenceCheckReport>(
        await readFile(join(directory, "page.json"), "utf8"),
      );
      TestValidator.equals("output stdout empty", output.stdout, "");
      TestValidator.equals("override empty page", saved.diagnostics.length, 0);
      TestValidator.equals("override metadata", [saved.page?.limit, saved.page?.page, saved.page?.totalPages], [2, 2, 1]);
      TestValidator.equals("output preserves failure", [output.exitCode, saved.exitCode], [1, 1]);
      const focused: IEvidenceCheckReport = await page(
        "--only",
        "settings.md#safety",
        "--page",
        "2",
      );
      TestValidator.equals("focus before paging", [focused.page?.eligibleDiagnostics, focused.diagnostics.length], [1, 0]);
      TestValidator.equals("focused failure", focused.exitCode, 1);
      const invalid: IEvidenceCommandResult = await EvidenceCommand.run(
        ["--config", "plain.json", "--page", "1"],
        directory,
      );
      TestValidator.equals("page requires limit", invalid.exitCode, 2);
      TestValidator.predicate(
        "limit repair",
        invalid.stderr.includes("--page requires --limit"),
      );
    },
  );
}
