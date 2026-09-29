import { EvidenceChecker, EvidenceCommand } from "@wrtnlabs/evidence";
import type { IEvidenceCheckReport, IEvidenceConfig } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Preserves Go checklist, exclusion and review outcomes around tag-shaped data.
 *
 * A source literal cannot satisfy missing coverage, manufacture a review,
 * withdraw its owner or conflict with a real acknowledgement. Misplaced real
 * comments must still fail after literal collection is removed.
 *
 * 1. Check an acknowledged constant whose raw value contains every recognized tag
 *    and require a complete, passing checklist through checker and CLI.
 * 2. Remove the real comment and require missing evidence despite literal tags.
 * 3. Add a real exclusion and require coverage without a literal conflict.
 * 4. Require reviews and keep missing review visible despite literal reviews.
 * 5. Place a real detached comment after the declaration and require an
 *    unsupported-host diagnostic without losing the public denominator.
 * 6. Restore the original acknowledgement and require recovery.
 */
export async function test_go_literal_graph(): Promise<void> {
  const config: IEvidenceConfig = {
    claims: [
      {
        type: "go",
        files: ["*.go"],
        symbol: "property",
        reference: {
          type: "markdown",
          files: ["contract.md"],
          symbol: "h2",
          checklist: true,
        },
      },
    ],
  };
  const data: string = dedent`
    @evidence contract.md#required Literal evidence.
    @link contract.md#required Literal link.
    @evidenceExclude contract.md#required Literal exclusion.
    @evidenceReview contract.md#required #1234567 Literal review.
    @evidenceExcludeReview contract.md#required #1234567 Literal exclusion review.
    @internal Literal withdrawal.
    @hidden Literal withdrawal.
    @ignore Literal withdrawal.
  `;
  const source: string = `package sample\n\nconst Value = \`${data}\`\n`;
  const documented: string = source.replace(
    "const Value",
    "// @evidence contract.md#required The value is literal text.\nconst Value",
  );
  await EvidenceTestFileSystem.experiment(
    "go-literal-graph",
    {
      "evidence.config.json": JSON.stringify(config),
      "contract.md": "# Contract\n\n## Required\n\nDescribe the declaration.\n",
      "subject.go": documented,
    },
    async (directory: string): Promise<void> => {
      const file: string = join(directory, "evidence.config.json");
      const initial: IEvidenceCheckReport = await EvidenceChecker.check(file);
      TestValidator.equals(
        "documented raw literal passes",
        initial.exitCode,
        0,
      );
      TestValidator.equals(
        "only real documentation participates",
        initial.diagnostics,
        [],
      );
      TestValidator.equals(
        "JSON-only Go CLI passes",
        (await EvidenceCommand.run(["--format", "json"], directory)).exitCode,
        0,
      );

      await EvidenceTestFileSystem.save(directory, { "subject.go": source });
      const missing: IEvidenceCheckReport = await EvidenceChecker.check(file);
      TestValidator.equals(
        "literal tags cannot supply coverage",
        missing.exitCode,
        1,
      );
      TestValidator.predicate(
        "missing coverage retained",
        missing.diagnostics.some(
          (diagnostic: IEvidenceCheckReport["diagnostics"][number]): boolean =>
            diagnostic.code === "graph-checklist-missing",
        ),
      );
      TestValidator.predicate(
        "literal strings are not host errors",
        missing.diagnostics.every(
          (diagnostic: IEvidenceCheckReport["diagnostics"][number]): boolean =>
            diagnostic.code !== "unsupported-annotation-host",
        ),
      );

      await EvidenceTestFileSystem.save(directory, {
        "subject.go": source.replace(
          "const Value",
          "// @evidenceExclude contract.md#required This constant is exempt.\nconst Value",
        ),
      });
      TestValidator.equals(
        "real exclusion unaffected by literal evidence",
        (await EvidenceChecker.check(file)).exitCode,
        0,
      );

      await EvidenceTestFileSystem.save(directory, {
        "subject.go": documented,
        "evidence.config.json": JSON.stringify({
          claims: [
            {
              type: "go",
              files: ["*.go"],
              symbol: "property",
              reference: {
                type: "markdown",
                files: ["contract.md"],
                symbol: "h2",
                checklist: true,
                requireReview: true,
              },
            },
          ],
        } satisfies IEvidenceConfig),
      });
      const reviewed: IEvidenceCheckReport = await EvidenceChecker.check(file);
      TestValidator.equals(
        "literal review cannot satisfy policy",
        reviewed.exitCode,
        1,
      );
      TestValidator.predicate(
        "missing review retained",
        reviewed.diagnostics.some(
          (diagnostic: IEvidenceCheckReport["diagnostics"][number]): boolean =>
            diagnostic.code.includes("review") &&
            diagnostic.code.includes("missing"),
        ),
      );

      await EvidenceTestFileSystem.save(directory, {
        "evidence.config.json": JSON.stringify(config),
        "subject.go":
          source +
          "\n// @evidence contract.md#required This real comment is detached.\n",
      });
      const detached: IEvidenceCheckReport = await EvidenceChecker.check(file);
      TestValidator.equals(
        "detached real annotation fails",
        detached.exitCode,
        1,
      );
      TestValidator.equals(
        "exact real misplaced comment diagnostic",
        detached.diagnostics.filter(
          (diagnostic: IEvidenceCheckReport["diagnostics"][number]): boolean =>
            diagnostic.code === "unsupported-annotation-host",
        ).length,
        1,
      );
      await EvidenceTestFileSystem.save(directory, {
        "subject.go": documented,
      });
      TestValidator.equals(
        "restored documentation recovers",
        (await EvidenceChecker.check(file)).exitCode,
        0,
      );
    },
  );
}
