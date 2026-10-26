/**
 * Memoizes export results with component-local cycle context.
 *
 * @evidence contracts/common.md#principled-implementation Tarjan components isolate possible return paths; cache keys retain all active resolution pairs in the same component, preserving path-dependent cycle cutoffs.
 * @evidence contracts/common.md#clear-and-simple-design This helper owns only graph components and cache keys; language-specific export interpretation remains in its resolver.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Keys include the complete resolution pair and sorted active pairs in the same component; no path context capable of changing a cycle cutoff is discarded.
 * @evidence contracts/common.md#meaningful-documentation Comments identify component-local context, immutable module-graph ownership and path-dependent cache size.
 * @evidence contracts/performance.md#efficient-algorithms Component construction is O(V+E); keys inspect the active path, acyclic pairs share completed results across diamonds, and cyclic components retain distinct necessary path contexts.
 * @evidence contracts/performance.md#reuse-equivalent-work One immutable module graph owns component IDs and completed context-qualified results.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The resolver releases all component and result maps after publication; retained contexts are bounded by visited resolution states, including distinct paths inside cyclic components.
 */
export class EvidenceExportResolutionCache<Value> {
  /** Component identity per source in the immutable dependency graph. */
  private readonly components: Map<string, number> = new Map();

  /** Source owning each language-qualified resolution pair. */
  private readonly owners: Map<string, string> = new Map();

  /** Completed values for equivalent component-local active paths. */
  public readonly values: Map<string, Value> = new Map();

  /** Computes components once without choosing any language binding. */
  public constructor(graph: ReadonlyMap<string, ReadonlySet<string>>) {
    const indices: Map<string, number> = new Map();
    const low: Map<string, number> = new Map();
    const active: Set<string> = new Set();
    const stack: string[] = [];
    let serial: number = 0;
    let component: number = 0;
    const components: Map<string, number> = this.components;
    /** Visits one source and closes a component at its earliest active root. */
    function visit(source: string): void {
      const index: number = serial++;
      indices.set(source, index);
      low.set(source, index);
      active.add(source);
      stack.push(source);
      for (const target of graph.get(source) ?? []) {
        if (!indices.has(target)) {
          visit(target);
          low.set(
            source,
            Math.min(low.get(source) ?? index, low.get(target) ?? index),
          );
        } else if (active.has(target))
          low.set(
            source,
            Math.min(low.get(source) ?? index, indices.get(target) ?? index),
          );
      }
      if (low.get(source) !== index) return;
      for (;;) {
        const target: string | undefined = stack.pop();
        if (target === undefined)
          throw new Error("Incomplete export component stack.");
        active.delete(target);
        components.set(target, component);
        if (target === source) break;
      }
      ++component;
    }
    for (const source of graph.keys()) if (!indices.has(source)) visit(source);
  }

  /**
   * Retains precisely the active pairs that can be reached again from source.
   *
   * @evidence contracts/common.md#principled-implementation Tarjan components isolate possible return paths; cache keys retain all active resolution pairs in the same component, preserving path-dependent cycle cutoffs.
   * @evidence contracts/common.md#clear-and-simple-design This helper owns only graph components and cache keys; language-specific export interpretation remains in its resolver.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Keys include the complete resolution pair and sorted active pairs in the same component; no path context capable of changing a cycle cutoff is discarded.
   * @evidence contracts/common.md#meaningful-documentation Comments identify component-local context, immutable module-graph ownership and path-dependent cache size.
   * @evidence contracts/performance.md#efficient-algorithms Key construction scans P active pairs and sorts the C pairs within this component in O(P + C log C), then serializes that context; unrelated components do not multiply completed resolution states.
   * @evidence contracts/performance.md#reuse-equivalent-work One immutable module graph owns component IDs and completed context-qualified results.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The resolver releases all component and result maps after publication; retained contexts are bounded by visited resolution states, including distinct paths inside cyclic components.
   */
  public key(
    source: string,
    pair: string,
    visited: ReadonlySet<string>,
  ): string {
    this.owners.set(pair, source);
    const component: number | undefined = this.components.get(source);
    const context: string[] = [];
    for (const active of visited) {
      const owner: string | undefined = this.owners.get(active);
      if (owner !== undefined && this.components.get(owner) === component)
        context.push(active);
    }
    context.sort((left: string, right: string): number =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return JSON.stringify([pair, context]);
  }
}
