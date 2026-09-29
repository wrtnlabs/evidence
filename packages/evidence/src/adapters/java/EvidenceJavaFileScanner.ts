import type { Node as EvidenceNode } from "web-tree-sitter";

import type { EvidenceParseSession } from "../../parsers/EvidenceParseSession";
import type { IEvidenceCommentSyntax } from "../../structures/IEvidenceCommentSyntax";
import type { IEvidenceDiagnostic } from "../../structures/IEvidenceDiagnostic";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceRange } from "../../structures/IEvidenceSourceRange";
import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { IEvidenceJavaDeclaration } from "./IEvidenceJavaDeclaration";
import type { IEvidenceJavaDocumentation } from "./IEvidenceJavaDocumentation";
import type { IEvidenceJavaFileAnalysis } from "./IEvidenceJavaFileAnalysis";
import type { IEvidenceJavaTypeContext } from "./IEvidenceJavaTypeContext";
import type { EvidenceJavaDeclarationForm } from "./EvidenceJavaDeclarationForm";
import { EvidenceJavaSyntax } from "./EvidenceJavaSyntax";
import type { EvidenceJavaTypeKind } from "./EvidenceJavaTypeKind";
import { EvidenceSourceText } from "../../internal/EvidenceSourceText";

/**
 * Extracts Java packages, declarations, and Javadoc before family
 * materialization.
 *
 * Ownership and visibility are recorded from selected source only;
 * `EvidenceJavaAdapter` later reconciles compatible declaration families into
 * graph units.
 */
export class EvidenceJavaFileScanner {
  private readonly declarations: IEvidenceJavaDeclaration[] = [];
  private readonly documentation = new Map<
    string,
    IEvidenceJavaDocumentation
  >();
  private readonly carrierDocumentation = new Map<
    string,
    IEvidenceJavaDocumentation
  >();
  private readonly diagnostics: IEvidenceDiagnostic[] = [];
  private readonly reported = new Set<string>();
  private readonly text: EvidenceSourceText;
  private complete = true;

  /**
   * Creates a scanner for one Java parse session and source snapshot.
   *
   * Javadoc carriers are collected before declaration walking so their physical
   * attachment cannot be confused with same-named declarations elsewhere.
   */
  public constructor(
    private readonly session: EvidenceParseSession,
    private readonly source: IEvidenceSourceFile,
  ) {
    this.text = new EvidenceSourceText(source.content);
    this.collectDocumentation();
  }

  /**
   * Produces node-free package declarations, documentation, and diagnostics.
   *
   * The result records unsupported relevant forms as incomplete rather than
   * allowing the adapter to publish a falsely complete smaller inventory.
   */
  public scan(): IEvidenceJavaFileAnalysis {
    const packageDeclaration = this.session.root.namedChildren.find(
      (child) => child.type === "package_declaration",
    );
    const packagePath = EvidenceJavaSyntax.packagePath(packageDeclaration);
    for (const item of this.session.root.namedChildren)
      switch (item.type) {
        case "package_declaration":
        case "import_declaration":
        case "line_comment":
        case "block_comment":
        case "module_declaration":
          break;
        case "class_declaration":
          this.scanType(item, packagePath, undefined, "class", "class");
          break;
        case "interface_declaration":
          this.scanType(item, packagePath, undefined, "interface", "interface");
          break;
        case "enum_declaration":
          this.scanType(item, packagePath, undefined, "enum", "enum");
          break;
        case "annotation_type_declaration":
          this.scanType(
            item,
            packagePath,
            undefined,
            "annotation",
            "annotation",
          );
          break;
        case "record_declaration":
          this.scanType(item, packagePath, undefined, "record", "record");
          break;
        default:
          if (EvidenceJavaSyntax.hasModifier(item, "public"))
            this.problem(
              "java-public-form",
              `Public Java source form '${item.type}' is not classified by this adapter.`,
              "Add an explicit declaration-form rule before evaluating this public surface.",
              item,
            );
      }
    return {
      source: this.source,
      declarations: this.declarations,
      documentation: Array.from(this.documentation.values()),
      diagnostics: this.diagnostics,
      complete: this.complete,
    };
  }

