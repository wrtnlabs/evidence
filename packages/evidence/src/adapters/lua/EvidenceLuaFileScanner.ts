import type { Node as EvidenceNode } from "web-tree-sitter";

import { EvidenceSourceText } from "../../internal/EvidenceSourceText";
import type { EvidenceParseSession } from "../../parsers/EvidenceParseSession";
import type { IEvidenceDiagnostic } from "../../structures/IEvidenceDiagnostic";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceLuaDeclaration } from "./IEvidenceLuaDeclaration";
import type { IEvidenceLuaDocumentation } from "./IEvidenceLuaDocumentation";
import type { IEvidenceLuaFileAnalysis } from "./IEvidenceLuaFileAnalysis";
import type { IEvidenceLuaValue } from "./IEvidenceLuaValue";

/**
 * Resolves an explicit, non-executing Lua module initialization convention.
 *
 * Lua exports arise from values and table writes, so the scanner follows only
 * supported static initialization and reports dynamic boundaries it cannot
 * prove.
 */
export class EvidenceLuaFileScanner {
  /**
   * Stores chunk-level bindings, including private local values.
   *
   * Static alias resolution consults this map before publishing globals or a
   * returned module table, while function-local names use lexical lookup
   * instead.
   */
  private readonly bindings = new Map<string, IEvidenceLuaValue>();

  /**
   * Stores chunk globals that contribute independent public declarations.
   *
   * The scanner publishes these values after a returned table, preserving Lua's
   * supported static global surface separately from module-table exports.
   */
  private readonly globals = new Map<string, IEvidenceLuaValue>();

  /**
   * Retains the table returned by the supported module-return statement.
   *
   * Omission means no valid table return was found; a present table is
   * published under the module address after all chunk initialization has been
   * processed.
   */
  private returned: IEvidenceLuaValue | undefined;

  /**
   * Accumulates serializable public declarations and alias projections.
   *
   * Each publication contributes an address projection, while shared values
   * reuse their first declaration identity to keep aliases from duplicating
   * units.
   */
  private readonly declarations: IEvidenceLuaDeclaration[] = [];

  /**
   * Indexes documentation carriers by the start offset of each comment line.
   *
   * Adjacent LuaDoc lines add keys for one extended carrier, allowing later
   * declaration attachment to find that group's complete original source
   * range.
   */
  private readonly documentation = new Map<number, IEvidenceLuaDocumentation>();

  /**
   * Collects diagnostics for unsupported surface-changing constructs.
   *
   * Any entry makes the returned file analysis incomplete, preventing dynamic
   * Lua behavior from silently reducing the coverage population.
   */
  private readonly diagnostics: IEvidenceDiagnostic[] = [];

  /**
   * Borrows the tree only for the active parser callback.
   *
   * The source remains authoritative for file identity and sites, while values
   * are converted into serializable declarations before the session closes.
   */
  public constructor(
    private readonly session: EvidenceParseSession,
    private readonly source: IEvidenceSourceFile,
  ) {}

  /**
   * Establishes values and ownership before attaching documentation.
   *
   * Public aliases must resolve first so a comment attaches to the canonical
   * declaration instead of a temporary local table projection.
   */
  public scan(): IEvidenceLuaFileAnalysis {
    this.comments();
    for (const node of this.session.root.namedChildren) this.statement(node);
    if (this.returned !== undefined)
      this.publish(this.returned, ["module"], undefined, new Set());
    for (const [name, value] of this.globals)
      this.publish(value, [name], undefined, new Set());
    this.deferredMutations();
    return {
      source: this.source,
      declarations: this.declarations,
      documentation: [...new Set(this.documentation.values())],
      diagnostics: this.diagnostics,
      complete: this.diagnostics.length === 0,
    };
  }

