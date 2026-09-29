import type { Node as EvidenceNode } from "web-tree-sitter";

import type { IEvidenceCommentSyntax } from "../../structures/IEvidenceCommentSyntax";
import type { EvidenceCppAccess } from "./EvidenceCppAccess";
import type { EvidenceCppDeclarationForm } from "./EvidenceCppDeclarationForm";
import type { EvidenceCppDeclaratorKind } from "./EvidenceCppDeclaratorKind";
import type { IEvidenceCppDeclaratorShape } from "./IEvidenceCppDeclaratorShape";
import type { IEvidenceCppQualifiedName } from "./IEvidenceCppQualifiedName";

/**
 * Provides C++ grammar helpers for names, declarators, comments, and modifiers.
 *
 * EvidenceCppFileScanner uses these helpers to preserve C++-specific spelling
 * and scope distinctions while it decides which supported declarations form
 * graph units.
 */
export namespace EvidenceCppSyntax {
  export function name(node: EvidenceNode | null): string | undefined {
    if (node === null) return undefined;
    if (
      [
        "identifier",
        "field_identifier",
        "type_identifier",
        "namespace_identifier",
      ].includes(node.type)
    )
      return decode(node.text);
    if (node.type === "destructor_name") {
      const value = name(node.namedChildren[0] ?? null);
      return value === undefined ? undefined : `~${value}`;
    }
    if (node.type === "operator_name") return operator(node.text);
    if (node.type === "operator_cast") {
      const type = node.childForFieldName("type");
      return type === null ? undefined : `operator ${normalize(type.text)}`;
    }
    return undefined;
  }

  export function qualifiedName(
    node: EvidenceNode | null,
  ): IEvidenceCppQualifiedName | undefined {
    if (node === null) return undefined;
    if (node.type === "qualified_identifier") {
      const scope = qualifiedName(node.childForFieldName("scope"));
      const member = qualifiedName(node.childForFieldName("name"));
      if (member === undefined) return undefined;
      return {
        segments: [...(scope?.segments ?? []), ...member.segments],
        specialized: (scope?.specialized ?? false) || member.specialized,
      };
    }
    if (node.type === "nested_namespace_specifier") {
      const parts = node.namedChildren.flatMap((child) => {
        const value = qualifiedName(child);
        return value === undefined ? [] : [value];
      });
      return {
        segments: parts.flatMap((part) => part.segments),
        specialized: parts.some((part) => part.specialized),
      };
    }
    if (
      node.type === "template_type" ||
      node.type === "template_function" ||
      node.type === "template_method" ||
      node.type === "dependent_name"
    ) {
      const wrapped =
        node.type === "dependent_name" ? node.namedChildren[0] : node;
      if (wrapped === undefined) return undefined;
      if (wrapped.type === "dependent_name") return undefined;
      const value = name(wrapped.childForFieldName("name"));
      const argumentsNode = wrapped.childForFieldName("arguments");
      if (value === undefined || argumentsNode === null) return undefined;
      const argumentsList = argumentsNode.namedChildren.filter(
        (child) => child.type !== "comment",
      );
      return {
        segments: [`${value}\`${argumentsList.length}`],
        specialized:
          argumentsList.length === 0 ||
          argumentsList.some((argument) => !templateParameter(argument)),
      };
    }
    const value = name(node);
    return value === undefined
      ? undefined
      : { segments: [value], specialized: false };
  }

  export function declarators(node: EvidenceNode): EvidenceNode[] {
    return node.childrenForFieldName("declarator");
  }