  private scanType(
    item: EvidenceNode,
    packagePath: string[],
    owner: IEvidenceJavaTypeContext | undefined,
    kind: EvidenceJavaTypeKind,
    form: Extract<
      EvidenceJavaDeclarationForm,
      "class" | "interface" | "enum" | "annotation" | "record"
    >,
  ): void {
    const name = EvidenceJavaSyntax.name(item.childForFieldName("name"));
    if (name === undefined) {
      this.problem(
        "java-type-name",
        `A Java ${form} declaration has no statically readable name.`,
        "Use one ordinary named declaration.",
        item,
      );
      return;
    }
    const identity = [
      ...(owner === undefined ? packagePath : owner.identity),
      name,
    ];
    const address = [...(owner?.address ?? []), name];
    const visible = this.typePublic(item, owner);
    const declaration = this.addDeclaration(
      item,
      item,
      EvidenceJavaSyntax.javadoc(item),
      [this.session.range(item)],
      name,
      "type",
      form,
      identity,
      address,
      visible,
      owner?.declarationId,
    );
    const context: IEvidenceJavaTypeContext = {
      declarationId: declaration.id,
      identity,
      address,
      kind,
      public: visible,
    };
    if (kind === "record") this.scanRecordComponents(item, context);
    const body = item.childForFieldName("body");
    if (body !== null) this.scanTypeBody(body, context);
  }

  private scanTypeBody(
    body: EvidenceNode,
    owner: IEvidenceJavaTypeContext,
  ): void {
    for (const member of body.namedChildren)
      switch (member.type) {
        case "line_comment":
        case "block_comment":
        case "constructor_declaration":
        case "compact_constructor_declaration":
        case "static_initializer":
          break;
        case "enum_body_declarations":
          this.scanTypeBody(member, owner);
          break;
        case "class_declaration":
          this.scanType(member, [], owner, "class", "class");
          break;
        case "interface_declaration":
          this.scanType(member, [], owner, "interface", "interface");
          break;
        case "enum_declaration":
          this.scanType(member, [], owner, "enum", "enum");
          break;
        case "annotation_type_declaration":
          this.scanType(member, [], owner, "annotation", "annotation");
          break;
        case "record_declaration":
          this.scanType(member, [], owner, "record", "record");
          break;
        case "field_declaration":
          this.scanField(member, owner, "field");
          break;
        case "constant_declaration":
          this.scanField(member, owner, "interface-constant");
          break;
        case "method_declaration":
          this.scanMethod(member, owner);
          break;
        case "enum_constant":
          this.scanEnumConstant(member, owner);
          break;
        case "annotation_type_element_declaration":
          this.scanAnnotationElement(member, owner);
          break;
        default:
          if (EvidenceJavaSyntax.hasModifier(member, "public"))
            this.problem(
              "java-public-form",
              `Public Java member form '${member.type}' is not classified by this adapter.`,
              "Add an explicit member rule before evaluating this public type.",
              member,
            );
      }
  }

  private scanRecordComponents(
    item: EvidenceNode,
    owner: IEvidenceJavaTypeContext,
  ): void {
    const parameters = item.childForFieldName("parameters");
    for (const parameter of parameters === null
      ? []
      : parameters.namedChildren) {
      if (
        parameter.type !== "formal_parameter" &&
        parameter.type !== "spread_parameter"
      )
        continue;
      const name = EvidenceJavaSyntax.parameterName(parameter);
      if (name === undefined) continue;
      this.addDeclaration(
        parameter,
        parameter,
        EvidenceJavaSyntax.javadoc(parameter),
        [this.session.range(parameter)],
        name,
        "property",
        "record-component",
        [...owner.identity, name],
        [...owner.address, name],
        owner.public,
        owner.declarationId,
      );
    }
  }

  private scanField(
    item: EvidenceNode,
    owner: IEvidenceJavaTypeContext,
    form: "field" | "interface-constant",
  ): void {
    const declarators = item.namedChildren.filter(
      (child) => child.type === "variable_declarator",
    );
    const first = declarators[0];
    if (first === undefined) return;
    const header = this.text.range(item.startIndex, first.startIndex);
    const documentation = EvidenceJavaSyntax.javadoc(item);
    const visible = this.memberPublic(item, owner, form !== "field");
    for (const declarator of declarators) {
      const name = EvidenceJavaSyntax.name(
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
        [...owner.address, name],
        visible,
        owner.declarationId,
      );
    }
  }

  private scanMethod(
    item: EvidenceNode,
    owner: IEvidenceJavaTypeContext,
  ): void {
    const name = EvidenceJavaSyntax.name(item.childForFieldName("name"));
    if (name === undefined) return;
    this.addDeclaration(
      item,
      item,
      EvidenceJavaSyntax.javadoc(item),
      [this.session.range(item)],
      name,
      "function",
      "method",
      [...owner.identity, name],
      [...owner.address, name],
      this.memberPublic(item, owner, owner.kind === "interface"),
      owner.declarationId,
    );
  }

