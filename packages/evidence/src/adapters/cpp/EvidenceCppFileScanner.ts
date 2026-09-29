import type { Node as EvidenceNode } from "web-tree-sitter";

import { EvidenceDocumentation } from "../../parsers/EvidenceDocumentation";
import type { EvidenceParseSession } from "../../parsers/EvidenceParseSession";
import type { IEvidenceCommentSyntax } from "../../structures/IEvidenceCommentSyntax";
import type { IEvidenceDiagnostic } from "../../structures/IEvidenceDiagnostic";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceRange } from "../../structures/IEvidenceSourceRange";
import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { EvidenceCppAccess } from "./EvidenceCppAccess";
import type { EvidenceCppDeclarationForm } from "./EvidenceCppDeclarationForm";
import { EvidenceCppSyntax } from "./EvidenceCppSyntax";
import type { EvidenceCppVisibility } from "./EvidenceCppVisibility";
import type { IEvidenceCppAlias } from "./IEvidenceCppAlias";
import type { IEvidenceCppDeclaration } from "./IEvidenceCppDeclaration";
import type { IEvidenceCppDeclaratorShape } from "./IEvidenceCppDeclaratorShape";
import type { IEvidenceCppDocumentation } from "./IEvidenceCppDocumentation";
import type { IEvidenceCppFileAnalysis } from "./IEvidenceCppFileAnalysis";
import type { IEvidenceCppScopeContext } from "./IEvidenceCppScopeContext";
import { EvidenceSourceText } from "../../internal/EvidenceSourceText";

/**
 * Extracts explicit C++ declarations and Doxygen without semantic lookup.
 *
 * The scanner retains only source-established scopes, aliases, and attachment
 * facts; `EvidenceCppAdapter` later resolves publication among those bounded
 * records.
 */
export class EvidenceCppFileScanner {
  private readonly declarations: IEvidenceCppDeclaration[] = [];
  private readonly aliases: IEvidenceCppAlias[] = [];
  private readonly documentation = new Map<string, IEvidenceCppDocumentation>();
  private readonly carrierDocumentation = new Map<
    string,
    IEvidenceCppDocumentation
  >();
  private readonly diagnostics: IEvidenceDiagnostic[] = [];
  private readonly reported = new Set<string>();
  private readonly text: EvidenceSourceText;
  private complete = true;

  /**
   * Creates a scanner for one live C++ parse session and captured source file.
   *
   * Documentation collection precedes declaration walking to preserve source
   * adjacency rather than reconstructing attachment from normalized records.
   */
  public constructor(
    private readonly session: EvidenceParseSession,
    private readonly source: IEvidenceSourceFile,
  ) {
    this.text = new EvidenceSourceText(source.content);
    this.collectDocumentation();
  }

  /**
   * Produces the node-free declarations, aliases, and documentation for one
   * file.
   *
   * Unsupported relevant syntax makes this result incomplete so materialization
   * cannot report success over a reduced public population.
   */
  public scan(): IEvidenceCppFileAnalysis {
    const items = this.session.root.namedChildren;
    const population = items.filter((item) => !this.inert(item));
    const guarded =
      population.length === 1 && population[0] !== undefined
        ? EvidenceCppSyntax.guardedDeclarations(population[0])
        : undefined;
    for (const item of guarded ?? items)
      this.scanScopeItem(item, undefined, [], item, []);
    return {
      source: this.source,
      declarations: this.declarations,
      aliases: this.aliases,
      documentation: Array.from(this.documentation.values()),
      diagnostics: this.diagnostics,
      complete: this.complete,
    };
  }

