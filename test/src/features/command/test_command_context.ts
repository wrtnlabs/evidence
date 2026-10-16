import { EvidenceChecker, EvidenceCommand, EvidenceQuery } from "@wrtnlabs/evidence";
import type { IEvidenceCheckAnalysis, IEvidenceCheckReport } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { join } from "node:path";
import typia from "typia";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Adds captured Markdown requirement text only to missing-reference findings.
 *
 * An agent needs the actual required section beside a missing acknowledgement,
 * including checklist items that share one host-level diagnostic.
 *
 * 1. Check two unanswered Markdown sections and require their distinct bodies
 *    in JSON and text only when context is requested.
 * 2. Focus one section and require the unrelated sibling to be absent.
 * 3. Enable checklist mode and require both missing sections on its one host.
 * 4. Mutate a source after analysis and require context from the captured snapshot.
 * 5. Bound a long section with explicit omitted lines and characters.
 * 6. Reject context on a non-check command before loading configuration.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs buffered check commands against real TypeScript and Markdown sources and asserts rendered missing-reference bodies and unchanged default output.
 * @evidence contracts/testing.md#independent-expectations Fixture section text and configured targets provide literal expectations independent of the renderer and extraction implementation.
 * @evidence contracts/testing.md#distinguishing-cases Covers ordinary and checklist gaps, selected versus unrelated Markdown headings, text and JSON, absence without the flag, and invalid command use.
 * @evidence contracts/testing.md#execution-ownership The exported test_command_context is discovered by DynamicExecutor and calls maintained source in-process without spawning a CLI or installing a consumer.
 */
export async function test_command_context(): Promise<void> {
  await EvidenceTestFileSystem.experiment(
    "command context",
    {
      "evidence.config.json": JSON.stringify({
        claims: [
          {
            type: "typescript",
            files: ["src/*.ts"],
            symbol: "function",
            reference: {
              type: "markdown",
              files: ["docs/*.md"],
              symbol: "h2",
            },
          },
        ],
      }),
      "src/main.ts": "export function treatment(): void {}\n",
      "docs/settings.md": dedent`
        ## Safety {#safety}
        Check the configured treatment limit.

        ## Consent {#consent}
        Obtain consent before treatment.
      `,
    },
    async (directory: string): Promise<void> => {
      const plain = await EvidenceCommand.run(["--format", "json"], directory);
      const enriched = await EvidenceCommand.run(
        ["--context", "--format", "json"],
        directory,
      );
      const report: IEvidenceCheckReport =
        typia.json.assertParse<IEvidenceCheckReport>(enriched.stdout);
      TestValidator.equals("missing result", enriched.exitCode, 1);
      TestValidator.equals("ordinary diagnostics", report.diagnostics.length, 2);
      TestValidator.predicate(
        "safety body",
        enriched.stdout.includes("Check the configured treatment limit."),
      );
      TestValidator.predicate(
        "consent body",
        enriched.stdout.includes("Obtain consent before treatment."),
      );
      TestValidator.predicate(
        "plain output unchanged",
        !plain.stdout.includes("Check the configured treatment limit."),
      );
      const text = await EvidenceCommand.run(["--context"], directory);
      TestValidator.predicate(
        "text body",
        text.stdout.includes("Check the configured treatment limit."),
      );
      const focused = await EvidenceCommand.run(
        ["--only", "docs/settings.md#safety", "--context"],
        directory,
      );
      TestValidator.predicate(
        "focused body",
        focused.stdout.includes("Check the configured treatment limit.") &&
          !focused.stdout.includes("Obtain consent before treatment."),
      );
      TestValidator.error("list rejects context", () =>
        EvidenceCommand.parse(["list", "--context"]),
      );
      for (const args of [
        ["--context", "--context"],
        ["--context", "--watch"],
      ])
        TestValidator.error(`reject ${args.join(" ")}`, () =>
          EvidenceCommand.parse(args),
        );
      const bounded = await EvidenceCommand.run(
        ["--context", "--limit", "1", "--format", "json"],
        directory,
      );
      const boundedReport: IEvidenceCheckReport =
        typia.json.assertParse<IEvidenceCheckReport>(bounded.stdout);
      TestValidator.equals("context window", boundedReport.diagnostics.length, 1);
      TestValidator.equals("context omitted", boundedReport.omittedDiagnostics, 1);
      const analysis: IEvidenceCheckAnalysis = await new EvidenceChecker(
        join(directory, "evidence.config.json"),
      ).analyze();
      await EvidenceTestFileSystem.save(directory, {
        "docs/settings.md": "## Changed {#changed}\nNew unrelated text.\n",
      });
      const captured: IEvidenceCheckReport = EvidenceQuery.context(
        analysis,
        analysis.report,
      );
      TestValidator.predicate(
        "captured source survives edit",
        captured.diagnostics.some(
          (diagnostic): boolean =>
            diagnostic.context?.some(
              (section): boolean =>
                section.text.includes("Check the configured treatment limit."),
            ) === true,
        ) && !JSON.stringify(captured).includes("New unrelated text."),
      );
    },
  );
  await EvidenceTestFileSystem.experiment(
    "checklist context",
    {
      "evidence.config.json": JSON.stringify({
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
              checklist: true,
            },
          },
        ],
      }),
      "src/main.ts": "export function treatment(): void {}\n",
      "docs/settings.md":
        "## Safety {#safety}\r\nCheck the safety limit.\r\n## Consent {#consent}\r\nObtain consent first.\r\n",
    },
    async (directory: string): Promise<void> => {
      const result = await EvidenceCommand.run(
        ["--context", "--format", "json"],
        directory,
      );
      const report: IEvidenceCheckReport =
        typia.json.assertParse<IEvidenceCheckReport>(result.stdout);
      TestValidator.equals("one checklist error", report.diagnostics.length, 1);
      TestValidator.equals(
        "two required sections",
        report.diagnostics[0]?.context?.length,
        2,
      );
      TestValidator.predicate(
        "preserved CRLF",
        report.diagnostics[0]?.context?.[0]?.text.includes("\r\n") === true,
      );
      const focused = await EvidenceCommand.run(
        ["--only", "settings.md#safety", "--context", "--format", "json"],
        directory,
      );
      const focusedReport: IEvidenceCheckReport =
        typia.json.assertParse<IEvidenceCheckReport>(focused.stdout);
      TestValidator.equals(
        "one focused section",
        focusedReport.diagnostics[0]?.context?.length,
        1,
      );
      TestValidator.predicate(
        "sibling omitted",
        !focused.stdout.includes("Obtain consent first."),
      );
    },
  );
  await EvidenceTestFileSystem.experiment(
    "long context",
    {
      "evidence.config.json": JSON.stringify({
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
      }),
      "src/main.ts": "export function treatment(): void {}\n",
      "docs/long.md":
        "## Long {#long}\n" +
        Array.from(
          { length: 50 },
          (_: unknown, index: number): string => `Line ${index + 1}: ${"λ".repeat(210)}`,
        ).join("\n") +
        "\n",
    },
    async (directory: string): Promise<void> => {
      const result = await EvidenceCommand.run(
        ["--context", "--format", "json"],
        directory,
      );
      const report: IEvidenceCheckReport =
        typia.json.assertParse<IEvidenceCheckReport>(result.stdout);
      const section = report.diagnostics[0]?.context?.[0];
      TestValidator.equals("long section truncated", section?.truncated, true);
      TestValidator.predicate(
        "bounded context",
        section !== undefined &&
          section.text.length <= 8192 &&
          section.omittedCharacters > 0 &&
          section.omittedLines > 0,
      );
    },
  );
}
