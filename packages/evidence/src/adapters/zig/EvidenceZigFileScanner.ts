import typia from "typia";
import type { Node as EvidenceNode } from "web-tree-sitter";

import type { EvidenceParseSession } from "../../parsers/EvidenceParseSession";
import type { IEvidenceDiagnostic } from "../../structures/IEvidenceDiagnostic";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { IEvidenceZigDeclaration } from "./IEvidenceZigDeclaration";
import type { IEvidenceZigDocumentation } from "./IEvidenceZigDocumentation";
import type { IEvidenceZigFileAnalysis } from "./IEvidenceZigFileAnalysis";

/**
 * Reads declared Zig namespaces without evaluating build or comptime code.
 *
 * It preserves physical declarations and alias projections separately, allowing
 * later materialization to publish several paths for one semantic unit.
 */
export class EvidenceZigFileScanner {
  /**
   * Collects serializable declarations, including intentional alias
   * projections.
   *
   * Each entry preserves its physical site and public path before the parser
   * session closes and later reconciliation merges aliases into canonical
   * units.
   */
  private readonly declarations: IEvidenceZigDeclaration[] = [];

  /**
   * Indexes documentation carriers by their adjacent source-line position.
   *
   * Declaration attachment uses this grouping to find contiguous triple-slash
   * comments without attaching ordinary comments or string literals by
   * proximity.
   */
  private readonly documentation = new Map<number, IEvidenceZigDocumentation>();

  /**
   * Collects unsupported public forms that prevent a complete population.
   *
   * The scan result uses a nonempty set to preserve extraction uncertainty in
   * the final inventory instead of certifying only the recognized
   * declarations.
   */
  private readonly diagnostics: IEvidenceDiagnostic[] = [];

  /**
   * Borrows the real syntax tree for the bounded parser callback.
   *
   * The scanner copies source identity and ranges into records before
   * returning, so no inventory state relies on a parser node after the callback
   * ends.
   */
  public constructor(
    private readonly session: EvidenceParseSession,
    private readonly source: IEvidenceSourceFile,
  ) {}

  /**
   * Extracts explicit public declarations and classified annotation carriers.
   *
   * Carrier collection precedes alias resolution so documentation retains its
   * original site while reconciliation decides which unit receives it.
   */
  public scan(): IEvidenceZigFileAnalysis {
    this.collectDocumentation();
    this.scope(this.session.root, undefined, [], new Set<number>());
    return {
      source: this.source,
      declarations: this.declarations,
      documentation: [...this.documentation.values()],
      diagnostics: this.diagnostics,
      complete: this.diagnostics.length === 0,
    };
  }

  /**
   * Visits supported namespace members while excluding local function bodies
   * and tests.
   *
   * Only namespace scope can establish declared public surface, so unsupported
   * comptime execution and namespace injection become incomplete diagnostics.
   */
  private scope(
    body: EvidenceNode,
    owner: IEvidenceZigDeclaration | undefined,
    canonical: string[],
    visited: Set<number>,
  ): void {
    for (const node of body.namedChildren) {
      if (node.type === "comment" || node.type === "test_declaration") continue;
      if (node.type === "comptime_declaration") {
        this.problem(
          "comptime",
          "Namespace comptime execution may change exported declarations and cannot be evaluated from source.",
          node,
        );
        continue;
      }
      const field = node.type === "container_field";
      if (
        field &&
        body.type === "enum_declaration" &&
        node.childForFieldName("name")?.text === "_"
      )
        continue;
      const visible =
        field || node.children.some((child) => child.text === "pub");
      if (node.type === "using_namespace_declaration") {
        const imported: EvidenceNode | undefined = node.namedChildren.find(
          (child: EvidenceNode): boolean => child.type !== "comment",
        );
        if (
          imported !== undefined &&
          this.foreignImport(imported, body, new Set<number>())
        )
          continue;
        // Private namespace imports can also participate in public name lookup.
        this.problem(
          "usingnamespace",
          "Namespace injection requires resolving all imported public members and lookup conflicts.",
          node,
        );
        continue;
      }
      if (!visible) continue;
      // A const namespace alias forwards its dependency's declarations rather
      // than defining a new local type or property obligation.
      if (
        node.type === "variable_declaration" &&
        node.children.some(
          (child: EvidenceNode): boolean => child.type === "const",
        ) &&
        node.childForFieldName("type") === null
      ) {
        const initializer: EvidenceNode | undefined = this.initializer(node);
        if (
          initializer !== undefined &&
          this.foreignImport(initializer, body, new Set<number>())
        )
          continue;
      }
      if (
        ![
          "variable_declaration",
          "function_declaration",
          "container_field",
        ].includes(node.type)
      ) {
        this.problem(
          "source-form",
          `Unsupported public Zig namespace member '${node.type}'.`,
          node,
        );
        continue;
      }
      this.declaration(node, body, owner, canonical, undefined, visited);
    }
  }

