/**
 * Captures mutable public ID arrays while reusing an unchanged selection
 * snapshot.
 *
 * @evidence contracts/common.md#principled-implementation A weak identity map compares current IDs with copied values before reusing the immutable array passed to internal indexes.
 * @evidence contracts/common.md#clear-and-simple-design One weak map owns immutable ID copies at the public boundary, leaving internal scope caching independent of mutable caller arrays.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Selection reuse compares every current value, including length and order; caller array identity alone never proves an unchanged selection.
 * @evidence contracts/common.md#meaningful-documentation Comments state mutable caller ownership, immutable cached copies and replacement when values change.
 * @evidence contracts/performance.md#efficient-algorithms Linear comparison in selection length per public call; internal calls reuse arrays directly.
 * @evidence contracts/performance.md#reuse-equivalent-work Equal values on the same caller array reuse one snapshot; mutations replace it before index lookup.
 * @evidence contracts/performance.md#bound-retention-and-release-resources Weak entries live with caller arrays and the owning public facade.
 */
export class EvidenceSelectionSnapshot {
  /** Immutable value snapshots keyed by caller array identity. */
  private readonly entries: WeakMap<string[], string[]> = new WeakMap();

  /**
   * Captures current public selection values and reuses an unchanged immutable
   * copy.
   *
   * @evidence contracts/common.md#principled-implementation Weak array identity lookup compares every value and replaces the copied array when length or any ID changes.
   * @evidence contracts/common.md#clear-and-simple-design One weak map owns immutable ID copies at the public boundary, leaving internal scope caching independent of mutable caller arrays.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Selection reuse compares every current value, including length and order; caller array identity alone never proves an unchanged selection.
   * @evidence contracts/common.md#meaningful-documentation Comments state mutable caller ownership, immutable cached copies and replacement when values change.
   * @evidence contracts/performance.md#efficient-algorithms Linear in selection length per public call.
   * @evidence contracts/performance.md#reuse-equivalent-work Unchanged caller arrays reuse one immutable internal key; changed arrays replace that key.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The facade owns weak entries which disappear with their caller array keys.
   */
  public capture(ids: string[]): string[] {
    let snapshot: string[] | undefined = this.entries.get(ids);
    if (
      snapshot === undefined ||
      snapshot.length !== ids.length ||
      !snapshot.every(
        (id: string, position: number): boolean => id === ids[position],
      )
    ) {
      snapshot = [...ids];
      this.entries.set(ids, snapshot);
    }
    return snapshot;
  }
}
