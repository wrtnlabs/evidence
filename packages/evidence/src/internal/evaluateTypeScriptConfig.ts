import { dedent } from "@typia/utils";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { deserialize } from "node:v8";
import typia from "typia";

import type { IEvidenceConfigPackageScope } from "./IEvidenceConfigPackageScope";
import type { IEvidenceEvaluateTypeScriptConfigOptions } from "./IEvidenceEvaluateTypeScriptConfigOptions";
import type { IEvidenceTtsxManifest } from "./IEvidenceTtsxManifest";

/**
 * Typechecks and evaluates a config in an isolated temporary project through
 * its own ttsx.
 *
 * The evaluator resolves the consumer's compiler rather than this package's,
 * and serializes the default export with V8 so invalid configuration values
 * reach parent-side validation without JSON silently dropping them.
 *
 * @evidence contracts/common.md#principled-implementation The consumer's ttsc launcher and TypeScript platform binary are resolved from the config's own dependency graph and run against a generated tsconfig, so the config is checked by the compiler the project installed.
 * @evidence contracts/common.md#clear-and-simple-design The function resolves the compiler, writes the temporary project, runs ttsx and reads the result; process, module-kind, dependency-tree and temp-volume decisions live in named helpers.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts The default export crosses the process boundary through V8 serialization instead of JSON, so undefined and BigInt values still reach typia validation and fail there.
 * @evidence contracts/common.md#meaningful-documentation The comment explains the consumer-compiler choice and the serialization; each helper documents its own boundary.
 * @evidence contracts/performance.md#efficient-algorithms One ttsx process per evaluation; cost is dominated by type checking in the child.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each evaluation must start with a fresh project so watch sees configuration edits; results are deliberately not reused.
 * @evidence contracts/performance.md#bound-retention-and-release-resources Each evaluation owns one temporary project under node_modules/.cache/evidence and removes it in finally with retries; the child process settles the promise on close. The shared cache base remains for later evaluations.
 */
export async function evaluateTypeScriptConfig(
  configFile: string,
  options: IEvidenceEvaluateTypeScriptConfigOptions = {},
): Promise<unknown> {
  const requireFromConfig: NodeJS.Require = createRequire(configFile);
  let launcher: string;
  let compiler: string;
  try {
    const manifestFile: string = requireFromConfig.resolve("ttsc/package.json");
    const manifest: IEvidenceTtsxManifest =
      typia.json.assertParse<IEvidenceTtsxManifest>(
        await readFile(manifestFile, "utf8"),
      );
    launcher = path.resolve(path.dirname(manifestFile), manifest.bin.ttsx);
    const typescript: string = requireFromConfig.resolve(
      "typescript/package.json",
    );
    const platform: string = createRequire(typescript).resolve(
      `@typescript/typescript-${process.platform}-${process.arch}/package.json`,
    );
    compiler = path.join(
      path.dirname(platform),
      "lib",
      process.platform === "win32" ? "tsc.exe" : "tsc",
    );
    if (!(await stat(launcher)).isFile() || !(await stat(compiler)).isFile())
      throw new Error("Compiler launcher or platform binary is not a file.");
  } catch (cause) {
    throw new Error(
      `Cannot resolve the compiler for ${configFile}. Install it with: pnpm i -D typescript ttsc @wrtnlabs/evidence`,
      { cause },
    );
  }
  const directory: string = path.dirname(configFile);
  const nodeModules: string | undefined = await findNodeModules(directory);
  const temporary: string = await realpath(
    await mkdtemp(
      path.join(await tempBase(configFile, nodeModules), "evidence-config-"),
    ),
  );
  let failed: boolean = false;
  try {
    if (nodeModules !== undefined)
      await symlink(
        nodeModules,
        path.join(temporary, "node_modules"),
        "junction",
      );
    const entry: string = path.join(temporary, "loader.ts");
    const writer: string = path.join(temporary, "write-result.cjs");
    const resultFile: string = path.join(temporary, "result.bin");
    const project: string = path.join(temporary, "tsconfig.json");
    const relative: string = path
      .relative(temporary, configFile)
      .replaceAll("\\", "/");
    await writeFile(
      entry,
      dedent`
        import config from EVIDENCE_CONFIG_FILE;
        import write from "./write-result.cjs";

        void write(config);
      `.replace("EVIDENCE_CONFIG_FILE", (): string =>
        JSON.stringify(relative.startsWith(".") ? relative : `./${relative}`),
      ),
    );
    // V8 serialization preserves invalid values such as undefined and BigInt for
    // parent-side validation; JSON serialization could erase them first.
    await writeFile(
      writer,
      dedent`
        const { writeFile } = require("node:fs/promises");
        const { serialize } = require("node:v8");

        module.exports = async function write(value) {
          try {
            await writeFile(EVIDENCE_RESULT_FILE, serialize(value));
          } catch (error) {
            console.error(error);
            process.exitCode = 1;
          }
        };
      `.replace("EVIDENCE_RESULT_FILE", (): string =>
        JSON.stringify(resultFile),
      ),
    );
    await writeFile(
      path.join(temporary, "write-result.d.cts"),
      dedent`
        declare function write(value: unknown): Promise<void>;
        export = write;
      `,
    );
    await writeFile(
      project,
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2023",
            module: await configModule(configFile),
            moduleResolution: "bundler",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            allowJs: true,
            checkJs: false,
            allowImportingTsExtensions: true,
            rewriteRelativeImportExtensions: true,
            resolveJsonModule: true,
            types: ["*"],
            rootDir: path.parse(temporary).root.replaceAll("\\", "/"),
            outDir: path.join(temporary, "out").replaceAll("\\", "/"),
          },
          files: [entry, configFile],
        },
        null,
        2,
      ),
    );
    await runEvaluator(
      configFile,
      temporary,
      [
        launcher,
        "--binary",
        compiler,
        "--project",
        project,
        "--cwd",
        directory,
        "--no-plugins",
        "--cache-dir",
        path.join(temporary, "cache"),
        entry,
      ],
      options.writeDiagnostic ?? writeProcessDiagnostic,
    );
    if (!(await exists(resultFile)))
      throw new Error(
        `Config evaluator for ${configFile} exited without returning its default export.`,
      );
    const value: unknown = deserialize(await readFile(resultFile));
    return value;
  } catch (cause) {
    failed = true;
    throw cause;
  } finally {
    await rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    }).catch((cause: unknown): void => {
      // Preserve the evaluator's diagnostic if cleanup also fails.
      if (!failed) throw cause;
    });
  }
}

