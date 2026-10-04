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
