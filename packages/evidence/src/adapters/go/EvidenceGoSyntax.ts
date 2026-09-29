import type { Node as EvidenceNode } from "web-tree-sitter";

import type { IEvidenceCommentSyntax } from "../../structures/IEvidenceCommentSyntax";

/**
 * Grammar-specific Go spelling and ownership helpers.
 *
 * Go extraction uses these helpers to recognize exported identifiers,
 * receivers, embedded fields, comments, and literal carriers directly from
 * Tree-sitter nodes.
 */
export namespace EvidenceGoSyntax {
  export function name(node: EvidenceNode | null): string | undefined {
    return node !== null &&
      (node.type === "identifier" ||
        node.type === "field_identifier" ||
        node.type === "type_identifier" ||
        node.type === "package_identifier")
      ? node.text
      : undefined;
  }

  export function names(node: EvidenceNode, type: string): string[] {
    return node.namedChildren
      .filter((child) => child.type === type)
      .map((child) => child.text);
  }

  export function exported(name: string): boolean {
    const first = Array.from(name)[0];
    return first !== undefined && /^\p{Lu}$/u.test(first);
  }

  export function receiver(node: EvidenceNode): string | undefined {
    const parameters = node.childForFieldName("receiver");
    if (parameters === null) return undefined;
    const declaration = parameters.namedChildren.find(
      (child) => child.type === "parameter_declaration",
    );
    return receiverName(
      declaration === undefined ? null : declaration.childForFieldName("type"),
    );
  }

  export function embeddedField(node: EvidenceNode | null): string | undefined {
    return typeName(node);
  }

  export function comment(node: EvidenceNode): IEvidenceCommentSyntax {
    if (node.text.startsWith("//"))
      return {
        opening: "//",
        closing: "",
        linePrefix: "//",
        tagBoundaries: true,
        allowWithdrawal: true,
      };
    return {
      opening: "/*",
      closing: "*/",
      linePrefix: "*",
      tagBoundaries: true,
      allowWithdrawal: true,
    };
  }

  function typeName(node: EvidenceNode | null): string | undefined {
    if (node === null) return undefined;
    const direct = name(node);
    if (direct !== undefined) return direct;
    if (node.type === "qualified_type")
      return name(node.childForFieldName("name"));
    if (node.type === "generic_type")
      return typeName(node.childForFieldName("type"));
    if (node.type === "pointer_type" || node.type === "parenthesized_type")
      return typeName(node.namedChildren[0] ?? null);
    return undefined;
  }

  function receiverName(node: EvidenceNode | null): string | undefined {
    if (node === null) return undefined;
    const direct = name(node);
    if (direct !== undefined) return direct;
    if (node.type === "generic_type")
      return receiverName(node.childForFieldName("type"));
    if (node.type === "pointer_type" || node.type === "parenthesized_type")
      return receiverName(node.namedChildren[0] ?? null);
    return undefined;
  }
}
