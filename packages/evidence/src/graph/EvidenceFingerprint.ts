import typia from "typia";
import { EvidenceInventoryIndex } from "../internal/EvidenceInventoryIndex";
import { EvidenceFingerprintIndex } from "../internal/EvidenceFingerprintIndex";
import type { IEvidenceFingerprint } from "../structures/IEvidenceFingerprint";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";

/**
 * Computes review fingerprints from reconciled semantic content.
 *
 * Review freshness must change when a declaration or its structural scope
 * changes, not when an adapter cache key, scan order, or caller-owned object
 * changes. This namespace first rebuilds the supplied inventory through the
 * normal validation boundary and delegates the versioned digest algorithm to
 * the shared index.
 *
 * @evidence contracts/common.md#principled-implementation Fingerprints are computed only after the inventory passes the normal reconciliation boundary, so cache keys, scan order and caller objects cannot change review freshness.
 * @evidence contracts/common.md#clear-and-simple-design The namespace is the public entry; the versioned algorithm lives in EvidenceFingerprintIndex.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Incomplete inventories are rejected rather than fingerprinted.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains what changes and what must not change a fingerprint.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceFingerprint {
  /**
   * Returns one unit's own digest and versioned structural-scope fingerprint.
   *
   * The result includes content accepted for review as well as the explicit
   * parent chain required to detect moves between owners. It rejects incomplete
   * inventory because a missing unit would make a stable-looking fingerprint
   * untrustworthy. The inventory is viewed with file scopes, so the unit ID of
   * a cited source file is accepted like any declaration.
   *
   * @example
   *   const fingerprint: IEvidenceFingerprint = EvidenceFingerprint.inspect(
   *     inventory,
   *     unitId,
   *   );
   *   // Persist fingerprint.value with a review of this semantic unit.
   *
   * @evidence contracts/common.md#principled-implementation The inventory is reconciled through a shape assertion and the internal inventory index with the same file scopes target resolution uses, completeness is required, and a fresh index computes the unit's digest and scope fingerprint.
   * @evidence contracts/common.md#clear-and-simple-design Reconciliation and hashing are delegated.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts An incomplete inventory throws because a missing unit would make the fingerprint untrustworthy.
   * @evidence contracts/common.md#meaningful-documentation The comment explains scope, rejection and gives an example.
   * @evidence contracts/performance.md#efficient-algorithms Linear in inventory size for reconciliation plus the cited scope's hashing.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work This one-off entry builds a fresh index; graph evaluation keeps its own memoized index for repeated reviews.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The temporary inventory and index are released when the call returns.
   */
  export function inspect(
    inventory: IEvidenceInventory,
    unitId: string,
  ): IEvidenceFingerprint {
    const snapshot: IEvidenceInventory = new EvidenceInventoryIndex(
      typia.assert([inventory]),
      {
        fileScopes: true,
      },
    ).snapshot();
    if (!snapshot.complete)
      throw new Error("Cannot fingerprint an incomplete evidence inventory.");
    return new EvidenceFingerprintIndex(snapshot).inspect(unitId);
  }
}
