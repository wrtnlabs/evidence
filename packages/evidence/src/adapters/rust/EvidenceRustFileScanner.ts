import type { Node as EvidenceNode } from "web-tree-sitter";

import type { EvidenceParseSession } from "../../parsers/EvidenceParseSession";
import type { IEvidenceCommentSyntax } from "../../structures/IEvidenceCommentSyntax";
import type { IEvidenceDiagnostic } from "../../structures/IEvidenceDiagnostic";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceRange } from "../../structures/IEvidenceSourceRange";
import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { IEvidenceRustDeclaration } from "./IEvidenceRustDeclaration";
import type { IEvidenceRustDocumentation } from "./IEvidenceRustDocumentation";
import type { IEvidenceRustExternalModule } from "./IEvidenceRustExternalModule";
import type { IEvidenceRustFileAnalysis } from "./IEvidenceRustFileAnalysis";
import type { IEvidenceRustImplementation } from "./IEvidenceRustImplementation";
import type { IEvidenceRustUse } from "./IEvidenceRustUse";
import type { IEvidenceRustUseBinding } from "./IEvidenceRustUseBinding";
import type { EvidenceRustDeclarationForm } from "./EvidenceRustDeclarationForm";
import { EvidenceRustSyntax } from "./EvidenceRustSyntax";
import type { EvidenceRustVisibility } from "./EvidenceRustVisibility";
import { EvidenceSourceText } from "../../internal/EvidenceSourceText";

const INERT_ATTRIBUTES = new Set([
  "allow",
  "cold",
  "deprecated",
  "deny",
  "doc",
  "forbid",
  "ignore",
  "inline",
  "link",
  "link_name",
  "must_use",
  "no_mangle",
  "non_exhaustive",
  "path",
  "repr",
  "should_panic",
  "target_feature",
  "test",
  "track_caller",
  "warn",
]);

/**
 * Extracts supported Rust declarations and documentation from one parsed source
 * file.
 *
 * The scanner deliberately retains node-free records because
 * EvidenceRustModuleResolver must continue crate, import, and impl resolution
 * after the parse session closes.
 */
export class EvidenceRustFileScanner {
  private readonly declarations: IEvidenceRustDeclaration[] = [];
  private readonly documentation = new Map<
    string,
    IEvidenceRustDocumentation
  >();
  private readonly carrierDocumentation = new Map<
    string,
    IEvidenceRustDocumentation
  >();
  private readonly externalModules: IEvidenceRustExternalModule[] = [];
  private readonly implementations: IEvidenceRustImplementation[] = [];
  private readonly uses: IEvidenceRustUse[] = [];
  private readonly diagnostics: IEvidenceDiagnostic[] = [];
  private readonly reported = new Set<string>();
  private readonly text: EvidenceSourceText;
  private complete = true;

  /**
   * Creates a scanner for one parsed selected Rust source file.
   *
   * Documentation is collected during construction while every comment and
   * attribute node is available for attachment to later declarations.
   */
  public constructor(
    private readonly session: EvidenceParseSession,
    private readonly source: IEvidenceSourceFile,
  ) {
    this.text = new EvidenceSourceText(source.content);
    this.collectDocumentation();
  }

  /**
   * Scans the file and returns its node-free extraction result.
   *
   * Unsupported public forms make the returned analysis incomplete so later
   * coverage evaluation cannot treat an unobserved declaration as absent.
   */
  public scan(): IEvidenceRustFileAnalysis {
    this.scanScope(this.session.root, [], undefined);
    return {
      source: this.source,
      declarations: this.declarations,
      documentation: Array.from(this.documentation.values()),
      externalModules: this.externalModules,
      implementations: this.implementations,
      uses: this.uses,
      diagnostics: this.diagnostics,
      complete: this.complete,
    };
  }

