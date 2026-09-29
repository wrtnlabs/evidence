import type { Node as EvidenceNode } from "web-tree-sitter";

import { EvidenceDocumentation } from "../../parsers/EvidenceDocumentation";
import type { EvidenceParseSession } from "../../parsers/EvidenceParseSession";
import type { IEvidenceCommentSyntax } from "../../structures/IEvidenceCommentSyntax";
import type { IEvidenceDiagnostic } from "../../structures/IEvidenceDiagnostic";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceRange } from "../../structures/IEvidenceSourceRange";
import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { EvidenceCDeclarationForm } from "./EvidenceCDeclarationForm";
import { EvidenceCSyntax } from "./EvidenceCSyntax";
import type { IEvidenceCDeclaration } from "./IEvidenceCDeclaration";
import type { IEvidenceCDeclarationAddress } from "./IEvidenceCDeclarationAddress";
import type { IEvidenceCDeclaratorShape } from "./IEvidenceCDeclaratorShape";
import type { IEvidenceCDocumentation } from "./IEvidenceCDocumentation";
import type { IEvidenceCFileAnalysis } from "./IEvidenceCFileAnalysis";
import type { IEvidenceCTypeContext } from "./IEvidenceCTypeContext";
import { EvidenceSourceText } from "../../internal/EvidenceSourceText";

/**
 * Extracts explicit C declarations and Doxygen without preprocessing source.
 *
 * It records physical declaration and attachment facts for `EvidenceCAdapter`
 * to reconcile; it never infers declarations from included or expanded source.
 */
export class EvidenceCFileScanner {
  private readonly declarations: IEvidenceCDeclaration[] = [];
  private readonly documentation = new Map<string, IEvidenceCDocumentation>();
  private readonly carrierDocumentation = new Map<
    string,
    IEvidenceCDocumentation
  >();
  private readonly diagnostics: IEvidenceDiagnostic[] = [];
  private readonly reported = new Set<string>();
  private readonly tags = new Map<string, IEvidenceCTypeContext>();
  private readonly text: EvidenceSourceText;
  private complete = true;

  /**
   * Creates one scanner bound to a live C parse session and source snapshot.
   *
   * Documentation is collected before declaration walking so adjacency can be
   * decided against the original source positions.
   */
  public constructor(
    private readonly session: EvidenceParseSession,
    private readonly source: IEvidenceSourceFile,
  ) {
    this.text = new EvidenceSourceText(source.content);
    this.collectDocumentation();
  }

  /**
   * Scans supported top-level C constructs into node-free file analysis.
   *
   * Unsupported public-surface syntax adds diagnostics and makes the returned
   * analysis incomplete instead of silently omitting its declarations.
   */
  public scan(): IEvidenceCFileAnalysis {
    const items = this.session.root.namedChildren;
    const population = items.filter((item) => !this.inertTopLevel(item));
    const guarded =
      population.length === 1 && population[0] !== undefined
        ? EvidenceCSyntax.guardedDeclarations(population[0])
        : undefined;
    for (const item of guarded ?? items) this.scanTopLevel(item);
    return {
      source: this.source,
      declarations: this.declarations,
      documentation: Array.from(this.documentation.values()),
      diagnostics: this.diagnostics,
      complete: this.complete,
    };
  }

  private scanTopLevel(item: EvidenceNode): void {
    switch (item.type) {
      case "comment":
      case "preproc_include":
      case "preproc_def":
      case "preproc_function_def":
      case "_static_assert_declaration":
      case "static_assert_declaration":
        return;
      case "function_definition":
        this.scanFunctionDefinition(item);
        return;
      case "declaration":
        this.scanExternalDeclaration(item);
        return;
      case "type_definition":
        this.scanTypeDefinition(item);
        return;
      case "struct_specifier":
      case "union_specifier":
      case "enum_specifier":
        this.scanTag(item, [], item, this.documentationFor(item));
        return;
      case "preproc_if":
      case "preproc_ifdef":
        this.conditional(item);
        return;
      case "preproc_call":
        if (!EvidenceCSyntax.isInertDirective(item))
          this.preprocessorDirective(item);
        return;
      case "expression_statement":
        if (!EvidenceCSyntax.isStaticAssertion(item))
          this.macroDeclaration(item);
        return;
      default:
        this.problem(
          "c-declaration-form",
          `C translation-unit form '${item.type}' is not classified by this adapter.`,
          "Add an explicit source-declaration rule before evaluating this file.",
          item,
        );
    }
  }