  /**
   * Processes deterministic chunk initialization without executing Lua.
   *
   * Only supported declarations, assignments, and one static module return can
   * establish values; other chunk statements receive an incomplete-surface
   * diagnostic.
   */
  private statement(node: EvidenceNode): void {
    if (["comment", "hash_bang_line", "empty_statement"].includes(node.type))
      return;
    if (node.type === "function_declaration") {
      const name = node.childForFieldName("name");
      if (name === null)
        return this.problem(node, "A function needs a static name.");
      this.assign(
        name,
        this.value(node, node),
        node.children.some((child) => child.type === "local"),
        node,
      );
      return;
    }
    if (
      node.type === "variable_declaration" ||
      node.type === "assignment_statement"
    ) {
      const assignment =
        node.type === "variable_declaration"
          ? node.namedChildren.find(
              (child) => child.type === "assignment_statement",
            )
          : node;
      if (assignment === undefined) {
        this.problem(
          node,
          "Uninitialized bindings require later mutation; initialize each binding explicitly.",
        );
        return;
      }
      const names = this.list(assignment, "variable_list");
      const values = this.list(assignment, "expression_list");
      if (
        names.length !== 1 ||
        values.length !== 1 ||
        names[0] === undefined ||
        values[0] === undefined
      ) {
        this.problem(
          node,
          "Multiple assignment and attributed bindings require Lua value-adjustment semantics.",
        );
        return;
      }
      this.assign(
        names[0],
        this.value(values[0], node),
        node.children.some((child) => child.type === "local"),
        node,
      );
      return;
    }
    if (node.type === "return_statement") {
      const values = this.list(node, "expression_list");
      const value =
        values.length === 1 && values[0] !== undefined
          ? this.value(values[0], node)
          : undefined;
      if (value?.kind !== "table")
        this.problem(
          node,
          "The module convention requires one literal table or a resolved local table return.",
        );
      else this.returned = value;
      return;
    }
    this.problem(
      node,
      `Chunk-level '${node.type}' can change exports through execution; use explicit static initialization.`,
    );
  }

  /**
   * Reads one grammar list while excluding interleaved comments.
   *
   * Assignment and return handling need only semantic list entries, so comments
   * cannot change arity checks or be mistaken for values.
   */
  private list(node: EvidenceNode, type: string): EvidenceNode[] {
    const list = node.namedChildren.find((child) => child.type === type);
    return list === undefined
      ? []
      : list.namedChildren.filter((child) => child.type !== "comment");
  }

  /**
   * Resolves one supported static value or an already established alias.
   *
   * Literal values receive the current declaration site, while table and
   * function aliases retain identity so publication can preserve shared
   * ownership.
   */
  private value(
    node: EvidenceNode,
    site: EvidenceNode,
  ): IEvidenceLuaValue | undefined {
    if (node.type === "parenthesized_expression") {
      const child = node.namedChildren.find((item) => item.type !== "comment");
      return child === undefined ? undefined : this.value(child, site);
    }
    if (
      [
        "identifier",
        "dot_index_expression",
        "bracket_index_expression",
      ].includes(node.type)
    ) {
      const path = this.path(node);
      if (path === undefined) return undefined;
      let value = this.bindings.get(path[0] ?? "");
      for (const segment of path.slice(1))
        value = value === undefined ? undefined : value.fields.get(segment);
      if (value === undefined)
        this.problem(
          node,
          "An alias or return depends on an unresolved binding; require loaders and external tables are not evaluated.",
        );
      // Scalar assignment copies a value; table and function aliases retain identity.
      return value?.kind === "literal" || value?.kind === "nil"
        ? { ...value, node: site, fields: new Map() }
        : value;
    }
    if (["function_declaration", "function_definition"].includes(node.type))
      return { kind: "function", node: site, fields: new Map() };
    if (["number", "string", "true", "false", "nil"].includes(node.type))
      return {
        kind: node.type === "nil" ? "nil" : "literal",
        node: site,
        fields: new Map(),
      };
    if (
      node.type === "unary_expression" &&
      node.childForFieldName("operator")?.text === "-" &&
      node.namedChildren
        .filter((child) => child.type !== "comment")
        .some((child) => child.type === "number")
    )
      return { kind: "literal", node: site, fields: new Map() };
    if (node.type === "table_constructor") {
      const value: IEvidenceLuaValue = {
        kind: "table",
        node: site,
        fields: new Map(),
      };
      for (const field of node.namedChildren.filter(
        (child) => child.type !== "comment",
      )) {
        const key = field.childForFieldName("name");
        const expression = field.childForFieldName("value");
        const name =
          key === null ||
          (field.children[0]?.type === "[" && key.type !== "string")
            ? undefined
            : this.key(key);
        if (
          field.type !== "field" ||
          name === undefined ||
          expression === null
        ) {
          this.problem(
            field,
            "Table exports require named or string-literal fields; computed, numeric, and positional keys are unsupported.",
          );
          continue;
        }
        const child = this.value(expression, field);
        if (child !== undefined) this.field(value, name, child, field);
      }
      return value;
    }
    this.problem(
      node,
      `Export initialization '${node.type}' is not a static literal, function, table, or resolved alias.`,
    );
    return undefined;
  }

