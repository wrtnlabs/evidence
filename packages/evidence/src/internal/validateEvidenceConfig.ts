import { resolve } from "node:path";

import { EvidenceLanguageRegistry } from "../parsers/EvidenceLanguageRegistry";

import type { IEvidenceConfig } from "../structures/IEvidenceConfig";
import type { IEvidenceReference } from "../structures/IEvidenceReference";
import { EvidenceArtifactTypes } from "./EvidenceArtifactTypes";
import { EvidenceFileGlob } from "./EvidenceFileGlob";
import { EvidenceSourcePath } from "./EvidenceSourcePath";
import { EvidenceSwaggerRemoteReader } from "../adapters/swagger/EvidenceSwaggerRemoteReader";

/**
 * Collects all configuration contract violations before plan construction.
 *
 * Validation does not stop at the first error so users can repair related
 * population policy mistakes together, including entries later disabled by
 * severity.
 */
export function validateEvidenceConfig(
  config: IEvidenceConfig,
  configFile: string = resolve("evidence.config.ts"),
): void {
  const problems: string[] = [];
  if (config.claims.length === 0)
    problems.push(
      "claims: at least one claim is required; an empty graph cannot establish evidence coverage.",
    );
  for (const key of ["limit", "unit"] as const) {
    const value: number | undefined = config.report?.[key];
    if (value !== undefined && !(Number.isInteger(value) && value >= 1))
      problems.push(
        `report.${key}: expected a positive integer, received ${String(value)}.`,
      );
  }
  config.claims.forEach((claim, claimIndex) => {
    const claimPath = `claims[${claimIndex}]`;
    validateArtifactType(problems, `${claimPath}.type`, claim.type);
    validateRoot(problems, `${claimPath}.root`, configFile, claim.root);
    validateGlobs(problems, `${claimPath}.files`, claim.files);
    validateSymbols(problems, `${claimPath}.symbol`, claim.symbol, claim.type);
    if (claim.evidenceExcludeCarriers !== undefined)
      validateGlobs(
        problems,
        `${claimPath}.evidenceExcludeCarriers`,
        claim.evidenceExcludeCarriers,
      );

    const references: IEvidenceReference[] = Array.isArray(claim.reference)
      ? claim.reference
      : [claim.reference];
    if (references.length === 0)
      problems.push(
        `${claimPath}.reference: an empty array creates no coverage obligation; provide at least one evidence reference.`,
      );
    references.forEach((reference, referenceIndex) => {
      const base = Array.isArray(claim.reference)
        ? `${claimPath}.reference[${referenceIndex}]`
        : `${claimPath}.reference`;
      validateArtifactType(problems, `${base}.type`, reference.type);
      validateRoot(problems, `${base}.root`, configFile, reference.root);
      validateSymbols(
        problems,
        `${base}.symbol`,
        reference.symbol,
        reference.type,
      );
      if (reference.type === "swagger")
        validateSwaggerSource(problems, `${base}.file`, reference.file);
      else validateGlobs(problems, `${base}.files`, reference.files);

      if (reference.type !== "markdown" && "checklist" in reference)
        problems.push(
          `${base}.checklist: only a Markdown reference can be a checklist; a ${reference.type} population has no Markdown reading hierarchy.`,
        );
      if (reference.type !== "markdown" || reference.checklist !== true) return;
      if (reference.uniqueEvidence === true)
        problems.push(
          `${base}: checklist and uniqueEvidence cannot both hold; a checklist requires every host to answer every item while uniqueEvidence permits at most one host per item.`,
        );
      if (reference.singleEvidencePerSymbol === true)
        problems.push(
          `${base}: checklist and singleEvidencePerSymbol cannot both hold; a checklist requires every item while singleEvidencePerSymbol requires exactly one item per host.`,
        );
      if (
        (claim.evidenceExcludeCarriers?.length ?? 0) !== 0 &&
        reference.noEvidenceExclude !== true
      )
        problems.push(
          `${claimPath}.evidenceExcludeCarriers: ${base} makes every acknowledgement one host's own answer, so it cannot gather checklist exclusions into shared carriers. Drop the carriers, drop checklist, or set noEvidenceExclude on that reference.`,
        );
    });
  });
  if (problems.length !== 0)
    throw new Error(
      [
        "Invalid Evidence Graph configuration:",
        ...problems.map((item) => `- ${item}`),
      ].join("\n"),
    );
}