  private inertTopLevel(node: EvidenceNode): boolean {
    return (
      node.type === "comment" ||
      node.type === "preproc_include" ||
      node.type === "preproc_def" ||
      node.type === "preproc_function_def" ||
      node.type === "_static_assert_declaration" ||
      node.type === "static_assert_declaration" ||
      EvidenceCSyntax.isStaticAssertion(node) ||
      EvidenceCSyntax.isInertDirective(node)
    );
  }

  private scanFunctionDefinition(item: EvidenceNode): void {
    if (EvidenceCSyntax.storage(item, "static")) return;
    const declarator = item.childForFieldName("declarator");
    if (declarator === null) {
      this.problem(
        "c-function-declarator",
        "A C function definition has no statically readable function declarator.",
        "Use an ordinary named function definition supported by the pinned grammar.",
        item,
      );
      return;
    }
    const conditional = this.firstConditional(declarator);
    if (conditional !== undefined) this.conditional(conditional);
    const shape = EvidenceCSyntax.declarator(declarator);
    if (shape === undefined || shape.kind !== "function") {
      this.problem(
        "c-function-declarator",
        "A C function definition has no statically readable function declarator.",
        "Use an ordinary named function definition supported by the pinned grammar.",
        item,
      );
      return;
    }
    this.addDeclaration(
      declarator,
      item,
      this.documentationFor(item),
      [this.session.range(item)],
      shape.name,
      "function",
      "function",
      [shape.name],
      [this.canonicalAddress([shape.name])],
      true,
    );
  }

  private scanExternalDeclaration(item: EvidenceNode): void {
    const conditional = this.firstConditional(item);
    if (conditional !== undefined) this.conditional(conditional);
    const specifier = item.childForFieldName("type");
    if (EvidenceCSyntax.tagForm(specifier) !== null && specifier !== null)
      this.scanTag(specifier, [], item, this.documentationFor(item));
    if (EvidenceCSyntax.storage(item, "static")) return;

    const documentation = this.documentationFor(item);
    const declarators = EvidenceCSyntax.declarators(item);
    const first = declarators[0];
    const header =
      first === undefined
        ? this.session.range(item)
        : this.text.range(item.startIndex, first.startIndex);
    for (const declarator of declarators) {
      const shape = EvidenceCSyntax.declarator(declarator);
      if (shape === undefined) {
        this.unreadableDeclarator(declarator);
        continue;
      }
      const functionDeclaration = shape.kind === "function";
      this.addRootDeclaration(
        shape,
        item,
        documentation,
        [header, this.session.range(declarator)],
        functionDeclaration ? "function" : "property",
        functionDeclaration ? "function" : "object",
        functionDeclaration
          ? false
          : declarator.type === "init_declarator" ||
              !EvidenceCSyntax.storage(item, "extern"),
      );
    }
  }

  private scanTypeDefinition(item: EvidenceNode): void {
    const conditional = this.firstConditional(item);
    if (conditional !== undefined) this.conditional(conditional);
    const documentation = this.documentationFor(item);
    const declarators = EvidenceCSyntax.declarators(item);
    const first = declarators[0];
    const header =
      first === undefined
        ? this.session.range(item)
        : this.text.range(item.startIndex, first.startIndex);
    const shapes = declarators.flatMap((declarator) => {
      const shape = EvidenceCSyntax.declarator(declarator);
      if (shape === undefined) {
        this.unreadableDeclarator(declarator);
        return [];
      }
      return [shape];
    });
    const specifier = item.childForFieldName("type");
    const tag = EvidenceCSyntax.tagForm(specifier);
    const directAliases = Array.from(
      new Set(
        shapes.flatMap((shape) =>
          shape.kind === "direct" ? [shape.name] : [],
        ),
      ),
    ).sort(compare);
    const owner =
      tag === null || specifier === null
        ? undefined
        : this.scanTag(specifier, directAliases, item, documentation);

    for (const shape of shapes) {
      if (owner !== undefined && shape.kind === "direct") continue;
      this.addRootDeclaration(
        shape,
        item,
        documentation,
        [header, this.session.range(shape.node)],
        "type",
        "typedef",
        true,
      );
    }
  }