  private scanScope(
    scope: EvidenceNode,
    modulePath: string[],
    moduleDeclarationId: string | undefined,
  ): void {
    this.attachInnerDocumentation(scope, modulePath, moduleDeclarationId);
    for (const item of scope.namedChildren) {
      if (
        item.type === "attribute_item" ||
        item.type === "inner_attribute_item" ||
        item.type === "line_comment" ||
        item.type === "block_comment"
      )
        continue;
      switch (item.type) {
        case "mod_item":
          this.scanModule(item, modulePath);
          break;
        case "struct_item":
          this.scanStruct(item, modulePath);
          break;
        case "enum_item":
          this.scanEnum(item, modulePath);
          break;
        case "trait_item":
          this.scanTrait(item, modulePath);
          break;
        case "type_item":
          this.scanTypeAlias(item, modulePath);
          break;
        case "function_item":
          this.scanFreeFunction(item, modulePath);
          break;
        case "const_item":
          this.scanValue(item, modulePath, "constant");
          break;
        case "static_item":
          this.scanValue(item, modulePath, "static");
          break;
        case "impl_item":
          this.scanImplementation(item, modulePath);
          break;
        case "use_declaration":
          this.scanUse(item, modulePath);
          break;
        case "expression_statement":
          if (
            item.namedChildren.some(
              (child) => child.type === "macro_invocation",
            )
          )
            this.problem(
              "rust-item-macro",
              "A Rust item-position macro can change the selected public declaration set.",
              "Select generated source or add explicit macro expansion support before evaluating coverage.",
              item,
            );
          break;
        case "macro_invocation":
          this.problem(
            "rust-item-macro",
            "A Rust item-position macro can change the selected public declaration set.",
            "Select generated source or add explicit macro expansion support before evaluating coverage.",
            item,
          );
          break;
        case "macro_definition":
          if (
            this.containsPublicVisibility(item) ||
            EvidenceRustSyntax.attributes(item).some(
              (attribute) =>
                EvidenceRustSyntax.attributeName(attribute) === "macro_export",
            )
          )
            this.problem(
              "rust-public-macro",
              "An exported Rust macro is outside the supported type/function/property inventory.",
              "Remove the exported macro from this population or add an explicit macro symbol contract.",
              item,
            );
          break;
        default:
          if (this.containsPublicVisibility(item))
            this.problem(
              "rust-public-form",
              `Public Rust source form '${item.type}' is not classified by this adapter.`,
              "Add an explicit declaration-form rule before evaluating this public surface.",
              item,
            );
      }
    }
  }

  private scanModule(item: EvidenceNode, modulePath: string[]): void {
    this.inspectAttributes(item);
    const name = EvidenceRustSyntax.name(item.childForFieldName("name"));
    if (name === undefined) {
      this.problem(
        "rust-module-name",
        "A Rust module declaration has no statically readable name.",
        "Use one ordinary named module declaration.",
        item,
      );
      return;
    }
    const declaration = this.addDeclaration(
      item,
      modulePath,
      name,
      "type",
      "module",
      EvidenceRustSyntax.visibility(item),
    );
    const body = item.childForFieldName("body");
    if (body !== null) {
      this.scanScope(body, [...modulePath, name], declaration.id);
      return;
    }
    const pathOverride = EvidenceRustSyntax.attributes(item).some(
      (attribute) => EvidenceRustSyntax.attributeName(attribute) === "path",
    );
    if (pathOverride)
      this.problem(
        "rust-module-path",
        `Module '${name}' uses a path override that static module-file resolution does not support.`,
        "Select the generated module layout directly or remove #[path] before evaluating coverage.",
        item,
      );
    this.externalModules.push({
      declarationId: declaration.id,
      modulePath,
      name,
      pathOverride,
    });
  }

  private scanStruct(item: EvidenceNode, modulePath: string[]): void {
    this.inspectAttributes(item);
    const declaration = this.namedType(
      item,
      modulePath,
      "struct",
      EvidenceRustSyntax.visibility(item),
    );
    if (declaration === undefined) return;
    const body = item.childForFieldName("body");
    if (body?.type === "field_declaration_list")
      for (const field of body.namedChildren) {
        if (field.type !== "field_declaration") continue;
        this.inspectAttributes(field);
        const name = EvidenceRustSyntax.name(field.childForFieldName("name"));
        if (name !== undefined)
          this.addDeclaration(
            field,
            modulePath,
            name,
            "property",
            "field",
            EvidenceRustSyntax.visibility(field),
            declaration.id,
          );
      }
    else if (body?.type === "ordered_field_declaration_list")
      this.scanTupleFields(body, modulePath, declaration.id);
  }