  /**
   * Defines one binding or a previously absent literal table member.
   *
   * Reassignment, environment writes, and non-table owners are rejected because
   * they can change a public declaration after its static identity is
   * established.
   */
  private assign(
    name: EvidenceNode,
    value: IEvidenceLuaValue | undefined,
    local: boolean,
    site: EvidenceNode,
  ): void {
    const path = this.path(name);
    if (path === undefined || value === undefined) return;
    const first = path[0];
    if (first === undefined) return;
    if (["_G", "_ENV", "module"].includes(first)) {
      this.problem(
        name,
        "Environment writes and the reserved module accessor are outside the bounded module convention.",
      );
      return;
    }
    if (path.length === 1) {
      if (this.bindings.has(first)) {
        this.problem(
          site,
          `Reassignment or shadowing of '${first}' can change public identity.`,
        );
        return;
      }
      this.bindings.set(first, value);
      if (!local) this.globals.set(first, value);
      return;
    }
    let owner = this.bindings.get(first);
    for (const segment of path.slice(1, -1))
      owner = owner === undefined ? undefined : owner.fields.get(segment);
    const last = path.at(-1);
    if (owner?.kind !== "table" || last === undefined) {
      this.problem(
        name,
        "A dot or colon declaration requires a previously initialized local table owner.",
      );
      return;
    }
    this.field(owner, last, value, site);
  }

  /**
   * Adds one initial table field while rejecting replacement.
   *
   * Replacing a field could leave an obsolete declaration in the coverage
   * denominator, so only the first non-nil static definition is retained.
   */
  private field(
    owner: IEvidenceLuaValue,
    name: string,
    value: IEvidenceLuaValue,
    node: EvidenceNode,
  ): void {
    if (owner.fields.has(name))
      this.problem(
        node,
        `Table field '${name}' is defined more than once; replacement is outside static declaration support.`,
      );
    else if (value.kind !== "nil") owner.fields.set(name, value);
  }

  /**
   * Reads exact static accessor segments from a Lua expression.
   *
   * Numeric and computed keys are rejected instead of being conflated with
   * string members, preserving the target spelling used for bindings and table
   * fields.
   */
  private path(node: EvidenceNode): string[] | undefined {
    if (node.type === "identifier") return [node.text];
    if (
      [
        "dot_index_expression",
        "method_index_expression",
        "bracket_index_expression",
      ].includes(node.type)
    ) {
      const table = node.childForFieldName("table");
      const key =
        node.childForFieldName("field") ?? node.childForFieldName("method");
      const prefix = table === null ? undefined : this.path(table);
      const name =
        key === null ||
        (node.type === "bracket_index_expression" && key.type !== "string")
          ? undefined
          : this.key(key);
      if (prefix !== undefined && name !== undefined) return [...prefix, name];
    }
    this.problem(
      node,
      "A declaration needs identifier or literal string accessor segments.",
    );
    return undefined;
  }

  /**
   * Decodes a supported literal table key without changing its accessor
   * spelling.
   *
   * Unescaped quoted and long strings have deterministic text; escaped strings
   * require byte-string decoding and therefore produce a diagnostic instead.
   */
  private key(node: EvidenceNode): string | undefined {
    if (node.type === "identifier") return node.text;
    if (node.type !== "string") return undefined;
    const quote = node.text[0];
    if ((quote === '"' || quote === "'") && !node.text.includes("\\"))
      return node.text.slice(1, -1);
    const long = /^\[(=*)\[([\s\S]*)\]\1\]$/u.exec(node.text);
    if (long !== null)
      return (long[2] ?? "")
        .replace(/\r\n|\n\r|\r/gu, "\n")
        .replace(/^\n/u, "");
    this.problem(
      node,
      "Escaped field names need a Lua byte-string decoder; use an unescaped string key.",
    );
    return undefined;
  }

