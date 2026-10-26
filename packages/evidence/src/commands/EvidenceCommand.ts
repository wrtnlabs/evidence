import type { IEvidenceGraphReport } from "../structures/IEvidenceGraphReport";
import type { IEvidenceInspectReport } from "../structures/IEvidenceInspectReport";
import type { IEvidenceListReport } from "../structures/IEvidenceListReport";
import { EvidenceQueryProgrammer } from "../programmers/EvidenceQueryProgrammer";
import { EvidenceUnitCheckProgrammer } from "../programmers/EvidenceUnitCheckProgrammer";
import type { IEvidenceQueryContext } from "../contexts/IEvidenceQueryContext";
import { dedent } from "@typia/utils";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import typia from "typia";

import { EvidenceChecker } from "../EvidenceChecker";
import { EvidenceCommandError } from "./EvidenceCommandError";
import { EvidenceGraphReporter } from "../reporters/EvidenceGraphReporter";
import { EvidenceQuery } from "../graph/EvidenceQuery";
import { EvidenceQueryReporter } from "../reporters/EvidenceQueryReporter";
import { EvidenceReporter } from "../reporters/EvidenceReporter";
import { EvidenceWatcher } from "./EvidenceWatcher";
import { EvidenceWatchReporter } from "../reporters/EvidenceWatchReporter";
import { EvidenceArtifactTypes } from "../internal/EvidenceArtifactTypes";
import { EvidenceConfigFormat } from "../internal/EvidenceConfigFormat";
import { EvidenceConfigLoader } from "../loaders/EvidenceConfigLoader";
import type { IEvidenceCheckAnalysis } from "../structures/IEvidenceCheckAnalysis";
import type { IEvidenceConfig } from "../structures/IEvidenceConfig";
import type { IEvidenceConfigReport } from "../structures/IEvidenceConfigReport";
import type { IEvidenceCheckReport } from "../structures/IEvidenceCheckReport";
import { EvidenceTreeSitterAssetScope } from "../internal/EvidenceTreeSitterAssetScope";
import type { IEvidencePackageManifest } from "../internal/IEvidencePackageManifest";
import type { IEvidenceCheckCommand } from "../structures/IEvidenceCheckCommand";
import type { IEvidenceCommand } from "../structures/IEvidenceCommand";
import type { IEvidenceCommandFailure } from "../structures/IEvidenceCommandFailure";
import type { IEvidenceCommandResult } from "../structures/IEvidenceCommandResult";
import type { IEvidenceGraphCommand } from "../structures/IEvidenceGraphCommand";
import type { IEvidenceInitCommand } from "../structures/IEvidenceInitCommand";
import type { IEvidenceInspectCommand } from "../structures/IEvidenceInspectCommand";
import type { IEvidenceLanguagesCommand } from "../structures/IEvidenceLanguagesCommand";
import type { IEvidenceListCommand } from "../structures/IEvidenceListCommand";
import type { EvidenceCommandExitCode } from "../typings/EvidenceCommandExitCode";
import type { EvidenceGraphFormat } from "../typings/EvidenceGraphFormat";
import type { EvidenceReportFormat } from "../typings/EvidenceReportFormat";
import type { EvidenceSymbol } from "../typings/EvidenceSymbol";

