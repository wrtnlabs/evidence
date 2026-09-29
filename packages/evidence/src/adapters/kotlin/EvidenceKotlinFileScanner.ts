import type { Node as EvidenceNode } from "web-tree-sitter";

import type { EvidenceParseSession } from "../../parsers/EvidenceParseSession";
import type { IEvidenceCommentSyntax } from "../../structures/IEvidenceCommentSyntax";
import type { IEvidenceDiagnostic } from "../../structures/IEvidenceDiagnostic";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceRange } from "../../structures/IEvidenceSourceRange";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { IEvidenceKotlinDeclaration } from "./IEvidenceKotlinDeclaration";
import type { IEvidenceKotlinDocumentation } from "./IEvidenceKotlinDocumentation";
import type { IEvidenceKotlinFileAnalysis } from "./IEvidenceKotlinFileAnalysis";
import type { IEvidenceKotlinTypeReference } from "./IEvidenceKotlinTypeReference";

/**
 * Extracts lexical Kotlin declarations without executing scripts or compiler
 * synthesis.
 *
 * The scanner retains package, import, receiver, and alias facts so the later
 * resolver can establish extension ownership without guessing from local
 * syntax.
 */
export class EvidenceKotlinFileScanner {
  /**
   * Copied declarations retained after the parser callback ends.
   *
   * The scanner emits this collection as serializable analysis data for later
   * receiver resolution and unit materialization.
   */
  private readonly declarations: IEvidenceKotlinDeclaration[] = [];

  /**
   * Documentation keyed by its original source start offset.
   *
   * Adjacent declaration attachment looks up the preceding comment by this
   * stable parser coordinate while nodes are still borrowed.
   */
  private readonly documentation = new Map<
    number,
    IEvidenceKotlinDocumentation
  >();

  /**
   * Failures that prevent a complete public denominator.
   *
   * The emitted analysis derives completeness from this collection so
   * unsupported Kotlin source cannot make coverage pass by omitting
   * declarations.
   */
  private readonly diagnostics: IEvidenceDiagnostic[] = [];

  /**
   * Package segments used for snapshot-wide semantic identities.
   *
   * Every top-level declaration receives this prefix before nested ownership
   * and extension receiver segments are appended.
   */
  private packagePath: string[] = [];

  /**
   * Explicit import names used to normalize extension receivers.
   *
   * An alias maps its local first segment to the imported nominal path during
   * receiver candidate construction.
   */
  private readonly imports = new Map<string, string[]>();

  /**
   * Whether a wildcard import requires dependency resolution for unknown
   * receiver names.
   *
   * Its presence prevents the scanner from assuming that an unqualified core
   * type name necessarily refers to Kotlin's built-in declaration.
   */
  private wildcardImport = false;

  /**
   * Borrows syntax and source only for the active parse callback.
   *
   * Source identity defines file-private lookup boundaries; serializable ranges
   * and paths outlive the session in the emitted analysis.
   */
  public constructor(
    private readonly session: EvidenceParseSession,
    private readonly source: IEvidenceSourceFile,
  ) {}

  /**
   * Returns serializable declarations and conservative boundary diagnostics.
   *
   * Import collection precedes declaration extraction because receiver lookup
   * preserves the source-defined alternatives and their order.
   */
  public scan(): IEvidenceKotlinFileAnalysis {
    this.collectDocumentation();
    const packageNode = this.session.root.namedChildren.find(
      (node) => node.type === "package_header",
    );
    const packageName =
      packageNode === undefined
        ? undefined
        : packageNode.namedChildren.find(
            (node) => node.type === "qualified_identifier",
          );
    this.packagePath =
      packageName === undefined
        ? []
        : packageName.namedChildren.map((node) => this.name(node));
    for (const node of this.session.root.namedChildren.filter(
      (child) => child.type === "import",
    )) {
      const path = node.namedChildren.find(
        (child) => child.type === "qualified_identifier",
      );
      if (path === undefined) continue;
      if (node.children.some((child) => child.text === "*")) {
        this.wildcardImport = true;
        continue;
      }
      const parts = path.namedChildren.map((child) => this.name(child));
      const alias = node.namedChildren.find(
        (child) => child.type === "identifier",
      );
      const local = alias === undefined ? parts.at(-1) : this.name(alias);
      if (local !== undefined) this.imports.set(local, parts);
    }
    this.scope(this.session.root, undefined);
    return {
      source: this.source,
      declarations: this.declarations,
      documentation: [...this.documentation.values()],
      diagnostics: this.diagnostics,
      complete: this.diagnostics.length === 0,
    };
  }

