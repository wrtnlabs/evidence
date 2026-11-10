/**
 * Delimited-text ledger formats whose records become row units.
 *
 * Each value names one published grammar rather than a delimiter setting:
 *
 * - `csv`: RFC 4180. Comma-separated fields; a field enclosed in double quotes
 *   may contain commas, line breaks, and doubled quotes.
 * - `tsv`: IANA `text/tab-separated-values`. Tab-separated fields with no
 *   quoting, so every character except tab and line breaks is literal field
 *   data.
 *
 * The type, not the file extension, chooses the grammar.
 *
 * @evidence contracts/common.md#principled-implementation Two literals name the RFC 4180 and IANA TSV grammars, so the quoting rule follows from the selected standard instead of being inferred from a delimiter.
 * @evidence contracts/common.md#clear-and-simple-design The alias only enumerates the two dialects; parsing rules live in the delimited adapter.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts No extension heuristic or project-specific dialect is encoded.
 * @evidence contracts/common.md#meaningful-documentation The comment states each dialect's quoting rule and that the type, not the extension, selects it.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export type EvidenceDelimitedType = "csv" | "tsv";
