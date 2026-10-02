import type { Node as EvidenceNode } from "web-tree-sitter";
import type { EvidenceParseSession } from "../../parsers/EvidenceParseSession";
import type { IEvidenceDiagnostic } from "../../structures/IEvidenceDiagnostic";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { IEvidenceScalaDeclaration } from "./IEvidenceScalaDeclaration";
import type { IEvidenceScalaDocumentation } from "./IEvidenceScalaDocumentation";
import type { IEvidenceScalaExport } from "./IEvidenceScalaExport";
import type { IEvidenceScalaFileAnalysis } from "./IEvidenceScalaFileAnalysis";

/**
 * Extracts explicit Scala 2/3 declarations while retaining unsupported surface
 * boundaries.
 *
 * The scanner records lexical declarations and explicit exports separately so a
 * later snapshot-wide pass can resolve singleton forwarding without inventing
 * aliases.
 */
export class EvidenceScalaFileScanner {
  /**
   * Collects declaration records that remain valid after parsing closes.
   *
   * Each record retains source ranges and lexical ownership without holding a
   * Tree-sitter node.
   */
  private readonly declarations: IEvidenceScalaDeclaration[] = [];

  /**
   * Indexes Scaladoc and unsupported tag carriers by their original source
   * offset.
   *
   * The offset permits adjacent declaration attachment without reparsing the
   * carrier text.
   */
  private readonly documentation = new Map<
    number,
    IEvidenceScalaDocumentation
  >();

  /**
   * Collects explicit exports for resolution after every selected file is
   * scanned.
   *
   * Deferring resolution lets a forwarding file find declarations from other
   * selected sources.
   */
  private readonly exports: IEvidenceScalaExport[] = [];

  /**
   * Collects public-surface failures that prevent a passing smaller inventory.
   *
   * The returned analysis uses these diagnostics to mark extraction incomplete.
   */
  private readonly diagnostics: IEvidenceDiagnostic[] = [];

  /**
   * Borrows syntax only during the common parser callback.
   *
   * Source identity and ranges are copied into the returned analysis because
   * export resolution begins only after parser sessions have closed.
   */
  public constructor(
    private readonly session: EvidenceParseSession,
    private readonly source: IEvidenceSourceFile,
  ) {}

  /**
   * Produces a serializable inventory fragment.
   *
   * Documentation is collected first, then scopes are traversed without
   * entering executable bodies, preserving source attachment and
   * public-boundary semantics.
   */
  public scan(): IEvidenceScalaFileAnalysis {
    this.collectDocumentation();
    this.scope(this.session.root.namedChildren, [], undefined);
    return {
      source: this.source,
      declarations: this.declarations,
      documentation: [...this.documentation.values()],
      exports: this.exports,
      diagnostics: this.diagnostics,
      complete: this.diagnostics.length === 0,
    };
  }

  /**
   * Walks declaration scopes without descending into executable bodies or local
   * definitions.
   *
   * Package clauses extend the current namespace, while nested declaration
   * bodies establish lexical owners.
   */
  private scope(
    nodes: EvidenceNode[],
    namespace: string[],
    owner: IEvidenceScalaDeclaration | undefined,
  ): void {
    let current = namespace;
    for (const node of nodes) {
      if (node.type === "package_clause") {
        const name = node.childForFieldName("name");
        const parts =
          name === null
            ? []
            : name.namedChildren.map((part) => this.name(part));
        const body = node.childForFieldName("body");
        if (body === null) current = [...current, ...parts];
        else this.scope(body.namedChildren, [...current, ...parts], owner);
      } else this.visit(node, current, owner);
    }
  }

