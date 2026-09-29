import type { Node as EvidenceNode } from "web-tree-sitter";

import type { EvidenceParseSession } from "../../parsers/EvidenceParseSession";
import type { IEvidenceCommentSyntax } from "../../structures/IEvidenceCommentSyntax";
import type { IEvidenceDiagnostic } from "../../structures/IEvidenceDiagnostic";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceRange } from "../../structures/IEvidenceSourceRange";
import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { IEvidenceRubyConstantPath } from "./IEvidenceRubyConstantPath";
import type { IEvidenceRubyDeclaration } from "./IEvidenceRubyDeclaration";
import type { IEvidenceRubyDocumentation } from "./IEvidenceRubyDocumentation";
import type { IEvidenceRubyFileAnalysis } from "./IEvidenceRubyFileAnalysis";
import type { IEvidenceRubyScopeContext } from "./IEvidenceRubyScopeContext";
import type { EvidenceRubyAttributeMode } from "./EvidenceRubyAttributeMode";
import type { EvidenceRubyContainerKind } from "./EvidenceRubyContainerKind";
import type { EvidenceRubyDeclarationForm } from "./EvidenceRubyDeclarationForm";
import type { EvidenceRubyMethodSide } from "./EvidenceRubyMethodSide";
import { EvidenceRubySyntax } from "./EvidenceRubySyntax";
import type { EvidenceRubyVisibility } from "./EvidenceRubyVisibility";
import { EvidenceSourceText } from "../../internal/EvidenceSourceText";

/**
 * Extracts bounded Ruby declarations, visibility changes, and documentation
 * carriers.
 *
 * The scanner follows Ruby's ordered class and module directives while
 * retaining declaration records for later inventory assembly and documentation
 * attachment.
 */
export class EvidenceRubyFileScanner {
  /**
   * Heredoc bodies paired with their opening syntax positions.
   *
   * Tree-sitter places delayed bodies beside their originating statement.
   * Fingerprints must retain those bodies without absorbing sibling
   * declarations.
   */
  private readonly heredocs: Map<string, EvidenceNode> = new Map<
    string,
    EvidenceNode
  >();

  /**
   * Collects declarations in source order for visibility and alias resolution.
   *
   * Ruby directives can alter only prior declarations, so this list preserves
   * the order required to reject ambiguous or forward targets.
   */
  private readonly declarations: IEvidenceRubyDeclaration[] = [];

  /**
   * Stores recognized documentation carriers by their source-range identity.
   *
   * Attachments are accumulated while declarations are scanned and later become
   * evidence documentation mappings.
   */
  private readonly documentation = new Map<
    string,
    IEvidenceRubyDocumentation
  >();

  /**
   * Collects failures that make static Ruby surface extraction incomplete.
   *
   * The adapter emits these records instead of silently omitting dynamic forms.
   */
  private readonly diagnostics: IEvidenceDiagnostic[] = [];

  /**
   * Deduplicates diagnostics encountered through overlapping syntax traversals.
   *
   * One unsupported directive should retain one actionable source location.
   */
  private readonly reported = new Set<string>();

  /**
   * Remembers explicit constant visibility by lexical identity.
   *
   * Later declarations of the same constant inherit the most recent supported
   * visibility directive in their selected source context.
   */
  private readonly constantVisibility = new Map<
    string,
    EvidenceRubyVisibility
  >();

  /**
   * Converts parser offsets to source ranges that survive parser cleanup.
   *
   * Declaration sites and attached documentation both use this one source view.
   */
  private readonly text: EvidenceSourceText;

  /**
   * States whether all surface-affecting Ruby constructs were classified.
   *
   * Unsupported dynamic behavior marks the file incomplete to protect coverage
   * from a falsely reduced public population.
   */
  private complete = true;

  /**
   * Supplies unique declaration-record suffixes within this source file.
   *
   * Synthetic aliases and module-function copies require identities distinct
   * from the source declaration they derive from.
   */
  private serial = 0;

  /**
   * Binds this scanner to the current parser session and selected Ruby source.
   *
   * Documentation is collected before declarations so adjacent comments are
   * available when a site is emitted.
   */
  public constructor(
    private readonly session: EvidenceParseSession,
    private readonly source: IEvidenceSourceFile,
  ) {
    this.text = new EvidenceSourceText(source.content);
    this.indexHeredocs();
    this.collectDocumentation();
  }

  /**
   * Produces the serializable extraction result for one Ruby source file.
   *
   * The root body is traversed with top-level scope state after documentation
   * collection, preserving ordered visibility and attachment behavior.
   */
  public scan(): IEvidenceRubyFileAnalysis {
    const root: IEvidenceRubyScopeContext = {
      kind: "top",
      identity: [],
      side: "instance",
      visibility: "private",
      moduleFunction: false,
    };
    this.scanBody(this.session.root, root);
    return {
      source: this.source,
      declarations: this.declarations,
      documentation: Array.from(this.documentation.values()),
      diagnostics: this.diagnostics,
      complete: this.complete,
    };
  }

  /**
   * Scans statements in one Ruby lexical body.
   *
   * Context carries ordered visibility and owner state into each statement.
   */
  private scanBody(
    body: EvidenceNode,
    context: IEvidenceRubyScopeContext,
  ): void {
    for (const statement of body.namedChildren)
      this.scanStatement(statement, context);
  }