  export function declarator(
    node: EvidenceNode,
  ): IEvidenceCppDeclaratorShape | undefined {
    let current: EvidenceNode | null = node;
    let nearest: EvidenceCppDeclaratorKind = "direct";
    while (current !== null) {
      if (current.type === "operator_cast") {
        const path = qualifiedName(current);
        return path === undefined
          ? undefined
          : {
              path: path.segments,
              kind: "function",
              node,
              specialized: path.specialized,
            };
      }
      const path = qualifiedName(current);
      if (path !== undefined)
        return {
          path: path.segments,
          kind: nearest,
          node,
          specialized: path.specialized,
        };
      switch (current.type) {
        case "init_declarator":
        case "attributed_declarator":
          current = childDeclarator(current);
          break;
        case "parenthesized_declarator":
          current = declaratorChild(current);
          break;
        case "function_declarator":
        case "abstract_function_declarator":
          nearest = "function";
          current = childDeclarator(current);
          break;
        case "pointer_declarator":
        case "pointer_type_declarator":
        case "reference_declarator":
        case "reference_type_declarator":
        case "array_declarator":
          nearest = "object";
          current = childDeclarator(current);
          break;
        default:
          current = childDeclarator(current);
      }
    }
    return undefined;
  }

  export function recordForm(
    node: EvidenceNode | null,
  ): Extract<
    EvidenceCppDeclarationForm,
    "class" | "struct" | "union" | "enum"
  > | null {
    if (node?.type === "class_specifier") return "class";
    if (node?.type === "struct_specifier") return "struct";
    if (node?.type === "union_specifier") return "union";
    if (node?.type === "enum_specifier") return "enum";
    return null;
  }

  export function templateArity(node: EvidenceNode): number {
    const parameters = node.childForFieldName("parameters");
    return parameters === null
      ? 0
      : parameters.namedChildren.filter((child) => child.type !== "comment")
          .length;
  }

  export function templateBody(node: EvidenceNode): EvidenceNode | undefined {
    return node.namedChildren.find(
      (child) =>
        child.type !== "template_parameter_list" &&
        child.type !== "requires_clause" &&
        child.type !== "comment",
    );
  }

  export function storage(node: EvidenceNode, value: string): boolean {
    return node.namedChildren.some(
      (child) =>
        child.type === "storage_class_specifier" && child.text === value,
    );
  }

  export function topLevelConstObject(
    node: EvidenceNode,
    declarator: EvidenceNode,
  ): boolean {
    const constantExpression = node.namedChildren.some(
      (child) => child.text === "constexpr",
    );
    const external = ["extern", "inline"].some((value) =>
      node.namedChildren.some((child) => child.text === value),
    );
    if (external) return false;
    if (constantExpression) return true;

    const baseConstant = node.namedChildren.some(
      (child) => child.type === "type_qualifier" && child.text === "const",
    );
    const wrappers: EvidenceNode[] = [];
    let current: EvidenceNode | null = declarator;
    while (current !== null) {
      if (
        [
          "pointer_declarator",
          "pointer_type_declarator",
          "reference_declarator",
          "reference_type_declarator",
          "array_declarator",
          "function_declarator",
          "abstract_function_declarator",
        ].includes(current.type)
      )
        wrappers.push(current);
      current = childDeclarator(current);
    }
    for (let index = wrappers.length - 1; index >= 0; --index) {
      const wrapper = wrappers[index];
      if (wrapper === undefined) continue;
      if (wrapper.type === "array_declarator") continue;
      if (
        wrapper.type === "pointer_declarator" ||
        wrapper.type === "pointer_type_declarator"
      )
        return wrapper.namedChildren.some(
          (child) => child.type === "type_qualifier" && child.text === "const",
        );
      return false;
    }
    return baseConstant;
  }

  export function access(node: EvidenceNode): EvidenceCppAccess | undefined {
    const value = node.text.replace(/\s*:\s*$/u, "").trim();
    return value === "public" || value === "protected" || value === "private"
      ? value
      : undefined;
  }