  /**
   * Selects supported source declarations and their explicit lexical children.
   *
   * Unsupported public declaration forms are reported as incomplete instead of
   * being guessed from syntax.
   */
  private visit(
    node: EvidenceNode,
    namespace: string[],
    owner: IEvidenceScalaDeclaration | undefined,
  ): void {
    if (
      [
        "class_definition",
        "trait_definition",
        "object_definition",
        "enum_definition",
        "package_object",
      ].includes(node.type)
    ) {
      const declaration = this.declare(
        node,
        node.childForFieldName("name"),
        "type",
        namespace,
        owner,
      );
      if (declaration === undefined) return;
      if (node.childForFieldName("derive") !== null && declaration.public)
        this.problem(
          "derived-members",
          "Derives and uses clauses require generated-member resolution.",
          node,
        );
      const parameterLists = node.childrenForFieldName("class_parameters");
      for (const [index, list] of parameterLists.entries())
        for (const parameter of list.namedChildren.filter(
          (child) => child.type === "class_parameter",
        ))
          if (
            parameter.children.some(
              (child) => child.text === "val" || child.text === "var",
            ) ||
            (index === 0 &&
              node.children.some((child) => child.text === "case"))
          )
            this.declare(
              parameter,
              parameter.childForFieldName("name"),
              "property",
              namespace,
              declaration,
            );
          else
            this.declare(
              parameter,
              parameter.childForFieldName("name"),
              "property",
              namespace,
              { ...declaration, public: false },
            );
      for (const body of node.childrenForFieldName("body"))
        this.scope(body.namedChildren, namespace, declaration);
      return;
    }
    if (["function_definition", "function_declaration"].includes(node.type)) {
      const name = node.childForFieldName("name");
      if (name?.text === "this") return;
      this.declare(node, name, "function", namespace, owner);
      return;
    }
    if (node.type === "type_definition") {
      this.declare(
        node,
        node.childForFieldName("name"),
        "type",
        namespace,
        owner,
      );
      return;
    }
    if (
      [
        "val_definition",
        "var_definition",
        "val_declaration",
        "var_declaration",
      ].includes(node.type)
    ) {
      const pattern =
        node.childForFieldName("pattern") ?? node.childForFieldName("name");
      if (pattern === null)
        this.problem(
          "binding-pattern",
          "A value declaration has no static binding name.",
          node,
        );
      else
        for (const name of this.bindings(pattern, node, owner))
          this.declare(node, name, "property", namespace, owner);
      return;
    }
    if (node.type === "given_definition") {
      const declaration = this.declare(
        node,
        node.childForFieldName("name"),
        "property",
        namespace,
        owner,
      );
      if (declaration === undefined) return;
      for (const body of node.childrenForFieldName("body"))
        if (["template_body", "with_template_body"].includes(body.type))
          this.scope(body.namedChildren, namespace, declaration);
      return;
    }
    if (node.type === "extension_definition") {
      const before = this.declarations.length;
      this.scope(
        node.childrenForFieldName("body").filter((child) => child.isNamed),
        namespace,
        owner,
      );
      for (const declaration of this.declarations.slice(before)) {
        if (declaration.ownerDeclarationId !== owner?.id) continue;
        const header = {
          start: this.session.range(node).start,
          end: this.session.range(node.childrenForFieldName("body")[0] ?? node)
            .start,
        };
        declaration.site.range = {
          start: header.start,
          end: declaration.site.range.end,
        };
        declaration.site.content = [header, ...declaration.site.content];
        this.attach(node, declaration);
      }
      return;
    }
    if (node.type === "enum_case_definitions") {
      for (const child of node.namedChildren.filter((part) =>
        ["simple_enum_case", "full_enum_case"].includes(part.type),
      )) {
        const name =
          child.childForFieldName("name") ??
          child.namedChildren.find((part) => part.type === "identifier") ??
          null;
        const full = child.namedChildren.some(
          (part) => part.type === "class_parameters",
        );
        const declaration = this.declare(
          child,
          name,
          full ? "type" : "property",
          namespace,
          owner,
        );
        if (declaration === undefined) continue;
        this.attach(node, declaration);
        if (full)
          for (const list of child.namedChildren.filter(
            (part) => part.type === "class_parameters",
          ))
            for (const parameter of list.namedChildren.filter(
              (part) => part.type === "class_parameter",
            ))
              this.declare(
                parameter,
                parameter.childForFieldName("name"),
                "property",
                namespace,
                declaration,
              );
      }
      return;
    }
    if (node.type === "export_declaration") {
      this.export(node, namespace, owner);
      return;
    }
    if (
      [
        "comment",
        "block_comment",
        "import_declaration",
        "end_marker",
        "self_type",
      ].includes(node.type)
    )
      return;
    if (
      owner?.public !== false &&
      (node.type.endsWith("_definition") || node.type.endsWith("_declaration"))
    )
      this.problem(
        "unsupported-declaration",
        `Unsupported public Scala declaration '${node.type}'.`,
        node,
      );
  }

  /**
   * Retains only statically bound value names from a Scala binding pattern.
   *
   * Identifiers, tuple patterns, and multi-name patterns expand into
   * declarations; visible extractor or typed patterns report a boundary.
   */
  private bindings(
    pattern: EvidenceNode,
    node: EvidenceNode,
    owner: IEvidenceScalaDeclaration | undefined,
  ): EvidenceNode[] {
    if (["identifier", "operator_identifier"].includes(pattern.type))
      return pattern.text === "_" ? [] : [pattern];
    if (["identifiers", "tuple_pattern"].includes(pattern.type))
      return pattern.namedChildren.flatMap((child) =>
        this.bindings(child, node, owner),
      );
    if (pattern.type === "wildcard") return [];
    if (this.visible(node, owner))
      this.problem(
        "binding-pattern",
        "Extractor and typed binding patterns require binding and stable-name resolution.",
        node,
      );
    return [];
  }