  /**
   * Dispatches one statement to the supported Ruby surface classifier.
   *
   * Unrecognized nested surface changes are preserved as incomplete
   * diagnostics.
   */
  private scanStatement(
    statement: EvidenceNode,
    context: IEvidenceRubyScopeContext,
  ): void {
    switch (statement.type) {
      case "comment":
      case "heredoc_body":
      case "empty_statement":
        return;
      case "class":
        this.scanContainer(statement, context, "class");
        return;
      case "module":
        this.scanContainer(statement, context, "module");
        return;
      case "singleton_class":
        this.scanSingletonClass(statement, context);
        return;
      case "method":
        this.scanMethod(statement, statement, context);
        return;
      case "singleton_method":
        this.scanSingletonMethod(statement, statement, context);
        return;
      case "assignment":
        this.scanAssignment(statement, context);
        return;
      case "alias":
        this.scanAlias(statement, statement, context);
        return;
      case "undef":
        if (context.kind !== "top")
          this.problem(
            "ruby-method-removal",
            "Ruby undef removes methods from the selected declared surface.",
            "Replace the removal with an explicit final declaration or add load-order-aware analysis.",
            statement,
          );
        return;
      case "identifier":
        this.scanBareDirective(statement, context);
        return;
      case "call":
        this.scanCall(statement, context);
        return;
      default:
        if (this.containsSurfaceChange(statement))
          this.problem(
            "ruby-conditional-surface",
            `Ruby '${statement.type}' conditionally changes the selected public surface.`,
            "Move declarations and public-surface macros into an unconditional class or module body, or add control-flow analysis.",
            statement,
          );
    }
  }

  /**
   * Extracts a class or module and traverses its owned lexical body.
   *
   * Owner identity and visibility state are derived before child declarations.
   */
  private scanContainer(
    statement: EvidenceNode,
    context: IEvidenceRubyScopeContext,
    kind: EvidenceRubyContainerKind,
  ): void {
    if (context.kind === "singleton") {
      this.problem(
        "ruby-singleton-constant",
        "A class or module declaration inside a singleton class has unsupported constant ownership.",
        "Declare the constant in an ordinary class or module body.",
        statement,
      );
      return;
    }
    const path = EvidenceRubySyntax.constantPath(
      statement.childForFieldName("name"),
    );
    if (path === undefined) {
      this.problem(
        "ruby-container-name",
        `A Ruby ${kind} has no statically readable constant path.`,
        "Use a named constant or constant path for the declaration.",
        statement,
      );
      return;
    }
    const identity = this.resolvePath(path, context);
    const visibility =
      this.constantVisibility.get(this.identityKey(identity)) ?? "public";
    this.addDeclaration(
      statement,
      statement,
      "type",
      kind,
      identity.at(-1) ?? "",
      identity.at(-1) ?? "",
      identity,
      identity,
      visibility,
      true,
      identity.slice(0, -1),
      [this.session.range(statement)],
      undefined,
      undefined,
      kind,
      kind === "class" ? EvidenceRubySyntax.superclass(statement) : undefined,
    );
    const body = statement.childForFieldName("body");
    if (body === null) return;
    const nested: IEvidenceRubyScopeContext = {
      kind,
      identity,
      side: "instance",
      visibility: "public",
      moduleFunction: false,
      containerKind: kind,
    };
    this.scanBody(body, nested);
  }

  /**
   * Extracts a singleton-class scope with singleton member ownership.
   *
   * Unsupported singleton owners are reported because their address is dynamic.
   */
  private scanSingletonClass(
    statement: EvidenceNode,
    context: IEvidenceRubyScopeContext,
  ): void {
    if (context.kind === "singleton") {
      this.problem(
        "ruby-nested-singleton",
        "A singleton class opened from another singleton class targets an unsupported eigenclass level.",
        "Declare class or module singleton methods directly with def self.name.",
        statement,
      );
      return;
    }
    const value = statement.childForFieldName("value");
    const identity =
      value?.type === "self" && context.kind !== "top"
        ? context.identity
        : this.resolveOptionalPath(
            EvidenceRubySyntax.constantPath(value),
            context,
          );
    if (identity === undefined || identity.length === 0) {
      if (this.containsSurfaceChange(statement))
        this.problem(
          "ruby-singleton-owner",
          "A singleton class with public declarations has no statically selected constant owner.",
          "Open class << self inside a supported class or module, or use a literal constant path.",
          statement,
        );
      return;
    }
    const body = statement.childForFieldName("body");
    if (body === null) return;
    const singleton: IEvidenceRubyScopeContext = {
      kind: "singleton",
      identity,
      side: "singleton",
      visibility: "public",
      moduleFunction: false,
      ...(context.containerKind === undefined
        ? {}
        : { containerKind: context.containerKind }),
    };
    this.scanBody(body, singleton);
  }

  /**
   * Extracts an instance method under the current Ruby scope.
   *
   * Scope visibility and module-function state determine its published form.
   */
  private scanMethod(
    method: EvidenceNode,
    wrapper: EvidenceNode,
    context: IEvidenceRubyScopeContext,
    forcedVisibility?: EvidenceRubyVisibility,
    forcedModuleFunction: boolean = false,
  ): void {
    if (context.kind === "top") return;
    const name = EvidenceRubySyntax.methodName(
      method.childForFieldName("name"),
    );
    if (name === undefined) {
      this.problem(
        "ruby-method-name",
        "A Ruby method has no statically readable name.",
        "Use an identifier, setter, or operator method name.",
        method,
      );
      return;
    }
    const moduleFunction =
      context.kind === "module" &&
      context.side === "instance" &&
      (forcedModuleFunction || context.moduleFunction);
    const visibility = moduleFunction
      ? "private"
      : (forcedVisibility ??
        (name === "initialize" ? "private" : context.visibility));
    const declaration = this.addMethod(
      method,
      wrapper,
      context,
      name,
      visibility,
      context.side === "singleton" ? "singleton-method" : "method",
    );
    if (moduleFunction) this.cloneModuleFunction(declaration);
  }

