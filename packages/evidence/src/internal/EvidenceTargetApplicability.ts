import { EvidenceTargetFileIndex } from "./EvidenceTargetFileIndex";
import path from "node:path";

import { EvidenceFileTarget } from "../targets/EvidenceFileTarget";
import { EvidenceLanguageRegistry } from "../parsers/EvidenceLanguageRegistry";
import type { IEvidenceAddress } from "../structures/IEvidenceAddress";
import type { IEvidenceHost } from "../structures/IEvidenceHost";
import type { IEvidenceTargetStatement } from "../structures/IEvidenceTargetStatement";
import type { EvidenceDatabaseType } from "../typings/EvidenceDatabaseType";
import type { EvidenceProgrammingType } from "../typings/EvidenceProgrammingType";
import type { IEvidenceMaterializedReference } from "./IEvidenceMaterializedReference";
import { EvidenceMarkdownTarget } from "../adapters/markdown/EvidenceMarkdownTarget";

/**
 * Chooses reference populations that can interpret an authored target.
 *
 * The scoring is conservative: when no grammar signal distinguishes references,
 * the declaration remains available to all of them rather than losing a valid
 * acknowledgement.
 *
 * @evidence contracts/common.md#principled-implementation Targets are routed to references by conservative affinity scores so an ambiguous token stays available to every viable reference.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns only applicability; parsing and resolution remain with each reference.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Without a decisive signal the declaration is kept for all references rather than dropped.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains the conservative rule; private helpers are documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidence contracts/performance.md#reuse-equivalent-work The registry-backed type set is a module constant computed once and shared by every selection.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The only retained state is the small immutable set of registry type names, held for the process.
 */
export namespace EvidenceTargetApplicability {
  /**
   * Selects the highest-affinity references while preserving configuration
   * order.
   *
   * A tag is retained for every tied viable population when syntax cannot
   * distinguish the intended reference artifact.
   *
   * @evidence contracts/common.md#principled-implementation Prisma and Swagger spellings route directly; otherwise exact inventory files score 3, recognized grammars 2, weak Markdown names or a single reference 1, and the highest decisive score wins.
   * @evidence contracts/common.md#clear-and-simple-design Scoring helpers are private; select only compares scores and keeps configuration order.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Ties keep every viable reference instead of guessing one.
   * @evidence contracts/common.md#meaningful-documentation The comment explains tie retention.
   * @evidence contracts/performance.md#efficient-algorithms Cost is O(R) per statement after indexing A source addresses once per immutable inventory in the supplied session; the registry-backed type set is computed once at module load, so scoring clones no catalog.
   * @evidence contracts/performance.md#reuse-equivalent-work Only selected file membership is shared within the optional caller-owned session; statement and host scoring remains independent.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Selection keeps no state after returning; its result is owned by the caller.
   */
  export function select(
    statement: IEvidenceTargetStatement,
    host: IEvidenceHost,
    references: IEvidenceMaterializedReference[],
    indexes: EvidenceTargetFileIndex = new EvidenceTargetFileIndex(),
  ): IEvidenceMaterializedReference[] {
    if (statement.target.startsWith("prisma:"))
      return references.filter(
        (entry) => entry.plan.population.type === "prisma",
      );
    if (swaggerLike(statement.target))
      return references.filter(
        (entry) => entry.plan.population.type === "swagger",
      );

    const scores = references.map((reference) => ({
      reference,
      score: affinity(statement.target, host, reference, indexes),
    }));
    const maximum = Math.max(0, ...scores.map((entry) => entry.score));
    if (maximum > 1)
      return scores
        .filter((entry) => entry.score === maximum)
        .map((entry) => entry.reference);
    if (references.length === 1) return [...references];

    const positive = scores
      .filter((entry) => entry.score > 0)
      .map((entry) => entry.reference);
    return positive.length === 0 ? [...references] : positive;
  }
}

/**
 * Scores a target by exact inventory file, recognizable grammar, and artifact
 * spelling.
 *
 * Selection compares these scores to narrow an ambiguous target only when the
 * available source evidence is decisive.
 */