  /**
   * Resolves bounded local aliases and establishes container ownership.
   *
   * Recursion is restricted to declarations in the current lexical container,
   * preserving canonical identity while rejecting cycles and ambiguous
   * targets.
   */
  private declaration(
    node: EvidenceNode,
    scope: EvidenceNode,
    owner: IEvidenceZigDeclaration | undefined,
    canonical: string[],
    exposed: string | undefined,
    visited: Set<number>,
  ): IEvidenceZigDeclaration | undefined {
    if (visited.has(node.startIndex)) {
      this.problem(
        "alias-cycle",
        "A public alias has cyclic local declaration ownership.",
        node,
      );
      return undefined;
    }
    const next = new Set(visited).add(node.startIndex);
    const nameNode =
      node.childForFieldName("name") ??
      node.namedChildren.find((child) => child.type === "identifier");
    if (
      nameNode === undefined ||
      nameNode === null ||
      nameNode.type !== "identifier"
    ) {
      this.problem(
        "declaration-name",
        "A public field or declaration has no supported literal name; tuple fields require numeric ownership.",
        node,
      );
      return undefined;
    }
    const name = this.name(nameNode);
    const duplicates = scope.namedChildren.filter((child) => {
      const candidate =
        child.childForFieldName("name") ??
        (child.type === "variable_declaration"
          ? child.namedChildren.find((part) => part.type === "identifier")
          : undefined);
      return (
        candidate !== null &&
        candidate !== undefined &&
        this.name(candidate) === name
      );
    });
    if (duplicates.length > 1)
      this.problem(
        "duplicate-name",
        "This public namespace contains conflicting declarations with the same name.",
        node,
      );
    const address = [...(owner?.address ?? []), exposed ?? name];
    const initializer = this.initializer(node);
    const declaredType = node.childForFieldName("type");
    const declaredMeta =
      declaredType !== null &&
      this.metaType(declaredType, scope, new Set<number>());
    if (
      node.type === "variable_declaration" &&
      (declaredType === null || declaredMeta) &&
      node.children.some((child) => child.text === "const") &&
      initializer?.type === "identifier"
    ) {
      const matches = scope.namedChildren.filter(
        (child) =>
          ["variable_declaration", "function_declaration"].includes(
            child.type,
          ) &&
          this.sameName(
            child.childForFieldName("name") ??
              child.namedChildren.find((part) => part.type === "identifier"),
            initializer,
          ),
      );
      const target = matches[0];
      if (matches.length !== 1 || target === undefined) {
        this.problem(
          "alias-unresolved",
          "The public alias does not resolve to one declaration in its lexical container.",
          node,
        );
        return undefined;
      }
      if (this.scalar(target, scope, new Set<number>()))
        return this.add(
          node,
          name,
          "property",
          owner,
          [...canonical, name],
          address,
          false,
        );
      const original = this.declaration(
        target,
        scope,
        owner,
        canonical,
        exposed ?? name,
        next,
      );
      if (original === undefined) return undefined;
      const alias = this.add(
        node,
        original.name,
        original.symbol,
        owner,
        original.identity,
        address,
        true,
      );
      return alias;
    }
    const container =
      initializer !== undefined && CONTAINERS.has(initializer.type)
        ? initializer
        : undefined;
    const primitiveType =
      initializer !== undefined && TYPE_FORMS.has(initializer.type);
    const symbol: EvidenceProgrammingSymbol =
      node.type === "container_field"
        ? "property"
        : node.type === "function_declaration"
          ? "function"
          : container !== undefined || primitiveType || declaredMeta
            ? "type"
            : "property";
    const declaration = this.add(
      node,
      name,
      symbol,
      owner,
      [...canonical, name],
      address,
      exposed !== undefined,
    );
    if (node.type === "function_declaration") {
      const returnType = node.childForFieldName("type");
      const parameters = node.namedChildren.find(
        (child) => child.type === "parameters",
      );
      const generic =
        parameters !== undefined &&
        parameters.namedChildren.some((parameter) =>
          parameter.children.some(
            (child) => child.text === "comptime" || child.text === "anytype",
          ),
        );
      if (
        (returnType !== null &&
          this.metaType(returnType, scope, new Set<number>())) ||
        (returnType !== null &&
          (returnType.descendantsOfType([
            ...CONTAINERS,
            "builtin_function",
            "call_expression",
            "if_type_expression",
          ]).length !== 0 ||
            [
              ...CONTAINERS,
              "builtin_function",
              "call_expression",
              "if_type_expression",
            ].includes(returnType.type))) ||
        (generic && returnType?.type !== "builtin_type")
      )
        this.problem(
          "type-producing-function",
          "Public type-producing or dependent generic return types require comptime instantiation to establish their reachable members.",
          node,
        );
      return declaration;
    }
    if (
      primitiveType &&
      initializer !== undefined &&
      initializer.descendantsOfType([
        ...CONTAINERS,
        "builtin_function",
        "call_expression",
        "if_type_expression",
      ]).length !== 0
    )
      this.problem(
        "compound-type",
        "A compound public type contains anonymous or computed members requiring static ownership resolution.",
        node,
      );
    if (container !== undefined) {
      if (container.type === "error_set_declaration") {
        for (const member of container.namedChildren.filter(
          (child) => child.type === "identifier",
        )) {
          const memberName = this.name(member);
          this.add(
            member,
            memberName,
            "property",
            declaration,
            [...declaration.identity, memberName],
            [...address, memberName],
            false,
          );
        }
      } else this.scope(container, declaration, declaration.identity, next);
    } else if (initializer?.type === "anonymous_struct_initializer") {
      this.problem(
        "anonymous-value",
        "Anonymous aggregate values require inferred field and tuple ownership; declare an explicit named container.",
        node,
      );
    } else if (
      initializer !== undefined &&
      declaredType === null &&
      !VALUE_FORMS.has(initializer.type) &&
      !primitiveType
    ) {
      this.problem(
        "inferred-surface",
        "An inferred public value may expose a type, namespace, or generated members. Import, conditional, call, and comptime expressions require static ownership resolution.",
        node,
      );
    } else if (declaredMeta && container === undefined && !primitiveType) {
      this.problem(
        "generated-type",
        "A public type value requires resolving its complete member surface without executing comptime code.",
        node,
      );
    }
    if (
      declaredType !== null &&
      ([
        ...CONTAINERS,
        "builtin_function",
        "call_expression",
        "if_type_expression",
      ].includes(declaredType.type) ||
        declaredType.descendantsOfType([
          ...CONTAINERS,
          "builtin_function",
          "call_expression",
          "if_type_expression",
        ]).length !== 0)
    )
      this.problem(
        "anonymous-field-type",
        "An anonymous or computed public declaration type requires nested member ownership; give the type an explicit declaration.",
        node,
      );
    return declaration;
  }