/**
 * Requires each configured artifact type to have a complete certified adapter.
 *
 * Configuration validation uses the registry-backed artifact list rather than
 * accepting a parser grammar that cannot produce a supported Evidence
 * inventory.
 */
function validateArtifactType(
  problems: string[],
  path: string,
  type: string,
): void {
  if (EvidenceArtifactTypes.isSupported(type)) return;
  problems.push(
    `${path}: artifact type '${type}' has no certified Evidence adapter. Supported types: ${EvidenceArtifactTypes.supported().join(", ")}.`,
  );
}

/**
 * Validates file selection through the restricted matcher used by discovery.
 *
 * Constructing EvidenceFileGlob checks every configured pattern before plan
 * construction, and this helper accumulates its message with the owning
 * configuration path.
 */
function validateGlobs(
  problems: string[],
  path: string,
  patterns: string[],
): void {
  try {
    new EvidenceFileGlob(patterns);
  } catch (cause) {
    problems.push(`${path}: ${message(cause)}`);
  }
}

/**
 * Validates configured root spelling without requiring the directory to exist.
 *
 * EvidenceSourcePath.root performs the same lexical resolution used by loading,
 * allowing a valid future directory while rejecting unsafe or invalid root
 * expressions.
 */
function validateRoot(
  problems: string[],
  path: string,
  configFile: string,
  root: string | undefined,
): void {
  if (root === undefined) return;
  try {
    EvidenceSourcePath.root(configFile, root);
  } catch (cause) {
    problems.push(`${path}: ${message(cause)}`);
  }
}

/**
 * Checks explicit symbol selections when a language adapter supplies a
 * supported set.
 *
 * Empty arrays select no units, while named selections must match the adapter's
 * published symbols; artifact types without symbol metadata remain
 * unrestricted.
 */
function validateSymbols(
  problems: string[],
  path: string,
  symbol: string | string[] | undefined,
  type: string,
): void {
  if (Array.isArray(symbol) && symbol.length === 0)
    problems.push(
      `${path}: an empty symbol array selects no evidence units or declaration hosts.`,
    );
  const supported = EvidenceLanguageRegistry.list().find(
    (language) => language.type === type,
  )?.adapter?.symbols;
  if (supported === undefined || symbol === undefined) return;
  for (const selected of Array.isArray(symbol) ? symbol : [symbol])
    if (!supported.some((candidate) => candidate === selected))
      problems.push(
        `${path}: '${type}' does not support '${selected}'; select ${supported.join(", ")}.`,
      );
}

/**
 * Requires one exact local or supported remote Swagger document source.
 *
 * Remote URLs are accepted only through EvidenceSwaggerRemoteReader; local
 * spellings are resolved and rejected when they name a directory-like location
 * rather than a file.
 */
function validateSwaggerSource(
  problems: string[],
  path: string,
  file: string,
): void {
  try {
    if (file === "" || file.trim() !== file)
      throw new Error("A Swagger source must not be empty or padded.");
    if (EvidenceSwaggerRemoteReader.parse(file) !== undefined) return;
    EvidenceSourcePath.resolve(".", file);
    const normalized = file.replaceAll("\\", "/");
    if (
      normalized.endsWith("/") ||
      normalized === "." ||
      normalized === ".." ||
      normalized === "/" ||
      normalized.endsWith("/..") ||
      /^[A-Za-z]:$/u.test(normalized)
    )
      throw new Error(
        "A Swagger reference names one exact document, not a directory.",
      );
  } catch (cause) {
    problems.push(`${path}: ${message(cause)}`);
  }
}

/**
 * Converts validation helper failures into stable user-facing problem text.
 *
 * Each validator appends this normalized message to the aggregate error so one
 * malformed value does not prevent reporting the remaining configuration
 * issues.
 */
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
