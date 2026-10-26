import type { Node as EvidenceNode } from "web-tree-sitter";

import { EvidenceSourceText } from "../../internal/EvidenceSourceText";
import type { EvidenceParseSession } from "../../parsers/EvidenceParseSession";
import type { IEvidenceDiagnostic } from "../../structures/IEvidenceDiagnostic";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { IEvidencePhpDeclaration } from "./IEvidencePhpDeclaration";
import type { IEvidencePhpDocumentation } from "./IEvidencePhpDocumentation";
import type { IEvidencePhpFileAnalysis } from "./IEvidencePhpFileAnalysis";

/**
 * Extracts explicit PHP declarations without executing source or runtime
 * loaders.
 *
 * The scanner follows lexical syntax only and reports dynamic surface changes
 * that would make a static Evidence inventory incomplete.
 *
 * @evidence contracts/common.md#principled-implementation Namespace declarations and public class members are read lexically with their nominal owners, and adjacent PHPDoc is attached.
 * @evidence contracts/common.md#clear-and-simple-design The scanner owns per-file extraction; snapshot-wide ownership and publication happen after every file is scanned.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Source and runtime loaders are never executed; dynamic global declarations and runtime property writes are reported.
 * @evidence contracts/common.md#meaningful-documentation The class comment states the boundary; public members and documented private steps describe each rule.
 * @evidence contracts/performance.md#efficient-algorithms Scanning is one traversal of the parsed file, linear in its size.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each file is scanned once per analysis.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The scanner copies names and ranges into node-free records before the parse session closes.
 */
export class EvidencePhpFileScanner {
  /**
   * Accumulates declarations and diagnostics in lexical source order.
   *
   * The output is serializable and does not retain parser-node ownership after
   * scanning.
   */
  private readonly declarations: IEvidencePhpDeclaration[] = [];

  /**
   * Stores PHPDoc carriers, including unsupported attachment positions.
   *
   * Their offsets allow later annotation parsing to report the original source
   * location.
   */
  private readonly documentation = new Map<number, IEvidencePhpDocumentation>();

  /**
   * Records failures that prevent a complete declared PHP surface.
   *
   * The scan returns these diagnostics instead of silently omitting dynamic
   * declarations.
   */
  /** Diagnostic source identities already reported by this scanner. */
  private readonly reported: Set<string> = new Set();
  private readonly diagnostics: IEvidenceDiagnostic[] = [];

  /**
   * Maps original source content to UTF-16 Evidence coordinates.
   *
   * PHPDoc attachment and diagnostics retain positions from this unnormalized
   * snapshot.
   */
  private readonly text: EvidenceSourceText;

  /**
   * Binds one parsed PHP source snapshot for lexical extraction.
   *
   * The scanner borrows the parser session only for this operation.
   */
  public constructor(
    private readonly session: EvidenceParseSession,
    private readonly source: IEvidenceSourceFile,
  ) {
    this.text = new EvidenceSourceText(source.content);
  }

  /**
   * Extracts namespaces, nominal types, functions, and visible members.
   *
   * Dynamic declarations are diagnosed so the output cannot imply a complete
   * static surface.
   *
   * @evidence contracts/common.md#principled-implementation Scan walks declaration scopes once, records declarations, documentation carriers and diagnostics, and returns a node-free analysis.
   * @evidence contracts/common.md#clear-and-simple-design Per-construct handling is split into private methods.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported constructs become diagnostics and incompleteness instead of being skipped.
   * @evidence contracts/common.md#meaningful-documentation The comment states what the returned analysis contains.
   * @evidence contracts/performance.md#efficient-algorithms Scanning is one traversal of the parsed file, linear in its size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each file is scanned once per analysis.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The scanner copies names and ranges into node-free records before the parse session closes.
   */
  public scan(): IEvidencePhpFileAnalysis {
    for (const comment of this.session.root.descendantsOfType("comment")) {
      if (!comment.text.startsWith("/**")) continue;
      this.documentation.set(comment.startIndex, {
        id: `php:${this.source.id}:documentation:${comment.startIndex}`,
        range: this.session.range(comment),
        syntax: {
          opening: "/**",
          closing: "*/",
          linePrefix: "*",
          tagBoundaries: true,
          allowWithdrawal: true,
        },
        attachments: [],
      });
    }
    if (this.session.root.descendantsOfType("php_tag").length === 0)
      this.problem(
        this.session.root,
        "source-policy",
        "PHP source requires an opening <?php tag; tagless PHP-only files are not selected by this adapter.",
      );
    this.scanScope(this.session.root, [], undefined);
    this.dynamicSurface(this.session.root);
    this.dynamicProperties(this.session.root);
    return {
      source: this.source,
      declarations: this.declarations,
      documentation: [...this.documentation.values()],
      diagnostics: this.diagnostics,
      context: this.session.root
        .descendantsOfType(["namespace_use_declaration", "declare_directive"])
        .map((node) => node.text.replaceAll("\r\n", "\n")),
      complete: this.diagnostics.length === 0,
    };
  }