  private scanTag(
    specifier: EvidenceNode,
    directAliases: string[],
    siteNode: EvidenceNode,
    documentation: IEvidenceCDocumentation[],
  ): IEvidenceCTypeContext | undefined {
    const form = EvidenceCSyntax.tagForm(specifier);
    if (form === null) return undefined;
    const tagName = EvidenceCSyntax.name(specifier.childForFieldName("name"));
    const body = specifier.childForFieldName("body");
    const aliases = Array.from(new Set(directAliases)).sort(compare);
    const stored =
      tagName === undefined ? undefined : this.tags.get(`${form}:${tagName}`);
    if (stored !== undefined && body === null && aliases.length === 0)
      return stored;
    if (tagName === undefined && aliases.length === 0) return undefined;

    const identityName =
      tagName === undefined ? aliases[0] : `${form} ${tagName}`;
    if (identityName === undefined) return undefined;
    const addresses = this.tagAddresses(form, tagName, aliases);
    const declaration = this.addDeclaration(
      specifier,
      siteNode,
      documentation,
      [this.session.range(specifier)],
      tagName ?? identityName,
      "type",
      form,
      [identityName],
      addresses,
      body !== null,
      undefined,
      tagName,
    );
    const context: IEvidenceCTypeContext = {
      declarationId: declaration.id,
      identity: declaration.identity,
    };
    if (tagName !== undefined) this.tags.set(`${form}:${tagName}`, context);
    if (body === null) return context;
    if (form === "enum") this.scanEnumerators(body, context);
    else this.scanFields(body, context);
    return context;
  }

  private scanFields(body: EvidenceNode, owner: IEvidenceCTypeContext): void {
    for (const field of body.namedChildren)
      switch (field.type) {
        case "comment":
        case "_static_assert_declaration":
        case "static_assert_declaration":
          break;
        case "field_declaration":
          this.scanField(field, owner);
          break;
        case "preproc_if":
        case "preproc_ifdef":
          this.conditional(field);
          break;
        case "preproc_call":
          if (!EvidenceCSyntax.isInertDirective(field))
            this.preprocessorDirective(field);
          break;
        default:
          this.problem(
            "c-field-form",
            `C aggregate member form '${field.type}' is not classified by this adapter.`,
            "Add an explicit aggregate-member rule before evaluating this type.",
            field,
          );
      }
  }

  private scanField(item: EvidenceNode, owner: IEvidenceCTypeContext): void {
    const documentation = this.documentationFor(item);
    const specifier = item.childForFieldName("type");
    const tag = EvidenceCSyntax.tagForm(specifier);
    const declarators = EvidenceCSyntax.declarators(item);
    if (tag !== null && specifier !== null && declarators.length === 0) {
      const name = EvidenceCSyntax.name(specifier.childForFieldName("name"));
      if (name === undefined) {
        const body = specifier.childForFieldName("body");
        if (body !== null) {
          if (tag === "enum") this.scanEnumerators(body, owner);
          else this.scanFields(body, owner);
        }
      } else this.scanTag(specifier, [], item, documentation);
      return;
    }
    if (tag !== null && specifier !== null)
      this.scanTag(specifier, [], item, documentation);

    const first = declarators[0];
    const header =
      first === undefined
        ? this.session.range(item)
        : this.text.range(item.startIndex, first.startIndex);
    for (const declarator of declarators) {
      const shape = EvidenceCSyntax.declarator(declarator);
      if (shape === undefined) {
        this.unreadableDeclarator(declarator);
        continue;
      }
      this.addDeclaration(
        declarator,
        item,
        documentation,
        [header, this.session.range(declarator)],
        shape.name,
        "property",
        "field",
        [...owner.identity, shape.name],
        [],
        true,
        owner.declarationId,
      );
    }
  }

  private scanEnumerators(
    body: EvidenceNode,
    owner: IEvidenceCTypeContext,
  ): void {
    for (const item of body.namedChildren)
      switch (item.type) {
        case "comment":
          break;
        case "enumerator": {
          const name = EvidenceCSyntax.name(item.childForFieldName("name"));
          if (name === undefined) {
            this.unreadableDeclarator(item);
            break;
          }
          this.addDeclaration(
            item,
            item,
            this.documentationFor(item),
            [this.session.range(item)],
            name,
            "property",
            "enumerator",
            [...owner.identity, name],
            [],
            true,
            owner.declarationId,
          );
          break;
        }
        case "preproc_if":
        case "preproc_ifdef":
          this.conditional(item);
          break;
        case "preproc_call":
          if (!EvidenceCSyntax.isInertDirective(item))
            this.preprocessorDirective(item);
          break;
        default:
          this.problem(
            "c-enumerator-form",
            `C enum member form '${item.type}' is not classified by this adapter.`,
            "Add an explicit enumerator rule before evaluating this enum.",
            item,
          );
      }
  }

