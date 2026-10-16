import type { EvidenceSeverity } from "../typings/EvidenceSeverity";
import type { IEvidenceDetachedHostBinding } from "./IEvidenceDetachedHostBinding";
import type { IEvidenceGraphReference } from "./IEvidenceGraphReference";
import type { IEvidenceInventory } from "./IEvidenceInventory";

/**
 * A materialized claim's semantic hosts and independent evidence requirements.
 *
 * The inventory supplies physical declarations and annotations; `unitIds`
 * selects the semantic hosts that participate. Reference entries supply their
 * own target inventories, selectors, and policies. Shared source files or
 * labels do not combine the coverage owed by different claims.
 *
 * Exclusion carrier restrictions narrow eligible positions within this claim.
 * They do not create hosts or widen the claim's selected population.
 *
 * @evidence contracts/common.md#principled-implementation A materialized inventory, selected host IDs and independent references form the evaluator's claim input.
 * @evidence contracts/common.md#clear-and-simple-design Inventory and host selection are separate fields; references carry their own inventories and policies.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Carrier restrictions narrow positions without creating hosts or widening the population.
 * @evidence contracts/common.md#meaningful-documentation The comment explains selection and independence; each field documents omission and effect.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceGraphClaim {
  /**
   * Original zero-based position in the configuration's claim array.
   *
   * Omission uses this record's array position for direct graph callers.
   * Explicit indices preserve attribution after the checker filters inactive
   * claims.
   */
  index?: number;

  /**
   * Optional human-readable label for claim diagnostics.
   *
   * Labels do not participate in identity. Two claims with equal names still
   * retain independent hosts, references, and coverage findings.
   */
  name?: string;

  /**
   * Effective claim severity, including the inactive off state.
   *
   * An off claim skips reference evaluation. Active claims attach this level to
   * findings originating from their own inventory and host participation.
   */
  severity: EvidenceSeverity;

  /**
   * Captured declaration and documentation inventory for the claim.
   *
   * Evaluation reconciles its records and validates ownership before selecting
   * hosts. Incompleteness prevents its references from producing a coverage
   * pass.
   */
  inventory: IEvidenceInventory;

  /**
   * Semantic identities selected as evidence hosts.
   *
   * Eligible hosts without tags remain part of this population, allowing zero
   * acknowledgements to fail cardinality and checklist policies.
   */
  unitIds: string[];

  /** Markdown carriers whose statements belong to selected original units. */
  detachedHostBindings?: IEvidenceDetachedHostBinding[];

  /**
   * Carrier IDs permitted to write exclusions for this claim.
   *
   * Omission permits every otherwise eligible attached public host. An explicit
   * selection restricts carriers without granting attachment to an invalid
   * host.
   */
  exclusionHostIds?: string[];

  /**
   * Target populations this claim must acknowledge independently.
   *
   * Repeated selections retain separate policies and diagnostic boundaries. An
   * acknowledgement accepted by one reference may still be refused by another.
   */
  references: IEvidenceGraphReference[];
}
