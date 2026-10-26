/**
 * Finds the first sorted offset at or after an authored source boundary.
 *
 * @evidence contracts/common.md#principled-implementation Binary search returns the first offset greater than or equal to the boundary, or the array length.
 * @evidence contracts/common.md#clear-and-simple-design This helper only searches numeric offsets.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Equal offsets retain their first position and absent matches return a sentinel index.
 * @evidence contracts/common.md#meaningful-documentation The comment defines both the match and absent result.
 * @evidence contracts/performance.md#efficient-algorithms O(log n) comparisons and constant auxiliary space.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each call searches a distinct boundary in a caller-owned sorted index.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources No input or state is retained after return.
 */
export function lowerEvidenceOffset(
  offsets: readonly number[],
  boundary: number,
): number {
  let low: number = 0;
  let high: number = offsets.length;
  while (low < high) {
    const middle: number = (low + high) >>> 1;
    if ((offsets[middle] ?? Infinity) < boundary) low = middle + 1;
    else high = middle;
  }
  return low;
}
