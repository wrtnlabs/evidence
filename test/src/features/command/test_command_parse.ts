import { EvidenceCommand, EvidenceCommandError } from "@wrtnlabs/evidence";
import type { IEvidenceCheckCommand } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import assert from "node:assert/strict";

/**
 * Parses supported command forms while rejecting ambiguous and incompatible
 * arguments.
 *
 * The parser is the contract between CLI spelling and typed operations. It must
 * retain authored paths until execution, assign operation-specific defaults,
 * and stop invalid combinations before they can choose an unintended action.
 *
 * 1. Require bare and explicit check forms to produce the same defaults, and
 *    require both watch aliases to enable watch on that command.
 * 2. Parse check, init, list, inspect, graph, and languages forms; verify their
 *    operation-specific options, defaults, and supported language or kind
 *    filters.
 * 3. Require help and version flags to short-circuit project-option processing.
 * 4. Reject unknown commands and options, missing values, duplicate settings,
 *    unsupported formats, unsupported command-option pairs, malformed inspect
 *    arguments, duplicate watch flags, and invalid language or kind filters.
 */
export function test_command_parse(): void {
  // Bare invocation and the explicit command have the same complete defaults.
  const defaults: IEvidenceCheckCommand = {
    operation: "check",
    cwd: ".",
    format: "text",
  };
  TestValidator.equals("bare check", EvidenceCommand.parse([]), defaults);
  TestValidator.equals(
    "explicit check",
    EvidenceCommand.parse(["check"]),
    defaults,
  );
  TestValidator.equals(
    "watch aliases",
    [
      EvidenceCommand.parse(["--watch"]),
      EvidenceCommand.parse(["check", "-w"]),
    ],
    [
      { ...defaults, watch: true },
      { ...defaults, watch: true },
    ],
  );

  // Both spellings preserve authored paths until execution resolves --cwd.
  TestValidator.equals(
    "check options",
    EvidenceCommand.parse([
      "check",
      "--cwd",
      "nested",
      "-c",
      "config/evidence.config.ts",
      "--format",
      "json",
      "-o",
      "reports/evidence.json",
    ]),
    {
      operation: "check",
      cwd: "nested",
      config: "config/evidence.config.ts",
      format: "json",
      output: "reports/evidence.json",
    },
  );
  TestValidator.equals(
    "init options",
    EvidenceCommand.parse([
      "init",
      "--cwd",
      "nested",
      "--config",
      "config/custom.ts",
    ]),
    {
      operation: "init",
      cwd: "nested",
      config: "config/custom.ts",
    },
  );
  TestValidator.equals(
    "list filters",
    EvidenceCommand.parse([
      "list",
      "--language",
      "typescript",
      "--kind",
      "property",
      "--format",
      "json",
    ]),
    {
      operation: "list",
      cwd: ".",
      config: "evidence.config.ts",
      format: "json",
      language: "typescript",
      kind: "property",
    },
  );
  TestValidator.equals(
    "Kotlin list filter",
    EvidenceCommand.parse(["list", "--language", "kotlin"]),
    {
      operation: "list",
      cwd: ".",
      config: "evidence.config.ts",
      format: "text",
      language: "kotlin",
    },
  );
  TestValidator.equals(
    "inspect target",
    EvidenceCommand.parse([
      "inspect",
      "src/contract.ts#Contract.member",
      "--cwd",
      "project",
    ]),
    {
      operation: "inspect",
      target: "src/contract.ts#Contract.member",
      cwd: "project",
      config: "evidence.config.ts",
      format: "text",
    },
  );
  TestValidator.equals(
    "graph format",
    EvidenceCommand.parse(["graph", "--format", "dot"]),
    {
      operation: "graph",
      cwd: ".",
      config: "evidence.config.ts",
      format: "dot",
    },
  );
  TestValidator.equals(
    "languages without config",
    EvidenceCommand.parse(["languages", "--format", "json"]),
    {
      operation: "languages",
      cwd: ".",
      format: "json",
    },
  );

  // Help and version are selected without any project option processing.
  for (const args of [
    ["--help"],
    ["-h"],
    ["check", "--help"],
    ["inspect", "--help"],
  ])
    TestValidator.equals(
      `help arguments: ${args.join(" ")}`,
      EvidenceCommand.parse(args),
      { operation: "help" },
    );
  for (const flag of ["--version", "-v"])
    TestValidator.equals(
      `version flag: ${flag}`,
      EvidenceCommand.parse([flag]),
      {
        operation: "version",
      },
    );

  // Typos, duplicates, bad formats, and incompatible flags all fail loudly.
  for (const args of [
    ["unknown"],
    ["--unknown"],
    ["--config"],
    ["--config", "--unknown"],
    ["--config", "one.ts", "-c", "two.ts"],
    ["--format", "yaml"],
    ["init", "--format", "json"],
    ["init", "--output", "report.txt"],
    ["languages", "--config", "evidence.config.ts"],
    ["graph", "--format", "text"],
    ["inspect"],
    ["inspect", "one.ts#A", "two.ts#B"],
    ["inspect", "one.ts#A", "--kind", "type"],
    ["list", "--language", "not-a-language"],
    ["list", "--kind", "namespace"],
    ["check", "--language", "typescript"],
    ["--help", "--format", "json"],
    ["check", "--version"],
    ["--watch", "-w"],
    ["list", "--watch"],
  ])
    assert.throws(
      () => EvidenceCommand.parse(args),
      EvidenceCommandError,
      `Expected invalid arguments to fail: ${args.join(" ")}`,
    );
}
