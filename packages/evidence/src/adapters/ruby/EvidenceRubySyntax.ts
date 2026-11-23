import { EvidenceArrays } from "../../internal/EvidenceArrays";
import type { Node as EvidenceNode } from "web-tree-sitter";

import type { IEvidenceCommentSyntax } from "../../structures/IEvidenceCommentSyntax";
import type { IEvidenceRubyConstantPath } from "./IEvidenceRubyConstantPath";

/**
 * Provides grammar-level Ruby extraction helpers without public-surface
 * decisions.
 *
 * EvidenceRubyFileScanner uses these functions to recognize statically readable
 * syntax. Publication, visibility, and reopening policy remain in the scanner
 * and adapter.
 *
 * @evidence contracts/common.md#principled-implementation Grammar helpers read call names and arguments, receivers, method spellings, literal symbols and strings, constant paths, superclasses and comment syntax for statically readable Ruby.
 * @evidence contracts/common.md#clear-and-simple-design The namespace holds syntax queries; publication and reopening policy stay in the scanner and adapter.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Interpolated or escaped names are rejected because their runtime content is uncertain.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains the boundary; every function is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceRubySyntax {
  /**
   * Reads the bare method name from a Ruby call node.
   *
   * Directive recognition uses this result only for ordinary identifier calls;
   * other node forms remain unsupported rather than being guessed from text.
   *
   * @evidence contracts/common.md#principled-implementation A call's bare identifier method name is returned.
   * @evidence contracts/common.md#clear-and-simple-design The helper is a pure syntax query; publication, visibility and export policy stay in the scanner and resolver.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported grammar forms return nothing rather than being coerced into a name.
   * @evidence contracts/common.md#meaningful-documentation The comment states the accepted forms and what is rejected.
   * @evidence contracts/performance.md#efficient-algorithms Constant or proportional to the inspected syntax subtree.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each node is inspected once by the scanner.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function returns copied values and keeps no reference to the borrowed node.
   */
  export function callName(node: EvidenceNode): string | undefined {
    if (node.type !== "call") return undefined;
    const method = node.childForFieldName("method");
    return method?.type === "identifier" ? method.text : undefined;
  }

  /**
   * Returns the direct named arguments of a Ruby call node.
   *
   * Attribute, visibility, and alias directives inspect this collection before
   * accepting literal arguments; non-call nodes deliberately produce no
   * arguments.
   *
   * @evidence contracts/common.md#principled-implementation A call's direct named arguments are returned for directive inspection.
   * @evidence contracts/common.md#clear-and-simple-design The helper is a pure syntax query; publication, visibility and export policy stay in the scanner and resolver.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported grammar forms return nothing rather than being coerced into a name.
   * @evidence contracts/common.md#meaningful-documentation The comment states the accepted forms and what is rejected.
   * @evidence contracts/performance.md#efficient-algorithms Constant or proportional to the inspected syntax subtree.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each node is inspected once by the scanner.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function returns copied values and keeps no reference to the borrowed node.
   */
  export function callArguments(node: EvidenceNode): EvidenceNode[] {
    if (node.type !== "call") return [];
    return node.childForFieldName("arguments")?.namedChildren ?? [];
  }

  /**
   * States whether a Ruby call has an explicit receiver.
   *
   * The scanner rejects or classifies directives differently when a receiver
   * changes their lexical effect, so this check does not interpret the
   * receiver.
   *
   * @evidence contracts/common.md#principled-implementation A call has a receiver when its receiver field is present.
   * @evidence contracts/common.md#clear-and-simple-design The helper is a pure syntax query; publication, visibility and export policy stay in the scanner and resolver.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported grammar forms return nothing rather than being coerced into a name.
   * @evidence contracts/common.md#meaningful-documentation The comment states the accepted forms and what is rejected.
   * @evidence contracts/performance.md#efficient-algorithms Constant or proportional to the inspected syntax subtree.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each node is inspected once by the scanner.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function returns copied values and keeps no reference to the borrowed node.
   */
  export function hasReceiver(node: EvidenceNode): boolean {
    return node.type === "call" && node.childForFieldName("receiver") !== null;
  }

  /**
   * Reads a statically supported Ruby method spelling from a syntax node.
   *
   * Direct identifiers, constants, operators, and setters retain their source
   * text; literal symbols and strings are delegated to literalName.
   *
   * @evidence contracts/common.md#principled-implementation Identifiers, constants, operators and setters keep their source spelling as method names.
   * @evidence contracts/common.md#clear-and-simple-design The helper is a pure syntax query; publication, visibility and export policy stay in the scanner and resolver.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported grammar forms return nothing rather than being coerced into a name.
   * @evidence contracts/common.md#meaningful-documentation The comment states the accepted forms and what is rejected.
   * @evidence contracts/performance.md#efficient-algorithms Constant or proportional to the inspected syntax subtree.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each node is inspected once by the scanner.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function returns copied values and keeps no reference to the borrowed node.
   */
  export function methodName(node: EvidenceNode | null): string | undefined {
    if (node === null) return undefined;
    if (
      node.type === "identifier" ||
      node.type === "constant" ||
      node.type === "operator" ||
      node.type === "setter"
    )
      return node.text;
    return literalName(node);
  }

  /**
   * Reads a flattened list of statically literal Ruby names.
   *
   * Nested arrays are expanded for directives that accept name lists. One
   * dynamic element makes the whole result undefined so callers can report
   * uncertainty.
   *
   * @evidence contracts/common.md#principled-implementation Literal names are flattened from argument lists and nested arrays; any non-literal makes the whole list unknown.
   * @evidence contracts/common.md#clear-and-simple-design The helper is a pure syntax query; publication, visibility and export policy stay in the scanner and resolver.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported grammar forms return nothing rather than being coerced into a name.
   * @evidence contracts/common.md#meaningful-documentation The comment states the accepted forms and what is rejected.
   * @evidence contracts/performance.md#efficient-algorithms Constant or proportional to the inspected syntax subtree.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each node is inspected once by the scanner.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function returns copied values and keeps no reference to the borrowed node.
   */
  export function literalNames(nodes: EvidenceNode[]): string[] | undefined {
    const output: string[] = [];
    for (const node of nodes) {
      if (node.type === "array") {
        const nested = literalNames(node.namedChildren);
        if (nested === undefined) return undefined;
        EvidenceArrays.append(output, nested);
        continue;
      }
      const name = literalName(node);
      if (name === undefined) return undefined;
      output.push(name);
    }
    return output;
  }

  /**
   * Reads one interpolation-free Ruby symbol or string as a literal name.
   *
   * Escape sequences and interpolation make runtime content uncertain, so
   * callers receive undefined instead of an approximated declaration name.
   *
   * @evidence contracts/common.md#principled-implementation An interpolation-free symbol or string is a literal name.
   * @evidence contracts/common.md#clear-and-simple-design The helper is a pure syntax query; publication, visibility and export policy stay in the scanner and resolver.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported grammar forms return nothing rather than being coerced into a name.
   * @evidence contracts/common.md#meaningful-documentation The comment states the accepted forms and what is rejected.
   * @evidence contracts/performance.md#efficient-algorithms Constant or proportional to the inspected syntax subtree.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each node is inspected once by the scanner.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function returns copied values and keeps no reference to the borrowed node.
   */
  export function literalName(node: EvidenceNode): string | undefined {
    if (node.type === "simple_symbol") return node.text.slice(1);
    if (node.type !== "string" && node.type !== "delimited_symbol")
      return undefined;
    if (
      node.descendantsOfType("interpolation").length !== 0 ||
      node.descendantsOfType("escape_sequence").length !== 0
    )
      return undefined;
    return node.namedChildren
      .filter((child) => child.type === "string_content")
      .map((child) => child.text)
      .join("");
  }

  /**
   * Converts a supported Ruby constant expression into root-qualified path
   * segments.
   *
   * The scanner uses absolute to distinguish `::Name` from lexical lookup while
   * resolving containers, superclass paths, and generated-constant receivers.
   *
   * @evidence contracts/common.md#principled-implementation Supported constant expressions become root-qualified path segments.
   * @evidence contracts/common.md#clear-and-simple-design The helper is a pure syntax query; publication, visibility and export policy stay in the scanner and resolver.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported grammar forms return nothing rather than being coerced into a name.
   * @evidence contracts/common.md#meaningful-documentation The comment states the accepted forms and what is rejected.
   * @evidence contracts/performance.md#efficient-algorithms Constant or proportional to the inspected syntax subtree.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each node is inspected once by the scanner.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function returns copied values and keeps no reference to the borrowed node.
   */
  export function constantPath(
    node: EvidenceNode | null,
  ): IEvidenceRubyConstantPath | undefined {
    if (node === null) return undefined;
    if (node.type === "constant")
      return { absolute: false, segments: [node.text] };
    if (node.type !== "scope_resolution") return undefined;
    const name = node.childForFieldName("name");
    if (name?.type !== "constant") return undefined;
    const scope = node.childForFieldName("scope");
    if (scope === null)
      return node.text.startsWith("::")
        ? { absolute: true, segments: [name.text] }
        : undefined;
    const parent = constantPath(scope);
    return parent === undefined
      ? undefined
      : {
          absolute: parent.absolute,
          segments: [...parent.segments, name.text],
        };
  }

  /**
   * Identifies the normalization rules for a supported Ruby documentation
   * comment.
   *
   * Line RDoc and complete embedded RDoc blocks retain tag boundaries and
   * permit withdrawals. Other comment forms return undefined and cannot become
   * hosts.
   *
   * @evidence contracts/common.md#principled-implementation Hash comment runs and embedded =begin/=end blocks get their own normalization rules.
   * @evidence contracts/common.md#clear-and-simple-design The helper is a pure syntax query; publication, visibility and export policy stay in the scanner and resolver.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported grammar forms return nothing rather than being coerced into a name.
   * @evidence contracts/common.md#meaningful-documentation The comment states the accepted forms and what is rejected.
   * @evidence contracts/performance.md#efficient-algorithms Constant or proportional to the inspected syntax subtree.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each node is inspected once by the scanner.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function returns copied values and keeps no reference to the borrowed node.
   */
  export function commentSyntax(
    node: EvidenceNode,
  ): IEvidenceCommentSyntax | undefined {
    if (node.type !== "comment") return undefined;
    if (node.text.startsWith("#"))
      return {
        opening: "#",
        closing: "",
        linePrefix: "#",
        tagBoundaries: true,
        allowWithdrawal: true,
      };
    if (!node.text.startsWith("=begin")) return undefined;
    const openingEnd = node.text.indexOf("\n");
    const closingStart = node.text.lastIndexOf("=end");
    if (openingEnd < 0 || closingStart <= openingEnd) return undefined;
    return {
      opening: node.text.slice(0, openingEnd + 1),
      closing: node.text.slice(closingStart),
      tagBoundaries: true,
      allowWithdrawal: true,
    };
  }

  /**
   * Normalizes the explicit superclass spelling on a Ruby class declaration.
   *
   * Reopening reconciliation compares this normalized text only when a
   * superclass is supplied, preserving the distinction between omission and
   * conflict.
   *
   * @evidence contracts/common.md#principled-implementation An explicit superclass spelling is normalized for reopening comparison.
   * @evidence contracts/common.md#clear-and-simple-design The helper is a pure syntax query; publication, visibility and export policy stay in the scanner and resolver.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported grammar forms return nothing rather than being coerced into a name.
   * @evidence contracts/common.md#meaningful-documentation The comment states the accepted forms and what is rejected.
   * @evidence contracts/performance.md#efficient-algorithms Constant or proportional to the inspected syntax subtree.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each node is inspected once by the scanner.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function returns copied values and keeps no reference to the borrowed node.
   */
  export function superclass(node: EvidenceNode): string | undefined {
    const superclass = node.childForFieldName("superclass");
    if (superclass === null) return undefined;
    return superclass.text.replace(/^\s*</u, "").replace(/\s+/gu, " ").trim();
  }

  /**
   * Detects calls that generate a runtime constant instead of a declared
   * container.
   *
   * EvidenceRubyFileScanner reports these forms as incomplete because their
   * members cannot be derived from the declared source model without executing
   * Ruby.
   *
   * @evidence contracts/common.md#principled-implementation Class.new, Module.new, Struct.new and Data.define calls, which generate a constant at runtime, are detected.
   * @evidence contracts/common.md#clear-and-simple-design The helper is a pure syntax query; publication, visibility and export policy stay in the scanner and resolver.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported grammar forms return nothing rather than being coerced into a name.
   * @evidence contracts/common.md#meaningful-documentation The comment states the accepted forms and what is rejected.
   * @evidence contracts/performance.md#efficient-algorithms Constant or proportional to the inspected syntax subtree.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each node is inspected once by the scanner.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function returns copied values and keeps no reference to the borrowed node.
   */
  export function generatedConstant(node: EvidenceNode | null): boolean {
    if (node?.type !== "call") return false;
    const method = callName(node);
    const receiver = node.childForFieldName("receiver");
    const path = constantPath(receiver);
    if (path === undefined) return false;
    const owner = path.segments.join("::");
    return (
      (method === "new" &&
        (owner === "Class" || owner === "Module" || owner === "Struct")) ||
      (method === "define" && owner === "Data")
    );
  }
}