  private addRootDeclaration(
    shape: IEvidenceCDeclaratorShape,
    siteNode: EvidenceNode,
    documentation: IEvidenceCDocumentation[],
    content: IEvidenceSourceRange[],
    symbol: EvidenceProgrammingSymbol,
    form: Extract<EvidenceCDeclarationForm, "typedef" | "function" | "object">,
    definition: boolean,
  ): IEvidenceCDeclaration {
    return this.addDeclaration(
      shape.node,
      siteNode,
      documentation,
      content,
      shape.name,
      symbol,
      form,
      [shape.name],
      [this.canonicalAddress([shape.name])],
      definition,
    );
  }

  private addDeclaration(
    item: EvidenceNode,
    siteNode: EvidenceNode,
    documentation: IEvidenceCDocumentation[],
    content: IEvidenceSourceRange[],
    name: string,
    symbol: EvidenceProgrammingSymbol,
    form: EvidenceCDeclarationForm,
    identity: string[],
    addresses: IEvidenceCDeclarationAddress[],
    definition: boolean,
    ownerDeclarationId?: string,
    tagName?: string,
  ): IEvidenceCDeclaration {
    const start = Math.min(
      siteNode.startIndex,
      ...documentation.map((entry) => entry.range.start.offset),
    );
    const end = Math.max(
      siteNode.endIndex,
      ...documentation.map((entry) => entry.range.end.offset),
    );
    const site: IEvidenceUnitSite = {
      id: this.siteId(siteNode),
      file: this.source.physicalPath,
      range: this.text.range(start, end),
      content,
    };
    const declaration: IEvidenceCDeclaration = {
      id: `c:${this.source.id}:declaration:${form}:${item.startIndex}:${name}`,
      name,
      symbol,
      form,
      identity,
      addresses,
      site,
      definition,
      ...(ownerDeclarationId === undefined ? {} : { ownerDeclarationId }),
      ...(tagName === undefined ? {} : { tagName }),
    };
    this.declarations.push(declaration);
    for (const entry of documentation)
      this.attach(entry, declaration.id, site.id);
    return declaration;
  }

  private tagAddresses(
    form: Extract<EvidenceCDeclarationForm, "struct" | "union" | "enum">,
    tagName: string | undefined,
    aliases: string[],
  ): IEvidenceCDeclarationAddress[] {
    const addresses = aliases.map((alias) => this.canonicalAddress([alias]));
    if (tagName === undefined) return addresses;
    const exact = `${form} ${tagName}`;
    return [
      this.canonicalAddress([exact]),
      {
        segments: [tagName],
        canonical: false,
        aliasPrefixes: [[tagName]],
      },
      ...addresses,
    ];
  }

  private canonicalAddress(segments: string[]): IEvidenceCDeclarationAddress {
    return { segments, canonical: true, aliasPrefixes: [] };
  }

  private documentationFor(node: EvidenceNode): IEvidenceCDocumentation[] {
    const output: IEvidenceCDocumentation[] = [];
    const previous = node.previousNamedSibling;
    if (previous !== null && EvidenceCSyntax.isDoxygen(previous)) {
      const documentation = this.carrierDocumentation.get(
        this.nodeKey(previous),
      );
      if (
        documentation !== undefined &&
        !EvidenceCSyntax.isTrailingDoxygen(previous) &&
        this.adjacent(documentation.range.end.offset, node.startIndex, true)
      )
        output.push(documentation);
    }
    const next = node.nextNamedSibling;
    if (next !== null && EvidenceCSyntax.isTrailingDoxygen(next)) {
      const documentation = this.carrierDocumentation.get(this.nodeKey(next));
      if (
        documentation !== undefined &&
        this.trailingAdjacent(
          node,
          documentation.range.start.offset,
          next.startPosition.row,
        )
      )
        output.push(documentation);
    }
    return output;
  }

  private adjacent(start: number, end: number, allowNewline: boolean): boolean {
    const gap = this.source.content.slice(start, end);
    return (
      /^\s*$/u.test(gap) &&
      !/\r?\n[ \t]*\r?\n/u.test(gap) &&
      (allowNewline || !/[\r\n]/u.test(gap))
    );
  }

  private trailingAdjacent(
    node: EvidenceNode,
    end: number,
    commentRow: number,
  ): boolean {
    if (node.endPosition.row !== commentRow) return false;
    const gap = this.source.content.slice(node.endIndex, end);
    if (node.type === "enumerator") return /^[ \t]*,[ \t]*$/u.test(gap);
    if (
      node.type === "struct_specifier" ||
      node.type === "union_specifier" ||
      node.type === "enum_specifier"
    )
      return /^[ \t]*;[ \t]*$/u.test(gap);
    return /^[ \t]*$/u.test(gap);
  }