  /**
   * Extracts a statically named singleton method.
   *
   * The receiver must resolve to the current selected owner.
   */
  private scanSingletonMethod(
    method: EvidenceNode,
    wrapper: EvidenceNode,
    context: IEvidenceRubyScopeContext,
    forcedVisibility?: EvidenceRubyVisibility,
  ): void {
    if (context.kind === "singleton") {
      this.problem(
        "ruby-nested-singleton",
        "def self.name inside a singleton class targets an unsupported eigenclass level.",
        "Use an ordinary def name inside class << self.",
        method,
      );
      return;
    }
    const object = method.childForFieldName("object");
    const identity =
      object?.type === "self" && context.kind !== "top"
        ? context.identity
        : this.resolveOptionalPath(
            EvidenceRubySyntax.constantPath(object),
            context,
          );
    if (identity === undefined || identity.length === 0) {
      if (context.kind !== "top" || object?.type !== "self")
        this.problem(
          "ruby-singleton-owner",
          "A singleton method has no statically selected class or module owner.",
          "Use def self.name inside a supported class or module, or use a literal constant path.",
          method,
        );
      return;
    }
    const name = EvidenceRubySyntax.methodName(
      method.childForFieldName("name"),
    );
    if (name === undefined) {
      this.problem(
        "ruby-method-name",
        "A Ruby singleton method has no statically readable name.",
        "Use an identifier, setter, or operator method name.",
        method,
      );
      return;
    }
    const owner: IEvidenceRubyScopeContext = {
      kind: "singleton",
      identity,
      side: "singleton",
      visibility: forcedVisibility ?? "public",
      moduleFunction: false,
      ...(context.containerKind === undefined
        ? {}
        : { containerKind: context.containerKind }),
    };
    this.addMethod(
      method,
      wrapper,
      owner,
      name,
      forcedVisibility ?? "public",
      "singleton-method",
    );
  }

  /**
   * Adds a method declaration with its semantic and runtime names.
   *
   * The method centralizes site construction for ordinary and synthetic forms.
   */
  private addMethod(
    method: EvidenceNode,
    wrapper: EvidenceNode,
    context: IEvidenceRubyScopeContext,
    name: string,
    visibility: EvidenceRubyVisibility,
    form: Extract<EvidenceRubyDeclarationForm, "method" | "singleton-method">,
  ): IEvidenceRubyDeclaration {
    const address = this.memberAddress(context.identity, context.side, name);
    return this.addDeclaration(
      method,
      wrapper,
      "function",
      form,
      name,
      name,
      address,
      address,
      visibility,
      true,
      context.identity,
      [this.session.range(method)],
      context.side,
      undefined,
      context.containerKind,
    );
  }

  /**
   * Extracts supported constant assignments from the current scope.
   *
   * Dynamic targets are failures because they cannot supply stable addresses.
   */
  private scanAssignment(
    statement: EvidenceNode,
    context: IEvidenceRubyScopeContext,
  ): void {
    const left = statement.childForFieldName("left");
    const path = EvidenceRubySyntax.constantPath(left);
    if (path === undefined) {
      if (
        left !== null &&
        left.descendantsOfType("constant").length !== 0 &&
        context.kind !== "singleton"
      )
        this.problem(
          "ruby-constant-assignment",
          "A compound Ruby assignment contains constants that cannot be separated safely.",
          "Declare each public constant with one direct assignment.",
          statement,
        );
      return;
    }
    if (context.kind === "singleton") {
      this.problem(
        "ruby-singleton-constant",
        "A constant assignment inside a singleton class has unsupported ownership.",
        "Declare the constant in an ordinary class or module body.",
        statement,
      );
      return;
    }
    const identity = this.resolvePath(path, context);
    const visibility =
      this.constantVisibility.get(this.identityKey(identity)) ?? "public";
    this.addDeclaration(
      statement,
      statement,
      "property",
      "constant",
      identity.at(-1) ?? "",
      identity.at(-1) ?? "",
      identity,
      identity,
      visibility,
      true,
      identity.slice(0, -1),
      [this.session.range(statement)],
      undefined,
      undefined,
      context.containerKind,
    );
    if (
      EvidenceRubySyntax.generatedConstant(statement.childForFieldName("right"))
    )
      this.problem(
        "ruby-generated-constant",
        `Ruby constant '${identity.join("::")}' receives a runtime-generated class or module.`,
        "Use an explicit class or module declaration, or add generator-aware analysis for its members.",
        statement,
      );
  }

  /**
   * Dispatches a Ruby call that may alter the declared surface.
   *
   * Only known static directives are interpreted; the rest preserve boundaries.
   */
  private scanCall(
    call: EvidenceNode,
    context: IEvidenceRubyScopeContext,
  ): void {
    const name = EvidenceRubySyntax.callName(call);
    if (name === undefined) return;
    if (!EvidenceRubySyntax.hasReceiver(call)) {
      if (name === "public" || name === "private" || name === "protected") {
        this.scanVisibilityCall(call, context, name);
        return;
      }
      if (name === "public_class_method" || name === "private_class_method") {
        this.scanClassVisibilityCall(
          call,
          context,
          name === "public_class_method" ? "public" : "private",
        );
        return;
      }
      if (name === "public_constant" || name === "private_constant") {
        this.scanConstantVisibilityCall(
          call,
          context,
          name === "public_constant" ? "public" : "private",
        );
        return;
      }
      if (
        name === "attr_reader" ||
        name === "attr_writer" ||
        name === "attr_accessor"
      ) {
        this.scanAttribute(call, call, context);
        return;
      }
      if (name === "alias_method") {
        this.scanAliasCall(call, context);
        return;
      }
      if (name === "module_function") {
        this.scanModuleFunction(call, context);
        return;
      }
    }
    if (this.surfaceCall(name))
      this.problem(
        "ruby-dynamic-surface",
        `Ruby call '${name}' can change the public surface without a statically complete declaration.`,
        "Replace it with explicit declarations or add a bounded adapter rule for this metaprogramming form.",
        call,
      );
  }