/**
 * Parses and executes the standalone Evidence Graph command contract.
 *
 * The executable delegates its argument handling here, while integrations can
 * use `parse` to inspect a command or `run` to capture a finite command's
 * output. This boundary validates syntax before configuration loading so
 * malformed input cannot accidentally scan the caller's project.
 *
 * @example
 *   const command: IEvidenceCommand = EvidenceCommand.parse([
 *     "list",
 *     "--format",
 *     "json",
 *   ]);
 *   // command.operation is "list" and its default cwd is ".".
 *
 * @evidence contracts/common.md#principled-implementation The CLI contract is parsed into validated command objects before any filesystem access, then dispatched to analysis, query, init, languages or watch handlers.
 * @evidence contracts/common.md#clear-and-simple-design Parsing, buffered execution, streaming main and init are separate exported functions; per-operation runners are private helpers.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Malformed input never triggers a project scan, and buffered run rejects watch instead of blocking.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains the boundary with an example; every function and helper is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceCommand {
  /**
   * Converts a complete argument vector into one validated command object.
   *
   * Parsing assigns operation-specific defaults and rejects unknown, duplicate,
   * or incompatible options before any filesystem access. `check` is implicit
   * when the first token is absent or an option; `inspect` accepts one
   * positional target and check's `--only` consumes targets until the next
   * option. Pages are one-based and require a finite check with an effective
   * diagnostic limit. Callers receive an {@link EvidenceCommandError} for
   * repairable syntax mistakes rather than a configuration or source
   * diagnostic.
   *
   * @example
   *   EvidenceCommand.parse(["graph", "--format", "dot"]);
   *   // { operation: "graph", cwd: ".", format: "dot" }
   *
   * @evidence contracts/common.md#principled-implementation A single pass over the argument vector assigns operation defaults and rejects unknown, duplicate and incompatible options, with check implicit when no operation is named.
   * @evidence contracts/common.md#clear-and-simple-design Parse only builds command objects; execution is run's job.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Syntax mistakes throw EvidenceCommandError before configuration or source access.
   * @evidence contracts/common.md#meaningful-documentation The comment explains defaults, positional handling and errors with an example.
   * @evidence contracts/performance.md#efficient-algorithms Linear in argument count.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each argument vector is parsed once.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The command object is owned by the caller.
   */
  export function parse(args: readonly string[]): IEvidenceCommand {
    if (args.length === 1 && (args[0] === "-v" || args[0] === "--version"))
      return { operation: "version" };

    // Copy the caller's vector before consuming the operation; embedding code may
    // reuse the original argument array after validation.
    const tokens = [...args];
    const operation = command(tokens[0]);
    if (operation !== "check" || tokens[0] === "check") tokens.shift();

    if (tokens.length === 1 && (tokens[0] === "-h" || tokens[0] === "--help"))
      return { operation: "help" };
    if (tokens.includes("-h") || tokens.includes("--help"))
      throw new EvidenceCommandError(
        "The help flag cannot be combined with other options.",
      );
    if (tokens.includes("-v") || tokens.includes("--version"))
      throw new EvidenceCommandError(
        "The version flag cannot be combined with a command or other options.",
      );

    const values: Map<string, string> = new Map();
    let only: string[] | undefined;
    let shallow: boolean = false;
    let context: boolean = false;
    let target: string | undefined;
    let watch = false;
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token === undefined)
        throw new EvidenceCommandError(
          "The argument list changed while parsing.",
        );
      if (token === "-w" || token === "--watch") {
        if (operation !== "check")
          throw new EvidenceCommandError(
            `${token} is available only to evidence check.`,
          );
        if (watch)
          throw new EvidenceCommandError("The watch flag was provided twice.");
        watch = true;
        continue;
      }
      if (token === "--shallow") {
        if (operation !== "check")
          throw new EvidenceCommandError(
            "--shallow is available only to evidence check.",
          );
        if (shallow)
          throw new EvidenceCommandError(
            "The shallow flag was provided twice.",
          );
        shallow = true;
        continue;
      }
      if (token === "--context") {
        if (operation !== "check")
          throw new EvidenceCommandError(
            "--context is available only to evidence check.",
          );
        if (context)
          throw new EvidenceCommandError(
            "The context flag was provided twice.",
          );
        context = true;
        continue;
      }
      if (token === "--only") {
        if (operation !== "check")
          throw new EvidenceCommandError(
            "--only is available only to evidence check.",
          );
        if (only !== undefined)
          throw new EvidenceCommandError("Option '--only' was provided twice.");
        only = [];
        while (index + 1 < tokens.length) {
          const value: string | undefined = tokens[index + 1];
          if (value === undefined || value.startsWith("-")) break;
          if (value === "")
            throw new EvidenceCommandError("Option '--only' cannot be empty.");
          only.push(value);
          index++;
        }
        if (only.length === 0)
          throw new EvidenceCommandError("Option '--only' requires a target.");
        continue;
      }
      if (!token.startsWith("-")) {
        if (operation !== "inspect")
          throw new EvidenceCommandError(
            `Unexpected argument '${token}' for evidence ${operation}.`,
          );
        if (target !== undefined)
          throw new EvidenceCommandError(
            "Evidence inspect accepts exactly one target.",
          );
        target = token;
        continue;
      }

      // Resolve aliases before admitting a value so duplicate short/long spellings
      // cannot silently override one another in the normalized command object.
      const key = optionKey(token);
      if (key === undefined)
        throw new EvidenceCommandError(`Unknown Evidence argument '${token}'.`);
      if (!optionAllowed(operation, key))
        throw new EvidenceCommandError(
          `${token} is not available to evidence ${operation}.`,
        );
      if (values.has(key))
        throw new EvidenceCommandError(`Option '${token}' was provided twice.`);
      const value = tokens[++index];
      if (value === undefined || value.startsWith("-"))
        throw new EvidenceCommandError(`Option '${token}' requires a value.`);
      if (value === "")
        throw new EvidenceCommandError(`Option '${token}' cannot be empty.`);
      values.set(key, value);
    }

    if (shallow && only === undefined)
      throw new EvidenceCommandError("--shallow requires --only targets.");
    if (watch && context)
      throw new EvidenceCommandError("--context cannot be used with --watch.");
    if (watch && values.has("page"))
      throw new EvidenceCommandError("--page cannot be used with --watch.");
    const cwd = values.get("cwd") ?? ".";
    if (operation === "init")
      return {
        operation,
        cwd,
        config: values.get("config") ?? "evidence.config.ts",
      };
    if (operation === "languages")
      return {
        operation,
        cwd,
        format: reportFormat(values.get("format")),
        ...optionalOutput(values),
      };

    const config: string | undefined = values.get("config");
    if (operation === "graph")
      return {
        operation,
        cwd,
        ...(config === undefined ? {} : { config }),
        format: graphFormat(values.get("format")),
        ...optionalOutput(values),
      };
    if (operation === "inspect") {
      if (target === undefined)
        throw new EvidenceCommandError(
          "Evidence inspect requires exactly one target.",
        );
      return {
        operation,
        target,
        cwd,
        ...(config === undefined ? {} : { config }),
        format: reportFormat(values.get("format")),
        ...optionalOutput(values),
      };
    }
    if (operation === "list") {
      const language = values.get("language");
      if (
        language !== undefined &&
        !EvidenceArtifactTypes.isSupported(language)
      )
        throw new EvidenceCommandError(
          `Unknown evidence artifact type '${language}'. Use a type backed by a shipped adapter.`,
        );
      const kind = values.get("kind");
      if (kind !== undefined && !typia.is<EvidenceSymbol>(kind))
        throw new EvidenceCommandError(
          `Unknown Evidence symbol kind '${kind}'.`,
        );
      return {
        operation,
        cwd,
        ...(config === undefined ? {} : { config }),
        format: reportFormat(values.get("format")),
        ...optionalOutput(values),
        ...(language === undefined ? {} : { language }),
        ...(kind === undefined ? {} : { kind }),
      };
    }
    const limit: number | undefined = positiveInteger(
      "--limit",
      values.get("limit"),
    );
    const unit: number | undefined = positiveInteger(
      "--unit",
      values.get("unit"),
    );
    const page: number | undefined = positiveInteger(
      "--page",
      values.get("page"),
    );
    return {
      operation,
      cwd,
      ...(config === undefined ? {} : { config }),
      format: reportFormat(values.get("format")),
      ...optionalOutput(values),
      ...(watch ? { watch: true } : {}),
      ...(limit === undefined ? {} : { limit }),
      ...(unit === undefined ? {} : { unit }),
      ...(page === undefined ? {} : { page }),
      ...(only === undefined ? {} : { only }),
      ...(shallow ? { shallow: true } : {}),
      ...(context ? { context: true } : {}),
    };
  }

  /**
   * Executes a finite command and returns its complete buffered result.
   *
   * This is the embedding and logic-test entry point: it does not write process
   * streams and returns parse or operational failures with exit code 2. Text
   * failures use stderr, while JSON operational failures use stdout to preserve
   * a parseable report. Watch mode is deliberately excluded because its
   * unbounded publication lifecycle belongs to {@link EvidenceWatcher} or
   * {@link main}.
   *
   * @example
   *   const result: IEvidenceCommandResult = await EvidenceCommand.run([
   *     "--help",
   *   ]);
   *   // result.exitCode === 0 and result.stdout contains the command reference.
   *
   * @evidence contracts/common.md#principled-implementation The parsed command dispatches to help, version, init, languages or analysis, returning buffered output and an exit code without touching process streams.
   * @evidence contracts/common.md#clear-and-simple-design Run only dispatches; private runners own each operation.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Parse and operational failures return exit code 2 with JSON failures on stdout so output stays parseable, and watch is refused.
   * @evidence contracts/common.md#meaningful-documentation The comment explains stream routing and the watch exclusion with an example.
   * @evidence contracts/performance.md#efficient-algorithms Cost is that of the dispatched operation.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each invocation runs its own operation.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Results are returned as strings; nothing is retained.
   */
  export async function run(
    args: readonly string[],
    baseCwd: string = process.cwd(),
  ): Promise<IEvidenceCommandResult> {
    let parsed: IEvidenceCommand;
    try {
      parsed = parse(args);
    } catch (cause) {
      return failureResult(cause, "Run 'evidence --help' for valid syntax.");
    }

    if (parsed.operation === "help")
      return { exitCode: 0, stdout: HELP + "\n", stderr: "" };
    if (parsed.operation === "version") {
      try {
        return { exitCode: 0, stdout: `${await version()}\n`, stderr: "" };
      } catch (cause) {
        return failureResult(
          cause,
          "Restore the installed evidence package manifest.",
        );
      }
    }
    if (parsed.operation === "init") return runInit(parsed, baseCwd);
    if (parsed.operation === "languages") return runLanguages(parsed, baseCwd);
    if (parsed.operation === "check" && parsed.watch === true)
      return failureResult(
        new Error("Buffered EvidenceCommand.run cannot execute watch mode."),
        "Use EvidenceWatcher for embedding or the evidence executable for streamed watch output.",
      );
    return runAnalysis(parsed, baseCwd);
  }

  /**
   * Streams a command result through Node's standard output and error channels.
   *
   * The packaged executable calls this method. It reuses the buffered command
   * path for finite operations, but keeps watch open and sends parser-asset
   * progress to stderr unless a report file was requested. Repeated progress is
   * deduplicated because retries can report the same acquisition state more
   * than once.
   *
   * @evidence contracts/common.md#principled-implementation The executable entry runs run or the streamed watch path inside an asset scope that routes deduplicated progress to stderr unless a report file was requested.
   * @evidence contracts/common.md#clear-and-simple-design Main adds stream writing and progress routing on top of run.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Malformed input is rendered by run for consistency rather than by a second error path.
   * @evidence contracts/common.md#meaningful-documentation The comment explains progress routing; inline comments explain parse reuse.
   * @evidence contracts/performance.md#efficient-algorithms Cost is that of the dispatched operation.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Progress messages are deduplicated within one invocation only.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The progress set and asset scope end with the invocation; watch cleanup is joined by its runner.
   */
  export async function main(
    args: readonly string[],
  ): Promise<EvidenceCommandExitCode> {
    let parsed: IEvidenceCommand | undefined;
    try {
      parsed = parse(args);
    } catch {
      // The buffered path owns the established command-error rendering.
    }
    // Retain a successful parse only for stream-specific choices; `run` renders
    // malformed input consistently with all other buffered command failures.
    const selected = parsed;
    const progressMessages = new Set<string>();
    const result = await EvidenceTreeSitterAssetScope.run(
      {
        progress: (message) => {
          if (
            selected !== undefined &&
            "output" in selected &&
            selected.output !== undefined
          )
            return;
          if (progressMessages.has(message)) return;
          progressMessages.add(message);
          process.stderr.write(`${message}\n`);
        },
      },
      async () =>
        selected?.operation === "check" && selected.watch === true
          ? runWatch(selected, process.cwd())
          : run(args),
    );
    if (result.stdout !== "") process.stdout.write(result.stdout);
    if (result.stderr !== "") process.stderr.write(result.stderr);
    return result.exitCode;
  }

  /**
   * Creates a starter configuration in the format implied by its filename.
   *
   * JSON receives literal data and TypeScript receives an `IEvidenceConfig`
   * `satisfies` template with identical defaults. Exclusive creation preserves
   * an existing author-owned configuration; its collision is rethrown with a
   * focused repair message instead of being overwritten.
   *
   * @example
   *   await EvidenceCommand.initialize("evidence.config.ts");
   *
   * @evidence contracts/common.md#principled-implementation The configuration format comes from the filename, and the starter is written with the exclusive wx flag so an existing file is never overwritten.
   * @evidence contracts/common.md#clear-and-simple-design Initialize only writes the template; the command runner resolves the path.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts An existing file yields a focused refusal instead of being replaced.
   * @evidence contracts/common.md#meaningful-documentation The comment explains both templates and exclusive creation with an example.
   * @evidence contracts/performance.md#efficient-algorithms One small file write.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Initialization runs once per request.
   * @evidence contracts/performance.md#bound-retention-and-release-resources writeFile opens and closes the file within the call.
   */
  export async function initialize(file: string): Promise<void> {
    const format = EvidenceConfigFormat.get(file);
    try {
      await writeFile(
        file,
        (format === "json"
          ? JSON.stringify(INITIAL_DATA, null, 2)
          : INITIAL_CONFIG) + "\n",
        {
          encoding: "utf8",
          flag: "wx",
        },
      );
    } catch (cause) {
      if (errorCode(cause) === "EEXIST")
        throw new Error(
          `Refusing to overwrite the existing Evidence Graph configuration: ${file}`,
        );
      throw cause;
    }
  }
}