  /**
   * Visits declaration scopes without entering local function bodies or
   * initializer expressions.
   *
   * Those regions can execute or introduce local values, neither of which
   * belongs to the static public declaration surface.
   */
  private scope(
    body: EvidenceNode,
    owner: IEvidenceKotlinDeclaration | undefined,
  ): void {
    for (const node of body.namedChildren) {
      switch (node.type) {
        case "package_header":
        case "import":
        case "file_annotation":
        case "line_comment":
        case "block_comment":
        case "anonymous_initializer":
        case "secondary_constructor":
          break;
        case "annotated_expression":
          if (!this.detachedAnnotation(node))
            this.problem(
              "source-form",
              "A top-level annotated expression is not a declaration annotation.",
              node,
            );
          break;
        case "class_declaration":
        case "object_declaration":
        case "companion_object":
          this.nominal(node, owner);
          break;
        case "type_alias":
          this.add(node, node.childForFieldName("type"), "type", owner);
          break;
        case "function_declaration":
          this.add(node, node.childForFieldName("name"), "function", owner);
          break;
        case "property_declaration": {
          const variable = node.namedChildren.find(
            (child) => child.type === "variable_declaration",
          );
          if (variable === undefined) {
            if (this.visible(node, owner))
              this.problem(
                "destructuring",
                "Public destructuring requires component ownership that is not established by this adapter.",
                node,
              );
            break;
          }
          const declaration = this.add(
            node,
            variable.namedChildren.find(
              (child) => child.type === "identifier",
            ) ?? null,
            "property",
            owner,
          );
          if (declaration !== undefined)
            for (const accessor of node.namedChildren.filter(
              (child) => child.type === "getter" || child.type === "setter",
            ))
              this.attach(accessor, declaration);
          break;
        }
        case "enum_entry":
          this.add(
            node,
            node.namedChildren.find((child) => child.type === "identifier") ??
              null,
            "property",
            owner,
          );
          break;
        default:
          if (owner?.public !== false)
            this.problem(
              "source-form",
              `The declaration scope contains unsupported '${node.type}' syntax. Script execution and generated declarations are outside the source contract.`,
              node,
            );
      }
    }
  }

  /**
   * Establishes nominal ownership before reading constructor properties and
   * members.
   *
   * Constructor `val` and `var` parameters, enum entries, and body members use
   * the emitted type declaration as their semantic owner.
   */
  private nominal(
    node: EvidenceNode,
    owner: IEvidenceKotlinDeclaration | undefined,
  ): void {
    const declaration = this.add(
      node,
      node.childForFieldName("name"),
      "type",
      owner,
      node.type === "companion_object" ? "Companion" : undefined,
    );
    if (declaration === undefined) return;
    const constructor = node.namedChildren.find(
      (child) => child.type === "primary_constructor",
    );
    const parameters =
      constructor === undefined
        ? undefined
        : constructor.namedChildren.find(
            (child) => child.type === "class_parameters",
          );
    for (const parameter of parameters === undefined
      ? []
      : parameters.namedChildren.filter(
          (child) => child.type === "class_parameter",
        ))
      if (
        parameter.children.some(
          (child) => child.text === "val" || child.text === "var",
        )
      )
        this.add(
          parameter,
          parameter.namedChildren.find(
            (child) => child.type === "identifier",
          ) ?? null,
          "property",
          declaration,
        );
    const body = node.namedChildren.find(
      (child) =>
        child.type === "class_body" || child.type === "enum_class_body",
    );
    if (body !== undefined) this.scope(body, declaration);
  }

