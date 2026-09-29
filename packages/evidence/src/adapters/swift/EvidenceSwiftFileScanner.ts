import type { Node as EvidenceNode } from "web-tree-sitter";

import { EvidenceSourceText } from "../../internal/EvidenceSourceText";
import type { EvidenceParseSession } from "../../parsers/EvidenceParseSession";
import type { IEvidenceDiagnostic } from "../../structures/IEvidenceDiagnostic";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { IEvidenceSwiftDeclaration } from "./IEvidenceSwiftDeclaration";
import type { IEvidenceSwiftDocumentation } from "./IEvidenceSwiftDocumentation";
import type { IEvidenceSwiftFileAnalysis } from "./IEvidenceSwiftFileAnalysis";

/**
 * Extracts lexical Swift source without compiler expansion or build-condition
 * evaluation.
 *
 * Extensions and aliases are held apart from nominal declarations because their
 * semantic ownership can resolve only after all selected files are available.
 */
export class EvidenceSwiftFileScanner {
  /**
   * EvidenceNode-free declarations retained after the parser callback.
   *
   * EvidenceSwiftOwnership later reconciles them without extending the parse
   * session lifetime.
   */
  private readonly declarations: IEvidenceSwiftDeclaration[] = [];

  /**
   * Documentation carriers indexed by their final original offset.
   *
   * Declaration scanning uses that offset to attach immediately preceding DocC.
   */
  private readonly documentation = new Map<
    number,
    IEvidenceSwiftDocumentation
  >();

  /**
   * Unsupported syntax that prevents a complete denominator.
   *
   * These findings propagate to the inventory instead of allowing partial
   * coverage to pass.
   */
  private readonly diagnostics: IEvidenceDiagnostic[] = [];

  /**
   * Borrows the syntax tree only during the active parser callback.
   *
   * The source supplies durable file identity; node-free records preserve the
   * ranges needed by later extension reconciliation and documentation hosts.
   */
  public constructor(
    private readonly session: EvidenceParseSession,
    private readonly source: IEvidenceSourceFile,
  ) {}

  /**
   * Collects public source declarations and conservative semantic boundaries.
   *
   * Documentation is classified before traversal so a comment at an extension
   * site remains attached even if its nominal target resolves in another file.
   */
  public scan(): IEvidenceSwiftFileAnalysis {
    this.collectDocumentation();
    for (const node of this.session.root.descendantsOfType([
      "directive",
      "macro_invocation",
      "macro_declaration",
    ]))
      this.problem(
        node.type === "directive" ? "conditional-compilation" : "macro",
        "Swift compiler directives and macros require expansion or condition evaluation before the public surface can be established.",
        node,
      );
    this.walk(this.session.root, undefined, false);
    return {
      source: this.source,
      declarations: this.declarations,
      documentation: [...this.documentation.values()],
      diagnostics: this.diagnostics,
      complete: this.diagnostics.length === 0,
    };
  }

