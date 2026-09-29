import type { Node as EvidenceNode } from "web-tree-sitter";

import { EvidenceDocumentation } from "../../parsers/EvidenceDocumentation";
import type { EvidenceParseSession } from "../../parsers/EvidenceParseSession";
import type { IEvidenceCommentSyntax } from "../../structures/IEvidenceCommentSyntax";
import type { IEvidenceDiagnostic } from "../../structures/IEvidenceDiagnostic";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceRange } from "../../structures/IEvidenceSourceRange";
import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { EvidenceCSharpDeclarationForm } from "./EvidenceCSharpDeclarationForm";
import { EvidenceCSharpSyntax } from "./EvidenceCSharpSyntax";
import type { EvidenceCSharpTypeKind } from "./EvidenceCSharpTypeKind";
import type { IEvidenceCSharpDeclaration } from "./IEvidenceCSharpDeclaration";
import type { IEvidenceCSharpDeclarationAddress } from "./IEvidenceCSharpDeclarationAddress";
import type { IEvidenceCSharpDocumentation } from "./IEvidenceCSharpDocumentation";
import type { IEvidenceCSharpFileAnalysis } from "./IEvidenceCSharpFileAnalysis";
import type { IEvidenceCSharpTypeContext } from "./IEvidenceCSharpTypeContext";
import { EvidenceSourceText } from "../../internal/EvidenceSourceText";

/**
 * Extracts C# namespaces, declarations, and XML documentation.
 *
 * It preserves declaration ownership and physical attachment decisions for
 * `EvidenceCSharpAdapter`, which reconciles partial families after parsing
 * closes.
 */
export class EvidenceCSharpFileScanner {
  private readonly declarations: IEvidenceCSharpDeclaration[] = [];
  private readonly documentation = new Map<
    string,
    IEvidenceCSharpDocumentation
  >();
  private readonly carrierDocumentation = new Map<
    string,
    IEvidenceCSharpDocumentation
  >();
  private readonly diagnostics: IEvidenceDiagnostic[] = [];
  private readonly reported = new Set<string>();
  private readonly text: EvidenceSourceText;
  private complete = true;

  /**
   * Binds the scanner to one C# parser session and captured source file.
   *
   * XML documentation is collected first so declaration adjacency remains a
   * property of the original source rather than a materialized unit.
   */
  public constructor(
    private readonly session: EvidenceParseSession,
    private readonly source: IEvidenceSourceFile,
  ) {
    this.text = new EvidenceSourceText(source.content);
    this.collectDocumentation();
  }

  /**
   * Extracts supported file and block namespace declarations into a file
   * record.
   *
   * Invalid namespace or declaration surfaces contribute diagnostics and
   * preserve incompleteness for the adapter's final inventory.
   */
  public scan(): IEvidenceCSharpFileAnalysis {
    let namespacePath: string[] = [];
    let fileScoped = false;
    for (const item of this.session.root.namedChildren) {
      if (item.type === "file_scoped_namespace_declaration") {
        const path = EvidenceCSharpSyntax.path(item.childForFieldName("name"));
        if (path === undefined)
          this.problem(
            "csharp-namespace-name",
            "A file-scoped C# namespace has no statically readable name.",
            "Use one identifier or dotted namespace name.",
            item,
          );
        else if (fileScoped)
          this.problem(
            "csharp-file-namespace",
            "A C# source file declares more than one file-scoped namespace.",
            "Keep one file-scoped namespace in the selected source file.",
            item,
          );
        else {
          namespacePath = path;
          fileScoped = true;
        }
        continue;
      }
      this.scanDeclaration(item, namespacePath, undefined);
    }
    return {
      source: this.source,
      declarations: this.declarations,
      documentation: Array.from(this.documentation.values()),
      diagnostics: this.diagnostics,
      complete: this.complete,
    };
  }