  /**
   * Creates one lexical declaration without synthesizing runtime or compiler
   * members.
   *
   * The record captures visibility, address, lookup path, source site, and
   * unsupported semantic boundaries for later publication.
   */
  private declare(
    node: EvidenceNode,
    nameNode: EvidenceNode | null,
    symbol: EvidenceProgrammingSymbol,
    namespace: string[],
    owner: IEvidenceScalaDeclaration | undefined,
    rename?: string,
  ): IEvidenceScalaDeclaration | undefined {
    const visible = this.visible(node, owner);
    if (nameNode === null) {
      if (visible)
        this.problem(
          "anonymous-given",
          "Anonymous givens require compiler-assigned names. Give the instance an explicit source name before addressing it.",
          node,
        );
      return undefined;
    }
    const name = rename ?? this.name(nameNode);
    const object = node.type === "object_definition";
    const segment = object
      ? `object ${name}`
      : node.type === "package_object"
        ? `package object ${name}`
        : name;
    const address = [...(owner?.address ?? namespace), segment];
    const range = this.session.range(node);
    const siteId = `scala:${this.source.id}:site:${node.startIndex}:${node.endIndex}`;
    const declaration: IEvidenceScalaDeclaration = {
      id: `${siteId}:${symbol}:${name}`,
      name,
      symbol,
      identity: address,
      address,
      lookup: [...(owner?.lookup ?? namespace), name],
      public: visible,
      object,
      syntax: node.type,
      site: {
        id: siteId,
        file: this.source.physicalPath,
        range,
        content: [range],
      },
      ...(owner === undefined ? {} : { ownerDeclarationId: owner.id }),
    };
    if (visible && node.descendantsOfType("macro_body").length !== 0)
      this.problem(
        "macro",
        "Macro expansion is outside the explicit Scala source surface.",
        node,
      );
    if (
      visible &&
      ["type", "return_type"].some((field) => {
        const type = node.childForFieldName(field);
        return (
          type !== null &&
          (type.type === "structural_type" ||
            type.descendantsOfType("structural_type").length !== 0)
        );
      })
    )
      this.problem(
        "structural-type",
        "Structural member types require explicit member ownership resolution.",
        node,
      );
    const value = node.childForFieldName("value");
    if (
      visible &&
      value !== null &&
      value.descendantsOfType("template_body").length !== 0
    )
      this.problem(
        "anonymous-members",
        "Anonymous initializer members require inferred public type resolution.",
        node,
      );
    this.declarations.push(declaration);
    this.attach(node, declaration);
    return declaration;
  }

  /**
   * Determines whether a declaration is publicly visible through its lexical
   * chain.
   *
   * Any private or protected modifier, or a restricted owner, excludes the
   * declaration from the public population.
   */
  private visible(
    node: EvidenceNode,
    owner: IEvidenceScalaDeclaration | undefined,
  ): boolean {
    const modifiers = node.namedChildren.find(
      (child) => child.type === "modifiers",
    );
    return (
      owner?.public !== false &&
      (modifiers === undefined ||
        modifiers.descendantsOfType("access_modifier").length === 0)
    );
  }

