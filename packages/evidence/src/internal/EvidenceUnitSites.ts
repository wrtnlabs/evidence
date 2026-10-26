import type { IEvidenceUnit } from "../structures/IEvidenceUnit";
import type { IEvidenceUnitSite } from "../structures/IEvidenceUnitSite";

/**
 * Indexes sites while exclusively owned adapter units are assembled.
 *
 * @evidence contracts/common.md#principled-implementation An exact site-ID map per owned site array retains the first occurrence, appends missing sites in encounter order and returns prior sites for explicit content merging.
 * @evidence contracts/common.md#clear-and-simple-design A single helper owns site-ID lookup for adapter construction; each adapter retains responsibility for merging a duplicate site's content.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts The first matching site is returned without replacement, and new sites append in encounter order with an explicit copy choice.
 * @evidence contracts/common.md#meaningful-documentation Comments state exclusive construction ownership, first-site precedence and the return value used for content merging.
 * @evidence contracts/performance.md#efficient-algorithms Each site array is indexed once; each appended or duplicate site then costs expected constant-time lookup plus any requested copy.
 * @evidence contracts/performance.md#reuse-equivalent-work All declarations merging an exclusively owned unit share its site index during construction; callers never reuse this helper for mutable public output.
 * @evidence contracts/performance.md#bound-retention-and-release-resources Weak array keys release the index with its construction records; each entry retains a site already owned by that array.
 */
export class EvidenceUnitSites {
  /** Site lookup lives only as long as the exclusively owned construction array. */
  private static readonly indexes: WeakMap<
    IEvidenceUnitSite[],
    Map<string, IEvidenceUnitSite>
  > = new WeakMap();

  /**
   * Appends a missing site, or returns the first matching site for content
   * merging.
   *
   * @evidence contracts/common.md#principled-implementation An exact site-ID map per owned site array retains the first occurrence, appends missing sites in encounter order and returns prior sites for explicit content merging.
   * @evidence contracts/common.md#clear-and-simple-design A single helper owns site-ID lookup for adapter construction; each adapter retains responsibility for merging a duplicate site's content.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts The first matching site is returned without replacement, and new sites append in encounter order with an explicit copy choice.
   * @evidence contracts/common.md#meaningful-documentation Comments state exclusive construction ownership, first-site precedence and the return value used for content merging.
   * @evidence contracts/performance.md#efficient-algorithms Each site array is indexed once; each appended or duplicate site then costs expected constant-time lookup plus any requested copy.
   * @evidence contracts/performance.md#reuse-equivalent-work All declarations merging an exclusively owned unit share its site index during construction; callers never reuse this helper for mutable public output.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Weak array keys release the index with its construction records; each entry retains a site already owned by that array.
   */
  public static append(
    unit: IEvidenceUnit,
    site: IEvidenceUnitSite,
    copy: boolean = true,
  ): IEvidenceUnitSite | undefined {
    let index: Map<string, IEvidenceUnitSite> | undefined = this.indexes.get(
      unit.sites,
    );
    if (index === undefined) {
      index = new Map();
      for (const previous of unit.sites)
        if (!index.has(previous.id)) index.set(previous.id, previous);
      this.indexes.set(unit.sites, index);
    }
    const previous: IEvidenceUnitSite | undefined = index.get(site.id);
    if (previous !== undefined) return previous;
    const captured: IEvidenceUnitSite = copy ? structuredClone(site) : site;
    unit.sites.push(captured);
    index.set(captured.id, captured);
    return undefined;
  }
}
