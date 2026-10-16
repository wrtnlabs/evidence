import type { EvidenceSeverity } from "../typings/EvidenceSeverity";

import type { IEvidenceReference } from "./IEvidenceReference";

/**
 * Shared selection rules for declarations that carry a claim's evidence.
 *
 * A claim selects files and symbol kinds whose public declarations may host
 * acknowledgements. Its references independently select the target units those
 * hosts must answer. A host remains selected even without a tag, allowing
 * checklist and cardinality policies to detect an unanswered declaration.
 *
 * Configuration planning resolves inherited severity and artifact defaults,
 * validates disabled declarations, and omits inactive populations from loading
 * and watch. The generic parameters restrict each artifact's discriminator and
 * supported selector vocabulary without adding a separate language option.
 *
 * @example
 *   const claim: IEvidenceClaimBase<"typescript", "function"> = {
 *     type: "typescript",
 *     files: ["src/*.ts"],
 *     symbol: "function",
 *     reference: [
 *       { type: "markdown", files: ["requirements.md"] },
 *       { type: "swagger", file: "openapi.json" },
 *     ],
 *   };
 *   // Both reference populations require independent coverage.
 *
 * @evidence contracts/common.md#principled-implementation Generic type and symbol parameters restrict each family's discriminator and selector vocabulary without a separate language option.
 * @evidence contracts/common.md#clear-and-simple-design Shared selection fields live here once; family interfaces add only their own files or symbols.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Untagged hosts stay selected so checklist and cardinality policies can detect unanswered declarations.
 * @evidence contracts/common.md#meaningful-documentation The comment explains host selection, planning effects and gives an example; each field documents defaults, glob rules and inheritance.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceClaimBase<
  Type extends string,
  SymbolKind extends string,
> {
  /**
   * Artifact discriminator selecting the claim's extraction rules.
   *
   * This determines which adapter interprets public declarations and eligible
   * documentation. References can independently select another artifact
   * family.
   */
  type: Type;

  /**
   * Optional label identifying the claim in diagnostics.
   *
   * Names do not establish semantic identity or combine obligations. Two claims
   * with the same label still require independent coverage.
   */
  name?: string;

  /**
   * Overrides the root configuration's diagnostic severity.
   *
   * Omit or use `undefined` to inherit. `"off"` disables this claim and its
   * references after configuration validation, avoiding their source loading.
   */
  severity?: EvidenceSeverity | undefined;

  /**
   * Disables the claim without removing its authored configuration.
   *
   * Skip its populations, references, coverage obligations, and watched inputs.
   * Its shape is still validated so reenabling it cannot reveal ignored
   * malformed settings that were accepted only because the claim was inactive.
   *
   * @default false
   */
  disabled?: boolean;

  /**
   * Base directory for file globs.
   *
   * - Defaults to the directory containing evidence.config.ts; relative roots
   *   resolve from that directory.
   * - Accepts absolute paths, directory symlinks, and Windows junctions.
   * - Names one directory, not a glob. Windows drive-relative paths are invalid.
   */
  root?: string;

  /**
   * File globs relative to root.
   *
   * - Evaluate left to right: "!" removes matches; later positives may
   *   re-include. At least one positive pattern is required.
   * - "*" matches within one path segment, "**" crosses segments, and "?" matches
   *   one character. Both path separators are accepted; identity is
   *   case-sensitive.
   * - A bare directory does not include its children; use "src/**".
   * - Resolved patterns define watched inputs, including files outside the
   *   project.
   */
  files: string[];

  /**
   * Markdown files that may carry this claim's positive evidence separately
   * from its selected declarations.
   *
   * Paths use ordered globs rooted at the configuration file directory, even
   * when `root` selects claim sources elsewhere. Each H1 in a matched document
   * names a selected unit of a claim using that document. Its Evidence headings
   * belong to that unit, and native documentation remains eligible alongside
   * these files.
   */
  evidenceFiles?: string[];

  /**
   * Symbol kinds eligible to host evidence; accepts one kind or a nonempty
   * array.
   *
   * Omit to select every supported kind for the artifact:
   *
   * - Programming: the language's supported type, function, and property kinds.
   * - Database: model, column, relation.
   * - Markdown: file, h1, h2, h3, h4.
   * - Swagger: operation.
   *
   * This selects claim hosts; each reference selects the units they must cover.
   */
  symbol?: SymbolKind | SymbolKind[];

  /**
   * Globs restricting exclusion carriers within the claim's selected files.
   *
   * - Use the same root and glob rules as files; never widen that population.
   * - Omit to allow every eligible carrier. An exclusion outside these globs is
   *   reported and provides no coverage.
   * - Each reference may independently refuse all exclusions with
   *   noEvidenceExclude.
   * - A Markdown checklist permits these globs only with noEvidenceExclude.
   */
  evidenceExcludeCarriers?: string[];

  /**
   * One reference or a nonempty array of independent evidence requirements.
   *
   * Every claim may reference any artifact family. Each reference requires
   * complete coverage independently, including repeated entries selecting the
   * same files. An acknowledgement accepted under one policy does not bypass
   * another policy.
   */
  reference: IEvidenceReference | IEvidenceReference[];
}