/**
 * Starts the isolated evaluator and forwards compiler output without parsing or
 * rewriting it.
 *
 * Compiler subprocesses use the owned project for temporary files, and their
 * diagnostics retain the original TypeScript and runtime formatting.
 */
async function runEvaluator(
  configFile: string,
  temporary: string,
  args: string[],
  writeDiagnostic: (content: string) => void,
): Promise<void> {
  await new Promise<undefined>(
    (
      resolve: (value: undefined) => void,
      reject: (cause: Error) => void,
    ): void => {
      const child: ChildProcess = spawn(process.execPath, args, {
        cwd: path.dirname(configFile),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          TEMP: temporary,
          TMP: temporary,
          TMPDIR: temporary,
        },
      });
      if (child.stdout !== null) {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", writeDiagnostic);
      }
      if (child.stderr !== null) {
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", writeDiagnostic);
      }
      child.once("error", (cause: Error): void => {
        reject(
          new Error(`Could not start the config evaluator for ${configFile}.`, {
            cause,
          }),
        );
      });
      child.once(
        "close",
        (code: number | null, signal: NodeJS.Signals | null): void => {
          if (code === 0) resolve(undefined);
          else
            reject(
              new Error(
                `Config evaluation failed for ${configFile} (${signal ?? `exit ${String(code)}`}). See compiler or runtime diagnostics above.`,
              ),
            );
        },
      );
    },
  );
}

/**
 * Writes child diagnostics to the parent process while preserving compiler
 * formatting.
 *
 * The evaluator streams both output channels here so users receive compiler
 * context before config loading rejects.
 */
function writeProcessDiagnostic(content: string): void {
  process.stderr.write(content);
}

/**
 * Determines module kind from Node's nearest package boundary without
 * inheriting application tsconfig settings.
 *
 * The temporary evaluator must follow the configuration file's runtime module
 * rules, rather than unrelated compiler options from the application.
 */
async function configModule(
  configFile: string,
): Promise<"CommonJS" | "ESNext"> {
  if (path.extname(configFile) === ".mts") return "ESNext";
  if (path.extname(configFile) === ".cts") return "CommonJS";
  let directory: string = path.dirname(configFile);
  for (;;) {
    const file: string = path.join(directory, "package.json");
    if (await exists(file)) {
      const scope: IEvidenceConfigPackageScope =
        typia.json.assertParse<IEvidenceConfigPackageScope>(
          await readFile(file, "utf8"),
        );
      return scope.type === "module" ? "ESNext" : "CommonJS";
    }
    const parent: string = path.dirname(directory);
    if (parent === directory) return "CommonJS";
    directory = parent;
  }
}

/**
 * Finds the nearest reusable dependency tree so the temporary project resolves
 * the consumer's packages.
 *
 * The evaluator links this tree instead of resolving dependencies from
 * Evidence's own installation location.
 */
async function findNodeModules(start: string): Promise<string | undefined> {
  let directory: string = start;
  for (;;) {
    const candidate: string = path.join(directory, "node_modules");
    if ((await exists(candidate)) && (await stat(candidate)).isDirectory())
      return realpath(candidate);
    const parent: string = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/**
 * Places evaluator files under node_modules/.cache/evidence on the config's
 * volume.
 *
 * A dependency junction on another volume requires a local cache container so
 * the compiler can import the config through a relative path.
 */
async function tempBase(
  configFile: string,
  nodeModules: string | undefined,
): Promise<string> {
  const volume: string = path.parse(configFile).root.toLowerCase();
  let root: string =
    nodeModules ?? path.join(path.dirname(configFile), "node_modules");
  if (path.parse(root).root.toLowerCase() !== volume) {
    let ancestor: string = path.dirname(configFile);
    for (;;) {
      root = path.join(ancestor, "node_modules");
      if (
        !(await exists(root)) ||
        path.parse(await realpath(root)).root.toLowerCase() === volume
      )
        break;
      const parent: string = path.dirname(ancestor);
      if (parent === ancestor)
        throw new Error(`Cannot place the config evaluator cache on ${volume}`);
      ancestor = parent;
    }
  }
  const directory: string = path.join(root, ".cache", "evidence");
  await mkdir(directory, { recursive: true });
  return realpath(directory);
}

/**
 * Treats absent paths as false while preserving unexpected filesystem failures
 * for diagnostics.
 *
 * Callers can probe optional package and dependency boundaries without hiding
 * permission or device errors.
 */
async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (cause) {
    if (
      typia.is<NodeJS.ErrnoException>(cause) &&
      (cause.code === "ENOENT" || cause.code === "ENOTDIR")
    )
      return false;
    throw cause;
  }
}