  private scanDeclaration(
    item: EvidenceNode,
    namespacePath: string[],
    owner: IEvidenceCSharpTypeContext | undefined,
  ): void {
    switch (item.type) {
      case "comment":
      case "using_directive":
      case "extern_alias_directive":
      case "global_attribute_list":
      case "global_statement":
      case "constructor_declaration":
      case "destructor_declaration":
        return;
      case "namespace_declaration":
        if (owner === undefined) this.scanNamespace(item, namespacePath);
        return;
      case "class_declaration":
        this.scanType(item, namespacePath, owner, "class", "class");
        return;
      case "struct_declaration":
        this.scanType(item, namespacePath, owner, "struct", "struct");
        return;
      case "interface_declaration":
        this.scanType(item, namespacePath, owner, "interface", "interface");
        return;
      case "record_declaration":
        this.scanType(
          item,
          namespacePath,
          owner,
          "record",
          EvidenceCSharpSyntax.hasToken(item, "struct")
            ? "record-struct"
            : "record",
        );
        return;
      case "enum_declaration":
        this.scanType(item, namespacePath, owner, "enum", "enum");
        return;
      case "delegate_declaration":
        this.scanType(item, namespacePath, owner, "delegate", "delegate");
        return;
      case "field_declaration":
        if (owner !== undefined) this.scanField(item, owner, "field");
        return;
      case "event_field_declaration":
        if (owner !== undefined) this.scanField(item, owner, "event");
        return;
      case "event_declaration":
        if (owner !== undefined) this.scanNamedMember(item, owner, "event");
        return;
      case "property_declaration":
        if (owner !== undefined) this.scanNamedMember(item, owner, "property");
        return;
      case "method_declaration":
        if (owner !== undefined) this.scanNamedMember(item, owner, "method");
        return;
      case "indexer_declaration":
        if (owner !== undefined) this.scanIndexer(item, owner);
        return;
      case "operator_declaration":
        if (owner !== undefined) this.scanOperator(item, owner);
        return;
      case "conversion_operator_declaration":
        if (owner !== undefined) this.scanConversionOperator(item, owner);
        return;
      case "preproc_if":
        this.problem(
          "csharp-preprocessor-conditional",
          "Conditional compilation can change the selected C# declaration population.",
          "Select preprocessed generated source or remove declaration-position conditional branches.",
          item,
        );
        return;
      default:
        if (EvidenceCSharpSyntax.hasModifier(item, "public"))
          this.problem(
            "csharp-public-form",
            `Public C# source form '${item.type}' is not classified by this adapter.`,
            "Add an explicit declaration-form rule before evaluating this public surface.",
            item,
          );
    }
  }

  private scanNamespace(item: EvidenceNode, prefix: string[]): void {
    const name = EvidenceCSharpSyntax.path(item.childForFieldName("name"));
    if (name === undefined) {
      this.problem(
        "csharp-namespace-name",
        "A C# namespace declaration has no statically readable name.",
        "Use one identifier or dotted namespace name.",
        item,
      );
      return;
    }
    const body = item.childForFieldName("body");
    if (body === null) return;
    const namespacePath = [...prefix, ...name];
    for (const child of body.namedChildren)
      this.scanDeclaration(child, namespacePath, undefined);
  }

  private scanType(
    item: EvidenceNode,
    namespacePath: string[],
    owner: IEvidenceCSharpTypeContext | undefined,
    kind: EvidenceCSharpTypeKind,
    form: Extract<
      EvidenceCSharpDeclarationForm,
      | "class"
      | "struct"
      | "interface"
      | "record"
      | "record-struct"
      | "enum"
      | "delegate"
    >,
  ): void {
    const name = EvidenceCSharpSyntax.name(item.childForFieldName("name"));
    if (name === undefined) {
      this.problem(
        "csharp-type-name",
        `A C# ${form} declaration has no statically readable name.`,
        "Use one ordinary named declaration.",
        item,
      );
      return;
    }
    const arity = EvidenceCSharpSyntax.typeParameterArity(item);
    const identityName = arity === 0 ? name : `${name}\`${arity}`;
    const identity = [
      ...(owner === undefined ? namespacePath : owner.identity),
      identityName,
    ];
    const addresses = this.typeAddresses(
      owner?.addresses ?? [
        { segments: namespacePath, canonical: true, aliasPrefixes: [] },
      ],
      name,
      identityName,
    );
    const declaration = this.addDeclaration(
      item,
      item,
      this.documentationFor(item),
      [this.session.range(item)],
      name,
      "type",
      form,
      identity,
      addresses,
      owner?.kind === "interface",
      false,
      owner?.declarationId,
    );
    const context: IEvidenceCSharpTypeContext = {
      declarationId: declaration.id,
      identity,
      addresses,
      kind,
    };
    const body = item.childForFieldName("body");
    if (body === null) return;
    if (kind === "enum") {
      for (const member of body.namedChildren)
        if (member.type === "enum_member_declaration")
          this.scanEnumMember(member, context);
        else this.scanDeclaration(member, namespacePath, context);
      return;
    }
    for (const member of body.namedChildren)
      this.scanDeclaration(member, namespacePath, context);
  }