  export function isStaticAssertion(node: EvidenceNode): boolean {
    return /^(?:_Static_assert|static_assert)\s*\(/u.test(node.text);
  }

  export function guardedDeclarations(
    node: EvidenceNode,
  ): EvidenceNode[] | undefined {
    if (node.type !== "preproc_ifdef" || !/^#\s*ifndef\b/u.test(node.text))
      return undefined;
    if (node.childForFieldName("alternative") !== null) return undefined;
    const guard = name(node.childForFieldName("name"));
    if (guard === undefined) return undefined;
    const body = node.namedChildren.slice(1);
    const definition = body[0];
    if (
      definition?.type !== "preproc_def" ||
      name(definition.childForFieldName("name")) !== guard
    )
      return undefined;
    return body.slice(1);
  }

  export function isInertDirective(node: EvidenceNode): boolean {
    if (node.type !== "preproc_call") return false;
    const directive = node.childForFieldName("directive")?.text;
    const argumentNode = node.childForFieldName("argument");
    const argument =
      argumentNode === null ? undefined : argumentNode.text.trim();
    return (
      directive === "#undef" ||
      directive === "#line" ||
      (directive === "#pragma" && argument === "once")
    );
  }

  export function isDoxygen(node: EvidenceNode): boolean {
    return (
      node.type === "comment" &&
      /^(?:\/\*\*|\/\*!|\/\/\/|\/\/!)/u.test(node.text)
    );
  }

  export function isTrailingDoxygen(node: EvidenceNode): boolean {
    return (
      node.type === "comment" &&
      /^(?:\/\*\*<|\/\*!<|\/\/\/<|\/\/!<)/u.test(node.text)
    );
  }

  export function comment(node: EvidenceNode): IEvidenceCommentSyntax {
    for (const opening of ["///<", "//!<", "///", "//!", "//"])
      if (node.text.startsWith(opening))
        return {
          opening,
          closing: "",
          linePrefix: opening,
          tagBoundaries: true,
          allowWithdrawal: opening !== "//",
        };
    for (const opening of ["/**<", "/*!<", "/**", "/*!", "/*"])
      if (node.text.startsWith(opening))
        return {
          opening,
          closing: "*/",
          linePrefix: "*",
          tagBoundaries: true,
          allowWithdrawal: opening !== "/*",
        };
    return {
      opening: "/*",
      closing: "*/",
      tagBoundaries: true,
      allowWithdrawal: false,
    };
  }

  function childDeclarator(node: EvidenceNode): EvidenceNode | null {
    return node.childForFieldName("declarator") ?? declaratorChild(node);
  }

  function declaratorChild(node: EvidenceNode): EvidenceNode | null {
    return (
      node.namedChildren.find(
        (child) =>
          qualifiedName(child) !== undefined ||
          child.type.endsWith("_declarator") ||
          child.type === "parenthesized_declarator" ||
          child.type === "operator_cast",
      ) ?? null
    );
  }

  function templateParameter(node: EvidenceNode): boolean {
    if (node.type === "parameter_pack_expansion") {
      const pattern = node.childForFieldName("pattern");
      return pattern !== null && templateParameter(pattern);
    }
    if (
      ["identifier", "field_identifier", "type_identifier"].includes(node.type)
    )
      return true;
    if (node.type !== "type_descriptor" || node.namedChildren.length !== 1)
      return false;
    const child = node.namedChildren[0];
    return (
      child !== undefined &&
      ["identifier", "type_identifier"].includes(child.type)
    );
  }

  function operator(input: string): string {
    return `operator ${input.replace(/^operator\s*/u, "").trim()}`;
  }

  function normalize(input: string): string {
    return input.replace(/\s+/gu, " ").trim();
  }

  function decode(input: string): string {
    return input
      .replace(/\\u([0-9A-Fa-f]{4})/gu, (_match, hex: string) =>
        String.fromCodePoint(Number.parseInt(hex, 16)),
      )
      .replace(/\\U([0-9A-Fa-f]{8})/gu, (match, hex: string) => {
        const codePoint = Number.parseInt(hex, 16);
        return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
      });
  }
}