  private scanTupleFields(
    body: EvidenceNode,
    modulePath: string[],
    ownerDeclarationId: string,
  ): void {
    let visibility: EvidenceRustVisibility = "private";
    let index = 0;
    const prefixes: EvidenceNode[] = [];
    for (const child of body.namedChildren) {
      if (EvidenceRustSyntax.ordinaryComment(child)) continue;
      if (
        child.type === "attribute_item" ||
        EvidenceRustSyntax.outerDocumentation(child)
      ) {
        prefixes.push(child);
        continue;
      }
      if (child.type === "visibility_modifier") {
        prefixes.push(child);
        visibility = child.text.trim() === "pub" ? "public" : "restricted";
        continue;
      }
      this.inspectAttributes(child, prefixes);
      this.addDeclaration(
        child,
        modulePath,
        String(index++),
        "property",
        "tuple-field",
        visibility,
        ownerDeclarationId,
        undefined,
        undefined,
        prefixes,
      );
      visibility = "private";
      prefixes.length = 0;
    }
  }

  private scanEnum(item: EvidenceNode, modulePath: string[]): void {
    this.inspectAttributes(item);
    const declaration = this.namedType(
      item,
      modulePath,
      "enum",
      EvidenceRustSyntax.visibility(item),
    );
    if (declaration === undefined) return;
    const body = item.childForFieldName("body");
    for (const variant of body?.namedChildren ?? []) {
      if (variant.type !== "enum_variant") continue;
      this.inspectAttributes(variant);
      const name = EvidenceRustSyntax.name(variant.childForFieldName("name"));
      if (name !== undefined)
        this.addDeclaration(
          variant,
          modulePath,
          name,
          "property",
          "enum-variant",
          "implicit",
          declaration.id,
        );
    }
  }

  private scanTrait(item: EvidenceNode, modulePath: string[]): void {
    this.inspectAttributes(item);
    const declaration = this.namedType(
      item,
      modulePath,
      "trait",
      EvidenceRustSyntax.visibility(item),
    );
    if (declaration === undefined) return;
    const body = item.childForFieldName("body");
    for (const member of body?.namedChildren ?? []) {
      if (
        member.type === "attribute_item" ||
        member.type === "line_comment" ||
        member.type === "block_comment"
      )
        continue;
      this.inspectAttributes(member);
      const name = EvidenceRustSyntax.name(member.childForFieldName("name"));
      if (
        name !== undefined &&
        (member.type === "function_signature_item" ||
          member.type === "function_item")
      )
        this.addDeclaration(
          member,
          modulePath,
          name,
          "function",
          "trait-method",
          "implicit",
          declaration.id,
        );
      else if (name !== undefined && member.type === "const_item")
        this.addDeclaration(
          member,
          modulePath,
          name,
          "property",
          "trait-constant",
          "implicit",
          declaration.id,
        );
      else if (
        name !== undefined &&
        (member.type === "associated_type" || member.type === "type_item")
      )
        this.addDeclaration(
          member,
          modulePath,
          name,
          "type",
          "trait-type",
          "implicit",
          declaration.id,
        );
      else if (
        member.type === "macro_invocation" ||
        (member.type === "expression_statement" &&
          member.namedChildren.some(
            (child) => child.type === "macro_invocation",
          ))
      )
        this.problem(
          "rust-item-macro",
          `A macro can change the associated items of trait '${declaration.name}'.`,
          "Expand the trait source or add explicit macro support before evaluating coverage.",
          member,
        );
    }
  }

  private scanTypeAlias(item: EvidenceNode, modulePath: string[]): void {
    this.inspectAttributes(item);
    this.namedType(
      item,
      modulePath,
      "type-alias",
      EvidenceRustSyntax.visibility(item),
    );
  }

  private scanFreeFunction(item: EvidenceNode, modulePath: string[]): void {
    this.inspectAttributes(item);
    const name = EvidenceRustSyntax.name(item.childForFieldName("name"));
    if (name !== undefined)
      this.addDeclaration(
        item,
        modulePath,
        name,
        "function",
        "function",
        EvidenceRustSyntax.visibility(item),
      );
  }