  private scanScopeItem(
    item: EvidenceNode,
    owner: IEvidenceCppScopeContext | undefined,
    templateArities: number[],
    siteNode: EvidenceNode,
    inheritedDocumentation: IEvidenceCppDocumentation[],
  ): void {
    switch (item.type) {
      case "comment":
      case "preproc_include":
      case "preproc_def":
      case "preproc_function_def":
      case "static_assert_declaration":
      case "_static_assert_declaration":
        return;
      case "namespace_definition":
        this.scanNamespace(item, owner, siteNode, inheritedDocumentation);
        return;
      case "namespace_alias_definition":
        this.scanNamespaceAlias(item, owner, siteNode, inheritedDocumentation);
        return;
      case "using_declaration":
        this.scanUsing(item, owner, "public", siteNode, inheritedDocumentation);
        return;
      case "template_declaration":
        this.scanTemplate(
          item,
          owner,
          "public",
          templateArities,
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "class_specifier":
      case "struct_specifier":
      case "union_specifier":
      case "enum_specifier":
        this.scanType(
          item,
          owner,
          "public",
          templateArities,
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "declaration":
        this.scanDeclaration(
          item,
          owner,
          "public",
          templateArities,
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "function_definition":
        this.scanFunctionDefinition(
          item,
          owner,
          "public",
          templateArities,
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "type_definition":
        this.scanTypeDefinition(
          item,
          owner,
          "public",
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "alias_declaration":
        this.scanAliasDeclaration(
          item,
          owner,
          "public",
          templateArities,
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "concept_definition":
        this.scanConcept(
          item,
          owner,
          templateArities,
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "linkage_specification":
        this.scanLinkage(item, owner);
        return;
      case "template_instantiation":
        this.problem(
          "cpp-template-instantiation",
          "An explicit C++ template instantiation has no stable common accessor in this adapter.",
          "Select the primary template or add specialization-aware addressing before evaluating this source.",
          item,
        );
        return;
      case "preproc_if":
      case "preproc_ifdef":
        this.conditional(item);
        return;
      case "preproc_call":
        if (!EvidenceCppSyntax.isInertDirective(item))
          this.preprocessorDirective(item);
        return;
      case "expression_statement":
        if (!EvidenceCppSyntax.isStaticAssertion(item))
          this.macroDeclaration(item);
        return;
      default:
        this.problem(
          "cpp-declaration-form",
          `C++ namespace-scope form '${item.type}' is not classified by this adapter.`,
          "Add an explicit declared-surface rule before evaluating this source.",
          item,
        );
    }
  }

  private scanNamespace(
    item: EvidenceNode,
    owner: IEvidenceCppScopeContext | undefined,
    siteNode: EvidenceNode,
    inheritedDocumentation: IEvidenceCppDocumentation[],
  ): void {
    const body = item.childForFieldName("body");
    const qualified = EvidenceCppSyntax.qualifiedName(
      item.childForFieldName("name"),
    );
    const documentation = this.documentationForSite(
      siteNode,
      item,
      inheritedDocumentation,
    );
    let context = owner;
    if (qualified === undefined || qualified.segments.length === 0) {
      context = {
        identity: [
          ...(owner?.identity ?? []),
          `(anonymous namespace ${item.startIndex})`,
        ],
        address: owner?.address ?? [],
        kind: "namespace",
        name: "",
        public: false,
      };
    } else {
      for (const name of qualified.segments) {
        const identity = [...(context?.identity ?? []), name];
        const address = [...(context?.address ?? []), name];
        const visible = context?.public ?? true;
        const declaration = this.addDeclaration(
          item,
          siteNode,
          documentation,
          [this.session.range(siteNode)],
          name,
          "type",
          "namespace",
          identity,
          [address],
          visible ? "public" : "non-public",
          true,
          context?.identity,
        );
        context = {
          declarationId: declaration.id,
          identity,
          address,
          kind: "namespace",
          name,
          public: visible,
        };
      }
    }
    if (body !== null)
      for (const child of body.namedChildren)
        this.scanScopeItem(child, context, [], child, []);
  }

  private scanTemplate(
    item: EvidenceNode,
    owner: IEvidenceCppScopeContext | undefined,
    access: EvidenceCppAccess,
    templateArities: number[],
    siteNode: EvidenceNode,
    inheritedDocumentation: IEvidenceCppDocumentation[],
  ): void {
    const arity = EvidenceCppSyntax.templateArity(item);
    if (arity === 0) {
      this.problem(
        "cpp-template-specialization",
        "An explicit C++ template specialization cannot share the primary template's common accessor.",
        "Use the primary template or add specialization-aware addressing before evaluating this source.",
        item,
      );
      return;
    }
    const body = EvidenceCppSyntax.templateBody(item);
    if (body === undefined) {
      this.problem(
        "cpp-template-body",
        "A C++ template declaration has no statically readable declared entity.",
        "Use a grammar-supported named template declaration.",
        item,
      );
      return;
    }
    if (
      ["class_specifier", "struct_specifier", "union_specifier"].includes(
        body.type,
      ) &&
      body.childForFieldName("name")?.type === "template_type"
    ) {
      this.problem(
        "cpp-template-specialization",
        "A partial C++ class specialization cannot share the primary template's common accessor.",
        "Use the primary template or add specialization-aware addressing before evaluating this source.",
        item,
      );
      return;
    }
    const documentation = this.documentationForSite(
      siteNode,
      item,
      inheritedDocumentation,
    );
    const arities = [...templateArities, arity];
    if (owner !== undefined && owner.kind !== "namespace")
      this.scanMember(body, owner, access, arities, siteNode, documentation);
    else this.scanScopeItem(body, owner, arities, siteNode, documentation);
  }

  private scanType(
    item: EvidenceNode,
    owner: IEvidenceCppScopeContext | undefined,
    access: EvidenceCppAccess,
    templateArities: number[],
    siteNode: EvidenceNode,
    inheritedDocumentation: IEvidenceCppDocumentation[],
    fallbackName?: string,
  ): IEvidenceCppScopeContext | undefined {
    const form = EvidenceCppSyntax.recordForm(item);
    if (form === null) return undefined;
    const nameNode = item.childForFieldName("name");
    if (nameNode?.type === "template_type") {
      this.problem(
        "cpp-template-specialization",
        "A C++ class specialization cannot share the primary template's common accessor.",
        "Use the primary template or add specialization-aware addressing before evaluating this source.",
        item,
      );
      return undefined;
    }
    const rawName = EvidenceCppSyntax.name(nameNode) ?? fallbackName;
    const body = item.childForFieldName("body");
    if (rawName === undefined) return undefined;
    const arity = templateArities.at(-1) ?? 0;
    const name = arity === 0 ? rawName : `${rawName}\`${arity}`;
    const identity = [...(owner?.identity ?? []), name];
    const address = [...(owner?.address ?? []), name];
    const visible = this.directVisibility(owner, access);
    const documentation = this.documentationForSite(
      siteNode,
      item,
      inheritedDocumentation,
    );
    const declaration = this.addDeclaration(
      item,
      siteNode,
      documentation,
      [this.session.range(siteNode)],
      rawName,
      "type",
      form,
      identity,
      [address],
      visible,
      body !== null,
      owner?.identity,
    );
    const context: IEvidenceCppScopeContext = {
      declarationId: declaration.id,
      identity,
      address,
      kind: form,
      name: rawName,
      public: visible === "public",
    };
    if (item.namedChildren.some((child) => child.type === "base_class_clause"))
      this.problem(
        "cpp-inheritance-resolution",
        `C++ ${form} '${identity.join(".")}' has inherited members that syntax-only analysis cannot project safely.`,
        "Select a flattened generated interface or add bounded inheritance resolution before evaluating this source.",
        item,
      );
    if (body === null) return context;
    if (form === "enum") this.scanEnumerators(body, context);
    else
      this.scanTypeBody(body, context, form === "class" ? "private" : "public");
    return context;
  }

  private scanTypeBody(
    body: EvidenceNode,
    owner: IEvidenceCppScopeContext,
    initialAccess: EvidenceCppAccess,
  ): void {
    let access = initialAccess;
    for (const member of body.namedChildren) {
      if (member.type === "access_specifier") {
        access = EvidenceCppSyntax.access(member) ?? access;
        continue;
      }
      this.scanMember(member, owner, access, [], member, []);
    }
  }

  private scanMember(
    member: EvidenceNode,
    owner: IEvidenceCppScopeContext,
    access: EvidenceCppAccess,
    templateArities: number[],
    siteNode: EvidenceNode,
    inheritedDocumentation: IEvidenceCppDocumentation[],
  ): void {
    switch (member.type) {
      case "comment":
      case "static_assert_declaration":
      case "_static_assert_declaration":
      case "preproc_def":
      case "preproc_function_def":
        return;
      case "field_declaration":
        this.scanFieldDeclaration(
          member,
          owner,
          access,
          templateArities,
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "declaration":
        this.scanDeclaration(
          member,
          owner,
          access,
          templateArities,
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "function_definition":
        this.scanFunctionDefinition(
          member,
          owner,
          access,
          templateArities,
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "class_specifier":
      case "struct_specifier":
      case "union_specifier":
      case "enum_specifier":
        this.scanType(
          member,
          owner,
          access,
          templateArities,
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "type_definition":
        this.scanTypeDefinition(
          member,
          owner,
          access,
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "alias_declaration":
        this.scanAliasDeclaration(
          member,
          owner,
          access,
          templateArities,
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "using_declaration":
        this.scanUsing(member, owner, access, siteNode, inheritedDocumentation);
        return;
      case "template_declaration":
        this.scanTemplate(
          member,
          owner,
          access,
          templateArities,
          siteNode,
          inheritedDocumentation,
        );
        return;
      case "friend_declaration":
        this.problem(
          "cpp-friend-declaration",
          "A C++ friend declaration can introduce or define a namespace member outside class ownership.",
          "Move the namespace declaration outside the class or add friend-aware ownership before evaluating this source.",
          member,
        );
        return;
      case "preproc_if":
      case "preproc_ifdef":
        this.conditional(member);
        return;
      case "preproc_call":
        if (!EvidenceCppSyntax.isInertDirective(member))
          this.preprocessorDirective(member);
        return;
      default:
        this.problem(
          "cpp-member-form",
          `C++ member form '${member.type}' is not classified by this adapter.`,
          "Add an explicit member rule before evaluating this public type.",
          member,
        );
    }
  }

  private scanFieldDeclaration(
    item: EvidenceNode,
    owner: IEvidenceCppScopeContext,
    access: EvidenceCppAccess,
    templateArities: number[],
    siteNode: EvidenceNode,
    inheritedDocumentation: IEvidenceCppDocumentation[],
  ): void {
    const documentation = this.documentationForSite(
      siteNode,
      item,
      inheritedDocumentation,
    );
    const specifier = item.childForFieldName("type");
    const form = EvidenceCppSyntax.recordForm(specifier);
    const declarators = EvidenceCppSyntax.declarators(item);
    if (form !== null && specifier !== null) {
      if (
        declarators.length === 0 &&
        specifier.childForFieldName("name") === null
      ) {
        const body = specifier.childForFieldName("body");
        if (body !== null) {
          if (form === "enum")
            this.scanAnonymousEnumerators(body, owner, access);
          else
            for (const child of body.namedChildren)
              this.scanMember(child, owner, access, [], child, []);
        }
        return;
      }
      this.scanType(
        specifier,
        owner,
        access,
        templateArities,
        siteNode,
        documentation,
      );
    }
    const first = declarators[0];
    const header =
      first === undefined
        ? this.session.range(item)
        : this.text.range(item.startIndex, first.startIndex);
    for (const declarator of declarators) {
      const shape = EvidenceCppSyntax.declarator(declarator);
      if (shape === undefined) {
        this.unreadableDeclarator(declarator);
        continue;
      }
      if (shape.kind === "function")
        this.addCallable(
          item,
          shape,
          owner,
          access,
          templateArities,
          siteNode,
          documentation,
          [header, this.session.range(declarator)],
          false,
        );
      else
        this.addObject(
          item,
          shape,
          owner,
          access,
          templateArities,
          siteNode,
          documentation,
          [header, this.session.range(declarator)],
          !EvidenceCppSyntax.storage(item, "static") ||
            (declarator.type === "init_declarator" &&
              item.namedChildren.some((child) => child.text === "inline")),
        );
    }
  }

  private scanDeclaration(
    item: EvidenceNode,
    owner: IEvidenceCppScopeContext | undefined,
    access: EvidenceCppAccess,
    templateArities: number[],
    siteNode: EvidenceNode,
    inheritedDocumentation: IEvidenceCppDocumentation[],
  ): void {
    const documentation = this.documentationForSite(
      siteNode,
      item,
      inheritedDocumentation,
    );
    const specifier = item.childForFieldName("type");
    if (EvidenceCppSyntax.recordForm(specifier) !== null && specifier !== null)
      this.scanType(
        specifier,
        owner,
        access,
        templateArities,
        siteNode,
        documentation,
      );
    const declarators = EvidenceCppSyntax.declarators(item);
    const first = declarators[0];
    const header =
      first === undefined
        ? this.session.range(item)
        : this.text.range(item.startIndex, first.startIndex);
    for (const declarator of declarators) {
      const shape = EvidenceCppSyntax.declarator(declarator);
      if (shape === undefined) {
        this.unreadableDeclarator(declarator);
        continue;
      }
      const namespaceScope = owner === undefined || owner.kind === "namespace";
      if (namespaceScope && EvidenceCppSyntax.storage(item, "static")) continue;
      if (shape.kind === "function")
        this.addCallable(
          item,
          shape,
          owner,
          access,
          templateArities,
          siteNode,
          documentation,
          [header, this.session.range(declarator)],
          false,
        );
      else {
        if (
          namespaceScope &&
          templateArities.length === 0 &&
          EvidenceCppSyntax.topLevelConstObject(item, declarator)
        )
          continue;
        this.addObject(
          item,
          shape,
          owner,
          access,
          templateArities,
          siteNode,
          documentation,
          [header, this.session.range(declarator)],
          declarator.type === "init_declarator" ||
            !EvidenceCppSyntax.storage(item, "extern"),
        );
      }
    }
  }

  private scanFunctionDefinition(
    item: EvidenceNode,
    owner: IEvidenceCppScopeContext | undefined,
    access: EvidenceCppAccess,
    templateArities: number[],
    siteNode: EvidenceNode,
    inheritedDocumentation: IEvidenceCppDocumentation[],
  ): void {
    if (
      (owner === undefined || owner.kind === "namespace") &&
      EvidenceCppSyntax.storage(item, "static")
    )
      return;
    const declarator = item.childForFieldName("declarator");
    const shape =
      declarator === null
        ? undefined
        : EvidenceCppSyntax.declarator(declarator);
    if (shape === undefined || shape.kind !== "function") {
      this.problem(
        "cpp-function-declarator",
        "A C++ function definition has no statically readable callable declarator.",
        "Use a grammar-supported named function, method, constructor, destructor, or operator.",
        item,
      );
      return;
    }
    this.addCallable(
      item,
      shape,
      owner,
      access,
      templateArities,
      siteNode,
      this.documentationForSite(siteNode, item, inheritedDocumentation),
      [this.session.range(siteNode)],
      true,
    );
  }

  private scanTypeDefinition(
    item: EvidenceNode,
    owner: IEvidenceCppScopeContext | undefined,
    access: EvidenceCppAccess,
    siteNode: EvidenceNode,
    inheritedDocumentation: IEvidenceCppDocumentation[],
  ): void {
    const documentation = this.documentationForSite(
      siteNode,
      item,
      inheritedDocumentation,
    );
    const shapes = EvidenceCppSyntax.declarators(item).flatMap((declarator) => {
      const shape = EvidenceCppSyntax.declarator(declarator);
      if (shape === undefined) {
        this.unreadableDeclarator(declarator);
        return [];
      }
      return [shape];
    });
    const specifier = item.childForFieldName("type");
    const record = EvidenceCppSyntax.recordForm(specifier);
    const recordName = EvidenceCppSyntax.name(
      specifier === null ? null : specifier.childForFieldName("name"),
    );
    const direct = shapes.find(
      (shape) => shape.kind === "direct" && shape.path.length === 1,
    );
    const directName = direct === undefined ? undefined : direct.path[0];
    if (record !== null && specifier !== null)
      this.scanType(
        specifier,
        owner,
        access,
        [],
        siteNode,
        documentation,
        recordName === undefined ? directName : undefined,
      );
    const first = EvidenceCppSyntax.declarators(item)[0];
    const header =
      first === undefined
        ? this.session.range(item)
        : this.text.range(item.startIndex, first.startIndex);
    for (const shape of shapes) {
      const name = shape.path.at(-1);
      if (
        name === undefined ||
        shape.path.length !== 1 ||
        (recordName !== undefined && name === recordName) ||
        (record !== null && recordName === undefined && name === directName)
      )
        continue;
      this.addNamedType(
        shape.node,
        siteNode,
        documentation,
        [header, this.session.range(shape.node)],
        owner,
        access,
        name,
        "typedef",
      );
    }
  }

  private scanAliasDeclaration(
    item: EvidenceNode,
    owner: IEvidenceCppScopeContext | undefined,
    access: EvidenceCppAccess,
    templateArities: number[],
    siteNode: EvidenceNode,
    inheritedDocumentation: IEvidenceCppDocumentation[],
  ): void {
    const rawName = EvidenceCppSyntax.name(item.childForFieldName("name"));
    if (rawName === undefined) {
      this.unreadableDeclarator(item);
      return;
    }
    const arity = templateArities.at(-1) ?? 0;
    this.addNamedType(
      item,
      siteNode,
      this.documentationForSite(siteNode, item, inheritedDocumentation),
      [this.session.range(siteNode)],
      owner,
      access,
      arity === 0 ? rawName : `${rawName}\`${arity}`,
      "alias",
      rawName,
    );
  }

  private scanConcept(
    item: EvidenceNode,
    owner: IEvidenceCppScopeContext | undefined,
    templateArities: number[],
    siteNode: EvidenceNode,
    inheritedDocumentation: IEvidenceCppDocumentation[],
  ): void {
    const rawName = EvidenceCppSyntax.name(item.childForFieldName("name"));
    if (rawName === undefined) {
      this.unreadableDeclarator(item);
      return;
    }
    const arity = templateArities.at(-1) ?? 0;
    this.addNamedType(
      item,
      siteNode,
      this.documentationForSite(siteNode, item, inheritedDocumentation),
      [this.session.range(siteNode)],
      owner,
      "public",
      arity === 0 ? rawName : `${rawName}\`${arity}`,
      "concept",
      rawName,
    );
  }

  private addNamedType(
    item: EvidenceNode,
    siteNode: EvidenceNode,
    documentation: IEvidenceCppDocumentation[],
    content: IEvidenceSourceRange[],
    owner: IEvidenceCppScopeContext | undefined,
    access: EvidenceCppAccess,
    name: string,
    form: Extract<EvidenceCppDeclarationForm, "alias" | "typedef" | "concept">,
    displayName: string = name,
  ): void {
    const identity = [...(owner?.identity ?? []), name];
    const address = [...(owner?.address ?? []), name];
    this.addDeclaration(
      item,
      siteNode,
      documentation,
      content,
      displayName,
      "type",
      form,
      identity,
      [address],
      this.directVisibility(owner, access),
      true,
      owner?.identity,
    );
  }

  private addCallable(
    item: EvidenceNode,
    shape: IEvidenceCppDeclaratorShape,
    owner: IEvidenceCppScopeContext | undefined,
    access: EvidenceCppAccess,
    templateArities: number[],
    siteNode: EvidenceNode,
    documentation: IEvidenceCppDocumentation[],
    content: IEvidenceSourceRange[],
    definition: boolean,
  ): void {
    if (shape.specialized) {
      this.problem(
        "cpp-template-specialization",
        "A specialized C++ callable cannot share the primary template's common accessor.",
        "Use the primary template or add specialization-aware addressing before evaluating this source.",
        item,
      );
      return;
    }
    const fullPath = this.fullPath(owner, shape.path);
    const sourceName = fullPath.at(-1);
    if (sourceName === undefined) {
      this.unreadableDeclarator(item);
      return;
    }
    const parentIdentity =
      shape.path.length === 1 ? owner?.identity : fullPath.slice(0, -1);
    const parentTail =
      parentIdentity === undefined ? undefined : parentIdentity.at(-1);
    const parentSourceName =
      parentTail === undefined ? undefined : parentTail.replace(/`\d+$/u, "");
    const typeMissing = item.childForFieldName("type") === null;
    let name = sourceName;
    let form: Extract<
      EvidenceCppDeclarationForm,
      "function" | "constructor" | "destructor" | "operator" | "conversion"
    > = "function";
    if (sourceName.startsWith("~")) {
      name = "destructor";
      form = "destructor";
    } else if (sourceName.startsWith("operator ")) {
      form =
        item.descendantsOfType("operator_cast").length === 0
          ? "operator"
          : "conversion";
    } else if (
      typeMissing &&
      parentSourceName !== undefined &&
      sourceName === parentSourceName
    ) {
      name = "constructor";
      form = "constructor";
    } else {
      const arity = this.entityTemplateArity(shape, templateArities);
      if (arity !== 0) name = `${name}\`${arity}`;
    }
    const identity = [...(parentIdentity ?? []), name];
    this.addDeclaration(
      shape.node,
      siteNode,
      documentation,
      content,
      name,
      "function",
      form,
      identity,
      [identity],
      shape.path.length === 1
        ? this.directVisibility(owner, access)
        : "qualified",
      definition,
      parentIdentity,
    );
  }

  private addObject(
    item: EvidenceNode,
    shape: IEvidenceCppDeclaratorShape,
    owner: IEvidenceCppScopeContext | undefined,
    access: EvidenceCppAccess,
    templateArities: number[],
    siteNode: EvidenceNode,
    documentation: IEvidenceCppDocumentation[],
    content: IEvidenceSourceRange[],
    definition: boolean,
  ): void {
    if (shape.specialized) {
      this.problem(
        "cpp-template-specialization",
        "A specialized C++ variable cannot share the primary template's common accessor.",
        "Use the primary template or add specialization-aware addressing before evaluating this source.",
        item,
      );
      return;
    }
    const fullPath = this.fullPath(owner, shape.path);
    let name = fullPath.at(-1);
    if (name === undefined) {
      this.unreadableDeclarator(item);
      return;
    }
    const arity = this.entityTemplateArity(shape, templateArities);
    if (arity !== 0) name = `${name}\`${arity}`;
    const parentIdentity =
      shape.path.length === 1 ? owner?.identity : fullPath.slice(0, -1);
    const identity = [...(parentIdentity ?? []), name];
    const member = owner !== undefined && owner.kind !== "namespace";
    const form: Extract<
      EvidenceCppDeclarationForm,
      "variable" | "field" | "static-field"
    > = member
      ? EvidenceCppSyntax.storage(item, "static")
        ? "static-field"
        : "field"
      : "variable";
    this.addDeclaration(
      shape.node,
      siteNode,
      documentation,
      content,
      name,
      "property",
      form,
      identity,
      [identity],
      shape.path.length === 1
        ? this.directVisibility(owner, access)
        : "qualified",
      definition,
      parentIdentity,
    );
  }

  private scanEnumerators(
    body: EvidenceNode,
    owner: IEvidenceCppScopeContext,
  ): void {
    for (const item of body.namedChildren) {
      if (item.type === "comment") continue;
      if (item.type === "preproc_if" || item.type === "preproc_ifdef") {
        this.conditional(item);
        continue;
      }
      if (item.type !== "enumerator") {
        this.problem(
          "cpp-enumerator-form",
          `C++ enum member form '${item.type}' is not classified by this adapter.`,
          "Add an explicit enumerator rule before evaluating this enum.",
          item,
        );
        continue;
      }
      const name = EvidenceCppSyntax.name(item.childForFieldName("name"));
      if (name === undefined) {
        this.unreadableDeclarator(item);
        continue;
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
        [[...owner.address, name]],
        owner.public ? "public" : "non-public",
        true,
        owner.identity,
      );
    }
  }

  private scanAnonymousEnumerators(
    body: EvidenceNode,
    owner: IEvidenceCppScopeContext,
    access: EvidenceCppAccess,
  ): void {
    const visible = this.directVisibility(owner, access);
    for (const item of body.namedChildren) {
      if (item.type !== "enumerator") continue;
      const name = EvidenceCppSyntax.name(item.childForFieldName("name"));
      if (name === undefined) continue;
      this.addDeclaration(
        item,
        item,
        this.documentationFor(item),
        [this.session.range(item)],
        name,
        "property",
        "enumerator",
        [...owner.identity, name],
        [[...owner.address, name]],
        visible,
        true,
        owner.identity,
      );
    }
  }

  private scanNamespaceAlias(
    item: EvidenceNode,
    owner: IEvidenceCppScopeContext | undefined,
    siteNode: EvidenceNode,
    inheritedDocumentation: IEvidenceCppDocumentation[],
  ): void {
    const name = EvidenceCppSyntax.name(item.childForFieldName("name"));
    const targetNode = item.namedChildren.at(-1);
    const target = EvidenceCppSyntax.qualifiedName(targetNode ?? null);
    if (name === undefined || target === undefined || target.specialized) {
      this.unresolvedAlias(item, "namespace alias");
      return;
    }
    this.addAlias(
      item,
      siteNode,
      this.documentationForSite(siteNode, item, inheritedDocumentation),
      owner,
      "public",
      "namespace",
      name,
      target.segments,
    );
  }

  private scanUsing(
    item: EvidenceNode,
    owner: IEvidenceCppScopeContext | undefined,
    access: EvidenceCppAccess,
    siteNode: EvidenceNode,
    inheritedDocumentation: IEvidenceCppDocumentation[],
  ): void {
    if (/^using\s+namespace\b/u.test(item.text)) {
      this.problem(
        "cpp-using-directive",
        "A C++ using-directive requires semantic lookup beyond one explicit alias target.",
        "Replace it with supported using declarations or add bounded namespace lookup before evaluating this source.",
        item,
      );
      return;
    }
    const target = EvidenceCppSyntax.qualifiedName(
      item.namedChildren.at(-1) ?? null,
    );
    const targetTail =
      target === undefined ? undefined : target.segments.at(-1);
    const name =
      targetTail === undefined ? undefined : targetTail.replace(/`\d+$/u, "");
    if (target === undefined || name === undefined || target.specialized) {
      this.unresolvedAlias(item, "using declaration");
      return;
    }
    this.addAlias(
      item,
      siteNode,
      this.documentationForSite(siteNode, item, inheritedDocumentation),
      owner,
      access,
      "using",
      name,
      target.segments,
    );
  }

  private addAlias(
    item: EvidenceNode,
    siteNode: EvidenceNode,
    documentation: IEvidenceCppDocumentation[],
    owner: IEvidenceCppScopeContext | undefined,
    access: EvidenceCppAccess,
    kind: "namespace" | "using",
    name: string,
    target: string[],
  ): void {
    const site = this.site(siteNode, [this.session.range(siteNode)]);
    const alias: IEvidenceCppAlias = {
      id: `cpp:${this.source.id}:alias:${kind}:${item.startIndex}:${name}`,
      kind,
      name,
      scopeIdentity: owner?.identity ?? [],
      scopeAddress: owner?.address ?? [],
      target,
      site,
      public: this.directVisibility(owner, access) === "public",
    };
    this.aliases.push(alias);
    for (const entry of documentation) this.attach(entry, alias.id, site.id);
  }

  private scanLinkage(
    item: EvidenceNode,
    owner: IEvidenceCppScopeContext | undefined,
  ): void {
    const body = item.childForFieldName("body");
    if (body === null) return;
    const children =
      body.type === "declaration_list" ? body.namedChildren : [body];
    for (const child of children)
      this.scanScopeItem(child, owner, [], child, []);
  }

  private addDeclaration(
    item: EvidenceNode,
    siteNode: EvidenceNode,
    documentation: IEvidenceCppDocumentation[],
    content: IEvidenceSourceRange[],
    name: string,
    symbol: EvidenceProgrammingSymbol,
    form: EvidenceCppDeclarationForm,
    identity: string[],
    addresses: string[][],
    visibility: EvidenceCppVisibility,
    definition: boolean,
    parentIdentity?: string[],
  ): IEvidenceCppDeclaration {
    const start = Math.min(
      siteNode.startIndex,
      ...documentation.map((entry) => entry.range.start.offset),
    );
    const end = Math.max(
      siteNode.endIndex,
      ...documentation.map((entry) => entry.range.end.offset),
    );
    const site = this.site(siteNode, content, start, end);
    const declaration: IEvidenceCppDeclaration = {
      id: `cpp:${this.source.id}:declaration:${form}:${item.startIndex}:${name}`,
      name,
      symbol,
      form,
      identity,
      addresses,
      site,
      visibility,
      definition,
      ...(parentIdentity === undefined ? {} : { parentIdentity }),
    };
    this.declarations.push(declaration);
    for (const entry of documentation)
      this.attach(entry, declaration.id, site.id);
    return declaration;
  }

  private site(
    node: EvidenceNode,
    content: IEvidenceSourceRange[],
    start: number = node.startIndex,
    end: number = node.endIndex,
  ): IEvidenceUnitSite {
    return {
      id: this.siteId(node),
      file: this.source.physicalPath,
      range: this.text.range(start, end),
      content,
    };
  }

  private fullPath(
    owner: IEvidenceCppScopeContext | undefined,
    path: string[],
  ): string[] {
    if (path.length <= 1 || owner === undefined)
      return path.length === 1 ? [...(owner?.identity ?? []), ...path] : path;
    const prefix =
      owner.kind === "namespace" ? owner.identity : owner.identity.slice(0, -1);
    if (prefix.length === 0 || path[0] === prefix[0]) return path;
    return [...prefix, ...path];
  }

  private entityTemplateArity(
    shape: IEvidenceCppDeclaratorShape,
    templateArities: number[],
  ): number {
    const ownerTemplates = shape.path
      .slice(0, -1)
      .filter((part) => /`\d+$/u.test(part)).length;
    return templateArities.slice(ownerTemplates).at(-1) ?? 0;
  }

  private directVisibility(
    owner: IEvidenceCppScopeContext | undefined,
    access: EvidenceCppAccess,
  ): EvidenceCppVisibility {
    if (owner === undefined) return "public";
    if (!owner.public) return "non-public";
    return owner.kind === "namespace" || access === "public"
      ? "public"
      : "non-public";
  }

  private documentationForSite(
    siteNode: EvidenceNode,
    item: EvidenceNode,
    inherited: IEvidenceCppDocumentation[],
  ): IEvidenceCppDocumentation[] {
    const candidates = [
      ...inherited,
      ...this.documentationFor(siteNode),
      ...(siteNode === item ? [] : this.documentationFor(item)),
    ];
    const output: IEvidenceCppDocumentation[] = [];
    const ids = new Set<string>();
    for (const documentation of candidates) {
      if (ids.has(documentation.id)) continue;
      ids.add(documentation.id);
      output.push(documentation);
    }
    return output;
  }

  private documentationFor(node: EvidenceNode): IEvidenceCppDocumentation[] {
    const output: IEvidenceCppDocumentation[] = [];
    const previous = node.previousNamedSibling;
    if (previous !== null && EvidenceCppSyntax.isDoxygen(previous)) {
      const documentation = this.carrierDocumentation.get(
        this.nodeKey(previous),
      );
      if (
        documentation !== undefined &&
        !EvidenceCppSyntax.isTrailingDoxygen(previous) &&
        this.adjacent(documentation.range.end.offset, node.startIndex, true)
      )
        output.push(documentation);
    }
    const next = node.nextNamedSibling;
    if (next !== null && EvidenceCppSyntax.isTrailingDoxygen(next)) {
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
    return node.type === "enumerator"
      ? /^[ \t]*,[ \t]*$/u.test(gap)
      : /^[ \t]*;?[ \t]*$/u.test(gap);
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
        !EvidenceCppSyntax.isTrailingDoxygen(first)
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
      const syntax = EvidenceCppSyntax.comment(first);
      const supported = EvidenceCppSyntax.isDoxygen(first);
      const raw = EvidenceDocumentation.read(
        this.source.content,
        "cpp-probe",
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
    documentation: IEvidenceCppDocumentation,
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
  ): IEvidenceCppDocumentation {
    const key = `${range.start.offset}:${range.end.offset}`;
    let documentation = this.documentation.get(key);
    if (documentation === undefined) {
      documentation = {
        id: `cpp:${this.source.id}:documentation:${key}`,
        range,
        syntax,
        attachments: [],
      };
      this.documentation.set(key, documentation);
    }
    return documentation;
  }

  private inert(node: EvidenceNode): boolean {
    return (
      node.type === "comment" ||
      node.type === "preproc_include" ||
      node.type === "preproc_def" ||
      node.type === "preproc_function_def" ||
      node.type === "static_assert_declaration" ||
      node.type === "_static_assert_declaration" ||
      EvidenceCppSyntax.isStaticAssertion(node) ||
      EvidenceCppSyntax.isInertDirective(node)
    );
  }

  private unreadableDeclarator(node: EvidenceNode): void {
    this.problem(
      "cpp-declarator-name",
      "A selected C++ declarator has no statically readable qualified name.",
      "Use one named declarator supported by the pinned grammar.",
      node,
    );
  }

  private unresolvedAlias(node: EvidenceNode, form: string): void {
    this.problem(
      "cpp-alias-target",
      `A C++ ${form} has no statically readable single target.`,
      "Use one explicit qualified target supported by the pinned grammar.",
      node,
    );
  }

  private conditional(node: EvidenceNode): void {
    this.problem(
      "cpp-preprocessor-conditional",
      "Conditional preprocessing can change the selected C++ declaration population.",
      "Select generated preprocessed source or remove declaration-position conditional branches.",
      node,
    );
  }

  private macroDeclaration(node: EvidenceNode): void {
    this.problem(
      "cpp-macro-declaration",
      "A declaration-position macro invocation can generate an unknown C++ surface.",
      "Select generated declaration source or replace the invocation with explicit declarations.",
      node,
    );
  }

  private preprocessorDirective(node: EvidenceNode): void {
    this.problem(
      "cpp-preprocessor-directive",
      "A selected C++ preprocessor directive can change declaration semantics.",
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
    return `cpp:${this.source.id}:site:${this.nodeKey(node)}`;
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
