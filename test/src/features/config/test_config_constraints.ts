import type { IEvidenceConfig } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";

import { validateEvidenceConfig } from "@wrtnlabs/evidence";

/**
 * Validates malformed population declarations before inactive entries are
 * filtered.
 *
 * Disabled and off settings control execution, not whether configuration shape
 * is valid. Ignoring malformed inactive declarations would let later activation
 * change which invalid settings the loader accepts.
 *
 * 1. Reject an empty root claim array with the nonempty-claim diagnostic.
 * 2. Validate a disabled claim containing a drive-relative root, empty files and
 *    selectors, exclusion-only carrier and evidence globs, and no references;
 *    require every offending field path in the combined message.
 * 3. Reject a whitespace-padded Swagger file on an off reference and an active
 *    Markdown reference with exclusion-only globs and an empty selector array.
 * 4. Accept a well-formed off Kotlin claim, proving inactivity itself is valid.
 *
 * @evidence contracts/testing.md#behavioral-verification Validates malformed configurations with validateEvidenceConfig and asserts the reported field paths or acceptance.
 * @evidence contracts/testing.md#independent-expectations Expected paths are written from the configuration contract.
 * @evidence contracts/testing.md#distinguishing-cases Covers an empty claim array, invalid settings on a disabled claim including evidenceFiles, an off reference with a padded Swagger file, invalid active globs and selectors, and a valid off claim.
 * @evidence contracts/testing.md#execution-ownership The exported test_config_constraints is discovered by DynamicExecutor under test/src/features and calls maintained source in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export function test_config_constraints(): void {
  const emptyGraph = failure({ claims: [] });

  TestValidator.predicate(
    "empty graph",
    emptyGraph.includes("at least one claim is required"),
  );

  const invalid: IEvidenceConfig = {
    claims: [
      {
        type: "typescript",
        disabled: true,
        root: "C:source",
        files: [],
        symbol: [],
        evidenceExcludeCarriers: ["!src/exclusions.ts"],
        evidenceFiles: ["!evidence/*.md"],
        reference: [],
      },
      {
        type: "kotlin",
        severity: "off",
        files: ["src/**"],
        reference: {
          type: "swagger",
          severity: "off",
          file: " openapi.json ",
        },
      },
      {
        type: "typescript",
        files: ["src/**"],
        reference: {
          type: "markdown",
          files: ["!docs/private/**"],
          symbol: [],
        },
      },
    ],
  };
  const message = failure(invalid);

  // A disabled claim remains fully validated before it can leave the load plan.
  for (const expected of [
    "claims[0].root",
    "claims[0].files",
    "claims[0].symbol",
    "claims[0].evidenceExcludeCarriers",
    "claims[0].evidenceFiles",
    "claims[0].reference",
  ])
    TestValidator.predicate(
      `disabled population constraint: ${expected}`,
      message.includes(expected),
    );

  // Off populations still reject malformed exact sources and empty selectors.
  for (const expected of [
    "claims[1].reference.file",
    "claims[2].reference.files",
    "claims[2].reference.symbol",
  ])
    TestValidator.predicate(
      `inactive population constraint: ${expected}`,
      message.includes(expected),
    );

  validateEvidenceConfig({
    claims: [
      {
        type: "kotlin",
        severity: "off",
        files: ["src/**/*.kt"],
        reference: { type: "markdown", files: ["docs/**/*.md"] },
      },
    ],
  });
}

/**
 * Captures the diagnostic message from an expected configuration failure.
 *
 * Unexpected non-Error causes propagate, and successful validation fails the
 * scenario rather than returning text that could satisfy a negative assertion.
 */
function failure(config: IEvidenceConfig): string {
  try {
    validateEvidenceConfig(config);
  } catch (cause) {
    if (cause instanceof Error) return cause.message;
    throw cause;
  }
  throw new Error("Expected Evidence configuration validation to fail.");
}
