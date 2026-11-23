/**
 * Appends records to construction arrays independently of their count.
 *
 * Spreading an array into a call such as `push(...values)` places every element
 * on the call stack as a separate argument, so the engine throws `Maximum call
 * stack size exceeded` once a project yields more records than one stack frame
 * can pass. Record counts grow with source files, units and evidence documents,
 * so every append whose length depends on input goes through this namespace.
 *
 * @evidence contracts/common.md#principled-implementation Appending iterates the values and pushes one element per call, so stack use stays constant for any record count.
 * @evidence contracts/common.md#clear-and-simple-design One namespace owns count-independent appending and minimum selection for every adapter, merger and evaluator.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Input-sized arrays are never spread into call arguments, and no caller raises the process stack size to hide the limit.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains the argument limit that makes spread calls unsafe; each member is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceArrays {
  /**
   * Appends every value to the target array in iteration order.
   *
   * Equivalent to `target.push(...values)` without passing the values as call
   * arguments, so the number of values is bounded only by memory. A spread
   * reads every value before the first push, so appending an array to itself
   * doubles it; the same array is therefore copied before iteration, which
   * would otherwise never reach the end of the growing array.
   *
   * @evidence contracts/common.md#principled-implementation Values are pushed one at a time in iteration order, and a target passed as its own source is copied first, matching a spread push without its argument-count limit.
   * @evidence contracts/common.md#clear-and-simple-design The function only appends; callers keep their own filtering and mapping.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No spread, apply or chunked argument list is used, so no input size reaches the call stack, and self-appends cannot loop on the growing array.
   * @evidence contracts/common.md#meaningful-documentation The comment states the spread-push equivalence, why it is avoided and why a self-append is copied.
   * @evidence contracts/performance.md#efficient-algorithms O(n) for n values with amortized constant pushes; only a self-append allocates a copy, and an iterable is consumed once.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each call appends its own values.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; the target array belongs to the caller.
   */
  export function append<T>(target: T[], values: Iterable<T>): void {
    const source: Iterable<T> = values === target ? target.slice() : values;
    for (const value of source) target.push(value);
  }

  /**
   * Finds the least number, or `undefined` for an empty array.
   *
   * Equivalent to `Math.min(...values)` for a nonempty array without passing
   * the values as call arguments.
   *
   * @evidence contracts/common.md#principled-implementation A single pass keeps the least value seen, and an empty input yields undefined so callers choose their own default.
   * @evidence contracts/common.md#clear-and-simple-design The function only selects the minimum; callers map their records to numbers first.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No spread or apply passes the values as call arguments, and emptiness is explicit instead of Infinity.
   * @evidence contracts/common.md#meaningful-documentation The comment states the Math.min equivalence and the empty result.
   * @evidence contracts/performance.md#efficient-algorithms O(n) for n values with one comparison each and no allocation.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each call scans its own values.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning.
   */
  export function min(values: readonly number[]): number | undefined {
    let least: number | undefined = undefined;
    for (const value of values)
      if (least === undefined || value < least) least = value;
    return least;
  }
}