  private collectDocumentation(): void {
    const comments = this.session.root
      .descendantsOfType("comment")
      .sort((left, right) => left.startIndex - right.startIndex);
    const consumed = new Set<string>();
    for (const first of comments) {
      if (consumed.has(this.nodeKey(first))) continue;
      const sequence: EvidenceNode[] = [first];
      consumed.add(this.nodeKey(first));
      let last = first;
      if (
        first.text.startsWith("//") &&
        !EvidenceCSyntax.isTrailingDoxygen(first)
      ) {
        let next = last.nextNamedSibling;
        while (
          next !== null &&
          next.type === "comment" &&
          this.lineFamily(next) === this.lineFamily(first) &&
          next.startPosition.column === first.startPosition.column &&
          this.adjacent(last.endIndex, next.startIndex, true)
        ) {
          sequence.push(next);
          consumed.add(this.nodeKey(next));
          last = next;
          next = last.nextNamedSibling;
        }
      }
      const range = this.text.range(first.startIndex, last.endIndex);
      const syntax = EvidenceCSyntax.comment(first);
      const supported = EvidenceCSyntax.isDoxygen(first);
      const raw = EvidenceDocumentation.read(
        this.source.content,
        "c-probe",
        range,
        syntax,
      ).text;
      if (!supported && !this.annotation(raw)) continue;
      const documentation = this.ensureDocumentation(range, syntax);
      for (const comment of sequence)
        this.carrierDocumentation.set(this.nodeKey(comment), documentation);
    }
  }

  private lineFamily(node: EvidenceNode): string {
    if (node.text.startsWith("///<")) return "///<";
    if (node.text.startsWith("//!<")) return "//!<";
    if (node.text.startsWith("///")) return "///";
    if (node.text.startsWith("//!")) return "//!";
    return "//";
  }

  private attach(
    documentation: IEvidenceCDocumentation,
    declarationId: string,
    siteId: string,
  ): void {
    if (
      !documentation.attachments.some(
        (attachment) =>
          attachment.declarationId === declarationId &&
          attachment.siteId === siteId,
      )
    )
      documentation.attachments.push({ declarationId, siteId });
  }

  private ensureDocumentation(
    range: IEvidenceSourceRange,
    syntax: IEvidenceCommentSyntax,
  ): IEvidenceCDocumentation {
    const key = `${range.start.offset}:${range.end.offset}`;
    let documentation = this.documentation.get(key);
    if (documentation === undefined) {
      documentation = {
        id: `c:${this.source.id}:documentation:${key}`,
        range,
        syntax,
        attachments: [],
      };
      this.documentation.set(key, documentation);
    }
    return documentation;
  }

  private unreadableDeclarator(node: EvidenceNode): void {
    this.problem(
      "c-declarator-name",
      "A selected C declarator has no statically readable identifier.",
      "Use one named declarator supported by the pinned grammar.",
      node,
    );
  }

  private firstConditional(node: EvidenceNode): EvidenceNode | undefined {
    for (const type of ["preproc_if", "preproc_ifdef"]) {
      const conditional = node.descendantsOfType(type)[0];
      if (conditional !== undefined) return conditional;
    }
    return undefined;
  }

  private conditional(node: EvidenceNode): void {
    this.problem(
      "c-preprocessor-conditional",
      "Conditional preprocessing can change the selected C declaration population.",
      "Select generated preprocessed source or remove declaration-position conditional branches.",
      node,
    );
  }

  private macroDeclaration(node: EvidenceNode): void {
    this.problem(
      "c-macro-declaration",
      "A declaration-position macro invocation can generate an unknown C surface.",
      "Select the generated declaration source or replace the invocation with explicit declarations.",
      node,
    );
  }

  private preprocessorDirective(node: EvidenceNode): void {
    this.problem(
      "c-preprocessor-directive",
      "A selected C preprocessor directive can change declaration semantics.",
      "Select generated source or add an explicit rule for this directive before evaluating coverage.",
      node,
    );
  }

  private annotation(raw: string): boolean {
    return /(?:^|[\r\n])[ \t]*@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link|internal|hidden|ignore)\b/u.test(
      raw,
    );
  }

  private nodeKey(node: EvidenceNode): string {
    return `${node.startIndex}:${node.endIndex}`;
  }

  private siteId(node: EvidenceNode): string {
    return `c:${this.source.id}:site:${this.nodeKey(node)}`;
  }

  private problem(
    code: string,
    message: string,
    repair: string,
    node: EvidenceNode,
  ): void {
    const key = `${code}:${node.startIndex}:${node.endIndex}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.complete = false;
    this.diagnostics.push({
      code,
      severity: "error",
      message,
      repair,
      location: {
        file: this.source.physicalPath,
        range: this.session.range(node),
      },
    });
  }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