  private scanField(
    item: EvidenceNode,
    owner: IEvidenceCSharpTypeContext,
    form: "field" | "event",
  ): void {
    const variable = item.namedChildren.find(
      (child) => child.type === "variable_declaration",
    );
    const declarators =
      variable === undefined
        ? []
        : variable.namedChildren.filter(
            (child) => child.type === "variable_declarator",
          );
    const first = declarators[0];
    if (first === undefined) return;
    const header = this.text.range(item.startIndex, first.startIndex);
    const documentation = this.documentationFor(item);
    const implicitPublic = owner.kind === "interface";
    for (const declarator of declarators) {
      const name = EvidenceCSharpSyntax.name(
        declarator.childForFieldName("name"),
      );
      if (name === undefined) continue;
      this.addDeclaration(
        declarator,
        item,
        documentation,
        [header, this.session.range(declarator)],
        name,
        "property",
        form,
        [...owner.identity, name],
        this.memberAddresses(owner, name),
        implicitPublic,
        false,
        owner.declarationId,
      );
    }
  }

  private scanNamedMember(
    item: EvidenceNode,
    owner: IEvidenceCSharpTypeContext,
    form: "method" | "property" | "event",
  ): void {
    const name = EvidenceCSharpSyntax.name(item.childForFieldName("name"));
    if (name === undefined) {
      this.problem(
        "csharp-member-name",
        `A C# ${form} declaration has no statically readable name.`,
        "Use one ordinary named member declaration.",
        item,
      );
      return;
    }
    this.addDeclaration(
      item,
      item,
      this.documentationFor(item),
      [this.session.range(item)],
      name,
      form === "method" ? "function" : "property",
      form,
      [...owner.identity, name],
      this.memberAddresses(owner, name),
      owner.kind === "interface",
      EvidenceCSharpSyntax.explicitInterface(item),
      owner.declarationId,
    );
  }

  private scanEnumMember(
    item: EvidenceNode,
    owner: IEvidenceCSharpTypeContext,
  ): void {
    const name = EvidenceCSharpSyntax.name(item.childForFieldName("name"));
    if (name === undefined) return;
    this.addDeclaration(
      item,
      item,
      this.documentationFor(item),
      [this.session.range(item)],
      name,
      "property",
      "enum-member",
      [...owner.identity, name],
      this.memberAddresses(owner, name),
      true,
      false,
      owner.declarationId,
    );
  }

  private scanIndexer(
    item: EvidenceNode,
    owner: IEvidenceCSharpTypeContext,
  ): void {
    const name = "this[]";
    this.addDeclaration(
      item,
      item,
      this.documentationFor(item),
      [this.session.range(item)],
      name,
      "property",
      "indexer",
      [...owner.identity, name],
      this.memberAddresses(owner, name),
      owner.kind === "interface",
      EvidenceCSharpSyntax.explicitInterface(item),
      owner.declarationId,
    );
  }

  private scanOperator(
    item: EvidenceNode,
    owner: IEvidenceCSharpTypeContext,
  ): void {
    const name = EvidenceCSharpSyntax.operatorName(item);
    if (name === undefined) {
      this.problem(
        "csharp-operator-name",
        "A C# operator declaration has no statically readable operator token.",
        "Use a grammar-supported operator declaration.",
        item,
      );
      return;
    }
    this.addDeclaration(
      item,
      item,
      this.documentationFor(item),
      [this.session.range(item)],
      name,
      "function",
      "operator",
      [...owner.identity, name],
      this.memberAddresses(owner, name),
      owner.kind === "interface",
      EvidenceCSharpSyntax.explicitInterface(item),
      owner.declarationId,
    );
  }

  private scanConversionOperator(
    item: EvidenceNode,
    owner: IEvidenceCSharpTypeContext,
  ): void {
    const name = EvidenceCSharpSyntax.conversionOperatorName(item);
    if (name === undefined) {
      this.problem(
        "csharp-conversion-name",
        "A C# conversion operator has no statically readable kind or destination type.",
        "Use a grammar-supported implicit or explicit conversion declaration.",
        item,
      );
      return;
    }
    this.addDeclaration(
      item,
      item,
      this.documentationFor(item),
      [this.session.range(item)],
      name,
      "function",
      "conversion-operator",
      [...owner.identity, name],
      this.memberAddresses(owner, name),
      owner.kind === "interface",
      EvidenceCSharpSyntax.explicitInterface(item),
      owner.declarationId,
    );
  }