  /**
   * Visits declaration containers, never local function bodies or initializer
   * expressions.
   *
   * The boundary prevents local implementation syntax from entering the public
   * declaration inventory.
   */
  private walk(
    container: EvidenceNode,
    owner: IEvidenceSwiftDeclaration | undefined,
    defaultPublic: boolean,
  ): void {
    for (const node of container.namedChildren) {
      if (
        node.type === "class_declaration" ||
        node.type === "protocol_declaration"
      ) {
        const extension = node.children.some(
          (child) => child.type === "extension",
        );
        const form =
          node.children.find((child) =>
            [
              "class",
              "struct",
              "actor",
              "enum",
              "protocol",
              "extension",
            ].includes(child.type),
          )?.type ?? node.type;
        const targetNode = node.childForFieldName("name");
        const target = targetNode === null ? [] : this.path(targetNode);
        const name = extension
          ? target.at(-1)
          : targetNode === null
            ? undefined
            : this.name(targetNode);
        if (name === undefined) {
          this.problem(
            "declaration-name",
            "The Swift type name could not be established.",
            node,
          );
          continue;
        }
        const declaration = this.declare(
          node,
          owner,
          name,
          "type",
          extension || this.visible(node, defaultPublic),
          form,
          extension,
          extension ? target : undefined,
        );
        if (
          extension &&
          node.namedChildren.some((child) => child.type === "type_constraints")
        )
          this.problem(
            "constrained-extension",
            "Constrained extensions require generic requirement resolution.",
            node,
          );
        const inheritance = node.namedChildren.filter(
          (child) => child.type === "inheritance_specifier",
        );
        if (
          inheritance.length !== 0 &&
          (extension ||
            form === "enum" ||
            inheritance.some((child) =>
              /\b(?:Codable|Encodable|Decodable|Equatable|Hashable|CaseIterable)\b/u.test(
                child.text,
              ),
            ))
        )
          this.problem(
            "conformance-expansion",
            "Swift conformance or raw-value declarations require requirement visibility and synthesized-member resolution.",
            node,
          );
        const body = node.childForFieldName("body");
        if (body !== null)
          this.walk(
            body,
            declaration,
            extension ? this.visible(node, false) : form === "protocol",
          );
      } else if (
        [
          "function_declaration",
          "protocol_function_declaration",
          "init_declaration",
          "subscript_declaration",
        ].includes(node.type)
      ) {
        const marker = node.children.findIndex(
          (child) => child.type === "func",
        );
        const name =
          node.type === "init_declaration"
            ? "init"
            : node.type === "subscript_declaration"
              ? "subscript"
              : this.name(node.children[marker + 1] ?? node);
        this.declare(
          node,
          owner,
          name,
          "function",
          this.visible(node, owner?.form === "enum" ? false : defaultPublic),
          node.type,
        );
      } else if (
        ["property_declaration", "protocol_property_declaration"].includes(
          node.type,
        )
      ) {
        const patterns = node.namedChildren.filter(
          (child) => child.type === "pattern",
        );
        const names = patterns
          .flatMap((pattern) => pattern.descendantsOfType("simple_identifier"))
          .map((name) => this.name(name));
        if (names.length === 0 && this.visible(node, defaultPublic))
          this.problem(
            "property-pattern",
            "The public Swift property binding could not be established.",
            node,
          );
        for (const name of names)
          this.declare(
            node,
            owner,
            name,
            "property",
            this.visible(node, owner?.form === "enum" ? false : defaultPublic),
            node.type,
          );
      } else if (
        ["typealias_declaration", "associatedtype_declaration"].includes(
          node.type,
        )
      ) {
        const name = node.namedChildren.find(
          (child) => child.type === "type_identifier",
        );
        if (name !== undefined) {
          const alias = node.type === "typealias_declaration";
          const target = node.namedChildren.find(
            (child) => child.type === "user_type",
          );
          this.declare(
            node,
            owner,
            this.name(name),
            "type",
            this.visible(node, owner?.form === "enum" ? false : defaultPublic),
            node.type,
            false,
            target === undefined ? undefined : this.path(target),
            alias,
          );
        }
      } else if (node.type === "enum_entry") {
        for (const name of node.namedChildren.filter(
          (child) => child.type === "simple_identifier",
        ))
          this.declare(
            node,
            owner,
            this.name(name),
            "property",
            true,
            node.type,
          );
      } else if (
        node.type.endsWith("_declaration") &&
        ![
          "import_declaration",
          "deinit_declaration",
          "operator_declaration",
          "precedence_group_declaration",
          "macro_declaration",
        ].includes(node.type)
      )
        this.problem(
          "unsupported-declaration",
          `Swift declaration '${node.type}' needs extraction support.`,
          node,
        );
    }
  }

  /**
   * Publishes source coordinates, ownership, and independently attached DocC.
   *
   * The record carries enough source facts for later ownership and host
   * materialization.
   */
  private declare(
    node: EvidenceNode,
    owner: IEvidenceSwiftDeclaration | undefined,
    name: string,
    symbol: EvidenceProgrammingSymbol,
    visible: boolean,
    form: string,
    extension: boolean = false,
    target?: string[],
    alias: boolean = false,
  ): IEvidenceSwiftDeclaration {
    const modifiers = node.namedChildren.find(
      (child) => child.type === "modifiers",
    );
    const staticMember =
      owner !== undefined &&
      (modifiers === undefined ? [] : modifiers.namedChildren).some((child) =>
        ["static", "class"].includes(child.text),
      ) === true;
    const address = extension
      ? (target ?? [])
      : [...(owner?.address ?? []), ...(staticMember ? ["static"] : []), name];
    const siteId = `swift:${this.source.id}:site:${node.startIndex}:${node.endIndex}`;
    const range = this.session.range(node);
    const declaration: IEvidenceSwiftDeclaration = {
      id: `${siteId}:${symbol}:${name}`,
      name,
      symbol,
      address,
      identity: address,
      public: owner?.public !== false && visible,
      extension,
      alias,
      form,
      filePrivate:
        (owner?.filePrivate === true &&
          (owner.form !== "extension" || !visible)) ||
        (modifiers === undefined ? [] : modifiers.namedChildren).some(
          (child) =>
            child.type === "visibility_modifier" &&
            ["private", "fileprivate"].includes(child.text),
        ) === true,
      ...(target === undefined ? {} : { target }),
      ...(owner === undefined ? {} : { ownerDeclarationId: owner.id }),
      site: {
        id: siteId,
        file: this.source.physicalPath,
        range,
        content: [range],
      },
    };
    this.declarations.push(declaration);
    const previous = node.previousNamedSibling;
    if (
      previous !== null &&
      /^\s*$/u.test(
        this.source.content.slice(previous.endIndex, node.startIndex),
      )
    ) {
      const documentation = this.documentation.get(previous.endIndex);
      if (
        documentation !== undefined &&
        ["///", "/**"].includes(documentation.syntax.opening)
      )
        documentation.attachments.push({
          declarationId: declaration.id,
          siteId,
        });
    }
    for (const attribute of (modifiers === undefined
      ? []
      : modifiers.namedChildren
    ).filter((child) => child.type === "attribute")) {
      const attributeName = attribute.namedChildren[0]?.text;
      if (
        ![
          "available",
          "inlinable",
          "usableFromInline",
          "discardableResult",
          "escaping",
          "autoclosure",
          "Sendable",
          "MainActor",
          "objc",
          "objcMembers",
          "nonobjc",
          "preconcurrency",
          "backDeployed",
        ].includes(attributeName ?? "")
      )
        this.problem(
          "attribute-expansion",
          `Swift attribute '${attributeName ?? attribute.text}' may generate or alter declarations; implement its semantics before checking coverage.`,
          attribute,
        );
    }
    return declaration;
  }

