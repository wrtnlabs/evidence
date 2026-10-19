import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import typia from "typia";
import type { IValidation } from "typia";

import { createEvidenceConfigPlan } from "../internal/createEvidenceConfigPlan";
import { EvidenceConfigFormat } from "../internal/EvidenceConfigFormat";
import { EvidenceArtifactTypes } from "../internal/EvidenceArtifactTypes";
import { evaluateTypeScriptConfig } from "../internal/evaluateTypeScriptConfig";
import { validateEvidenceConfig } from "../internal/validateEvidenceConfig";
import type { IEvidenceConfig } from "../structures/IEvidenceConfig";
import type { IEvidenceConfigPlan } from "../structures/IEvidenceConfigPlan";

/**
 * Loads and validates Evidence configuration before artifact I/O begins.
 *
 * JSON is read as data; TypeScript is evaluated through the consumer's ttsx
 * with output isolated from report stdout. Validation covers disabled
 * declarations too. Call load to retain authored configuration or plan to
 * resolve inherited policy and remove inactive populations before source
 * discovery.
 *
 * @example
 *   const plan: IEvidenceConfigPlan = await EvidenceConfigLoader.plan(
 *     "./config/evidence.config.ts",
 *   );
 *   // Population roots are anchored to the resolved configuration file.
 *
 * @evidence contracts/common.md#principled-implementation Configuration is located by explicit path or absence-only discovery, read as JSON data or evaluated in an isolated TypeScript process, then validated with typia and the full configuration validator before any artifact I/O.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns locating and loading; evaluation, planning and validation are separate modules, and private helpers handle resolution and error messages.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Only an absent directory entry permits fallback; broken links, directories and access errors fail instead of selecting another configuration.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains both entry points with an example; every function and helper is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceConfigLoader {
  /**
   * Loads authored configuration and validates every claim and reference.
   *
   * JSON data and TypeScript default exports share artifact and shape
   * validation. Evaluation output goes to stderr, and failures reject rather
   * than returning partially validated configuration. Inactive declarations are
   * still checked. Omission discovers evidence.config.ts before
   * evidence.config.json, falling back only when the TS entry is absent.
   * Explicit paths select exactly one file.
   *
   * @param file Configuration path, relative to the current working directory.
   * @evidence contracts/common.md#principled-implementation The file is located, evaluated by its format, shape-checked with typia, and validated including disabled entries.
   * @evidence contracts/common.md#clear-and-simple-design Load composes locate, evaluation and validation without planning.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Failures reject instead of returning partially validated configuration.
   * @evidence contracts/common.md#meaningful-documentation The comment explains discovery, output routing and validation of inactive entries.
   * @evidence contracts/performance.md#efficient-algorithms Cost is dominated by TypeScript evaluation in a child process for .ts files; JSON is parsed once.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each load re-evaluates so edits are observed; watch depends on that freshness.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The evaluator child process ends before load returns; no handle is retained.
   */
  export async function load(file?: string): Promise<IEvidenceConfig> {
    const filename: string = await locate(file);
    const config = await evaluateResolvedConfig(filename);
    validateEvidenceConfig(config, filename);
    return config;
  }

  /**
   * Loads configuration into a plan with resolved policy and selector defaults.
   *
   * Validation precedes filtering, so malformed disabled settings still fail.
   * Disabled and off populations are omitted before artifact I/O while active
   * entries retain their authored indices and configuration-relative roots.
   * Omission uses the same absence-only TS-to-JSON discovery as load.
   *
   * @evidence contracts/common.md#principled-implementation The same located and evaluated configuration is turned into a plan with resolved severities and symbol defaults.
   * @evidence contracts/common.md#clear-and-simple-design Plan delegates validation and filtering to createEvidenceConfigPlan.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Validation precedes filtering, so malformed disabled settings still fail.
   * @evidence contracts/common.md#meaningful-documentation The comment explains filtering, index retention and discovery.
   * @evidence contracts/performance.md#efficient-algorithms Same cost as load plus linear planning.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each plan reflects the current file contents.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The evaluator child process ends before plan returns.
   */
  export async function plan(file?: string): Promise<IEvidenceConfigPlan> {
    const filename: string = await locate(file);
    return createEvidenceConfigPlan(
      await evaluateResolvedConfig(filename),
      filename,
    );
  }

  /**
   * Selects and resolves an explicit path or conventional configuration file.
   *
   * Omission checks evidence.config.ts before evidence.config.json in cwd. Only
   * an absent directory entry permits fallback: broken symlinks, directories,
   * access failures and selected-file errors remain failures. Explicit paths
   * never fall back. Both spellings retain format validation.
   *
   * @evidence contracts/common.md#principled-implementation An explicit path is resolved directly; otherwise lstat checks evidence.config.ts then evidence.config.json, continuing only on ENOENT, and the chosen file is resolved to a supported physical file.
   * @evidence contracts/common.md#clear-and-simple-design Path resolution and format checks are a private helper shared by both branches.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Explicit paths never fall back, and broken symlinks or directories fail.
   * @evidence contracts/common.md#meaningful-documentation The comment and inline comment explain the absence-only fallback.
   * @evidence contracts/performance.md#efficient-algorithms At most two lstat calls plus one realpath and stat.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Location must observe the current directory state.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Only a path string is returned; nothing is held.
   */
  export async function locate(
    file?: string,
    cwd: string = process.cwd(),
  ): Promise<string> {
    if (file !== undefined) return resolveConfigFile(resolve(cwd, file));
    const candidates: string[] = ["evidence.config.ts", "evidence.config.json"];
    for (const candidate of candidates) {
      const filename: string = resolve(cwd, candidate);
      // lstat distinguishes an absent entry from a symlink whose target is gone.
      // Once an entry exists, its resolution failure cannot select another policy.
      try {
        await lstat(filename);
      } catch (cause: unknown) {
        if (
          cause instanceof Error &&
          "code" in cause &&
          cause.code === "ENOENT"
        )
          continue;
        throw cause;
      }
      return resolveConfigFile(filename);
    }
    throw new Error(
      `No Evidence configuration found in ${resolve(cwd)}. Expected evidence.config.ts or evidence.config.json.`,
    );
  }
}