  /**
   * Traverses namespace scopes without creating namespace Evidence units.
   *
   * Both semicolon and bracketed forms affect lexical ownership of contained
   * declarations.
   */
  private scanScope(
    node: EvidenceNode,
    initial: string[],
    owner: IEvidencePhpDeclaration | undefined,
  ): void {
    let namespace = initial;
    for (const child of node.namedChildren) {
      if (child.type === "namespace_definition") {
        const name = child.childForFieldName("name");
        const segments =
          name === null
            ? []
            : name.descendantsOfType("name").map((part) => part.text);
        const body = child.childForFieldName("body");
        if (body === null) namespace = segments;
        else this.scanScope(body, segments, undefined);
      } else if (TYPES.has(child.type)) {
        const declaration = this.add(child, child, "type", namespace, owner);
        const body = child.childForFieldName("body");
        if (declaration !== undefined && body !== null)
          this.scanScope(body, namespace, declaration);
      } else if (
        child.type === "function_definition" ||
        child.type === "method_declaration"
      ) {
        this.add(child, child, "function", namespace, owner);
        const methodName = child.childForFieldName("name");
        if (
          owner !== undefined &&
          methodName !== null &&
          methodName.text.toLowerCase() === "__construct"
        )
          for (const parameter of child.childForFieldName("parameters")
            ?.namedChildren ?? [])
            if (parameter.type === "property_promotion_parameter")
              this.add(parameter, parameter, "property", namespace, owner);
      } else if (
        child.type === "property_declaration" ||
        child.type === "const_declaration"
      ) {
        for (const element of child.namedChildren)
          if (
            element.type === "property_element" ||
            element.type === "const_element"
          )
            this.add(element, child, "property", namespace, owner);
      } else if (child.type === "enum_case")
        this.add(child, child, "property", namespace, owner);
      else if (child.type === "use_declaration")
        this.problem(
          child,
          "trait-composition",
          "Trait use and adaptation can add, rename, or hide members; trait composition is not implemented.",
        );
      else if (!IGNORED.has(child.type)) {
        if (owner !== undefined)
          this.problem(
            child,
            "member-form",
            `PHP member '${child.type}' is not classified.`,
          );
        for (const declaration of child.descendantsOfType([
          ...TYPES,
          "function_definition",
        ]))
          this.problem(
            declaration,
            "conditional-declaration",
            "A declaration inside executable control flow has runtime-dependent availability.",
          );
      }
    }
  }

