import type { IEvidenceDatabaseReference } from "./IEvidenceDatabaseReference";
import type { IEvidenceDelimitedReference } from "./IEvidenceDelimitedReference";
import type { IEvidenceMarkdownReference } from "./IEvidenceMarkdownReference";
import type { IEvidenceProgrammingReference } from "./IEvidenceProgrammingReference";
import type { IEvidenceSwaggerReference } from "./IEvidenceSwaggerReference";

/**
 * Artifact-specific evidence populations required by an owning claim.
 *
 * Each entry supplies its own selection, target grammar, and effective policy.
 * Repeated entries are independent obligations rather than a union that allows
 * coverage accepted in one reference to satisfy another automatically.
 *
 * @evidence contracts/common.md#principled-implementation A union discriminated by type selects the reference family's extraction and target rules.
 * @evidence contracts/common.md#clear-and-simple-design Family interfaces own their fields; the union only enumerates them.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Every claim may reference any family; no pairing is special-cased.
 * @evidence contracts/common.md#meaningful-documentation The comment explains the discriminator.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export type IEvidenceReference =
  | IEvidenceDatabaseReference
  | IEvidenceDelimitedReference
  | IEvidenceMarkdownReference
  | IEvidenceProgrammingReference
  | IEvidenceSwaggerReference;
