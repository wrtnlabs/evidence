import { EvidenceArrays } from "../../internal/EvidenceArrays";
import type { Node as EvidenceNode } from "web-tree-sitter";

/**
 * Defines the portable subset independently of the broad SQL parser grammar.
 *
 * `EvidenceSqlFileScanner` uses this policy to reject syntax whose meaning
 * varies by dialect.
 *
 * @evidence contracts/common.md#principled-implementation The portable policy accepts only explicit CREATE TABLE syntax whose meaning does not vary by dialect, folding regular identifiers as standard SQL does.
 * @evidence contracts/common.md#clear-and-simple-design Policy decisions are separate from the shared scanner.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Everything outside the portable subset is rejected rather than interpreted.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains its purpose; both functions are documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceSqlPolicy {
  /**
   * Folds regular identifiers to upper case and preserves standard quoted
   * identifiers.
   *
   * This yields portable semantic identity while retaining literal quoted
   * spelling.
   *
   * @evidence contracts/common.md#principled-implementation Regular identifiers fold to upper case and standard double-quoted identifiers keep their literal spelling, following the SQL standard.
   * @evidence contracts/common.md#clear-and-simple-design Identifier decoding is the policy's only naming rule.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported quoting returns undefined rather than inventing a name.
   * @evidence contracts/common.md#meaningful-documentation The comment explains folding and quoting.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the identifier or literal length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each spelling is decoded once where it occurs.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function identifier(raw: string): string | undefined {
    if (/^"(?:[^"]|"")+"$/u.test(raw))
      return raw.slice(1, -1).replaceAll('""', '"');
    return /^[A-Za-z_][A-Za-z_0-9]*$/u.test(raw)
      ? raw.toUpperCase()
      : undefined;
  }

  /**
   * Rejects every statement or extension outside explicit portable CREATE
   * TABLE.
   *
   * The scanner reports the returned reason so unsupported syntax cannot shrink
   * the population.
   *
   * @evidence contracts/common.md#principled-implementation Statements other than plain CREATE TABLE, and dialect extensions within them, return a rejection reason.
   * @evidence contracts/common.md#clear-and-simple-design Validation returns a reason; the scanner records it.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Rejection keeps unsupported syntax from shrinking the population.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the reporting.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the inspected statement's syntax subtree.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each statement is validated once during its file scan.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function reads borrowed nodes during the parse callback and keeps no reference to them.
   */
  export function validate(node: EvidenceNode): string | undefined {
    if (node.type === "comment" || node.type === "marginalia") return undefined;
    if (node.type !== "create_table")
      return "Portable SQL accepts only explicit CREATE TABLE declarations; select a dialect adapter or add support for this statement.";
    const allowed = new Set([
      "keyword_create",
      "keyword_table",
      "object_reference",
      "column_definitions",
      "comment",
      "marginalia",
    ]);
    if (node.namedChildren.some((child) => !allowed.has(child.type)))
      return "Portable SQL does not infer conditional, temporary, query-derived, or dialect-specific tables.";
    const forbidden = new Set([
      "keyword_index",
      "keyword_auto_increment",
      "keyword_generated",
      "keyword_as",
      "keyword_stored",
      "keyword_virtual",
      "keyword_comment",
      "keyword_unsigned",
      "keyword_zerofill",
      "keyword_collate",
      "keyword_nulls",
      "direction",
      "array_size",
      "array_size_definition",
      "array_type",
    ]);
    const stack = [...node.namedChildren];
    while (stack.length !== 0) {
      const child = stack.pop();
      if (child === undefined) continue;
      if (child.type === "identifier" && identifier(child.text) === undefined)
        return "Portable SQL accepts regular ASCII and standard double-quoted identifiers only.";
      if (forbidden.has(child.type))
        return `Portable SQL does not support '${child.text}' in table declarations.`;
      if (child.type === "constraint") {
        const forms = new Set(child.namedChildren.map((entry) => entry.type));
        if (
          ![
            "keyword_foreign",
            "keyword_primary",
            "keyword_unique",
            "keyword_check",
          ].some((type) => forms.has(type))
        )
          return "Portable SQL supports only PRIMARY KEY, UNIQUE, CHECK, and FOREIGN KEY table constraints.";
        if (forms.has("keyword_unique") && forms.has("keyword_key"))
          return "Portable SQL uses UNIQUE, not the dialect-specific UNIQUE KEY spelling.";
        if (
          child.childForFieldName("name") !== null &&
          !forms.has("keyword_constraint")
        )
          return "Portable SQL names constraints with CONSTRAINT; dialect-specific index names are unsupported.";
        if (
          forms.has("keyword_foreign") &&
          child.childForFieldName("name") !== null
        )
          return "Named foreign-key syntax is not supported by the portable SQL grammar; use an anonymous FOREIGN KEY or a certified dialect.";
      }
      if (child.type === "column_definition") {
        const named = child.namedChildren.filter(
          (entry) => entry.type !== "comment" && entry.type !== "marginalia",
        );
        for (let index = 0; index < named.length; ++index) {
          if (named[index]?.type !== "keyword_default") continue;
          const expression = named[index + 1];
          if (
            expression === undefined ||
            !/^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|'(?:[^']|'')*'|TRUE|FALSE|NULL|CURRENT_TIMESTAMP)$/iu.test(
              expression.text.trim(),
            )
          )
            return "Portable SQL defaults require a scalar literal or CURRENT_TIMESTAMP; dialect function defaults are unsupported.";
        }
        if (named.some((entry) => entry.type === "keyword_constraint"))
          return "Named column constraints are outside the documented portable grammar subset.";
        const type = child.childForFieldName("type");
        if (
          child.childrenForFieldName("type").length !== 1 ||
          type === null ||
          !/^(?:SMALLINT|INTEGER|INT|BIGINT|DECIMAL|NUMERIC|REAL|DOUBLE\s+PRECISION|FLOAT|BOOLEAN|CHAR(?:ACTER)?|VARCHAR|CHARACTER\s+VARYING|DATE|TIME|TIMESTAMP)(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?$/iu.test(
            type.text,
          )
        )
          return "Portable SQL columns require a documented standard scalar data type.";
      }
      EvidenceArrays.append(stack, child.namedChildren);
    }
    return undefined;
  }
}