  /**
   * Records one declaration site and checks surface-changing header constructs.
   *
   * The method captures a static name, visibility, ownership, and attached KDoc
   * while reporting modifiers that need compiler or source-set resolution.
   */
  private add(
    node: EvidenceNode,
    nameNode: EvidenceNode | null,
    symbol: EvidenceProgrammingSymbol,
    owner: IEvidenceKotlinDeclaration | undefined,
    fallback?: string,
  ): IEvidenceKotlinDeclaration | undefined {
    const name = nameNode === null ? fallback : this.name(nameNode);
    if (name === undefined) {
      if (this.visible(node, owner))
        this.problem(
          "declaration-name",
          "A public declaration has no statically addressable name.",
          node,
        );
      return undefined;
    }
    const visible = this.visible(node, owner);
    const modifiers = node.namedChildren.find(
      (child) => child.type === "modifiers",
    );
    const modifierWords =
      modifiers === undefined
        ? []
        : modifiers.namedChildren
            .filter((child) => child.type !== "annotation")
            .flatMap((child) => child.text.split(/\s+/u));
    if (visible) {
      if (modifierWords.some((word) => word === "expect" || word === "actual"))
        this.problem(
          "multiplatform",
          "Multiplatform expect/actual ownership requires source-set resolution.",
          node,
        );
      if (
        modifierWords.includes("override") &&
        !modifierWords.includes("public")
      )
        this.problem(
          "override-visibility",
          "An override without explicit visibility inherits base-member visibility, which this adapter cannot establish. Declare public visibility explicitly or implement base-member resolution.",
          node,
        );
      const delegation = node.namedChildren.find(
        (child) => child.type === "delegation_specifiers",
      );
      if (
        (delegation !== undefined &&
          delegation.descendantsOfType("explicit_delegation").length !== 0) ||
        node.namedChildren.some((child) => child.type === "property_delegate")
      )
        this.problem(
          "delegation",
          "Delegated members require generated-member and accessor ownership resolution.",
          node,
        );
    }
    const parameters = node.namedChildren.find(
      (child) => child.type === "type_parameters",
    );
    const typeParameters = [
      ...(owner?.typeParameters ?? []),
      ...(parameters === undefined
        ? []
        : parameters.namedChildren
            .filter((child) => child.type === "type_parameter")
            .flatMap((child) =>
              child.namedChildren
                .filter((part) => part.type === "identifier")
                .map((part) => this.name(part)),
            )),
    ];
    const receiverNode = this.receiver(node, nameNode);
    const receiver =
      receiverNode === undefined
        ? undefined
        : this.typeReference(receiverNode, owner, typeParameters);
    const aliasNode =
      node.type === "type_alias" ? node.namedChildren.at(-1) : undefined;
    const address = [
      ...(owner?.address ?? []),
      ...(receiver === undefined ? [] : ["extension"]),
      name,
    ];
    const prefix = this.annotationPrefix(node);
    const range: IEvidenceSourceRange = {
      start: this.session.range(prefix).start,
      end: this.session.range(node).end,
    };
    const siteId = `kotlin:${this.source.id}:site:${node.startIndex}:${node.endIndex}`;
    const declaration: IEvidenceKotlinDeclaration = {
      id: `${siteId}:${symbol}:${name}`,
      name,
      symbol,
      typeParameters,
      ...(receiver === undefined ? {} : { receiver }),
      ...(aliasNode === undefined
        ? {}
        : {
            aliasTarget: this.typeReference(aliasNode, owner, typeParameters),
          }),
      identity: [...this.packagePath, ...address],
      address,
      public: visible,
      filePrivate:
        owner?.filePrivate === true || modifierWords.includes("private"),
      site: {
        id: siteId,
        file: this.source.physicalPath,
        range,
        content: [range],
      },
      ...(owner === undefined ? {} : { ownerDeclarationId: owner.id }),
    };
    this.declarations.push(declaration);
    this.attach(node, declaration);
    return declaration;
  }

