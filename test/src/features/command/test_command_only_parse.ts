import { EvidenceCommand, EvidenceCommandError } from "@wrtnlabs/evidence";
import type { IEvidenceCheckCommand } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import assert from "node:assert/strict";

/**
 * Parses variadic focused checks without stealing neighboring options.
 *
 * The check selector must coexist with presentation bounds and watch while
 * rejecting empty or incompatible requests before configuration loading.
 *
 * 1. Parse implicit and explicit checks with several targets and surrounding
 *    options; require authored paths and independent numeric bounds.
 * 2. Allow shallow before or after only, and preserve watch selection.
 * 3. Reject missing or empty targets, duplicate selectors or shallow flags,
 *    shallow without targets, and selector options on other commands.
 */
export function test_command_only_parse(): void {
  const expected: IEvidenceCheckCommand = {
    operation: "check",
    cwd: "project",
    format: "json",
    only: ["one.md#first", "two.md#second"],
    shallow: true,
    limit: 3,
    unit: 2,
    watch: true,
  };
  for (const prefix of [[], ["check"]])
    TestValidator.equals(
      "focused check",
      EvidenceCommand.parse([
        ...prefix,
        "--cwd",
        "project",
        "--only",
        "one.md#first",
        "two.md#second",
        "--format",
        "json",
        "--shallow",
        "--unit",
        "2",
        "--limit",
        "3",
        "--watch",
      ]),
      expected,
    );
  TestValidator.equals(
    "shallow before only",
    EvidenceCommand.parse(["--shallow", "--only", "one.md#first"]),
    {
      operation: "check",
      cwd: ".",
      format: "text",
      only: ["one.md#first"],
      shallow: true,
    },
  );
  for (const args of [
    ["--only"],
    ["--only", "--watch"],
    ["--only", ""],
    ["--only", "one.md#first", "--only", "two.md#second"],
    ["--shallow"],
    ["--only", "one.md#first", "--shallow", "--shallow"],
    ["list", "--only", "one.md#first"],
    ["graph", "--shallow"],
    ["inspect", "one.md#first", "--only", "two.md#second"],
  ])
    assert.throws(() => EvidenceCommand.parse(args), EvidenceCommandError);
}
