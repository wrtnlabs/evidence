import type { IEvidenceDetachedHostBinding } from "../structures/IEvidenceDetachedHostBinding";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
import type { IEvidenceDetachedOwner } from "./IEvidenceDetachedOwner";

/**
 * Prepared Markdown evidence and its links to original claim units.
 *
 * The inventory retains its own source positions while bindings carry semantic
 * ownership into graph evaluation.
 *
 * @evidence contracts/common.md#principled-implementation Separate inventory and binding records preserve both physical positions and semantic claim ownership.
 * @evidence contracts/common.md#clear-and-simple-design The result contains the inventory, semantic bindings, and H1 owner outcomes needed for cross-claim validation.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Neither output substitutes Markdown units for original claim units.
 * @evidence contracts/common.md#meaningful-documentation The comment explains the distinct roles of the two fields.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceDetachedSelection {
  /** Parsed Markdown sources and eligible statements. */
  inventory: IEvidenceInventory;

  /** Eligible physical carrier links to selected claim units. */
  bindings: IEvidenceDetachedHostBinding[];

  /** H1 outcomes retained until all claims can confirm or reject ownership. */
  owners: IEvidenceDetachedOwner[];
}