  /**
   * Applies lexical visibility without letting a restricted setter hide a
   * property.
   *
   * A member is public unless its owner is nonpublic or its own declaration has
   * a nonpublic visibility modifier; accessor restrictions do not change it.
   */
  private visible(
    node: EvidenceNode,
    owner: IEvidenceKotlinDeclaration | undefined,
  ): boolean {
    const modifiers = node.namedChildren.find(
      (child) => child.type === "modifiers",
    );
    return (
      owner?.public !== false &&
      (modifiers === undefined ||
        !modifiers.namedChildren.some(
          (child) =>
            child.type === "visibility_modifier" && child.text !== "public",
        ))
    );
  }

  /**
   * Separates extension declarations from ordinary members and other receiver
   * types.
   *
   * Only a receiver type preceding a function or property name establishes an
   * extension; later type nodes cannot change its owner identity.
   */
  private receiver(
    node: EvidenceNode,
    nameNode: EvidenceNode | null,
  ): EvidenceNode | undefined {
    if (
      node.type !== "function_declaration" &&
      node.type !== "property_declaration"
    )
      return undefined;
    const receiver = node.namedChildren.find(
      (child) =>
        [
          "user_type",
          "nullable_type",
          "parenthesized_type",
          "function_type",
          "non_nullable_type",
        ].includes(child.type) && child.endIndex <= (nameNode?.startIndex ?? 0),
    );
    return receiver;
  }

  /**
   * Retains nominal lookup paths and makes unresolved type substitution
   * explicit.
   *
   * Candidate paths preserve lexical, import, package, and qualified
   * alternatives; generic and compound receivers carry a problem instead of a
   * guessed owner.
   */
  private typeReference(
    node: EvidenceNode,
    owner: IEvidenceKotlinDeclaration | undefined,
    typeParameters: string[],
  ): IEvidenceKotlinTypeReference {
    const nullable = node.type === "nullable_type";
    const nominal = nullable
      ? node.namedChildren.find((child) => child.type === "user_type")
      : node;
    const names =
      nominal === undefined
        ? []
        : nominal.namedChildren
            .filter((child) => child.type === "identifier")
            .map((child) => this.name(child));
    const first = names[0];
    if (
      nominal === undefined ||
      nominal.type !== "user_type" ||
      first === undefined ||
      nominal.descendantsOfType("type_arguments").length !== 0 ||
      typeParameters.includes(first)
    )
      return {
        file: this.source.physicalPath,
        paths: [],
        nullable,
        problem:
          "Generic, type-parameter, function, and compound receivers require type substitution beyond nominal source resolution.",
      };
    const paths: string[][] = [];
    const scope = owner?.identity ?? this.packagePath;
    for (let length = scope.length; length > this.packagePath.length; --length)
      paths.push([...scope.slice(0, length), ...names]);
    const imported = this.imports.get(first);
    if (imported !== undefined) paths.push([...imported, ...names.slice(1)]);
    paths.push([...this.packagePath, ...names]);
    if (names.length > 1) paths.push(names);
    const core = [
      "Any",
      "Nothing",
      "Unit",
      "String",
      "Number",
      "Byte",
      "Short",
      "Int",
      "Long",
      "UByte",
      "UShort",
      "UInt",
      "ULong",
      "Float",
      "Double",
      "Boolean",
      "Char",
      "Throwable",
      "Annotation",
    ].includes(first);
    const external =
      imported !== undefined
        ? [...imported, ...names.slice(1)]
        : names.length > 1
          ? names
          : core && !this.wildcardImport
            ? ["kotlin", first]
            : undefined;
    return {
      file: this.source.physicalPath,
      paths,
      nullable,
      ...(external === undefined ? {} : { external }),
    };
  }

  /**
   * Decodes Kotlin backtick names as literal accessor segments.
   *
   * Removing only the delimiters preserves punctuation or whitespace that the
   * source author made part of the declaration name.
   */
  private name(node: EvidenceNode): string {
    return node.text.startsWith("`") ? node.text.slice(1, -1) : node.text;
  }