  /**
   * Identifies literal dependency imports and their static namespace aliases.
   *
   * Named packages belong to build-provided dependency namespaces. File paths,
   * the special local root module, dynamic imports, and alias cycles retain
   * their existing ownership boundaries instead of being treated as foreign.
   */
  private foreignImport(
    node: EvidenceNode,
    scope: EvidenceNode,
    visited: Set<number>,
  ): boolean {
    if (visited.has(node.startIndex)) return false;
    visited.add(node.startIndex);
    if (node.type === "builtin_function") {
      const name: EvidenceNode | undefined = node.namedChildren.find(
        (child: EvidenceNode): boolean => child.type === "builtin_identifier",
      );
      const argumentsNode: EvidenceNode | undefined = node.namedChildren.find(
        (child: EvidenceNode): boolean => child.type === "arguments",
      );
      const args: EvidenceNode[] =
        argumentsNode === undefined
          ? []
          : argumentsNode.namedChildren.filter(
              (child: EvidenceNode): boolean => child.type !== "comment",
            );
      const argument: EvidenceNode | undefined = args[0];
      if (
        name?.text !== "@import" ||
        args.length !== 1 ||
        argument?.type !== "string"
      )
        return false;
      const match: RegExpExecArray | null =
        /^"([A-Za-z_][A-Za-z0-9_-]*)"$/u.exec(argument.text);
      return match !== null && match[1] !== "root";
    }
    if (node.type === "identifier") {
      const declaration: EvidenceNode | undefined = scope.namedChildren.find(
        (child: EvidenceNode): boolean =>
          child.type === "variable_declaration" &&
          this.sameName(
            child.childForFieldName("name") ??
              child.namedChildren.find(
                (part: EvidenceNode): boolean => part.type === "identifier",
              ),
            node,
          ),
      );
      const initializer: EvidenceNode | undefined =
        declaration === undefined ? undefined : this.initializer(declaration);
      return (
        initializer !== undefined &&
        this.foreignImport(initializer, scope, visited)
      );
    }
    if (
      node.type === "field_expression" ||
      node.type === "parenthesized_expression"
    ) {
      const base: EvidenceNode | undefined = node.namedChildren[0];
      return base !== undefined && this.foreignImport(base, scope, visited);
    }
    return false;
  }