  /**
   * Handles a directive written without an explicit receiver.
   *
   * Such calls inherit the current lexical scope and visibility state.
   */
  private scanBareDirective(
    statement: EvidenceNode,
    context: IEvidenceRubyScopeContext,
  ): void {
    const name = statement.text;
    if (name === "public" || name === "private" || name === "protected") {
      context.visibility = name;
      context.moduleFunction = false;
    } else if (name === "module_function") {
      if (context.kind !== "module" || context.side !== "instance")
        this.problem(
          "ruby-module-function-owner",
          "module_function is only supported in an ordinary module body.",
          "Move the directive into a module or declare singleton methods explicitly.",
          statement,
        );
      else {
        context.visibility = "private";
        context.moduleFunction = true;
      }
    }
  }

  /**
   * Applies a supported method-visibility directive in the current scope.
   *
   * Literal targets update prior selected declarations in Ruby source order.
   */
  private scanVisibilityCall(
    call: EvidenceNode,
    context: IEvidenceRubyScopeContext,
    visibility: EvidenceRubyVisibility,
  ): void {
    const arguments_ = EvidenceRubySyntax.callArguments(call);
    const wrapped = arguments_[0];
    if (arguments_.length === 1 && wrapped !== undefined) {
      if (wrapped.type === "method") {
        this.scanMethod(wrapped, call, context, visibility);
        return;
      }
      if (wrapped.type === "singleton_method") {
        this.scanSingletonMethod(wrapped, call, context);
        const name = EvidenceRubySyntax.methodName(
          wrapped.childForFieldName("name"),
        );
        if (name !== undefined)
          this.changeMethodVisibility(
            context.identity,
            context.kind === "singleton" ? "singleton" : "instance",
            name,
            visibility,
            call,
          );
        return;
      }
      if (
        wrapped.type === "call" &&
        ["attr_reader", "attr_writer", "attr_accessor"].includes(
          EvidenceRubySyntax.callName(wrapped) ?? "",
        )
      ) {
        this.scanAttribute(wrapped, call, context, visibility);
        return;
      }
    }
    if (arguments_.length === 0) {
      context.visibility = visibility;
      context.moduleFunction = false;
      return;
    }
    const names = EvidenceRubySyntax.literalNames(arguments_);
    if (names === undefined || names.length === 0) {
      this.dynamicDirective(call, "method visibility");
      return;
    }
    const side = context.kind === "singleton" ? "singleton" : "instance";
    for (const name of names)
      this.changeMethodVisibility(
        context.identity,
        side,
        name,
        visibility,
        call,
      );
  }

  /**
   * Applies a class-method visibility directive to singleton members.
   *
   * Dynamic names are rejected because the selected member cannot be
   * identified.
   */
  private scanClassVisibilityCall(
    call: EvidenceNode,
    context: IEvidenceRubyScopeContext,
    visibility: Extract<EvidenceRubyVisibility, "private" | "public">,
  ): void {
    if (context.kind !== "class" && context.kind !== "module") {
      this.problem(
        "ruby-class-visibility-owner",
        "Class-method visibility is only supported in an ordinary class or module body.",
        "Use private or public inside class << self, or move the directive into the owning class or module body.",
        call,
      );
      return;
    }
    const arguments_ = EvidenceRubySyntax.callArguments(call);
    const wrapped = arguments_[0];
    if (arguments_.length === 1 && wrapped?.type === "singleton_method") {
      this.scanSingletonMethod(wrapped, call, context, visibility);
      return;
    }
    const names = EvidenceRubySyntax.literalNames(arguments_);
    if (names === undefined || names.length === 0) {
      this.dynamicDirective(call, "class-method visibility");
      return;
    }
    for (const name of names)
      this.changeMethodVisibility(
        context.identity,
        "singleton",
        name,
        visibility,
        call,
      );
  }

  /**
   * Applies a constant-visibility directive to selected constants.
   *
   * Visibility is retained for both prior records and later same-name
   * declarations.
   */
  private scanConstantVisibilityCall(
    call: EvidenceNode,
    context: IEvidenceRubyScopeContext,
    visibility: Extract<EvidenceRubyVisibility, "private" | "public">,
  ): void {
    if (context.kind === "singleton") {
      this.dynamicDirective(call, "constant visibility");
      return;
    }
    const names = EvidenceRubySyntax.literalNames(
      EvidenceRubySyntax.callArguments(call),
    );
    if (
      names === undefined ||
      names.length === 0 ||
      names.some((name) => !/^[A-Z][A-Za-z0-9_]*$/u.test(name))
    ) {
      this.dynamicDirective(call, "constant visibility");
      return;
    }
    for (const name of names)
      this.changeConstantVisibility(
        [...context.identity, name],
        visibility,
        call,
      );
  }