/**
 * Opens the process-owned watch lifecycle and routes each published cycle.
 *
 * Watch output is either appended to the requested destination or written
 * through stdout's completion callback so I/O failures become command failures.
 * The SIGINT handler only requests shutdown; `finally` removes it and joins
 * watcher cleanup.
 */
async function runWatch(
  command: IEvidenceCheckCommand,
  baseCwd: string,
): Promise<IEvidenceCommandResult> {
  const cwd = path.resolve(baseCwd, command.cwd);
  const configFile: string | undefined =
    command.config === undefined
      ? undefined
      : path.resolve(cwd, command.config);
  const destination =
    command.output === undefined
      ? undefined
      : path.resolve(cwd, command.output);
  try {
    if (destination !== undefined) await writeFile(destination, "", "utf8");
  } catch (cause) {
    return failureResult(
      new Error(
        `Could not initialize Evidence Graph watch output '${String(destination)}': ${errorMessage(cause)}`,
      ),
      "Correct the output path or its permissions and run the command again.",
    );
  }

  const watcher: EvidenceWatcher = new EvidenceWatcher(configFile, {
    cwd,
    ...(command.only === undefined ? {} : { only: command.only }),
    ...(command.shallow === undefined ? {} : { shallow: command.shallow }),
  });
  const interrupt = (): void => {
    void watcher.close();
  };
  process.once("SIGINT", interrupt);
  try {
    await watcher.watch(async (cycle) => {
      const content = EvidenceWatchReporter.render(cycle, command.format, {
        ...(command.limit === undefined ? {} : { limit: command.limit }),
        ...(command.unit === undefined ? {} : { unit: command.unit }),
      });
      if (destination === undefined) await writeStandardOutput(content);
      else await appendFile(destination, content, "utf8");
    });
    return { exitCode: 0, stdout: "", stderr: "" };
  } catch (cause) {
    return failureResult(
      cause,
      "Correct the watch output or dependency failure and start the command again.",
    );
  } finally {
    process.removeListener("SIGINT", interrupt);
    await watcher.close();
  }
}