  /**
   * Ignores setter-only restrictions while respecting getter access and
   * contextual defaults.
   *
   * The public surface follows readable-member visibility rather than setter
   * mutability.
   */
  private visible(node: EvidenceNode, fallback: boolean): boolean {
    const modifiers = node.namedChildren.find(
      (child) => child.type === "modifiers",
    );
    const visibility = (
      modifiers === undefined ? [] : modifiers.namedChildren
    ).find(
      (child) =>
        child.type === "visibility_modifier" && !child.text.includes("("),
    );
    return visibility === undefined
      ? fallback
      : ["public", "open"].includes(visibility.text);
  }

  /**
   * Decodes backtick identifiers as literal accessor segments.
   *
   * The resulting name is used unchanged in semantic identities and public
   * addresses.
   */
  private name(node: EvidenceNode): string {
    return node.text.startsWith("`") ? node.text.slice(1, -1) : node.text;
  }

  /**
   * Resolves only explicit, nongeneric nominal paths.
   *
   * Unsupported generic or qualified grammar shapes return no target for a
   * visible diagnostic.
   */
  private path(node: EvidenceNode): string[] {
    if (node.type === "type_identifier") return [this.name(node)];
    if (
      node.type !== "user_type" ||
      node.namedChildren.some((child) => child.type !== "type_identifier")
    )
      return [];
    return node.namedChildren.map((child) => this.name(child));
  }

  /**
   * Groups adjacent DocC line comments while keeping unsupported carriers
   * diagnosable.
   *
   * Tag-bearing non-DocC carriers remain records so the adapter can report
   * their invalid placement.
   */
  private collectDocumentation(): void {
    const nodes: EvidenceNode[] = this.session.root.descendantsOfType([
      "comment",
      "multiline_comment",
    ]);
    const text: EvidenceSourceText = new EvidenceSourceText(
      this.source.content,
    );
    let previous: IEvidenceSwiftDocumentation | undefined;
    for (const node of nodes) {
      const line: boolean = node.type === "comment";
      const block: boolean = node.type === "multiline_comment";
      const doc: boolean =
        (line && node.text.startsWith("///")) ||
        (block && node.text.startsWith("/**"));
      if (
        !doc &&
        !/@(?:evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link|internal|hidden|ignore)\b/u.test(
          node.text,
        )
      ) {
        previous = undefined;
        continue;
      }
      if (
        line &&
        doc &&
        previous?.syntax?.opening === "///" &&
        /^[ \t]*\r?\n[ \t]*$/u.test(
          this.source.content.slice(previous.range.end.offset, node.startIndex),
        )
      ) {
        this.documentation.delete(previous.range.end.offset);
        previous.range = text.range(previous.range.start.offset, node.endIndex);
        this.documentation.set(node.endIndex, previous);
        continue;
      }
      const opening: string = line ? (doc ? "///" : "//") : doc ? "/**" : "/*";
      previous = {
        id: `swift:${this.source.id}:documentation:${node.startIndex}`,
        range: this.session.range(node),
        syntax: {
          opening,
          closing: line ? "" : "*/",
          ...(line ? { linePrefix: opening } : { linePrefix: "*" }),
          tagBoundaries: true,
          allowWithdrawal: doc,
        },
        attachments: [],
      };
      this.documentation.set(node.endIndex, previous);
    }
  }

  /**
   * Retains actionable failure instead of returning a smaller successful
   * inventory.
   *
   * Every reported boundary marks the containing analysis incomplete.
   */
  private problem(code: string, message: string, node: EvidenceNode): void {
    this.diagnostics.push({
      code: `swift-${code}`,
      severity: "error",
      message,
      repair:
        "Select supported explicit Swift source or implement the reported semantic boundary before evaluating coverage.",
      location: {
        file: this.source.physicalPath,
        range: this.session.range(node),
      },
    });
  }
}