  private scanEnumConstant(
    item: EvidenceNode,
    owner: IEvidenceJavaTypeContext,
  ): void {
    const name = EvidenceJavaSyntax.name(item.childForFieldName("name"));
    if (name === undefined) return;
    this.addDeclaration(
      item,
      item,
      EvidenceJavaSyntax.javadoc(item),
      [this.session.range(item)],
      name,
      "property",
      "enum-constant",
      [...owner.identity, name],
      [...owner.address, name],
      owner.public,
      owner.declarationId,
    );
  }

  private scanAnnotationElement(
    item: EvidenceNode,
    owner: IEvidenceJavaTypeContext,
  ): void {
    const name = EvidenceJavaSyntax.name(item.childForFieldName("name"));
    if (name === undefined) return;
    this.addDeclaration(
      item,
      item,
      EvidenceJavaSyntax.javadoc(item),
      [this.session.range(item)],
      name,
      "property",
      "annotation-element",
      [...owner.identity, name],
      [...owner.address, name],
      owner.public,
      owner.declarationId,
    );
  }

  private typePublic(
    item: EvidenceNode,
    owner: IEvidenceJavaTypeContext | undefined,
  ): boolean {
    if (owner === undefined)
      return EvidenceJavaSyntax.hasModifier(item, "public");
    if (!owner.public) return false;
    if (EvidenceJavaSyntax.hasModifier(item, "private")) return false;
    if (EvidenceJavaSyntax.hasModifier(item, "protected")) return false;
    return owner.kind === "interface" || owner.kind === "annotation"
      ? true
      : EvidenceJavaSyntax.hasModifier(item, "public");
  }

  private memberPublic(
    item: EvidenceNode,
    owner: IEvidenceJavaTypeContext,
    implicit: boolean,
  ): boolean {
    if (!owner.public) return false;
    if (EvidenceJavaSyntax.hasModifier(item, "private")) return false;
    if (EvidenceJavaSyntax.hasModifier(item, "protected")) return false;
    return implicit || EvidenceJavaSyntax.hasModifier(item, "public");
  }

  private addDeclaration(
    item: EvidenceNode,
    siteNode: EvidenceNode,
    documentationNode: EvidenceNode | null,
    content: IEvidenceSourceRange[],
    name: string,
    symbol: EvidenceProgrammingSymbol,
    form: EvidenceJavaDeclarationForm,
    identity: string[],
    address: string[],
    visible: boolean,
    ownerDeclarationId?: string,
  ): IEvidenceJavaDeclaration {
    const site: IEvidenceUnitSite = {
      id: this.siteId(siteNode),
      file: this.source.physicalPath,
      range: this.text.range(
        documentationNode?.startIndex ?? siteNode.startIndex,
        siteNode.endIndex,
      ),
      content,
    };
    const declaration: IEvidenceJavaDeclaration = {
      id: `java:${this.source.id}:declaration:${form}:${item.startIndex}:${name}`,
      name,
      symbol,
      form,
      identity,
      address,
      site,
      public: visible,
      ...(ownerDeclarationId === undefined ? {} : { ownerDeclarationId }),
    };
    this.declarations.push(declaration);
    if (documentationNode !== null) {
      const documentation = this.carrierDocumentation.get(
        this.nodeKey(documentationNode),
      );
      if (documentation !== undefined)
        this.attach(documentation, declaration.id, site.id);
    }
    return declaration;
  }

  private collectDocumentation(): void {
    const comments = [
      ...this.session.root.descendantsOfType("line_comment"),
      ...this.session.root.descendantsOfType("block_comment"),
    ];
    for (const comment of comments) {
      const syntax = EvidenceJavaSyntax.comment(comment);
      const range = this.session.range(comment);
      const javadoc =
        comment.type === "block_comment" && comment.text.startsWith("/**");
      const raw = this.source.content.slice(
        range.start.offset + syntax.opening.length,
        range.end.offset - syntax.closing.length,
      );
      if (!javadoc && !this.annotation(raw)) continue;
      const documentation = this.ensureDocumentation(range, syntax);
      this.carrierDocumentation.set(this.nodeKey(comment), documentation);
    }
  }

  private attach(
    documentation: IEvidenceJavaDocumentation,
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
  ): IEvidenceJavaDocumentation {
    const key = `${range.start.offset}:${range.end.offset}`;
    let documentation = this.documentation.get(key);
    if (documentation === undefined) {
      documentation = {
        id: `java:${this.source.id}:documentation:${key}`,
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
    return `java:${this.source.id}:site:${this.nodeKey(node)}`;
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