/**
 * Waits for Node to accept a complete watch block on standard output.
 *
 * Watch publication must apply backpressure. Resolving after `write`'s callback
 * prevents a rapid filesystem change from reordering or losing rendered
 * cycles.
 */
async function writeStandardOutput(content: string): Promise<void> {
  await new Promise<undefined>((resolve, reject) => {
    process.stdout.write(content, (cause) => {
      if (cause === null || cause === undefined) resolve(undefined);
      else reject(cause);
    });
  });
}

/**
 * Runs one analysis and projects it into check, query, or graph output.
 *
 * Every operation shares one checker result so list, inspect, and graph
 * describe the same configuration and source snapshot as the underlying check.
 * A thrown loading or analysis failure is serialized in the selected report
 * format before the optional output-file path is attempted.
 */
async function runAnalysis(
  command:
    | IEvidenceCheckCommand
    | IEvidenceGraphCommand
    | IEvidenceInspectCommand
    | IEvidenceListCommand,
  baseCwd: string,
): Promise<IEvidenceCommandResult> {
  const cwd = path.resolve(baseCwd, command.cwd);
  let configFile: string = path.resolve(
    cwd,
    command.config ?? "evidence.config.ts",
  );
  try {
    configFile = await EvidenceConfigLoader.locate(command.config, cwd);
    const analysis = await new EvidenceChecker(configFile).analyze();
    if (command.operation === "check") {
      const report: IEvidenceCheckReport =
        command.only === undefined
          ? analysis.report
          : await EvidenceUnitCheckProgrammer.check(
              queryContext(analysis, cwd),
              command.only,
              command.shallow === true,
              command.context === true,
            );
      const window: IEvidenceConfigReport = {
        ...(command.limit === undefined ? {} : { limit: command.limit }),
        ...(command.unit === undefined ? {} : { unit: command.unit }),
      };
      const limit: number | undefined = command.limit ?? report.bounds?.limit;
      if (command.page !== undefined && limit === undefined)
        throw new EvidenceCommandError(
          "--page requires --limit or a configured report.limit.",
        );
      const page: number | undefined =
        limit === undefined ? undefined : (command.page ?? 1);
      const bounded: IEvidenceCheckReport = EvidenceReporter.narrow(
        report,
        window,
        page,
      );
      const presented: IEvidenceCheckReport =
        command.context === true
          ? EvidenceQuery.context(analysis, bounded)
          : bounded;
      const output: string =
        command.format === "json"
          ? EvidenceReporter.json(presented)
          : EvidenceReporter.text(presented);
      return writeReport(command.output, cwd, output, report.exitCode, false);
    }
    // Query projections reuse the captured inventory and diagnostics. Reanalyzing
    // here could make a report disagree with the command's check boundary.
    const query: IEvidenceQueryContext = queryContext(analysis, cwd);
    if (command.operation === "list") {
      const report: IEvidenceListReport = EvidenceQueryProgrammer.list(
        query,
        command.language,
        command.kind,
      );
      return writeReport(
        command.output,
        cwd,
        EvidenceQueryReporter.render(report, command.format),
        report.exitCode,
        false,
      );
    }
    if (command.operation === "inspect") {
      const report: IEvidenceInspectReport =
        await EvidenceQueryProgrammer.inspect(query, command.target);
      return writeReport(
        command.output,
        cwd,
        EvidenceQueryReporter.render(report, command.format),
        report.exitCode,
        false,
      );
    }
    const report: IEvidenceGraphReport = EvidenceQueryProgrammer.graph(query);
    return writeReport(
      command.output,
      cwd,
      EvidenceGraphReporter.render(report, command.format),
      report.exitCode,
      false,
    );
  } catch (cause) {
    const message = errorMessage(cause);
    const repair =
      "Correct the command, configuration, dependencies, or source failure and run the complete command again.";
    const output =
      command.format === "json"
        ? JSON.stringify(
            {
              schemaVersion: 1,
              command: command.operation,
              status: "failed",
              success: false,
              exitCode: 2,
              configFile,
              message,
              repair,
            } satisfies IEvidenceCommandFailure,
            null,
            2,
          ) + "\n"
        : `Evidence ${command.operation} failed: ${message}\nRepair: ${repair}\n`;
    return writeReport(
      command.output,
      cwd,
      output,
      2,
      command.format !== "json",
    );
  }
}

