import type { IEvidenceDatabaseClaim } from "./IEvidenceDatabaseClaim";
import type { IEvidenceDelimitedClaim } from "./IEvidenceDelimitedClaim";
import type { IEvidenceMarkdownClaim } from "./IEvidenceMarkdownClaim";
import type { IEvidenceProgrammingClaim } from "./IEvidenceProgrammingClaim";
import type { IEvidenceSwaggerClaim } from "./IEvidenceSwaggerClaim";

/**
 * Artifact-specific populations that owe evidence to configured references.
 *
 * The type discriminator chooses extraction and host rules for code, schemas,
 * Markdown, API operations, or ledger rows. Each claim retains its own policy
 * and reference boundaries even when another claim selects the same physical
 * files.
 *
 * @evidence contracts/common.md#principled-implementation A union discriminated by type selects extraction and host rules for each artifact family.
 * @evidence contracts/common.md#clear-and-simple-design Family interfaces own their selectors; the union only lets configuration accept any of them.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts No family is special-cased; each claim keeps its own policy even when files overlap.
 * @evidence contracts/common.md#meaningful-documentation The comment explains the discriminator and the independence of claim boundaries.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export type IEvidenceClaim =
  | IEvidenceDatabaseClaim
  | IEvidenceDelimitedClaim
  | IEvidenceMarkdownClaim
  | IEvidenceProgrammingClaim
  | IEvidenceSwaggerClaim;
