import type { EvidenceDatabaseSymbol } from "./EvidenceDatabaseSymbol";
import type { EvidenceMarkdownSymbol } from "./EvidenceMarkdownSymbol";
import type { EvidenceProgrammingSymbol } from "./EvidenceProgrammingSymbol";

/**
 * Declaration or structural kind within an artifact-specific inventory.
 *
 * Programming, database, and Markdown adapters contribute their own precise
 * classifications. `operation` covers API operations, whose target semantics do
 * not correspond to a programming declaration or document heading. `row` is one
 * keyed record of a CSV or TSV ledger; its file is a `file` unit that stays
 * addressable as an aggregate without being selectable. `scope` represents
 * address-only namespaces, modules, and extension containers; it is not a
 * selectable programming symbol and cannot host evidence. Consumers must retain
 * the accompanying artifact type when interpreting this value.
 *
 * @evidence contracts/common.md#principled-implementation The union composes each family's selector kinds plus operation, row and an address-only scope kind, keeping namespaces and modules distinct from selectable declarations.
 * @evidence contracts/common.md#clear-and-simple-design Family unions own their members; this alias composes them without repetition.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Operation names API operations, row names ledger records, and scope names address-only containers; none coerces these units into programming declaration kinds.
 * @evidence contracts/common.md#meaningful-documentation The comment explains why the artifact type must accompany the value when interpreting it.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export type EvidenceSymbol =
  | EvidenceProgrammingSymbol
  | EvidenceDatabaseSymbol
  | EvidenceMarkdownSymbol
  | "operation"
  | "row"
  | "scope";