  private scanValue(
    item: EvidenceNode,
    modulePath: string[],
    form: "constant" | "static",
  ): void {
    this.inspectAttributes(item);
    const name = EvidenceRustSyntax.name(item.childForFieldName("name"));
    if (name !== undefined)
      this.addDeclaration(
        item,
        modulePath,
        name,
        "property",
        form,
        EvidenceRustSyntax.visibility(item),
      );
  }

  private scanImplementation(item: EvidenceNode, modulePath: string[]): void {
    this.inspectAttributes(item);
    const ownerPath = EvidenceRustSyntax.path(item.childForFieldName("type"));
    if (ownerPath === undefined) {
      this.problem(
        "rust-impl-owner",
        "A Rust impl block has no supported local nominal owner path.",
        "Implement a selected local named struct or enum, or add explicit ownership support.",
        item,
      );
      return;
    }
    const traitPath = EvidenceRustSyntax.path(item.childForFieldName("trait"));
    const implementation: IEvidenceRustImplementation = {
      id: `rust:${this.source.id}:impl:${item.startIndex}`,
      modulePath,
      ownerPath,
      ...(traitPath === undefined ? {} : { traitPath }),
      typeParameters: EvidenceRustSyntax.typeParameters(item),
    };
    this.implementations.push(implementation);
    const body = item.childForFieldName("body");
    const header = this.text.range(
      item.startIndex,
      body === null ? item.endIndex : body.startIndex,
    );
    for (const member of body?.namedChildren ?? []) {
      if (
        member.type === "attribute_item" ||
        member.type === "line_comment" ||
        member.type === "block_comment"
      )
        continue;
      this.inspectAttributes(member);
      const name = EvidenceRustSyntax.name(member.childForFieldName("name"));
      const visibility =
        traitPath === undefined
          ? EvidenceRustSyntax.visibility(member)
          : "implicit";
      if (name !== undefined && member.type === "function_item") {
        const declaration = this.addDeclaration(
          member,
          modulePath,
          name,
          "function",
          "impl-method",
          visibility,
          undefined,
          implementation.id,
          name,
        );
        declaration.site.content.unshift(header);
        declaration.site.range.start = header.start;
      } else if (name !== undefined && member.type === "const_item") {
        const declaration = this.addDeclaration(
          member,
          modulePath,
          name,
          "property",
          "impl-constant",
          visibility,
          undefined,
          implementation.id,
          name,
        );
        declaration.site.content.unshift(header);
        declaration.site.range.start = header.start;
      } else if (name !== undefined && member.type === "type_item") {
        const declaration = this.addDeclaration(
          member,
          modulePath,
          name,
          "type",
          "impl-type",
          visibility,
          undefined,
          implementation.id,
          name,
        );
        declaration.site.content.unshift(header);
        declaration.site.range.start = header.start;
      } else if (
        member.type === "macro_invocation" ||
        (member.type === "expression_statement" &&
          member.namedChildren.some(
            (child) => child.type === "macro_invocation",
          ))
      )
        this.problem(
          "rust-item-macro",
          "A macro can change the selected associated items of a Rust impl block.",
          "Expand the impl source or add explicit macro support before evaluating coverage.",
          member,
        );
      else if (this.containsPublicVisibility(member))
        this.problem(
          "rust-public-form",
          `Public Rust impl form '${member.type}' is not classified by this adapter.`,
          "Add an explicit associated-item rule before evaluating coverage.",
          member,
        );
    }
  }

  private scanUse(item: EvidenceNode, modulePath: string[]): void {
    this.inspectAttributes(item);
    if (EvidenceRustSyntax.visibility(item) !== "public") return;
    const argument = item.childForFieldName("argument");
    const bindings: IEvidenceRustUseBinding[] = [];
    if (argument !== null) this.parseUse(argument, [], bindings);
    if (bindings.length === 0) {
      this.problem(
        "rust-use-shape",
        "A public Rust use declaration has no statically resolvable bindings.",
        "Use named, aliased, grouped, or wildcard paths rooted in selected modules.",
        item,
      );
      return;
    }
    this.uses.push({
      id: `rust:${this.source.id}:use:${item.startIndex}`,
      modulePath,
      bindings,
      siteId: this.siteId(item),
    });
  }

