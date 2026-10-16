import type { IEvidenceConfigPlanClaim } from "../structures/IEvidenceConfigPlanClaim";
import type { IEvidenceDetachedHostBinding } from "../structures/IEvidenceDetachedHostBinding";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";

import type { IEvidenceMaterializedReference } from "./IEvidenceMaterializedReference";
import type { IEvidenceDetachedOwner } from "./IEvidenceDetachedOwner";

/**
 * One enabled claim with the inventories needed to resolve its
 * acknowledgements.
 *
 * This record belongs to a single analysis pass. It retains configuration order
 * and selected identities so later graph construction never needs to rediscover
 * files or reinterpret a mutable user configuration.
 *
 * @evidence contracts/common.md#principled-implementation A plan, extracted inventory, selected host IDs, optional carrier IDs and materialized references are what graph input construction needs per claim.
 * @evidence contracts/common.md#clear-and-simple-design Planning output and extraction output stay in separate fields.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Carrier IDs narrow eligibility only, never add hosts.
 * @evidence contracts/common.md#meaningful-documentation The comment explains the materialized stage; each field is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceMaterializedClaim {
  /**
   * Validated, enabled claim policy that owns this population's configuration
   * position.
   *
   * Later graph construction reads its effective policy without revisiting the
   * mutable configuration document that produced this analysis pass.
   */
  plan: IEvidenceConfigPlanClaim;

  /**
   * Extracted claim inventory, including contextual units outside the
   * denominator.
   *
   * Structural parents remain available for host and withdrawal decisions even
   * when only the selected units contribute claim obligations.
   */
  inventory: IEvidenceInventory;

  /**
   * Semantic identities selected by the claim, in configured selection order.
   *
   * This collection is the claim denominator and remains narrower than the
   * inventory's contextual population.
   */
  unitIds: string[];

  /** Detached Markdown carrier relations after owner resolution. */
  detachedHostBindings?: IEvidenceDetachedHostBinding[];

  /** H1 resolutions awaiting cross-claim orphan detection. */
  detachedOwners?: IEvidenceDetachedOwner[];

  /**
   * Hosts that may carry exclusions when exclusion scope differs from selected
   * units.
   *
   * Omission means the selected unit IDs also define every eligible exclusion
   * host, so graph processing needs no separate structural population.
   */
  exclusionHostIds?: string[];

  /**
   * Reference inventories evaluated against this claim in authored reference
   * order.
   *
   * The order preserves independent configuration occurrences for diagnostics
   * and query rows even when they resolve to overlapping identities.
   */
  references: IEvidenceMaterializedReference[];
}