  /**
   * Expands a static Ruby attribute directive into property declarations.
   *
   * Reader and writer modes retain their runtime spelling and scope visibility;
   * dynamic attribute names leave the scan incomplete.
   */
  private scanAttribute(
    call: EvidenceNode,
    wrapper: EvidenceNode,
    context: IEvidenceRubyScopeContext,
    forcedVisibility?: EvidenceRubyVisibility,
  ): void {
    if (context.kind === "top") return;
    const callName = EvidenceRubySyntax.callName(call);
    if (
      callName !== "attr_reader" &&
      callName !== "attr_writer" &&
      callName !== "attr_accessor"
    )
      return;
    const arguments_ = EvidenceRubySyntax.callArguments(call);
    const names = arguments_.map((argument) =>
      EvidenceRubySyntax.literalName(argument),
    );
    if (
      names.length === 0 ||
      names.some((name) => name === undefined || name.length === 0)
    ) {
      this.problem(
        "ruby-dynamic-attribute",
        `Ruby ${callName} contains a nonliteral attribute name.`,
        "Use literal symbol or string names in attr_reader, attr_writer, or attr_accessor.",
        call,
      );
      return;
    }
    if (context.kind === "module" && context.moduleFunction)
      this.problem(
        "ruby-module-function-attribute",
        "An attribute declaration under module_function mode has unsupported copy semantics.",
        "Declare explicit instance and singleton accessors, or reset visibility before the attribute declaration.",
        call,
      );
    const visibility = forcedVisibility ?? context.visibility;
    const modes: EvidenceRubyAttributeMode[] =
      callName === "attr_reader"
        ? ["read"]
        : callName === "attr_writer"
          ? ["write"]
          : ["read", "write"];
    const method = call.childForFieldName("method");
    for (let index = 0; index < arguments_.length; ++index) {
      const argument = arguments_[index];
      const name = names[index];
      if (argument === undefined || name === undefined) continue;
      for (const mode of modes) {
        const runtimeName = mode === "write" ? `${name}=` : name;
        const address = this.memberAddress(
          context.identity,
          context.side,
          name,
        );
        this.addDeclaration(
          argument,
          wrapper,
          "property",
          "attribute",
          name,
          runtimeName,
          address,
          address,
          visibility,
          true,
          context.identity,
          [
            ...(method === null ? [] : [this.session.range(method)]),
            this.session.range(argument),
          ],
          context.side,
          mode,
          context.containerKind,
        );
      }
    }
  }

  /**
   * Resolves an `alias` statement against a preceding selected method.
   *
   * Ruby alias names must be literal so the new public address is stable.
   */
  private scanAlias(
    statement: EvidenceNode,
    wrapper: EvidenceNode,
    context: IEvidenceRubyScopeContext,
  ): void {
    if (context.kind === "top") return;
    const name = EvidenceRubySyntax.methodName(
      statement.childForFieldName("name"),
    );
    const target = EvidenceRubySyntax.methodName(
      statement.childForFieldName("alias"),
    );
    if (name === undefined || target === undefined) {
      this.problem(
        "ruby-alias-name",
        "A Ruby alias has a name that cannot be resolved statically.",
        "Use literal method names in the alias statement.",
        statement,
      );
      return;
    }
    this.addAlias(statement, wrapper, context, name, target);
  }

  /**
   * Resolves an `alias_method` call with two literal method names.
   *
   * It delegates to the common alias path after enforcing static argument
   * count.
   */
  private scanAliasCall(
    call: EvidenceNode,
    context: IEvidenceRubyScopeContext,
  ): void {
    if (context.kind === "top") return;
    const names = EvidenceRubySyntax.literalNames(
      EvidenceRubySyntax.callArguments(call),
    );
    if (names?.length !== 2) {
      this.problem(
        "ruby-alias-name",
        "alias_method requires two statically readable method names.",
        "Use two literal symbol or string method names.",
        call,
      );
      return;
    }
    const name = names[0];
    const target = names[1];
    if (name !== undefined && target !== undefined)
      this.addAlias(call, call, context, name, target);
  }

  /**
   * Adds an alias declaration after finding exactly one prior function target.
   *
   * Ambiguity is rejected because Ruby load order cannot be inferred beyond the
   * selected file's ordered declaration records.
   */
  private addAlias(
    statement: EvidenceNode,
    wrapper: EvidenceNode,
    context: IEvidenceRubyScopeContext,
    name: string,
    targetName: string,
  ): void {
    const candidates = this.methodDeclarations(
      context.identity,
      context.side,
      targetName,
    ).filter((declaration) => declaration.symbol === "function");
    if (candidates.length !== 1) {
      this.problem(
        "ruby-alias-target",
        `Ruby alias '${name}' cannot identify one selected prior method '${targetName}'.`,
        "Define the target method once earlier in the same selected file before aliasing it.",
        statement,
      );
      return;
    }
    const target = candidates[0];
    if (target === undefined) return;
    const address = this.memberAddress(context.identity, context.side, name);
    this.addDeclaration(
      statement,
      wrapper,
      "function",
      "alias",
      name,
      name,
      address,
      address,
      target.visibility,
      true,
      context.identity,
      [this.session.range(statement)],
      context.side,
      undefined,
      context.containerKind,
    );
  }

  /**
   * Applies supported `module_function` forms to instance methods.
   *
   * The directive privatizes the source method and creates a public singleton
   * copy only when its target can be identified statically.
   */
  private scanModuleFunction(
    call: EvidenceNode,
    context: IEvidenceRubyScopeContext,
  ): void {
    if (context.kind !== "module" || context.side !== "instance") {
      this.problem(
        "ruby-module-function-owner",
        "module_function is only supported in an ordinary module body.",
        "Move the directive into a module or declare singleton methods explicitly.",
        call,
      );
      return;
    }
    const arguments_ = EvidenceRubySyntax.callArguments(call);
    const wrapped = arguments_[0];
    if (arguments_.length === 1 && wrapped?.type === "method") {
      this.scanMethod(wrapped, call, context, "private", true);
      return;
    }
    if (arguments_.length === 0) {
      context.visibility = "private";
      context.moduleFunction = true;
      return;
    }
    const names = EvidenceRubySyntax.literalNames(arguments_);
    if (names === undefined || names.length === 0) {
      this.dynamicDirective(call, "module_function");
      return;
    }
    for (const name of names) {
      const candidates = this.methodDeclarations(
        context.identity,
        "instance",
        name,
      ).filter((declaration) => declaration.symbol === "function");
      if (candidates.length !== 1) {
        this.problem(
          "ruby-module-function-target",
          `module_function cannot identify one selected prior method '${name}'.`,
          "Define the method once earlier in the same selected file or use an explicit singleton method.",
          call,
        );
        continue;
      }
      const target = candidates[0];
      if (target === undefined) continue;
      target.visibility = "private";
      this.cloneModuleFunction(target);
    }
  }