/**
 * Renders shipped adapter capabilities without loading project configuration.
 *
 * `languages` remains useful in a broken project because its data comes from
 * the package registry, while output handling follows the same contract as
 * analysis.
 */
async function runLanguages(
  command: IEvidenceLanguagesCommand,
  baseCwd: string,
): Promise<IEvidenceCommandResult> {
  const cwd = path.resolve(baseCwd, command.cwd);
  const report = EvidenceQuery.languages();
  return writeReport(
    command.output,
    cwd,
    EvidenceQueryReporter.render(report, command.format),
    0,
    false,
  );
}

/**
 * Routes fully rendered output to a buffer or a caller-selected report file.
 *
 * Text failures use stderr when no file is requested; JSON is kept on stdout so
 * machine consumers receive a valid structured failure document. File-write
 * errors replace the original result because no requested report was
 * delivered.
 */
async function writeReport(
  output: string | undefined,
  cwd: string,
  content: string,
  exitCode: EvidenceCommandExitCode,
  failure: boolean,
): Promise<IEvidenceCommandResult> {
  if (output === undefined)
    return {
      exitCode,
      stdout: failure ? "" : content,
      stderr: failure ? content : "",
    };
  const destination = path.resolve(cwd, output);
  try {
    await writeFile(destination, content, "utf8");
    return { exitCode, stdout: "", stderr: "" };
  } catch (cause) {
    return failureResult(
      new Error(
        `Could not write Evidence Graph report '${destination}': ${errorMessage(cause)}`,
      ),
      "Correct the output path or its permissions and run the command again.",
    );
  }
}