  /**
   * Publishes a value address with one canonical identity and table owner.
   *
   * Recursive traversal projects table fields, detects cycles, and requires a
   * shared value to retain the same structural owner across every public
   * alias.
   */
  private publish(
    value: IEvidenceLuaValue,
    address: string[],
    owner: IEvidenceLuaDeclaration | undefined,
    ancestors: Set<IEvidenceLuaValue>,
  ): void {
    if (value.kind === "nil") return;
    if (ancestors.has(value)) {
      this.problem(
        value.node,
        "Cyclic table exports cannot be represented by finite public accessor paths.",
      );
      return;
    }
    let declaration = value.declaration;
    if (declaration === undefined) {
      const id = `lua:${this.source.id}:${value.node.startIndex}`;
      declaration = {
        id,
        name: address.at(-1) ?? "module",
        symbol: value.kind === "function" ? "function" : "property",
        identity: address,
        address,
        site: {
          id: `${id}:site`,
          file: this.source.physicalPath,
          range: this.session.range(value.node),
          content: [this.session.range(value.node)],
        },
        public: true,
        ...(owner === undefined ? {} : { ownerDeclarationId: owner.id }),
      };
      value.declaration = declaration;
      this.attach(value.node, declaration);
    } else if (declaration.ownerDeclarationId !== owner?.id)
      this.problem(
        value.node,
        "A shared value is exported under different table owners; unique structural ownership is required for aggregate coverage and withdrawal.",
      );
    this.declarations.push({ ...declaration, address });
    const next = new Set(ancestors).add(value);
    for (const [name, field] of value.fields)
      this.publish(field, [...address, name], declaration, next);
  }

  /**
   * Reports deferred writes and table escapes inside function bodies.
   *
   * Function execution can mutate an exported surface after chunk
   * initialization, so the scanner marks writes, returns, and calls involving
   * public tables incomplete.
   */
  private deferredMutations(): void {
    for (const fn of this.session.root.descendantsOfType([
      "function_declaration",
      "function_definition",
    ])) {
      const body = fn.childForFieldName("body");
      if (body === null) continue;
      for (const assignment of body.descendantsOfType("assignment_statement")) {
        const values = assignment.namedChildren.find(
          (child) => child.type === "expression_list",
        );
        if (values !== undefined && this.tableReferences(values, assignment))
          this.problem(
            assignment,
            "A deferred alias can mutate an exported table; assignment alias flow is outside static module initialization.",
          );
        if (assignment.parent?.type === "variable_declaration") continue;
        const names = assignment.namedChildren.find(
          (child) => child.type === "variable_list",
        );
        for (const name of names?.namedChildren ?? []) {
          if (name.type === "comment") continue;
          const root =
            name.descendantsOfType("identifier")[0]?.text ?? name.text;
          if (this.local(root, assignment)) continue;
          if (
            this.bindings.get(root)?.declaration !== undefined ||
            root === "self" ||
            root === "_G" ||
            root === "_ENV" ||
            !this.bindings.has(root)
          )
            this.problem(
              assignment,
              "A function writes a public or unresolved binding; deferred export mutation requires runtime analysis.",
            );
        }
      }
      for (const returned of body.descendantsOfType("return_statement"))
        if (this.tableReferences(returned, returned))
          this.problem(
            returned,
            "A function returns an exported table and creates deferred aliases; only the final chunk module return is supported.",
          );
      for (const declaration of body.descendantsOfType(
        "function_declaration",
      )) {
        if (declaration.children.some((child) => child.type === "local"))
          continue;
        const name = declaration.childForFieldName("name");
        const root =
          name === null
            ? undefined
            : (name.descendantsOfType("identifier")[0]?.text ?? name.text);
        if (root !== undefined && !this.local(root, declaration))
          this.problem(
            declaration,
            "A deferred function declaration changes an external table or global binding.",
          );
      }
      for (const call of body.descendantsOfType("function_call")) {
        const args = call.childForFieldName("arguments");
        if (args !== null && this.tableReferences(args, call))
          this.problem(
            call,
            "An exported table escapes to a function call that may mutate its surface.",
          );
      }
    }
  }

  /**
   * Detects exported-table references that may expose a mutable surface.
   *
   * Reads of known scalar or callable fields remain static, while passing a
   * table, using `self`, or reaching an unknown field requires runtime alias
   * analysis.
   */
  private tableReferences(
    container: EvidenceNode,
    site: EvidenceNode,
  ): boolean {
    for (const node of container.descendantsOfType([
      "identifier",
      "dot_index_expression",
      "bracket_index_expression",
    ])) {
      const parent = node.parent;
      if (
        parent !== null &&
        [
          "dot_index_expression",
          "method_index_expression",
          "bracket_index_expression",
        ].includes(parent.type)
      )
        continue;
      const root = node.descendantsOfType("identifier")[0]?.text ?? node.text;
      if (this.local(root, site)) continue;
      if (root === "self") return true;
      let value = this.bindings.get(root);
      if (value?.kind !== "table" || value.declaration === undefined) continue;
      const path = this.path(node);
      if (path === undefined) return true;
      for (const segment of path.slice(1))
        value = value === undefined ? undefined : value.fields.get(segment);
      if (value === undefined || value.kind === "table") return true;
    }
    return false;
  }