  /**
   * Creates the public singleton copy required by `module_function`.
   *
   * Documentation attachments are copied to the new declaration site relation
   * so both Ruby entry points retain the source evidence mapping.
   */
  private cloneModuleFunction(target: IEvidenceRubyDeclaration): void {
    const address = this.memberAddress(
      target.ownerIdentity ?? [],
      "singleton",
      target.runtimeName,
    );
    const clone: IEvidenceRubyDeclaration = {
      ...target,
      id: `ruby:${this.source.id}:declaration:${this.serial++}:module-function`,
      form: "module-function",
      identity: address,
      address,
      visibility: "public",
      side: "singleton",
      site: structuredClone(target.site),
    };
    this.declarations.push(clone);
    for (const documentation of this.documentation.values())
      for (const attachment of documentation.attachments.filter(
        (candidate) => candidate.declarationId === target.id,
      ))
        documentation.attachments.push({
          declarationId: clone.id,
          siteId: attachment.siteId,
        });
  }

  /**
   * Changes visibility on matching prior method declarations.
   *
   * Missing targets are errors because a directive must not silently alter an
   * unknown population member.
   */
  private changeMethodVisibility(
    ownerIdentity: string[],
    side: EvidenceRubyMethodSide,
    name: string,
    visibility: EvidenceRubyVisibility,
    call: EvidenceNode,
  ): void {
    const candidates = this.methodDeclarations(ownerIdentity, side, name);
    if (candidates.length === 0) {
      this.problem(
        "ruby-visibility-target",
        `Ruby visibility directive cannot identify a selected prior ${side} method '${name}'.`,
        "Define the method earlier in the same selected file or add load-order-aware resolution.",
        call,
      );
      return;
    }
    for (const candidate of candidates) candidate.visibility = visibility;
  }

  /**
   * Changes visibility on matching constants and stores it for later records.
   *
   * Ruby permits the directive after declaration, so both existing and future
   * selected records need the resolved lexical visibility.
   */
  private changeConstantVisibility(
    identity: string[],
    visibility: Extract<EvidenceRubyVisibility, "private" | "public">,
    call: EvidenceNode,
  ): void {
    const key = this.identityKey(identity);
    const candidates = this.declarations.filter(
      (declaration) =>
        (declaration.form === "class" ||
          declaration.form === "module" ||
          declaration.form === "constant") &&
        this.identityKey(declaration.identity) === key,
    );
    if (candidates.length === 0) {
      this.problem(
        "ruby-constant-visibility-target",
        `Ruby constant visibility cannot identify selected prior constant '${identity.join("::")}'.`,
        "Declare the constant earlier in the same selected file or add load-order-aware resolution.",
        call,
      );
      return;
    }
    this.constantVisibility.set(key, visibility);
    for (const candidate of candidates) candidate.visibility = visibility;
  }

  /**
   * Returns definition records matching one owner, side, and runtime method
   * name.
   *
   * Attributes participate because their generated readers and writers are
   * valid targets for Ruby visibility directives.
   */
  private methodDeclarations(
    ownerIdentity: string[],
    side: EvidenceRubyMethodSide,
    runtimeName: string,
  ): IEvidenceRubyDeclaration[] {
    const owner = this.identityKey(ownerIdentity);
    return this.declarations.filter(
      (declaration) =>
        declaration.definition &&
        declaration.side === side &&
        declaration.runtimeName === runtimeName &&
        this.identityKey(declaration.ownerIdentity ?? []) === owner &&
        (declaration.symbol === "function" || declaration.form === "attribute"),
    );
  }

  /**
   * Builds and records one Ruby declaration with its source site and metadata.
   *
   * The site begins at attached documentation when present, preserving the
   * source region Evidence associates with the declaration.
   */
  private addDeclaration(
    item: EvidenceNode,
    siteNode: EvidenceNode,
    symbol: EvidenceProgrammingSymbol,
    form: EvidenceRubyDeclarationForm,
    name: string,
    runtimeName: string,
    identity: string[],
    address: string[],
    visibility: EvidenceRubyVisibility,
    definition: boolean,
    ownerIdentity: string[],
    content: IEvidenceSourceRange[],
    side?: EvidenceRubyMethodSide,
    attributeMode?: EvidenceRubyAttributeMode,
    containerKind?: EvidenceRubyContainerKind,
    superclass?: string,
  ): IEvidenceRubyDeclaration {
    const documentation = this.attachedDocumentation(siteNode);
    const ranges: IEvidenceSourceRange[] = this.contentWithHeredocs(
      item,
      content,
    );
    const end: number = Math.max(
      siteNode.endIndex,
      ...ranges.map((range: IEvidenceSourceRange): number => range.end.offset),
    );
    const site: IEvidenceUnitSite = {
      id: this.siteId(siteNode),
      file: this.source.physicalPath,
      range: this.text.range(
        documentation?.range?.start?.offset ?? siteNode.startIndex,
        end,
      ),
      content: ranges,
    };
    const declaration: IEvidenceRubyDeclaration = {
      id: `ruby:${this.source.id}:declaration:${this.serial++}:${form}:${item.startIndex}`,
      name,
      runtimeName,
      symbol,
      form,
      identity,
      address,
      site,
      visibility,
      definition,
      ...(ownerIdentity.length === 0 ? {} : { ownerIdentity }),
      ...(side === undefined ? {} : { side }),
      ...(attributeMode === undefined ? {} : { attributeMode }),
      ...(containerKind === undefined ? {} : { containerKind }),
      ...(superclass === undefined ? {} : { superclass }),
    };
    this.declarations.push(declaration);
    if (documentation !== undefined)
      this.attach(documentation, declaration.id, site.id);
    return declaration;
  }