  private parseUse(
    node: EvidenceNode,
    prefix: string[],
    output: IEvidenceRustUseBinding[],
  ): void {
    if (node.type === "use_as_clause") {
      const path = EvidenceRustSyntax.path(node.childForFieldName("path"));
      const alias = EvidenceRustSyntax.name(node.childForFieldName("alias"));
      if (path !== undefined && alias !== undefined && alias !== "_")
        output.push({ path: [...prefix, ...path], alias, wildcard: false });
      return;
    }
    if (node.type === "scoped_use_list") {
      const base = EvidenceRustSyntax.path(node.childForFieldName("path"));
      const list = node.childForFieldName("list");
      if (base !== undefined && list !== null)
        this.parseUse(list, [...prefix, ...base], output);
      return;
    }
    if (node.type === "use_list") {
      for (const child of node.namedChildren)
        this.parseUse(child, prefix, output);
      return;
    }
    if (node.type === "use_wildcard") {
      const child = node.namedChildren[0] ?? null;
      const path = EvidenceRustSyntax.path(child);
      output.push({
        path: path === undefined ? prefix : [...prefix, ...path],
        wildcard: true,
      });
      return;
    }
    const path = EvidenceRustSyntax.path(node);
    if (path === undefined) return;
    const resolved =
      node.type === "self" && prefix.length !== 0
        ? prefix
        : [...prefix, ...path];
    output.push({ path: resolved, wildcard: false });
  }

  private namedType(
    item: EvidenceNode,
    modulePath: string[],
    form: "struct" | "enum" | "trait" | "type-alias",
    visibility: EvidenceRustVisibility,
  ): IEvidenceRustDeclaration | undefined {
    const name = EvidenceRustSyntax.name(item.childForFieldName("name"));
    if (name === undefined) return undefined;
    return this.addDeclaration(
      item,
      modulePath,
      name,
      "type",
      form,
      visibility,
    );
  }

  private addDeclaration(
    item: EvidenceNode,
    modulePath: string[],
    name: string,
    symbol: EvidenceProgrammingSymbol,
    form: EvidenceRustDeclarationForm,
    visibility: EvidenceRustVisibility,
    ownerDeclarationId?: string,
    implementationId?: string,
    memberSegment?: string,
    suppliedPrefixes?: EvidenceNode[],
  ): IEvidenceRustDeclaration {
    const prefixes = suppliedPrefixes ?? EvidenceRustSyntax.attributes(item);
    const start = prefixes[0]?.startIndex ?? item.startIndex;
    const site: IEvidenceUnitSite = {
      id: this.siteId(item),
      file: this.source.physicalPath,
      range: this.text.range(start, item.endIndex),
      content: [this.text.range(start, item.endIndex)],
    };
    const declaration: IEvidenceRustDeclaration = {
      id: `rust:${this.source.id}:declaration:${form}:${item.startIndex}:${name}`,
      modulePath,
      name,
      symbol,
      form,
      visibility,
      site,
      ...(ownerDeclarationId === undefined ? {} : { ownerDeclarationId }),
      ...(implementationId === undefined ? {} : { implementationId }),
      ...(memberSegment === undefined ? {} : { memberSegment }),
    };
    this.declarations.push(declaration);
    for (const prefix of prefixes) {
      const documentation = this.carrierDocumentation.get(this.nodeKey(prefix));
      if (documentation !== undefined)
        this.attach(documentation, declaration.id, site.id);
    }
    return declaration;
  }

  private attachInnerDocumentation(
    scope: EvidenceNode,
    modulePath: string[],
    moduleDeclarationId: string | undefined,
  ): void {
    for (const child of scope.namedChildren) {
      const documentation = this.carrierDocumentation.get(this.nodeKey(child));
      if (documentation === undefined) continue;
      if (
        EvidenceRustSyntax.innerDocumentation(child) ||
        (child.type === "inner_attribute_item" &&
          EvidenceRustSyntax.attributeName(child) === "doc")
      ) {
        if (moduleDeclarationId === undefined)
          documentation.innerModulePath = modulePath;
        else {
          const declaration = this.declarations.find(
            (candidate) => candidate.id === moduleDeclarationId,
          );
          if (declaration !== undefined)
            this.attach(documentation, declaration.id, declaration.site.id);
        }
      }
    }
  }