/**
 * Resolves and creates an initialization target for buffered command execution.
 *
 * Initializing is intentionally separate from analysis: it needs only its
 * working directory and configuration path, and reports existing-file conflicts
 * as a command result instead of loading an unrelated current configuration.
 */
async function runInit(
  command: IEvidenceInitCommand,
  baseCwd: string,
): Promise<IEvidenceCommandResult> {
  const cwd = path.resolve(baseCwd, command.cwd);
  const configFile = path.resolve(cwd, command.config);
  try {
    await EvidenceCommand.initialize(configFile);
    return { exitCode: 0, stdout: `Created ${configFile}\n`, stderr: "" };
  } catch (cause) {
    return failureResult(
      cause,
      "Choose another --config path or preserve and edit the existing file.",
    );
  }
}

/**
 * Classifies the optional leading token as a supported operation.
 *
 * A missing token or a leading option starts the default `check` command. Other
 * bare tokens fail here, before option parsing can attribute them incorrectly.
 */
function command(
  token: string | undefined,
): Exclude<IEvidenceCommand["operation"], "help" | "version"> {
  if (token === undefined || token.startsWith("-")) return "check";
  switch (token) {
    case "check":
    case "graph":
    case "init":
    case "inspect":
    case "languages":
    case "list":
      return token;
    default:
      throw new EvidenceCommandError(`Unknown evidence command '${token}'.`);
  }
}