function affinity(
  target: string,
  host: IEvidenceHost,
  reference: IEvidenceMaterializedReference,
  indexes: EvidenceTargetFileIndex,
): number {
  const type = reference.plan.population.type;
  if (type === "prisma" || type === "swagger") return 0;
  if (type === "markdown") {
    let file: string;
    try {
      file = EvidenceMarkdownTarget.parse(target).file;
    } catch {
      return 0;
    }
    const exact: boolean = indexes.markdown(reference.inventory).has(file);
    return exact ? 3 : markdownLike(file) ? 2 : 1;
  }

  const parsed = parseFileTargets(target, host);
  if (parsed.length !== 0) {
    const files: ReadonlySet<string> = indexes.absolute(reference.inventory);
    const exact: boolean = parsed.some((address: IEvidenceAddress): boolean =>
      files.has(EvidenceFileTarget.normalize(address.file)),
    );
    if (exact) return 3;
  }
  return isParsedType(type) && recognizes(type, targetFile(target)) ? 2 : 0;
}

/**
 * Parses against every retained host origin because a physical host can have
 * several logical paths.
 *
 * An exact source address may be reachable through multiple configured
 * spellings, each of which can make a target applicable.
 */
function parseFileTargets(
  target: string,
  host: IEvidenceHost,
): IEvidenceAddress[] {
  const output: IEvidenceAddress[] = [];
  for (const origin of host.origins ?? [host.file])
    try {
      output.push(EvidenceFileTarget.parse(target, origin));
    } catch {
      continue;
    }
  return output;
}

/**
 * Checks registry recognition without leaking parser-selection failures into
 * affinity scoring.
 *
 * Affinity treats an unrecognized grammar spelling as no signal while adapter
 * analysis reports actual parser failures elsewhere.
 */
function recognizes(
  type: EvidenceProgrammingType | EvidenceDatabaseType,
  file: string,
): boolean {
  try {
    EvidenceLanguageRegistry.select(type, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Narrows types backed by the language registry, excluding document artifacts
 * with separate target grammars.
 *
 * The registry lookup is valid only for programming and database artifact
 * types.
 */
function isParsedType(
  type: string,
): type is EvidenceProgrammingType | EvidenceDatabaseType {
  return PARSED_TYPES.has(type);
}

/**
 * Programming and database artifact types backed by registry grammars.
 *
 * Computed once at module load so per-statement affinity scoring does not clone
 * the language catalogs for every reference it compares.
 */
const PARSED_TYPES: ReadonlySet<string> = new Set(
  [
    ...EvidenceLanguageRegistry.list(),
    ...EvidenceLanguageRegistry.databases(),
  ].map((entry): string => entry.type),
);

/**
 * Extracts a decodable file portion while retaining a harmless basename for
 * malformed escapes.
 *
 * Target affinity must not throw while inspecting incomplete authored text,
 * because ordinary target parsing owns that diagnostic.
 */
function targetFile(target: string): string {
  const hash = target.indexOf("#");
  const encoded = hash < 0 ? target : target.slice(0, hash);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return path.basename(encoded);
  }
}

/**
 * Identifies conventional Markdown names when no exact selected source is
 * known.
 *
 * This supplies a weak affinity signal for Markdown references without claiming
 * that the file exists in their inventory.
 */
function markdownLike(file: string): boolean {
  return /\.(?:md|markdown|mdx)$/iu.test(file);
}

/**
 * Recognizes API operation spelling before a Swagger reference can parse it.
 *
 * The cheap lexical check avoids assigning Swagger affinity to ordinary
 * path-like targets.
 */
function swaggerLike(target: string): boolean {
  const match = /^([^:\s/]+):\//u.exec(target);
  const method = match?.[1];
  return (
    (method !== undefined && !/^[A-Za-z]$/u.test(method)) ||
    /^(?:GET|PUT|POST|DELETE|OPTIONS|HEAD|PATCH|TRACE)(?::|\s)/iu.test(target)
  );
}
