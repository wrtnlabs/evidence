/**
 * Propagates each newly known export name once along its reverse star edges.
 *
 * @evidence contracts/common.md#principled-implementation A FIFO delta worklist adds allowed names to subscribers until the monotone export-name sets reach their fixed point.
 * @evidence contracts/common.md#clear-and-simple-design Languages define edges and name eligibility; this helper only propagates names.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Cycles terminate because each source/name pair enters the queue once.
 * @evidence contracts/common.md#meaningful-documentation The comment states the delta and fixed-point behavior.
 * @evidence contracts/performance.md#efficient-algorithms O(V+K+P) for modules, known names and name-edge propagation, without repeated whole-graph passes.
 * @evidence contracts/performance.md#reuse-equivalent-work Already known names never trigger equivalent propagation again.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The local queue contains at most one entry per discovered source/name pair and is released on return.
 */
export function propagateEvidenceNames(
  names: Map<string, Set<string>>,
  subscribers: Map<string, Set<string>>,
  allowed: (name: string) => boolean,
): void {
  const pending: Array<readonly [string, string]> = [];
  for (const [source, entries] of names)
    for (const name of entries) pending.push([source, name]);
  for (let head: number = 0; head < pending.length; ++head) {
    const entry: readonly [string, string] | undefined = pending[head];
    if (entry === undefined || !allowed(entry[1])) continue;
    for (const source of subscribers.get(entry[0]) ?? []) {
      const entries: Set<string> | undefined = names.get(source);
      if (entries === undefined || entries.has(entry[1])) continue;
      entries.add(entry[1]);
      pending.push([source, entry[1]]);
    }
  }
}