  /**
   * Records supported named exports from selected singleton objects.
   *
   * Resolution distinguishes foreign forwarding from selected local aliases.
   * Unsupported local selectors remain incomplete instead of losing owners.
   */
  private export(
    node: EvidenceNode,
    namespace: string[],
    owner: IEvidenceScalaDeclaration | undefined,
  ): void {
    if (owner?.public === false) return;
    const imported: boolean =
      this.session.root.descendantsOfType("import_declaration").length !== 0;
    const path = node
      .childrenForFieldName("path")
      .filter((child) => child.isNamed);
    const selectors = node.namedChildren.find(
      (child) => child.type === "namespace_selectors",
    );
    const renamed = node.namedChildren.find(
      (child) => child.type === "as_renamed_identifier",
    );
    const wildcard: EvidenceNode | undefined = node.namedChildren.find(
      (child: EvidenceNode): boolean => child.type === "namespace_wildcard",
    );
    const names =
      selectors?.namedChildren ??
      (wildcard !== undefined
        ? [wildcard]
        : renamed === undefined
          ? path.slice(-1)
          : [renamed]);
    const qualifier = (
      selectors === undefined && renamed === undefined && wildcard === undefined
        ? path.slice(0, -1)
        : path
    ).map((part) => this.name(part));
    if (
      qualifier.length === 0 ||
      node.children.some((child) => child.text === "given")
    ) {
      this.problem(
        "export-resolution",
        "Only explicit named exports from selected singleton objects are supported; wildcard, given, and unqualified exports require member resolution.",
        node,
      );
      return;
    }
    for (const selected of names) {
      const parts = [
        "as_renamed_identifier",
        "arrow_renamed_identifier",
      ].includes(selected.type)
        ? selected.namedChildren
        : [selected];
      const member = parts[0];
      const alias = parts.at(-1);
      if (
        member === undefined ||
        alias === undefined ||
        ![
          "identifier",
          "operator_identifier",
          "namespace_wildcard",
          "wildcard",
        ].includes(member.type) ||
        alias.text === "_"
      ) {
        this.problem(
          "export-resolution",
          "This export selector requires unsupported name or given resolution.",
          node,
        );
        continue;
      }
      const declaration = this.declare(
        node,
        member,
        "property",
        namespace,
        owner,
        this.name(alias),
      );
      if (declaration === undefined) continue;
      declaration.public = false;
      const scope = owner?.lookup ?? namespace;
      const paths: string[][] = [];
      for (let length = scope.length; length >= 0; --length)
        paths.push([...scope.slice(0, length), ...qualifier]);
      this.exports.push({
        declaration,
        paths,
        qualifierLength: qualifier.length,
        member: this.name(member),
        imported,
      });
    }
  }

  /**
   * Decodes a backticked Scala name into its literal accessor segment.
   *
   * Unquoted names retain their source text, while only the surrounding
   * backticks are removed.
   */
  private name(node: EvidenceNode): string {
    return node.text.startsWith("`") ? node.text.slice(1, -1) : node.text;
  }

  /**
   * Attaches a Scaladoc carrier only when it immediately precedes a declaration
   * through whitespace.
   *
   * Other comments, intervening syntax, and non-Scaladoc blocks remain
   * unattached for unsupported-host handling.
   */
  private attach(
    node: EvidenceNode,
    declaration: IEvidenceScalaDeclaration,
  ): void {
    const previous = node.previousNamedSibling;
    if (
      previous === null ||
      previous.type !== "block_comment" ||
      !previous.text.startsWith("/**") ||
      !/^\s*$/u.test(
        this.source.content.slice(previous.endIndex, node.startIndex),
      )
    )
      return;
    const documentation = this.documentation.get(previous.startIndex);
    if (documentation !== undefined)
      documentation.attachments.push({
        declarationId: declaration.id,
        siteId: declaration.site.id,
      });
  }

  /**
   * Classifies comments and tag-bearing literal strings without treating them
   * as declarations.
   *
   * Scaladoc may attach to a declaration; other tag-shaped carriers remain
   * available for diagnostics.
   */
  private collectDocumentation(): void {
    const nodes: EvidenceNode[] = this.session.root.descendantsOfType([
      "block_comment",
      "comment",
    ]);
    for (const node of nodes) {
      const scaladoc: boolean =
        node.type === "block_comment" && node.text.startsWith("/**");
      if (
        !scaladoc &&
        !/@(?:evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link|internal|hidden|ignore)\b/u.test(
          node.text,
        )
      )
        continue;
      const opening: string =
        node.type === "block_comment" ? (scaladoc ? "/**" : "/*") : "//";
      this.documentation.set(node.startIndex, {
        id: `scala:${this.source.id}:documentation:${node.startIndex}`,
        range: this.session.range(node),
        syntax: {
          opening,
          closing: node.type === "block_comment" ? "*/" : "",
          ...(node.type === "block_comment" ? { linePrefix: "*" } : {}),
          tagBoundaries: true,
          allowWithdrawal: scaladoc,
        },
        attachments: [],
      });
    }
  }

  /**
   * Reports an actionable incomplete-analysis boundary at the original syntax
   * range.
   *
   * The repair directs authors toward supported explicit declarations before
   * graph evaluation can use the inventory.
   */
  private problem(code: string, message: string, node: EvidenceNode): void {
    this.diagnostics.push({
      code: `scala-${code}`,
      severity: "error",
      message,
      repair:
        "Use supported explicit Scala declarations or implement the reported source-resolution boundary before evaluating coverage.",
      location: {
        file: this.source.physicalPath,
        range: this.session.range(node),
      },
    });
  }
}