  /**
   * Creates one fingerprinted declaration and attaches adjacent PHPDoc.
   *
   * Each declaration keeps its physical site while its identity represents
   * lexical ownership.
   */
  private add(
    item: EvidenceNode,
    carrier: EvidenceNode,
    symbol: EvidenceProgrammingSymbol,
    namespace: string[],
    owner: IEvidencePhpDeclaration | undefined,
  ): IEvidencePhpDeclaration | undefined {
    const nameNode =
      item.childForFieldName("name") ??
      (item.type === "const_element" ? item.namedChildren[0] : null);
    const name =
      nameNode === null || nameNode === undefined
        ? undefined
        : nameNode.text.replace(/^&\s*/u, "");
    if (name === undefined || name.length === 0) {
      this.problem(
        item,
        "declaration-name",
        "A PHP declaration has no static source name.",
      );
      return undefined;
    }
    const previous = carrier.previousNamedSibling;
    const doc =
      previous?.type === "comment" &&
      /^\s*$/u.test(
        this.source.content.slice(previous.endIndex, carrier.startIndex),
      )
        ? this.documentation.get(previous.startIndex)
        : undefined;
    const visibility = carrier.namedChildren.filter(
      (child) =>
        child.type === "visibility_modifier" && !child.text.includes("("),
    );
    const visible =
      (owner?.public ?? true) &&
      !visibility.some(
        (child) => child.text === "private" || child.text === "protected",
      );
    const identity = [...(owner?.identity ?? namespace), name];
    const siteId = `php:${this.source.id}:site:${carrier.startIndex}`;
    const declaration: IEvidencePhpDeclaration = {
      id: `php:${this.source.id}:declaration:${item.startIndex}:${name}`,
      name,
      symbol,
      form: item.type,
      identity,
      address: identity,
      public: visible,
      site: {
        id: siteId,
        file: this.source.physicalPath,
        range: this.text.range(
          doc?.range?.start?.offset ?? carrier.startIndex,
          carrier.endIndex,
        ),
        content:
          item.id === carrier.id
            ? [this.session.range(carrier)]
            : [
                this.text.range(
                  carrier.startIndex,
                  carrier.namedChildren.find(
                    (child) => child.type === item.type,
                  )?.startIndex ?? item.startIndex,
                ),
                this.session.range(item),
                ...carrier.namedChildren
                  .filter((child) => child.type === "property_hook_list")
                  .map((child) => this.session.range(child)),
              ],
      },
      ...(owner === undefined ? {} : { ownerDeclarationId: owner.id }),
    };
    this.declarations.push(declaration);
    if (doc !== undefined)
      doc.attachments.push({ declarationId: declaration.id, siteId });
    return declaration;
  }

  /**
   * Reports dynamic global declarations, including ones nested in function
   * bodies.
   *
   * Runtime declaration creation can add public surface absent from lexical
   * analysis.
   */
  private dynamicSurface(root: EvidenceNode): void {
    const dynamicNames = new Set([
      "eval",
      "define",
      "class_alias",
      "spl_autoload_register",
    ]);
    for (const imported of root.descendantsOfType(
      "namespace_use_declaration",
    )) {
      // Grouped imports have a namespace prefix and cannot name global builtins.
      if (imported.childForFieldName("body") !== null) continue;
      for (const clause of imported.descendantsOfType("namespace_use_clause")) {
        if (
          (
            clause.childForFieldName("type") ??
            imported.childForFieldName("type")
          )?.text !== "function"
        )
          continue;
        const importedName = clause.namedChildren[0];
        const target =
          importedName === undefined
            ? undefined
            : importedName.text.replace(/^\\/u, "").toLowerCase();
        const alias = clause.childForFieldName("alias");
        if (target !== undefined && dynamicNames.has(target) && alias !== null)
          dynamicNames.add(alias.text.toLowerCase());
      }
    }
    for (const node of root.descendantsOfType([
      "include_expression",
      "include_once_expression",
      "require_expression",
      "require_once_expression",
    ]))
      this.problem(
        node,
        "runtime-loader",
        "Runtime includes require execution and may change declarations; select explicit source files and remove runtime discovery from this population.",
      );
    for (const node of root.descendantsOfType("function_call_expression")) {
      const target = node.childForFieldName("function");
      if (
        target !== null &&
        dynamicNames.has(target.text.replace(/^\\/u, "").toLowerCase())
      )
        this.problem(
          node,
          "dynamic-declaration",
          `PHP ${target.text} can generate declarations or change their availability.`,
        );
    }
    for (const node of root.descendantsOfType([
      ...TYPES,
      "function_definition",
    ]))
      if (
        node.parent !== null &&
        !["program", "compound_statement"].includes(node.parent.type)
      )
        this.problem(
          node,
          "conditional-declaration",
          "Nested declarations can change the global public surface at runtime.",
        );
      else if (
        node.parent?.type === "compound_statement" &&
        node.parent.parent?.type !== "namespace_definition"
      )
        this.problem(
          node,
          "conditional-declaration",
          "Declarations in executable blocks have runtime-dependent availability.",
        );
  }