/**
 * Normalizes supported short and long option spellings to parser map keys.
 *
 * The normalized key lets the parser reject duplicate aliases and apply
 * operation rules once, while an undefined result preserves the user's original
 * token in the unknown-argument diagnostic.
 */
function optionKey(token: string): string | undefined {
  switch (token) {
    case "-c":
    case "--config":
      return "config";
    case "--cwd":
      return "cwd";
    case "--format":
      return "format";
    case "-o":
    case "--output":
      return "output";
    case "--language":
      return "language";
    case "--kind":
      return "kind";
    case "--limit":
      return "limit";
    case "--page":
      return "page";
    case "--unit":
      return "unit";
    default:
      return undefined;
  }
}

/**
 * Tests whether a normalized option belongs to the selected operation.
 *
 * Working-directory selection is shared, while initialization, registry lookup,
 * and list filtering expose only their meaningful controls. This guard prevents
 * accepted-but-ignored options from hiding invocation mistakes.
 */
function optionAllowed(operation: string, option: string): boolean {
  if (option === "cwd") return true;
  if (option === "limit" || option === "unit" || option === "page")
    return operation === "check";
  if (operation === "init") return option === "config";
  if (operation === "languages")
    return option === "format" || option === "output";
  if (option === "config" || option === "format" || option === "output")
    return true;
  return operation === "list" && (option === "language" || option === "kind");
}

/**
 * Adds a report destination only when the user supplied one.
 *
 * Omission remains distinct from an empty string, which parse has already
 * rejected; renderers then choose buffered stdout or stderr behavior from
 * property presence.
 */
function optionalOutput(
  values: Map<string, string>,
): Pick<IEvidenceCheckCommand, "output"> {
  const output = values.get("output");
  return output === undefined ? {} : { output };
}

/**
 * Parses a report-window bound as a positive integer.
 *
 * Zero or fractional bounds would print nothing or an ill-defined prefix, so
 * they fail before analysis starts.
 */
function positiveInteger(
  flag: string,
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/u.test(value))
    throw new EvidenceCommandError(
      `Option '${flag}' requires a positive integer.`,
    );
  const number: number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new EvidenceCommandError(
      `Option '${flag}' requires a safe positive integer.`,
    );
  return number;
}

/**
 * Validates the text-or-JSON format shared by report-producing commands.
 *
 * Text is the interactive default. Rejecting unknown values before loading
 * keeps a misspelled formatter from paying the cost of analysis or changing
 * source state.
 */
function reportFormat(value: string | undefined): EvidenceReportFormat {
  const format = value ?? "text";
  if (format !== "text" && format !== "json")
    throw new EvidenceCommandError(
      `Unknown report format '${format}'. Use text or json.`,
    );
  return format;
}

/**
 * Validates the graph-specific output family and supplies its JSON default.
 *
 * Graph visualization formats are not general report formats, so this separate
 * gate keeps `mermaid` and `dot` unavailable to commands that cannot render
 * them.
 */
function graphFormat(value: string | undefined): EvidenceGraphFormat {
  const format = value ?? "json";
  if (format !== "json" && format !== "mermaid" && format !== "dot")
    throw new EvidenceCommandError(
      `Unknown graph format '${format}'. Use json, mermaid, or dot.`,
    );
  return format;
}

/**
 * Reads the installed package version without loading project configuration.
 *
 * The manifest is shape-checked because executable packaging determines its
 * path; a broken installation becomes an actionable version-command failure.
 */
async function version(): Promise<string> {
  const manifest = typia.json.assertParse<IEvidencePackageManifest>(
    await readFile(path.join(__dirname, "../../package.json"), "utf8"),
  );
  return manifest.version;
}

/**
 * Converts an unexpected command-boundary failure into the stable result shape.
 *
 * Exit code 2 distinguishes unavailable or invalid execution from a completed
 * Evidence Graph violation. Keeping this mapping centralized makes parse,
 * manifest, and I/O failures present the same repair-oriented terminal
 * contract.
 */