  /**
   * Attaches only adjacent KDoc because annotations already belong to the
   * declaration node.
   *
   * Whitespace-only separation prevents a nearby unrelated documentation block
   * from being attached to the next declaration.
   */
  private attach(
    node: EvidenceNode,
    declaration: IEvidenceKotlinDeclaration,
  ): void {
    const prefix = this.annotationPrefix(node);
    const previous = prefix.previousNamedSibling;
    if (
      previous === null ||
      previous.type !== "block_comment" ||
      !previous.text.startsWith("/**")
    )
      return;
    if (
      !/^\s*$/u.test(
        this.source.content.slice(previous.endIndex, prefix.startIndex),
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
   * Includes annotation calls that the upstream grammar separates from a
   * declaration.
   *
   * The returned prefix expands the declaration site and KDoc adjacency across
   * contiguous detached annotation expressions.
   */
  private annotationPrefix(node: EvidenceNode): EvidenceNode {
    let prefix = node;
    while (
      prefix.previousNamedSibling !== null &&
      this.detachedAnnotation(prefix.previousNamedSibling)
    )
      prefix = prefix.previousNamedSibling;
    return prefix;
  }

  /**
   * Recognizes only an annotation name immediately followed by its
   * parenthesized argument.
   *
   * The strict shape avoids treating arbitrary annotated expressions as
   * declaration prefixes when their expression or spacing could alter source
   * semantics.
   */
  private detachedAnnotation(node: EvidenceNode): boolean {
    if (node.type !== "annotated_expression") return false;
    const children = node.namedChildren;
    const annotation = children[0];
    const argumentsNode = children[1];
    if (
      children.length !== 2 ||
      annotation?.type !== "annotation" ||
      argumentsNode?.type !== "parenthesized_expression" ||
      annotation.endIndex !== argumentsNode.startIndex
    )
      return false;
    const next = node.nextNamedSibling;
    return (
      next !== null &&
      [
        "class_declaration",
        "object_declaration",
        "function_declaration",
        "property_declaration",
        "type_alias",
      ].includes(next.type) &&
      /^\s*$/u.test(this.source.content.slice(node.endIndex, next.startIndex))
    );
  }

  /**
   * Retains real KDoc and unsupported annotation carriers for truthful
   * diagnostics.
   *
   * Annotation-shaped text in comments and strings is retained so the common
   * tag parser can report unsupported placement instead of silently ignoring
   * it.
   */
  private collectDocumentation(): void {
    const nodes: EvidenceNode[] = this.session.root.descendantsOfType([
      "block_comment",
      "line_comment",
    ]);
    for (const node of nodes) {
      const kdoc: boolean =
        node.type === "block_comment" && node.text.startsWith("/**");
      if (
        !kdoc &&
        !/@(?:evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link|internal|hidden|ignore)\b/u.test(
          node.text,
        )
      )
        continue;
      const opening: string =
        node.type === "block_comment" ? (kdoc ? "/**" : "/*") : "//";
      const syntax: IEvidenceCommentSyntax = {
        opening,
        closing: node.type === "block_comment" ? "*/" : "",
        ...(node.type === "block_comment" ? { linePrefix: "*" } : {}),
        tagBoundaries: true,
        allowWithdrawal: kdoc,
      };
      this.documentation.set(node.startIndex, {
        id: `kotlin:${this.source.id}:documentation:${node.startIndex}`,
        range: this.session.range(node),
        syntax,
        attachments: [],
      });
    }
  }

  /**
   * Keeps unsupported extraction visible to graph evaluation.
   *
   * Every diagnostic names the Kotlin boundary and source range, causing the
   * analysis to be incomplete rather than publishing a reduced declaration
   * set.
   */
  private problem(code: string, message: string, node: EvidenceNode): void {
    this.diagnostics.push({
      code: `kotlin-${code}`,
      severity: "error",
      message,
      repair:
        "Select supported explicit Kotlin source or implement the reported semantic boundary before evaluating coverage.",
      location: {
        file: this.source.physicalPath,
        range: this.session.range(node),
      },
    });
  }
}