  /**
   * Resolves parameters and preceding lexical locals visible at one source
   * node.
   *
   * The scope walk excludes later and sibling declarations so deferred-mutation
   * checks do not mistake a local binding for a write to a public value.
   */
  private local(name: string, node: EvidenceNode): boolean {
    let scope = node.parent;
    while (scope !== null && scope.type !== "chunk") {
      if (
        ["function_declaration", "function_definition"].includes(scope.type)
      ) {
        const parameters = scope.childForFieldName("parameters");
        if (
          parameters !== null &&
          parameters.namedChildren.some(
            (child) => child.type === "identifier" && child.text === name,
          )
        )
          return true;
      }
      if (scope.type === "block")
        for (const declaration of scope.namedChildren) {
          if (declaration.startIndex >= node.startIndex) break;
          if (declaration.type === "variable_declaration") {
            if (declaration.endIndex > node.startIndex) continue;
            const names = declaration.descendantsOfType("variable_list")[0];
            if (
              names !== undefined &&
              names.namedChildren.some(
                (child) => child.type === "identifier" && child.text === name,
              )
            )
              return true;
          }
          if (
            declaration.type === "function_declaration" &&
            declaration.children.some((child) => child.type === "local") &&
            declaration.childForFieldName("name")?.text === name
          )
            return true;
        }
      scope = scope.parent;
    }
    return false;
  }

  /**
   * Collects grouped LuaDoc lines and eligible long documentation comments.
   *
   * Unsupported tag-bearing carriers are also retained for diagnostics, while
   * adjacent line comments become one carrier with an extended source range.
   */
  private comments(): void {
    const source: EvidenceSourceText = new EvidenceSourceText(
      this.source.content,
    );
    const nodes: EvidenceNode[] =
      this.session.root.descendantsOfType("comment");
    for (const node of nodes) {
      const text: string = node.text;
      const long: RegExpExecArray | null = /^--\[(=*)\[/u.exec(text);
      const line: boolean =
        node.type === "comment" && text.startsWith("---") && long === null;
      const eligible: boolean = line || long !== null;
      if (
        !eligible &&
        !/@(?:evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link|internal|hidden|ignore)\b/u.test(
          text,
        )
      )
        continue;
      const previous: EvidenceNode | null = node.previousNamedSibling;
      const existing: IEvidenceLuaDocumentation | undefined =
        line &&
        previous?.type === "comment" &&
        previous.text.startsWith("---") &&
        /^\s*$/u.test(
          this.source.content.slice(previous.endIndex, node.startIndex),
        )
          ? this.documentation.get(previous.startIndex)
          : undefined;
      if (existing !== undefined) {
        existing.range = source.range(
          existing.range.start.offset,
          node.endIndex,
        );
        this.documentation.set(node.startIndex, existing);
        continue;
      }
      const opening: string = long?.[0] ?? (line ? "---" : "--");
      const closing: string = long !== null ? `]${long[1] ?? ""}]` : "";
      this.documentation.set(node.startIndex, {
        id: `lua:${this.source.id}:documentation:${node.startIndex}`,
        range: this.session.range(node),
        syntax: {
          opening,
          closing,
          ...(line ? { linePrefix: "---" } : {}),
          tagBoundaries: true,
          allowWithdrawal: eligible,
        },
        attachments: [],
      });
    }
  }

  /**
   * Attaches an adjacent LuaDoc carrier to one static declaration site.
   *
   * Whitespace-only separation is permitted; any intervening syntax prevents
   * attachment so a detached comment cannot annotate a later public
   * declaration.
   */
  private attach(
    node: EvidenceNode,
    declaration: IEvidenceLuaDeclaration,
  ): void {
    const previous = node.previousNamedSibling;
    if (
      previous?.type !== "comment" ||
      !(previous.text.startsWith("---") || /^--\[=*\[/u.test(previous.text))
    )
      return;
    if (
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
   * Records one actionable diagnostic for an unproven public surface.
   *
   * Every unsupported boundary receives the original node range and makes this
   * file's inventory incomplete, preserving failure instead of guessing
   * exports.
   */
  private problem(node: EvidenceNode, message: string): void {
    this.diagnostics.push({
      code: "lua-dynamic-surface",
      severity: "error",
      message,
      repair:
        "Use the explicit Lua module/table convention or implement this semantic boundary before evaluating coverage.",
      location: {
        file: this.source.physicalPath,
        range: this.session.range(node),
      },
    });
  }
}