  /**
   * Pairs delayed heredoc bodies with openings in source order.
   *
   * Ruby consumes multiple openings in lexical order even when their bodies
   * appear after separate statements on one line. Pairing globally preserves
   * ownership across those sibling statements and nested containers.
   */
  private indexHeredocs(): void {
    const openings: EvidenceNode[] = this.session.root
      .descendantsOfType("heredoc_beginning")
      .sort(
        (left: EvidenceNode, right: EvidenceNode): number =>
          left.startIndex - right.startIndex,
      );
    const bodies: EvidenceNode[] = this.session.root
      .descendantsOfType("heredoc_body")
      .sort(
        (left: EvidenceNode, right: EvidenceNode): number =>
          left.startIndex - right.startIndex,
      );
    const incomplete: boolean = bodies.some(
      (body: EvidenceNode): boolean =>
        !body.namedChildren.some(
          (child: EvidenceNode): boolean =>
            child.type === "heredoc_end" && child.text.trim() !== "",
        ),
    );
    if (openings.length !== bodies.length || incomplete) {
      this.problem(
        "ruby-heredoc-body",
        "Heredoc openings and delayed bodies cannot be paired completely.",
        "Use complete heredoc expressions before checking their content fingerprints.",
        this.session.root,
      );
      return;
    }
    openings.forEach((opening: EvidenceNode, index: number): void => {
      const body: EvidenceNode | undefined = bodies[index];
      if (body !== undefined) this.heredocs.set(this.nodeKey(opening), body);
    });
  }

  /**
   * Includes delayed literal bodies in the declaration's own semantic content.
   *
   * Bodies already inside a method or container range are not duplicated. A
   * constant with several heredoc operands receives only its own paired
   * bodies.
   */
  private contentWithHeredocs(
    node: EvidenceNode,
    content: IEvidenceSourceRange[],
  ): IEvidenceSourceRange[] {
    const ranges: IEvidenceSourceRange[] = [...content];
    const openings: EvidenceNode[] =
      node.descendantsOfType("heredoc_beginning");
    for (const opening of openings) {
      const body: EvidenceNode | undefined = this.heredocs.get(
        this.nodeKey(opening),
      );
      if (
        body === undefined ||
        ranges.some(
          (range: IEvidenceSourceRange): boolean =>
            range.start.offset <= body.startIndex &&
            range.end.offset >= body.endIndex,
        )
      )
        continue;
      ranges.push(this.session.range(body));
    }
    return ranges;
  }

  /**
   * Finds the nearest attachable documentation carrier before a declaration.
   *
   * Only line-leading comments without intervening content attach, preventing
   * an unrelated earlier comment from becoming the declaration's evidence
   * host.
   */
  private attachedDocumentation(
    node: EvidenceNode,
  ): IEvidenceRubyDocumentation | undefined {
    const documentation = Array.from(this.documentation.values())
      .filter(
        (candidate) =>
          candidate.syntax !== undefined &&
          this.lineLeading(candidate.range) &&
          candidate.range.end.offset <= node.startIndex &&
          (candidate.syntax.opening.startsWith("=begin") ||
            candidate.range.start.column === node.startPosition.column + 1),
      )
      .sort((left, right) => right.range.end.offset - left.range.end.offset)[0];
    if (documentation === undefined) return undefined;
    const between = this.source.content.slice(
      documentation.range.end.offset,
      node.startIndex,
    );
    return between.trim() !== "" || /\r?\n[ \t]*\r?\n/u.test(between)
      ? undefined
      : documentation;
  }

  /**
   * Checks whether a documentation range begins after only whitespace on its
   * line.
   *
   * Inline comments cannot attach to the following Ruby declaration.
   */
  private lineLeading(range: IEvidenceSourceRange): boolean {
    const lineStart =
      Math.max(
        this.source.content.lastIndexOf("\n", range.start.offset - 1),
        this.source.content.lastIndexOf("\r", range.start.offset - 1),
      ) + 1;
    return (
      this.source.content.slice(lineStart, range.start.offset).trim() === ""
    );
  }

  /**
   * Collects supported Ruby comment carriers and contiguous hash-comment runs.
   *
   * Adjacent aligned comments become one mapping; blank lines and indentation
   * changes deliberately break the run.
   */
  private collectDocumentation(): void {
    const comments = this.session.root
      .descendantsOfType("comment")
      .sort((left, right) => left.startIndex - right.startIndex);
    for (let index = 0; index < comments.length; ++index) {
      const first = comments[index];
      if (first === undefined) continue;
      const syntax = EvidenceRubySyntax.commentSyntax(first);
      if (syntax === undefined) continue;
      let last = first;
      if (first.text.startsWith("#"))
        while (index + 1 < comments.length) {
          const next = comments[index + 1];
          if (next === undefined) break;
          const between = this.source.content.slice(
            last.endIndex,
            next.startIndex,
          );
          if (
            !next.text.startsWith("#") ||
            next.startPosition.column !== first.startPosition.column ||
            /\r?\n[ \t]*\r?\n/u.test(between) ||
            between.trim() !== ""
          )
            break;
          last = next;
          ++index;
        }
      this.ensureDocumentationRange(
        this.text.range(first.startIndex, last.endIndex),
        syntax,
      );
    }
  }