  /**
   * Distinguishes declared-field writes from detectable runtime property
   * creation.
   *
   * Dynamic public fields must be diagnosed because they escape the static
   * inventory.
   */
  private dynamicProperties(root: EvidenceNode): void {
    const owners: Map<string, IEvidencePhpDeclaration> = new Map();
    const properties: Map<string, Set<string>> = new Map();
    for (const declaration of this.declarations) {
      const key: string = JSON.stringify([
        declaration.form,
        declaration.site.range.end.offset,
      ]);
      if (!owners.has(key)) owners.set(key, declaration);
      if (
        declaration.symbol === "property" &&
        declaration.ownerDeclarationId !== undefined
      ) {
        const names: Set<string> =
          properties.get(declaration.ownerDeclarationId) ?? new Set();
        names.add(declaration.name);
        properties.set(declaration.ownerDeclarationId, names);
      }
    }
    for (const member of root.descendantsOfType("member_access_expression")) {
      if (member.childForFieldName("object")?.text !== "$this") continue;
      let written = member;
      while (
        written.parent !== null &&
        written.parent.type === "subscript_expression" &&
        written.parent.namedChildren[0]?.id === written.id
      )
        written = written.parent;
      const mutation = written.parent;
      if (mutation === null) continue;
      if (mutation.type === "update_expression") {
        if (!mutation.namedChildren.some((child) => child.id === written.id))
          continue;
      } else if (
        ![
          "assignment_expression",
          "augmented_assignment_expression",
          "reference_assignment_expression",
        ].includes(mutation.type) ||
        mutation.childForFieldName("left")?.id !== written.id
      )
        continue;
      let container = member.parent;
      while (
        container !== null &&
        !TYPES.has(container.type) &&
        container.type !== "anonymous_class"
      )
        container = container.parent;
      if (container === null || container.type === "anonymous_class") continue;
      const ownerNode = container;
      const owner: IEvidencePhpDeclaration | undefined = owners.get(
        JSON.stringify([ownerNode.type, ownerNode.endIndex]),
      );
      const name = member.childForFieldName("name");
      if (
        owner !== undefined &&
        name?.type === "name" &&
        properties.get(owner.id)?.has(`$${name.text}`) === true
      )
        continue;
      this.problem(
        member,
        "dynamic-property",
        "Writing a computed $this property or one not declared on this lexical type can add a public property at runtime; declare it explicitly or add inherited-property resolution.",
      );
    }
  }

  /**
   * Records unsupported surface-changing syntax at its original source range.
   *
   * Duplicate diagnostics are suppressed while the analysis remains explicitly
   * incomplete.
   */
  private problem(node: EvidenceNode, code: string, message: string): void {
    const key: string = JSON.stringify([code, node.startIndex]);
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.diagnostics.push({
      code: `php-${code}`,
      severity: "error",
      message,
      repair:
        "Use explicit supported declarations or add PHP adapter support before evaluating coverage.",
      location: {
        file: this.source.physicalPath,
        range: this.session.range(node),
      },
    });
  }
}

/**
 * Lists nominal PHP declarations whose members have an explicit lexical owner.
 *
 * The scanner uses these node kinds to establish class-like ownership while
 * traversing bodies.
 */
const TYPES = new Set([
  "class_declaration",
  "interface_declaration",
  "trait_declaration",
  "enum_declaration",
]);

/**
 * Lists syntax nodes that introduce no independently declared public symbol.
 *
 * Ignoring these nodes keeps traversal focused on syntax that can change the
 * inventory.
 */
const IGNORED = new Set([
  "php_tag",
  "php_end_tag",
  "text",
  "text_interpolation",
  "comment",
  "namespace_use_declaration",
  "empty_statement",
]);