/**
 * Resolves a supported configuration path to an existing physical file.
 *
 * Both logical and resolved spellings must use a supported format. Evaluation
 * follows the resolved filename, and a symlink to an unsupported target is
 * rejected.
 */
async function resolveConfigFile(file: string): Promise<string> {
  EvidenceConfigFormat.get(file);
  const filename = await realpath(resolve(file));
  EvidenceConfigFormat.get(filename);
  if (!(await stat(filename)).isFile())
    throw new Error(`Evidence configuration must be a file: ${filename}`);
  return filename;
}

/**
 * Evaluates an already resolved file and validates its configuration shape.
 *
 * Artifact identifiers receive a focused certification diagnostic before the
 * generated shape validator handles the remaining contract. JSON BOM removal
 * permits ordinary UTF-8 files without treating their strings as executable
 * imports.
 */
async function evaluateResolvedConfig(
  filename: string,
): Promise<IEvidenceConfig> {
  const value: unknown =
    EvidenceConfigFormat.get(filename) === "json"
      ? JSON.parse((await readFile(filename, "utf8")).replace(/^\uFEFF/u, ""))
      : await evaluateTypeScriptConfig(filename);
  validateArtifactTypes(value);
  const validation: IValidation<IEvidenceConfig> =
    typia.validate<IEvidenceConfig>(value);
  if (validation.success === false)
    throw new Error(validation.errors.map(configurationShapeError).join("\n"));
  return validation.data;
}

/**
 * Attributes unsupported artifact identifiers to exact claim/reference paths.
 *
 * This preflight only traverses recognizable containers. General malformed
 * shapes remain the generated validator's responsibility rather than being
 * accepted here.
 */
function validateArtifactTypes(value: unknown): void {
  if (!isRecord(value)) return;
  const claims = unknownArray(value["claims"]);
  if (claims === undefined) return;
  claims.forEach((claim, claimIndex) => {
    if (!isRecord(claim)) return;
    validateArtifactType(claim["type"], `claims[${claimIndex}].type`);
    const references = unknownArray(claim["reference"]);
    if (references !== undefined)
      references.forEach((reference, referenceIndex) => {
        if (isRecord(reference))
          validateArtifactType(
            reference["type"],
            `claims[${claimIndex}].reference[${referenceIndex}].type`,
          );
      });
    else if (isRecord(claim["reference"]))
      validateArtifactType(
        claim["reference"]["type"],
        `claims[${claimIndex}].reference.type`,
      );
  });
}

/**
 * Rejects a string discriminator with no shipped certified adapter.
 *
 * Non-string values are left for shape validation so this check reports only
 * the artifact-availability problem it can diagnose with a precise
 * configuration path.
 */
function validateArtifactType(value: unknown, path: string): void {
  if (typeof value !== "string" || EvidenceArtifactTypes.isSupported(value))
    return;
  throw new Error(
    `Invalid Evidence configuration at ${path}: artifact type '${value}' has no certified Evidence adapter. Supported types: ${EvidenceArtifactTypes.supported().join(", ")}.`,
  );
}

/**
 * Narrows a value enough to inspect named configuration fields during
 * preflight.
 *
 * This only establishes safe object access; full shape validity is checked by
 * typia.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Exposes array entries for artifact preflight without assuming their element
 * shape.
 *
 * Non-arrays return undefined so single-reference handling or shape validation
 * can decide the appropriate interpretation.
 */
function unknownArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/**
 * Converts each generated shape-validation error into an author-facing
 * configuration message.
 *
 * The message removes the validator's synthetic root name and distinguishes a
 * missing value from a wrong type without serializing arbitrary configuration
 * data.
 */
function configurationShapeError(error: IValidation.IError): string {
  const path: string = error.path.replace(/^\$input\.?/u, "");
  const location: string = path === "" ? "configuration" : path;
  const received: string =
    error.value === undefined
      ? "the value is missing"
      : "the value has another type";
  return `Invalid Evidence configuration at ${location}: expected ${error.expected}; ${received}.`;
}