  /**
   * Recognizes aliases of Zig's metatype in function return positions without
   * execution.
   *
   * Type-producing returns require complete member discovery, so recognizing
   * them allows the scanner to retain an incomplete boundary rather than infer
   * one.
   */
  private metaType(
    node: EvidenceNode,
    scope: EvidenceNode,
    visited: Set<number>,
  ): boolean {
    if (node.text === "type") return true;
    if (node.type !== "identifier" || visited.has(node.startIndex))
      return false;
    visited.add(node.startIndex);
    const target = scope.namedChildren.find(
      (child) =>
        child.type === "variable_declaration" &&
        this.sameName(
          child.namedChildren.find((part) => part.type === "identifier"),
          node,
        ),
    );
    const initializer =
      target === undefined ? undefined : this.initializer(target);
    return (
      initializer !== undefined && this.metaType(initializer, scope, visited)
    );
  }

  /**
   * Distinguishes copied scalar values from identity-preserving namespace
   * aliases.
   *
   * A scalar alias becomes its own property declaration; other aliases recurse
   * to their original declaration so they share semantic identity and
   * ownership.
   */
  private scalar(
    node: EvidenceNode,
    scope: EvidenceNode,
    visited: Set<number>,
  ): boolean {
    if (visited.has(node.startIndex) || node.type !== "variable_declaration")
      return false;
    visited.add(node.startIndex);
    const declared = node.childForFieldName("type");
    if (declared !== null)
      return declared.type === "builtin_type" && declared.text !== "type";
    const initializer = this.initializer(node);
    if (initializer === undefined) return false;
    if (VALUE_FORMS.has(initializer.type)) return true;
    if (initializer.type !== "identifier") return false;
    const matches = scope.namedChildren.filter(
      (child) =>
        child.type === "variable_declaration" &&
        this.sameName(
          child.namedChildren.find((part) => part.type === "identifier"),
          initializer,
        ),
    );
    const target = matches[0];
    return (
      matches.length === 1 &&
      target !== undefined &&
      this.scalar(target, scope, visited)
    );
  }