function failureResult(cause: unknown, repair: string): IEvidenceCommandResult {
  return {
    exitCode: 2,
    stdout: "",
    stderr: `evidence command failed: ${errorMessage(cause)}\nRepair: ${repair}\n`,
  };
}

/**
 * Extracts a Node-style error code without trusting arbitrary thrown values.
 *
 * Filesystem APIs may throw non-Error values in embedding environments. The
 * initializer uses this narrow probe only to recognize exclusive-create
 * conflicts.
 */
function errorCode(cause: unknown): string | undefined {
  if (!(cause instanceof Error) || !("code" in cause)) return undefined;
  const code: unknown = cause.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Produces a printable failure message while preserving native Error text.
 *
 * String conversion gives command rendering a deterministic fallback for
 * rejected promises that throw primitives or foreign error-like objects.
 */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Terminal reference returned before configuration loading for explicit help.
 *
 * Keep options, defaults, formats, and exit semantics aligned with `parse` and
 * command execution so the repair path remains trustworthy after syntax
 * failure.
 */
const HELP = dedent`
  Usage: evidence [check] [options]
         evidence list [options]
         evidence inspect <target> [options]
         evidence graph [options]
         evidence languages [options]
         evidence init [options]
         evidence --help
         evidence --version

  Commands:
    check                 Evaluate every enabled claim and reference (default).
    list                  List configured public Evidence Graph targets.
    inspect               Resolve and explain one target in every applicable scope.
    graph                 Export the configured graph as json, mermaid, or dot.
    languages             Report adapters shipped with this package.
    init                  Create a TS or JSON config without overwriting.

  Options:
    -c, --config <path>   Select a TS/CTS/MTS or JSON configuration file.
        --cwd <path>      Resolve CLI paths from this directory.
        --format <value>  Select the command's output format.
    -o, --output <path>   Write command output to a file.
        --language <type> Filter the Evidence Graph list by artifact type.
        --kind <symbol>   Filter the Evidence Graph list by symbol kind.
        --limit <n>       Print at most n check diagnostics; counts stay complete.
        --page <n>        Select one-based diagnostic page; requires a limit.
        --unit <n>        Print diagnostics for at most n units.
        --context         Show missing Markdown reference sections.
        --only <targets...> Check only these units and their descendants.
        --shallow         With --only, omit descendants of the named units.
    -w, --watch           Recheck whenever an active dependency changes.
    -h, --help            Show this help without loading configuration.
    -v, --version         Show the package version without loading configuration.

  Configuration discovery:
    Use evidence.config.ts, or evidence.config.json only when TS is absent.
    Explicit --config paths and invalid selected files never fall back.
    Watch repeats discovery after candidate changes; init defaults to TS.

  Formats:
    check, list, inspect, languages  text (default), json
    graph                           json (default), mermaid, dot
    check --watch                   text blocks (default), NDJSON

  Exit codes:
    0  Complete analysis without error-severity findings.
    1  Complete analysis with Evidence Graph violations or an unresolved inspection.
    2  Invalid command/configuration or incomplete analysis.

  Watch stays active across cycle exit codes. Ctrl+C cleans up and exits 0.
`;

/**
 * Minimal authored configuration shared by JSON and TypeScript initialization.
 *
 * It demonstrates one TypeScript population and one Markdown reference without
 * claiming that either path is present in the receiving project.
 */
const INITIAL_DATA: IEvidenceConfig = {
  claims: [
    {
      name: "application",
      type: "typescript",
      files: ["src/**/*.ts"],
      reference: { type: "markdown", files: ["docs/requirements.md"] },
    },
  ],
};

/**
 * TypeScript source template preserving the same data as {@link INITIAL_DATA}.
 *
 * `satisfies IEvidenceConfig` gives authors editor validation while leaving the
 * starter object readable and directly editable after `evidence init`.
 */
const INITIAL_CONFIG = dedent`
  import type { IEvidenceConfig } from "@wrtnlabs/evidence";

  // Replace these globs with the public source and requirements in this project.
  export default ${JSON.stringify(INITIAL_DATA, null, 2)} satisfies IEvidenceConfig;
`;

/**
 * Borrows command-owned analysis until rendering; no mutable object crosses
 * this boundary.
 */
function queryContext(
  analysis: IEvidenceCheckAnalysis,
  cwd: string,
): IEvidenceQueryContext {
  return {
    analysis,
    cwd,
    populations: EvidenceQueryProgrammer.populations(analysis),
  };
}