  /**
   * Returns the documentation record for one exact source range and syntax.
   *
   * Reuse prevents duplicate mappings when several collection paths meet.
   */
  private ensureDocumentationRange(
    range: IEvidenceSourceRange,
    syntax: IEvidenceCommentSyntax,
  ): IEvidenceRubyDocumentation {
    const key = `${range.start.offset}:${range.end.offset}`;
    let documentation = this.documentation.get(key);
    if (documentation === undefined) {
      documentation = {
        id: `ruby:${this.source.id}:documentation:${key}`,
        range,
        syntax,
        attachments: [],
      };
      this.documentation.set(key, documentation);
    }
    return documentation;
  }

  /**
   * Attaches documentation to a declaration site without duplicate relations.
   *
   * Repeated scan paths can identify the same carrier and declaration pair.
   */
  private attach(
    documentation: IEvidenceRubyDocumentation,
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

  /**
   * Detects nested syntax that can change Ruby's declared public surface.
   *
   * Dynamic execution boundaries are reported instead of interpreted as static
   * declarations within a conditional or metaprogrammed body.
   */
  private containsSurfaceChange(node: EvidenceNode): boolean {
    const queue: EvidenceNode[] = [node];
    for (let index = 0; index < queue.length; ++index) {
      const current = queue[index];
      if (current === undefined) continue;
      if (
        current.type === "class" ||
        current.type === "module" ||
        current.type === "singleton_class" ||
        current.type === "method" ||
        current.type === "singleton_method" ||
        current.type === "alias" ||
        current.type === "undef"
      )
        return true;
      if (
        current.type === "assignment" &&
        EvidenceRubySyntax.constantPath(current.childForFieldName("left")) !==
          undefined
      )
        return true;
      const callName = EvidenceRubySyntax.callName(current);
      if (callName !== undefined && this.surfaceCall(callName)) return true;
      queue.push(...current.namedChildren);
    }
    return false;
  }

  /**
   * Checks whether a call name is known to mutate Ruby declaration surface.
   *
   * This explicit list bounds static support and identifies dynamic directives.
   */
  private surfaceCall(name: string): boolean {
    return [
      "alias_method",
      "attr",
      "attr_accessor",
      "attr_reader",
      "attr_writer",
      "autoload",
      "class_eval",
      "const_set",
      "define_method",
      "define_singleton_method",
      "extend",
      "include",
      "module_eval",
      "module_function",
      "prepend",
      "private",
      "private_class_method",
      "private_constant",
      "protected",
      "public",
      "public_class_method",
      "public_constant",
      "refine",
      "remove_const",
      "remove_method",
      "undef_method",
      "using",
    ].includes(name);
  }

  /**
   * Reports a directive whose names or target cannot be statically resolved.
   *
   * The diagnostic marks the file incomplete so unsupported runtime behavior
   * cannot lower coverage requirements.
   */
  private dynamicDirective(node: EvidenceNode, description: string): void {
    this.problem(
      "ruby-dynamic-directive",
      `Ruby ${description} uses names that cannot be resolved statically.`,
      "Use literal symbol or string names in the selected class or module body.",
      node,
    );
  }

  /**
   * Resolves a constant path against the current lexical owner when relative.
   *
   * Absolute paths and top-level paths retain their source segments unchanged.
   */
  private resolvePath(
    path: IEvidenceRubyConstantPath,
    context: IEvidenceRubyScopeContext,
  ): string[] {
    return path.absolute || context.kind === "top"
      ? path.segments
      : [...context.identity, ...path.segments];
  }

  /**
   * Resolves a constant path when a supported path is present.
   *
   * Absence remains undefined so callers can distinguish it from top-level
   * paths.
   */
  private resolveOptionalPath(
    path: IEvidenceRubyConstantPath | undefined,
    context: IEvidenceRubyScopeContext,
  ): string[] | undefined {
    return path === undefined ? undefined : this.resolvePath(path, context);
  }

  /**
   * Creates a public member address for instance or singleton ownership.
   *
   * Singleton members use the explicit `self` segment to avoid identity
   * clashes.
   */
  private memberAddress(
    owner: string[],
    side: EvidenceRubyMethodSide,
    name: string,
  ): string[] {
    return side === "instance" ? [...owner, name] : [...owner, "self", name];
  }

  /**
   * Serializes a lexical identity for map keys and equality checks.
   *
   * JSON preserves segment boundaries that a joined string could blur.
   */
  private identityKey(identity: string[]): string {
    return JSON.stringify(identity);
  }

  /**
   * Serializes a parser node range as a stable source-local key.
   *
   * The immutable selected source makes its offsets suitable for record
   * identity.
   */
  private nodeKey(node: EvidenceNode): string {
    return `${node.startIndex}:${node.endIndex}`;
  }

  /**
   * Creates the stable declaration-site identity for a Ruby parser node.
   *
   * The source ID scopes a range that could recur in another selected file.
   */
  private siteId(node: EvidenceNode): string {
    return `ruby:${this.source.id}:site:${this.nodeKey(node)}`;
  }

  /**
   * Records one static-analysis failure and marks the file incomplete.
   *
   * A source-range key suppresses repeated diagnostics from overlapping checks.
   */
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