  private addDeclaration(
    item: EvidenceNode,
    siteNode: EvidenceNode,
    documentation: IEvidenceCSharpDocumentation | undefined,
    content: IEvidenceSourceRange[],
    name: string,
    symbol: EvidenceProgrammingSymbol,
    form: EvidenceCSharpDeclarationForm,
    identity: string[],
    addresses: IEvidenceCSharpDeclarationAddress[],
    implicitPublic: boolean,
    explicitInterface: boolean,
    ownerDeclarationId?: string,
  ): IEvidenceCSharpDeclaration {
    const site: IEvidenceUnitSite = {
      id: this.siteId(siteNode),
      file: this.source.physicalPath,
      range: this.text.range(
        documentation === undefined
          ? siteNode.startIndex
          : documentation.range.start.offset,
        siteNode.endIndex,
      ),
      content,
    };
    const declaration: IEvidenceCSharpDeclaration = {
      id: `csharp:${this.source.id}:declaration:${form}:${item.startIndex}:${name}`,
      name,
      symbol,
      form,
      identity,
      addresses,
      site,
      accessibility: EvidenceCSharpSyntax.accessibility(siteNode),
      implicitPublic,
      partial: EvidenceCSharpSyntax.hasModifier(siteNode, "partial"),
      explicitInterface,
      ...(ownerDeclarationId === undefined ? {} : { ownerDeclarationId }),
    };
    this.declarations.push(declaration);
    if (documentation !== undefined)
      this.attach(documentation, declaration.id, site.id);
    return declaration;
  }

  private typeAddresses(
    bases: IEvidenceCSharpDeclarationAddress[],
    name: string,
    identityName: string,
  ): IEvidenceCSharpDeclarationAddress[] {
    const names = name === identityName ? [name] : [identityName, name];
    return bases.flatMap((base) =>
      names.map((entry) => {
        const segments = [...base.segments, entry];
        return {
          segments,
          canonical: base.canonical && entry === identityName,
          aliasPrefixes:
            entry === identityName
              ? base.aliasPrefixes
              : [...base.aliasPrefixes, segments],
        };
      }),
    );
  }

  private memberAddresses(
    owner: IEvidenceCSharpTypeContext,
    name: string,
  ): IEvidenceCSharpDeclarationAddress[] {
    return owner.addresses.map((address) => ({
      segments: [...address.segments, name],
      canonical: address.canonical,
      aliasPrefixes: address.aliasPrefixes,
    }));
  }

  private documentationFor(
    node: EvidenceNode,
  ): IEvidenceCSharpDocumentation | undefined {
    const previous = node.previousNamedSibling;
    if (previous === null || !EvidenceCSharpSyntax.isXmlDocumentation(previous))
      return undefined;
    const documentation = this.carrierDocumentation.get(this.nodeKey(previous));
    const gap =
      documentation === undefined
        ? ""
        : this.source.content.slice(
            documentation.range.end.offset,
            node.startIndex,
          );
    if (
      documentation === undefined ||
      documentation.range.start.column !== node.startPosition.column + 1 ||
      !/^\s*$/u.test(gap) ||
      /\r?\n[ \t]*\r?\n/u.test(gap)
    )
      return undefined;
    return documentation;
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
      if (first.text.startsWith("//")) {
        let next = last.nextNamedSibling;
        while (
          next !== null &&
          next.type === "comment" &&
          next.text.startsWith("///") === first.text.startsWith("///") &&
          next.startPosition.column === first.startPosition.column &&
          /^\s*$/u.test(
            this.source.content.slice(last.endIndex, next.startIndex),
          ) &&
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
      const syntax = EvidenceCSharpSyntax.comment(first);
      const supported = EvidenceCSharpSyntax.isXmlDocumentation(first);
      const raw = EvidenceDocumentation.read(
        this.source.content,
        "csharp-probe",
        range,
        syntax,
      ).text;
      if (!supported && !this.annotation(raw)) continue;
      const documentation = this.ensureDocumentation(range, syntax);
      for (const comment of sequence)
        this.carrierDocumentation.set(this.nodeKey(comment), documentation);
    }
  }

  private attach(
    documentation: IEvidenceCSharpDocumentation,
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
  ): IEvidenceCSharpDocumentation {
    const key = `${range.start.offset}:${range.end.offset}`;
    let documentation = this.documentation.get(key);
    if (documentation === undefined) {
      documentation = {
        id: `csharp:${this.source.id}:documentation:${key}`,
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
    return `csharp:${this.source.id}:site:${this.nodeKey(node)}`;
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