  private collectDocumentation(): void {
    const comments = [
      ...this.session.root.descendantsOfType("line_comment"),
      ...this.session.root.descendantsOfType("block_comment"),
    ].sort((left, right) => left.startIndex - right.startIndex);
    const consumed = new Set<string>();
    for (const first of comments) {
      if (consumed.has(this.nodeKey(first))) continue;
      const syntax = EvidenceRustSyntax.comment(first);
      const sequence: EvidenceNode[] = [first];
      consumed.add(this.nodeKey(first));
      let last = first;
      if (first.type === "line_comment") {
        let next = last.nextNamedSibling;
        while (
          next !== null &&
          next.type === "line_comment" &&
          EvidenceRustSyntax.comment(next).opening === syntax.opening &&
          next.startPosition.column === first.startPosition.column &&
          !/\r?\n[ \t]*\r?\n/u.test(
            this.source.content.slice(last.endIndex, next.startIndex),
          )
        ) {
          sequence.push(next);
          consumed.add(this.nodeKey(next));
          last = next;
          next = last.nextNamedSibling;
        }
      }
      const range = this.text.range(first.startIndex, last.endIndex);
      const raw = this.source.content.slice(
        range.start.offset + syntax.opening.length,
        range.end.offset - syntax.closing.length,
      );
      if (
        EvidenceRustSyntax.outerDocumentation(first) ||
        EvidenceRustSyntax.innerDocumentation(first) ||
        this.annotation(raw)
      ) {
        const documentation = this.ensureDocumentation(range, syntax);
        for (const comment of sequence)
          this.carrierDocumentation.set(this.nodeKey(comment), documentation);
      }
    }

    const attributes = [
      ...this.session.root.descendantsOfType("attribute_item"),
      ...this.session.root.descendantsOfType("inner_attribute_item"),
    ];
    for (const attribute of attributes) {
      if (EvidenceRustSyntax.attributeName(attribute) !== "doc") continue;
      if (!/^#!?\[\s*doc\s*=/u.test(attribute.text)) continue;
      const value = EvidenceRustSyntax.attributeValue(attribute);
      const syntax =
        value === null ? undefined : EvidenceRustSyntax.string(value);
      if (value === null || syntax === undefined) {
        this.problem(
          "rust-doc-attribute",
          "A Rust doc attribute does not use a supported static string literal.",
          'Use #[doc = "..."] or an outer documentation comment for Evidence tags.',
          attribute,
        );
        continue;
      }
      const documentation = this.ensureDocumentation(
        this.session.range(value),
        syntax,
      );
      this.carrierDocumentation.set(this.nodeKey(attribute), documentation);
    }
  }

  private inspectAttributes(
    item: EvidenceNode,
    supplied?: EvidenceNode[],
  ): void {
    for (const attribute of supplied ?? EvidenceRustSyntax.attributes(item)) {
      if (attribute.type !== "attribute_item") continue;
      const name = EvidenceRustSyntax.attributeName(attribute);
      if (name === undefined) continue;
      if (name === "cfg" || name === "cfg_attr")
        this.problem(
          "rust-conditional-item",
          `Attribute #[${name}] can change the selected Rust public declaration set.`,
          "Select one expanded source configuration or add explicit cfg evaluation before checking coverage.",
          attribute,
        );
      else if (!INERT_ATTRIBUTES.has(name))
        this.problem(
          "rust-attribute-expansion",
          `Attribute #[${name}] may generate or replace Rust public declarations.`,
          "Select expanded source or add explicit support for this attribute before checking coverage.",
          attribute,
        );
    }
  }

  private containsPublicVisibility(node: EvidenceNode): boolean {
    return node
      .descendantsOfType("visibility_modifier")
      .some((modifier) => modifier.text.trim() === "pub");
  }

  private attach(
    documentation: IEvidenceRustDocumentation,
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
  ): IEvidenceRustDocumentation {
    const key = `${range.start.offset}:${range.end.offset}`;
    let documentation = this.documentation.get(key);
    if (documentation === undefined) {
      documentation = {
        id: `rust:${this.source.id}:documentation:${key}`,
        range,
        syntax,
        attachments: [],
      };
      this.documentation.set(key, documentation);
    }
    return documentation;
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
    return `rust:${this.source.id}:site:${this.nodeKey(node)}`;
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
