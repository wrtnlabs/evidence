/**
 * Groups borrowed records in encounter order without collapsing ambiguity.
 *
 * @evidence contracts/common.md#principled-implementation Each record is appended under its exact caller-defined identity.
 * @evidence contracts/common.md#clear-and-simple-design The helper owns grouping only; callers define identity and interpretation.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Multiple candidates and encounter order are preserved.
 * @evidence contracts/common.md#meaningful-documentation The comment states borrowing, order and ambiguity.
 * @evidence contracts/performance.md#efficient-algorithms One pass over records with expected constant-time map operations.
 * @evidence contracts/performance.md#reuse-equivalent-work Callers retain the resulting index for their immutable processing phase.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The caller owns one borrowed reference per input record and releases the map with its phase.
 */
export function groupEvidenceRecords<Value>(
  records: Iterable<Value>,
  key: (record: Value) => string,
): Map<string, Value[]> {
  const groups: Map<string, Value[]> = new Map();
  for (const record of records) {
    const identity: string = key(record);
    const entries: Value[] = groups.get(identity) ?? [];
    entries.push(record);
    groups.set(identity, entries);
  }
  return groups;
}