  /**
   * Copies one physical declaration and its public path before the tree is
   * released.
   *
   * The record includes parser-derived ranges, ownership, and attachment state
   * so later adapter phases do not retain Tree-sitter nodes beyond the
   * callback.
   */
  private add(
    node: EvidenceNode,
    name: string,
    symbol: EvidenceProgrammingSymbol,
    owner: IEvidenceZigDeclaration | undefined,
    identity: string[],
    address: string[],
    alias: boolean,
  ): IEvidenceZigDeclaration {
    const range = this.session.range(node);
    const siteId = `zig:${this.source.id}:site:${node.startIndex}:${node.endIndex}`;
    const declaration: IEvidenceZigDeclaration = {
      id: `${siteId}:${JSON.stringify(address)}`,
      name,
      symbol,
      identity,
      address,
      public: true,
      alias,
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
   * Identifies a declaration initializer from syntax delimiters rather than
   * source regexes.
   *
   * The first named child following an equals token supplies the supported
   * static form used for alias, type, and inferred-surface classification.
   */
  private initializer(node: EvidenceNode): EvidenceNode | undefined {
    const equals = node.children.find((child) => child.type === "=");
    return equals === undefined
      ? undefined
      : node.namedChildren.find(
          (child) =>
            child.startIndex >= equals.endIndex && child.type !== "comment",
        );
  }

  /**
   * Compares bare and quoted spellings by their decoded Zig identifier.
   *
   * Alias lookup therefore treats a literal identifier and its supported quoted
   * source spelling as the same declaration name within one lexical container.
   */
  private sameName(
    left: EvidenceNode | null | undefined,
    right: EvidenceNode,
  ): boolean {
    return (
      left !== undefined &&
      left !== null &&
      this.name(left) === this.name(right)
    );
  }

  /**
   * Decodes literal Zig identifiers while preserving dots as one accessor
   * segment.
   *
   * Unsupported escape syntax emits a diagnostic and returns the original text,
   * preventing an invented decoded name from changing alias or address
   * identity.
   */
  private name(node: EvidenceNode): string {
    if (!node.text.startsWith('@"')) return node.text;
    try {
      const parsed: unknown = JSON.parse(node.text.slice(1));
      return typia.assert<string>(parsed);
    } catch {
      this.problem(
        "identifier-escape",
        "This quoted identifier uses an unsupported Zig escape; use a literal UTF-8 name or implement its escape decoding.",
        node,
      );
      return node.text;
    }
  }

  /**
   * Attaches an adjacent triple-slash group to its declaration.
   *
   * Only directly preceding standalone documentation comments qualify,
   * preventing strings and ordinary comments from creating an accidental
   * documentation host.
   */
  private attach(
    node: EvidenceNode,
    declaration: IEvidenceZigDeclaration,
  ): void {
    const previous = node.previousNamedSibling;
    if (
      previous === null ||
      previous.type !== "comment" ||
      !previous.text.startsWith("///") ||
      previous.text.startsWith("////")
    )
      return;
    if (
      !/^\s*$/u.test(
        this.source.content.slice(previous.endIndex, node.startIndex),
      )
    )
      return;
    const documentation = [...this.documentation.values()].find(
      (item) =>
        item.range.end.offset === previous.endIndex &&
        item.syntax.opening === "///",
    );
    if (documentation === undefined) return;
    if (
      !documentation.attachments.some(
        (attachment) => attachment.declarationId === declaration.id,
      )
    )
      documentation.attachments.push({
        declarationId: declaration.id,
        siteId: declaration.site.id,
      });
  }

  /**
   * Classifies documentation comments and tag-bearing strings with UTF-16
   * positions.
   *
   * Triple-slash runs form attachable documentation, while other carriers
   * remain available only when they contain supported annotations that require
   * diagnostics.
   */
  private collectDocumentation(): void {
    const nodes: EvidenceNode[] =
      this.session.root.descendantsOfType("comment");
    const consumed: Set<number> = new Set<number>();
    for (const node of nodes) {
      if (consumed.has(node.startIndex)) continue;
      const doc: boolean =
        node.type === "comment" &&
        node.text.startsWith("///") &&
        !node.text.startsWith("////");
      if (
        !doc &&
        !/@(?:evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link|internal|hidden|ignore)\b/u.test(
          node.text,
        )
      )
        continue;
      let end: EvidenceNode = node;
      if (doc) {
        let next: EvidenceNode | null = end.nextNamedSibling;
        while (
          next !== null &&
          next.type === "comment" &&
          next.text.startsWith("///") &&
          !next.text.startsWith("////") &&
          /^[ \t]*\r?\n[ \t]*$/u.test(
            this.source.content.slice(end.endIndex, next.startIndex),
          )
        ) {
          consumed.add(next.startIndex);
          end = next;
          next = end.nextNamedSibling;
        }
      }
      const opening: string = doc
        ? "///"
        : node.text.startsWith("//!")
          ? "//!"
          : "//";
      this.documentation.set(node.startIndex, {
        id: `zig:${this.source.id}:documentation:${node.startIndex}`,
        range: {
          start: this.session.range(node).start,
          end: this.session.range(end).end,
        },
        syntax: {
          opening,
          closing: "",
          ...(doc ? { linePrefix: "///" } : {}),
          tagBoundaries: true,
          allowWithdrawal: doc,
        },
        attachments: [],
      });
    }
  }

  /**
   * Records unsupported namespace semantics as actionable incomplete
   * diagnostics.
   *
   * Duplicate suppression keeps one reported source location from producing
   * repeated errors while ensuring every unsupported public form fails
   * analysis.
   */
  private problem(code: string, message: string, node: EvidenceNode): void {
    if (
      this.diagnostics.some(
        (item) =>
          item.code === `zig-${code}` &&
          item.location?.range?.start?.offset === node.startIndex,
      )
    )
      return;
    this.diagnostics.push({
      code: `zig-${code}`,
      severity: "error",
      message,
      repair:
        "Use explicit supported Zig declarations or implement the reported static resolution before evaluating coverage.",
      location: {
        file: this.source.physicalPath,
        range: this.session.range(node),
      },
    });
  }
}

const CONTAINERS = new Set([
  "struct_declaration",
  "enum_declaration",
  "union_declaration",
  "opaque_declaration",
  "error_set_declaration",
]);
const TYPE_FORMS = new Set([
  "builtin_type",
  "nullable_type",
  "slice_type",
  "pointer_type",
  "array_type",
  "error_union_type",
  "function_signature",
]);
const VALUE_FORMS = new Set([
  "integer",
  "float",
  "boolean",
  "character",
  "string",
  "multiline_string",
]);
