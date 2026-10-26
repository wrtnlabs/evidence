import { EvidenceFingerprintIndex } from "../../internal/EvidenceFingerprintIndex";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";

/**
 * Keeps PostgreSQL COMMENT metadata out of declaration content fingerprints.
 *
 * COMMENT sites remain materialized for annotation ownership, while schema
 * content review must remain stable when only its review metadata changes.
 *
 * @evidence contracts/common.md#principled-implementation Content digests are recomputed from a structural view without COMMENT sites, so editing review metadata through COMMENT does not change schema fingerprints.
 * @evidence contracts/common.md#clear-and-simple-design The namespace only adjusts digests; COMMENT sites remain for annotation ownership.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Declaration relationships are preserved so only COMMENT content is excluded.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains why COMMENT is excluded.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidencePostgresqlFingerprint {
  /**
   * Recomputes affected content digests from DDL sites alone.
   *
   * The structural inventory view removes only COMMENT sites before indexing,
   * preserving all declaration relationships used to derive the original
   * fingerprint.
   *
   * @evidence contracts/common.md#principled-implementation A structural view without COMMENT sites is indexed and each affected unit's digest is written back.
   * @evidence contracts/common.md#clear-and-simple-design It reuses EvidenceFingerprintIndex for digests.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Only COMMENT sites are removed; relationships stay intact.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the local view and retained declaration relationships.
   * @evidence contracts/performance.md#efficient-algorithms Linear in units plus one fingerprint index over the structural view.
   * @evidence contracts/performance.md#reuse-equivalent-work The index memoizes digests across units.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The view and index are discarded after digests are copied back.
   */
  export function apply(inventory: IEvidenceInventory): void {
    if (!inventory.complete) return;
    const semantic: IEvidenceInventory = {
      ...inventory,
      units: inventory.units.map((unit: IEvidenceUnit): IEvidenceUnit => ({
        ...unit,
        sites: unit.sites.filter(
          (site: IEvidenceUnitSite): boolean => !site.id.endsWith(":comment"),
        ),
      })),
    };
    const fingerprints = new EvidenceFingerprintIndex(semantic);
    for (const unit of inventory.units)
      if (unit.sites.some((site) => site.id.endsWith(":comment")))
        unit.contentDigest = fingerprints.inspect(unit.id).contentDigest;
  }
}
