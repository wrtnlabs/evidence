# Adapter inventories

Implement `IEvidenceAdapter.analyze(snapshot)` to translate source snapshots into serializable graph data. The adapter owns declaration classification, public visibility, structural ownership, export resolution, documentation attachment, and unsupported-construct detection. A successful syntax parse alone does not establish a complete Evidence Graph inventory.

This guide gives implementation-level inventories for Markdown, TypeScript, JavaScript, Python, Go, Rust, Java, C#, C, C++, Ruby, and Prisma. The root README's [Languages](../../../../README.md#languages) section is the authoritative current boundary for all 28 supported artifact types, including the adapters whose implementation chapters have not yet been expanded here:

| Family | Authoritative coverage supplied by the root README |
| --- | --- |
| Programming | Kotlin, Swift, PHP, Dart, Scala, Lua, Objective-C, Zig, and MATLAB |
| Database | Portable SQL, PostgreSQL, MySQL, SQLite, BigQuery, and DBML |
| Document/API | Swagger/OpenAPI, plus the Markdown summary used by public configuration |

`EvidenceLanguageRegistry.list()`, `EvidenceLanguageRegistry.databases()`, and `evidence languages` provide the machine-readable certification set. Prose does not make a candidate or grammar-only entry selectable.

## Identities and locations

| Record | Meaning |
| --- | --- |
| `IEvidenceUnit` | One semantic identity, its selector, explicit parent, declaration sites, and retained withdrawal markers. |
| `IEvidenceUnit.contentDigest` | An optional adapter-supplied digest of that unit's own normalized semantic content. |
| `IEvidencePublicAddress` | A file and literal accessor segments that expose a unit. Several addresses can expose the same identity. |
| `IEvidenceUnitSite` | One declaration position and the content ranges belonging to this unit. |
| `IEvidenceHost` | A position that can carry documentation, its attachment status, declaration site, and semantic owners. |
| `IEvidenceDeclaration` | A positive acknowledgement or an exclusion with a target and reason. |
| `IEvidenceReview` | A verification statement paired by acknowledgement kind, host, and target; it supplies no coverage. |
| `IEvidenceInventory.annotationRanges` | Every parser-recognized annotation span that fingerprinting must remove from semantic content. |

Assign globally unambiguous IDs from physical source identity and language-established declaration identity. Merge overloads, declaration fragments, or reopened containers only when the language establishes that they are one identity. Never merge unrelated declarations by display name. Keep public module addresses independent of the defining file and identity.

Store literal accessor segments separately. `A["B.C"]` contains two segments; it does not establish a parent named `A.B`. Set `parentId` explicitly, including container relationships that are not represented by a textual prefix.

Use half-open original source spans with zero-based UTF-16 offsets and one-based lines and UTF-16 columns. Preserve CRLF and Unicode in source snapshots. An attached semantic host names a site owned by each listed unit. An artifact may also define an attached exclusion-only carrier with no site or semantic unit; positive evidence on that carrier must be rejected. Register eligible hosts even when they contain no annotations. An operation without a description or a declaration without a comment must not vanish from policies that inspect every selected host.

A multi-variable statement can give two units the same site and documentation host. Give each unit its own content ranges so changing one initializer does not necessarily change its sibling's fingerprint. Keep all declaration sites when several declarations form one semantic identity.

Fingerprint input comes from an adapter-supplied `contentDigest` or the source slices in each site's `content` ranges. Keep a source snapshot digest as a cache key only; it cannot substitute for a unit digest. Register every recognized annotation range, including comments on hidden or unsupported declarations, so editing a review cannot invalidate the scope it reviews.

## Combining and selecting

Construct `EvidenceInventory` from adapter inventories, then use `select(ids)` independently for each configured population. The constructor owns a validated copy; neither source-input mutations nor edits to returned snapshots change the index. Duplicate aliases and declaration records do not duplicate obligations. Different physical spellings of the same filesystem identity receive a deterministic declaration path while public addresses remain distinct.

Host `origins` retain the original paths used for relative citations; omitting the field initially means `file`. Resolve relative targets in the applicable population and source context, rather than using a diagnostic path chosen during merging. Several origins must not let scan order silently choose different evidence targets.

`select(ids)` includes selected visible units and their actual structural ancestors. It does not expose unrelated declarations merely because they occur in the same file. Withdrawal on any merged declaration hides that identity, its descendants, and their eligible hosts. The withdrawal remains available to explain a citation to a hidden target.

`resolve({ file, segments }, ids)` requires an exact address in the selected scope and reports `resolved`, `ambiguous`, `hidden`, `missing`, or `incomplete`. It does not search global display names or perform filesystem target resolution. Resolve authored paths and artifact-specific target forms before calling it.

`snapshot()` returns ordinary data with `schemaVersion: 1`; `serialize()` writes schema-order JSON with deterministic collection order for consistent inputs. Conflicting identities, missing parents, cycles, unowned hosts, or incorrect source coordinates mark analysis incomplete. Preserve upstream source failures in the adapter result as well. A healthy empty inventory is complete; failed analysis must never become a passing empty population. Annotation diagnostics can coexist with complete discovery, so inspect diagnostics as well as the completeness flag.

## File-qualified targets

`EvidenceFileTarget.parse(target, origin)` handles file-qualified programming targets. It decodes the path, resolves it from the citing file, and retains each accessor segment. Omitting `#` addresses the artifact's file unit; a trailing `#` is invalid. `format(address)` produces canonical text by percent-encoding reserved path characters and using dotted identifiers or JSON-string brackets for members. Equivalent encoded paths therefore reach the same absolute address, while `A.B` and `A["B.C"]` remain different.

Markdown keeps its original target grammar. Its file path is relative to the reference population root, `\` becomes `/`, and repeated leading `./` is ignored. Case, percent signs, and other path text remain literal. The text after `#` is one literal anchor segment, including dots, colons, and hyphens. Do not percent-decode Markdown paths or parse their anchors as programming accessors.

Prisma targets contain no file path. Parse `prisma:Model` and `prisma:Model.member` into the virtual `prisma:` address plus one or two identifier segments. Model identity belongs to the whole selected schema, so moving its declaration between selected files cannot change its target.

`EvidenceTargetResolver` accepts reference inventories, a target-bearing acknowledgement or review, its claim host, and the reference's selected unit IDs. For Markdown it matches root-relative logical source addresses. For other file-qualified artifacts it tries every retained claim-host origin. It queries only exact public addresses in the selected structural scope, unifies aliases by semantic unit ID, and never searches another file for a matching display name.

Resolution distinguishes malformed targets, missing files, existing files outside the reference, missing or unselected public members, withdrawn identities, ambiguous addresses, unsupported hosts, and incomplete inventories. An incomplete export graph prevents an otherwise valid address from resolving. An adapter may load an address only for dependency analysis by setting `IEvidenceSourceAddress.selected` to `false`; such a file can supply a selected barrel export but cannot be cited directly. TypeScript reexports must remain inside both the logical and resolved physical population roots.

## Graph evaluation

`EvidenceGraph.evaluate(input)` consumes fully materialized inventories and target resolutions without reading files. Each configured claim and each element of its reference array remains a separate indexed obligation; an optional claim name only labels its diagnostics. A disabled claim or a healthy claim with no selected semantic host is inactive; an incomplete claim remains active because failed discovery cannot prove that its population is empty.

Supply only the claim declarations whose target grammar applies to a reference in that reference's `resolutions`. The evaluator first accepts an exact resolved target in the reference's structural scope, then checks its claim host. Positive evidence must belong to a selected semantic claim host. An exclusion may use any attached claim host unless `exclusionHostIds` narrows the carrier set, and `noEvidenceExclude` refuses every exclusion. Reviews never enter the coverage ledger.

An accepted acknowledgement covers the selected target and selected descendants reached through explicit `parentId` links. The resulting edge retains the declaration, its documentation position, its semantic host identities, the exact target, and every selected unit covered by the scope. Repeating positive evidence on the same semantic host and exact target is a duplicate. Overlapping exclusions and opposite positive/exclusion intent each produce one finding for the later declaration, regardless of the number of descendants in the overlap. Positive evidence from different semantic hosts remains valid.

Cardinality policies count semantic identities rather than documentation positions. `uniqueEvidence` permits at most one distinct positive claim host for each selected reference unit. `singleEvidencePerSymbol` requires each selected claim host, including hosts with no tags, to cite exactly one distinct selected reference unit. Aggregate targets count every selected descendant, while exclusions contribute no positive host or unit count.

Supply applicable review target results in `reviewResolutions`. Review pairing uses acknowledgement kind, exact resolved target identity, and overlapping semantic host identity. This lets merged declaration positions review the same host while keeping unrelated declarations separate. A review at an unattached position falls back to its exact physical host. Duplicate reviews at one documentation position, orphan reviews, and reviews of the opposite acknowledgement kind receive distinct diagnostics. A real acknowledgement refused by another policy still prevents its review from being mislabeled as orphan; neither record enters coverage.

`requireReview` adds freshness checks to accepted acknowledgement edges. Each edge exposes the same seven-character value returned by `EvidenceFingerprint.inspect`. A missing review, a review without a fingerprint, and a stale fingerprint are mutually exclusive findings, and each repair names the current value. Review resolution that is incomplete makes the obligation incomplete and suppresses those derivative findings. Explicit resolved reviews are still audited for structural pairing when freshness is not required.

Fingerprint version 2 hashes each adapter-owned portable unit identity, artifact and symbol kinds, segmented semantic identity, normalized own content, retained withdrawal kinds, and every explicit descendant linked by `parentId`. File-scoped adapters retain a checkout-relative declaring path, while database adapters whose semantic identities span an ordered schema set remain stable when a declaration moves between those files. It removes registered annotations, normalizes CRLF and CR to LF, trims trailing horizontal whitespace, and ignores trailing blank lines. Filesystem device/inode identity, canonical link targets, absolute checkout roots, source offsets, and selected public aliases do not affect the result. Distinct configured source roots and distinct declaring paths remain distinguishable where their adapter identity includes them. Changing this contract requires another fingerprint-version increment; consumers then inspect the new value and re-review affected scopes rather than mechanically accepting the migration.

A Markdown `checklist` creates one obligation for every selected claim host and selected Markdown item. Positive evidence answers only the selected item it names. Exclusions retain descendant coverage for their own host. An unselected positive aggregate produces one direct diagnostic and records its selected descendants as explained, so the same host does not receive derivative missing-item diagnostics for that mistake. The obligation's `hostCoverage` retains each host's covered, missing, and explained units; its top-level covered units are those answered by every host. Configuration validation rejects checklists on other artifact kinds, incompatible cardinality options, and gathered exclusion carriers unless exclusions are disabled for that reference.

Incomplete claim, reference, or target analysis leaves its active obligation incomplete and suppresses derivative empty-population and missing-coverage findings. It also withholds a deferred unhosted-checklist finding when the failed obligation could have consumed that declaration. A healthy empty reference emits one population finding and does not create that uncertainty. `success` requires every active obligation to be complete and the deterministic diagnostic list to be empty.

## Documentation and tags

Identify real documentation through the artifact parser and establish its semantic host before reading tags. Pass known comment delimiters to `EvidenceDocumentation.read(content, hostId, range, syntax)`. JSDoc-style comments use their own delimiter and line prefix; Prisma documentation can use `///`; Markdown HTML comments have no foreign-tag field boundaries. The helper preserves a source map through prefix removal and CRLF normalization.

For decoded text such as Swagger operation descriptions, an adapter may supply `IEvidenceDocumentation` directly. Provide each UTF-16 code unit's original start in `offsets` and exclusive end in `ends`, followed by the final source boundary in `offsets`. Maps must remain ordered and within the host. These separate boundaries preserve gaps caused by decoration or encoded text.

`EvidenceTagParser.parse(content, host, documentation)` recognizes:

```text
@evidence <target> <reason>
@link <file>#<Accessor> <reason>
@evidenceExclude <target> <reason>
@evidenceReview <target> [#<fingerprint>] <description>
@evidenceExcludeReview <target> [#<fingerprint>] <description>
```

Markers begin a documentation line and end at a space, tab, or line boundary. Reasons and review descriptions can continue across lines. Fenced examples produce no tags. `tagBoundaries` controls whether another tool's line-start tag ends an acknowledgement; reviews always end at another tag. `allowWithdrawal` enables line-start `@internal`, `@hidden`, and `@ignore` in documentation positions where withdrawal is meaningful. Prose mentions do not withdraw declarations.

A review fingerprint is exactly seven lowercase hexadecimal characters after `#`. Other `#`-prefixed tokens followed by prose remain part of the description. Missing targets, blank prose, unsupported compiler inline links, and unsupported or unattached hosts produce actionable diagnostics. Ordinary evidence targets retain their authored token until the selected reference's resolver can apply its artifact grammar; explicit `@link` targets use the programming file-link grammar immediately. Retain valid declarations, reviews, and withdrawals in their separate inventory records. Review pairing and content freshness belong to graph evaluation, after target resolution.

Accessor examples include `Class.prototype.member`, `Namespace["member.with.dots"]`, and `Tuple[0]`. Quoted bracket segments use JSON strings; paths containing whitespace use percent encoding. Compiler import-scoped `{@link Symbol}` targets require migration to explicit file-qualified targets.

## Markdown inventories

`EvidenceMarkdownAdapter` materializes one file unit and each ATX H1-H4 section. Setext headings and H5/H6 do not form units. A deeper or unaddressable heading still opens a source region: its content belongs to the nearest real ancestor, while annotations in that region are unsupported until another H1-H4 host opens.

Prefer a valid trailing `{#anchor}`; otherwise derive the anchor from the heading by retaining Unicode letters, numbers, and underscores, removing punctuation, and collapsing whitespace or hyphens. Keep duplicate anchors as distinct identities with the same public address so resolution reports ambiguity. Every selected logical file alias contributes an address, but an alias containing whitespace contributes a diagnostic because the authored target grammar cannot represent it as one token.

HTML comments are the only Markdown documentation hosts. Register a real comment even when it has no Evidence Graph tag, attach it to the unit active on its opening line, and parse it with `tagBoundaries: false` and `allowWithdrawal: false`. Report a line-start tag rendered as ordinary prose, including list and quote forms. Ignore tag-shaped examples in fences, indented code, `<pre>` blocks, and MDX template code.

Partition a section's own content into original source ranges. Include heading lines, ordinary body text, deeper unsupported headings, and fenced examples. Exclude full HTML-comment lines; retain surrounding prose when a comment appears mid-line so later fingerprinting can remove only the registered comment span. Preserve the source snapshot's completeness and diagnostics before normalizing the inventory.

## TypeScript inventories

`EvidenceTypeScriptAdapter` parses `.ts`, `.mts`, `.cts`, and `.tsx` snapshots with the pinned TypeScript or TSX grammar acquired through the verified parser cache. It materializes exported interfaces, type aliases, classes, and namespaces as `type` units; object-shaped aliases also expose their members. Function and generator declarations are `function` units. A variable is a function only when a `const` identifier is initialized directly with a function value; mutable variables, typed declarations without such an initializer, and destructured leaves are properties.

Public class methods and directly written function fields are functions. Other public fields are properties. Static members use `Class.member`; instance members and parameter properties use `Class.prototype.member`. Interface members and object-type members use their containing type directly, except when an interface merges with a class and therefore joins the class instance side. Constructors, get/set and auto-accessors, private/protected members, computed names, index signatures, static blocks, and enums do not form units.

Compatible interface, class, and namespace declarations with the same TypeScript identity share one `type` unit. Exported namespace declarations contribute their own site and nested public declarations, so an interface `IShoppingSale` beside `namespace IShoppingSale { export interface ICreate { title: string } }` exposes `IShoppingSale`, `IShoppingSale.ICreate`, and `IShoppingSale.ICreate.title`. A function and namespace may merge in TypeScript, but Evidence Graph keeps the callable function unit and excludes that companion namespace's static body from the declared target grammar.

Local declaration identity remains separate from each exported address. The adapter follows direct exports, local aliases, defaults, imported bindings that are re-exported, named and star reexports, and namespace exports through relative source-snapshot paths. It recognizes `.js` to `.ts`/`.tsx`, `.mjs` to `.mts`, `.cjs` to `.cts`, and declaration-file substitutions. Explicit exports shadow star candidates; competing star candidates remain distinct so resolution can report ambiguity. Traversal terminates finite cycles, and a named export cycle that never reaches a declaration marks the inventory incomplete.

Named type-only exports and reexports retain only units available in type space, and that restriction travels through later value barrels. The pinned upstream grammar does not parse the TypeScript 5.0 `export type *` or `export type * as` spellings; encountering either produces a parse-incomplete diagnostic instead of a reduced population. Package exports, path aliases, ambient modules, global augmentations, UMD namespace exports, and CommonJS `export =` also remain explicit incomplete-analysis boundaries.

Only attached JSDoc is an eligible TypeScript documentation host. A variable statement can host all of its declarators, while a JSDoc block on an individual declarator belongs only to that declarator. Overloads and merged declarations share semantic identity and retain every declaration site. Withdrawal on any declaration hides the merged identity and its descendants. Tag-bearing line comments, ordinary block comments, detached JSDoc, local declarations, and excluded declaration forms produce unsupported-host findings instead of evidence edges.

## JavaScript inventories

Share the ECMAScript declaration, JSDoc, and ESM export model with TypeScript, but select the JavaScript grammar and emit `javascript` identities. Recognize `.mjs` as ESM and `.cjs` as CommonJS. Resolve `.js` and `.jsx` from the nearest `package.json` along the logical file path, defaulting to CommonJS when none exists. Record checked package paths as exact dependencies. Conflicting aliases or invalid metadata make the inventory incomplete.

Use the same `type`, `function`, and `property` classification for JavaScript classes, callable declarations, and values. Preserve static and prototype ownership, literal names, anonymous defaults, async and generator forms, and JSX bodies. Constructors, accessors, private fields, and computed members remain outside the unit set.

Run the shared static ESM resolver over direct exports, local and imported aliases, defaults, named and star reexports, namespace exports, shadowing, ambiguity, and cycles. JavaScript resolution accepts only JavaScript extensions and relative or absolute files already present in the snapshot.

For CommonJS, process unconditional top-level initialization in source order. Support direct static properties with local declaration values, static object replacement, and one local default replacement. Clear prior names and detach `exports` when `module.exports` is replaced; reconnect it only through `exports = module.exports`. Mark computed keys, control-flow changes, dynamic or inline replacement values, binding shadowing, and escaped aliases incomplete. Do not inspect deferred function or class bodies as module initialization.

Attach only JSDoc that immediately precedes a supported declaration. Retain unsupported tag-bearing comments as findings, and exclude all registered annotation ranges from semantic fingerprints. Literal and JSX tag examples never become comment hosts.

## Python inventories

`EvidencePythonAdapter` parses `.py` and `.pyi` snapshots with the pinned Python grammar acquired through the verified parser cache. It inventories the statically declared source surface and never imports or executes the analyzed application.

Classify supported declarations as follows:

| Source form | Symbol and address |
| --- | --- |
| Module class or explicit `type Alias = ...` / `Alias: TypeAlias = ...` | `type` at `Name` |
| Module `def` or `async def` | `function` at `name` |
| Simple module assignment | `property` at `name` |
| Nested class | `type` at `Owner.Nested` |
| Simple class assignment | `property` at `Owner.name` |
| `@staticmethod` or `@classmethod` method | `function` at `Owner.name` |
| Ordinary method | `function` at `Owner.prototype.name` |
| `@property`, `@cached_property`, getter, setter, or deleter method | `property` at `Owner.prototype.name` |
| Direct `receiver.name` assignment in `__init__` | `property` at `Owner.prototype.name` |

The constructor receiver is its first declared parameter; it need not be spelled `self`. Scan only assignments directly in the constructor body. A conditional or otherwise nested public receiver assignment makes analysis incomplete. Simple annotated and unannotated assignments are supported. Destructuring public bindings are not guessed. Stub overload declarations with the same identity retain all sites. A class-side and instance-side member with the same spelling remain distinct through the `prototype` segment.

Leading-underscore class members, constructors, and special methods do not form units. Module declarations are retained before export selection so a literal `__all__` can explicitly publish an underscored name. Local helpers nested inside functions never become module units. Decorators contribute to declaration fingerprints but are not executed; dataclass, descriptor, decorator, and metaclass generated members remain outside the declared-source guarantee.

Evaluate `__all__` in source order. Accept lists and tuples of ordinary or `u`-prefixed literal names without escapes or newlines, binary `+` composition of those sequences, and top-level `+=` with another supported sequence. A supported assignment replaces the previous value and `+=` appends. Any other assignment, method mutation, deletion, or conditional modification marks the inventory incomplete. Retain statically known names and the ordinary public declaration set after a dynamic mutation so an unresolved export cannot erase existing obligations.

Without `__all__`, publish supported module declarations and statically resolved import bindings whose local names do not start with `_`. An explicit `__all__` selects exactly its names. Resolve named aliases, namespace imports, and star imports through local source modules. A named import may reach a declaration that its defining module omits from its own `__all__`; a star import observes that module's public names. Imports never create units from captured identifiers by themselves.

Resolve relative imports from the importing file's package directory. Resolve absolute dotted imports from the configured population root. Recognize `.py`, `.pyi`, and `__init__.py`/`__init__.pyi` candidates already present in the snapshot, retain reexport identity, and terminate finite cycles. Missing, outside-root, ambiguous, declaration-free cyclic, and unresolved explicit exports make analysis incomplete. This bounded resolver does not model environment-dependent `sys.path`, installed packages, or `from . import submodule` fallback loading.

An actual class or function docstring is an eligible documentation carrier. A consecutive same-indent run of standalone `#` comments attaches only when it immediately precedes a supported declaration without a blank line; a run before a decorated definition attaches across the decorators. Property assignments can use the same adjacent-comment form, including the first class member and a directly declared constructor field. Determine adjacency from original source lines even when the grammar places a leading comment outside the declaration's body block. Module docstrings, assigned strings, other arbitrary string expressions, detached comments, trailing code comments, and comments on unpublished declarations remain unsupported annotation hosts. Register all parsed tag-bearing comments as annotation ranges, including unsupported carriers, so Evidence Graph metadata does not move semantic fingerprints or disappear without a finding.

Conditional module declarations/imports, conditional class declarations, dynamic `__all__`, and unresolved local imports are explicit incomplete-analysis boundaries. Dynamic module attributes, `globals()`, `getattr`, module `__getattr__`, decorators, and application initialization are never executed or used to fabricate units.

## Go inventories

`EvidenceGoAdapter` parses `.go` snapshots with the pinned Go grammar acquired through the verified parser cache and groups physical files by directory and package. It inventories the selected declared source without invoking the Go toolchain.

Classify supported declarations as follows:

| Source form                                  | Symbol and address         |
| -------------------------------------------- | -------------------------- |
| Exported defined type or type alias          | `type` at `Name`           |
| Exported package function                    | `function` at `Name`       |
| Exported receiver method or interface method | `function` at `Owner.Name` |
| Exported package constant or variable        | `property` at `Name`       |
| Exported named or embedded struct field      | `property` at `Owner.Name` |

Apply Go's Unicode uppercase rule to the first rune of every published name. Retain generic defined types, grouped declarations, pointer and value receivers, multiple-name specifications, and direct named, pointer, qualified, or generic embedded fields. A type alias to an explicitly written anonymous struct or interface owns those declared members. An embedded field forms its own property unit; do not synthesize promoted members. Embedded interface elements do not form units.

Resolve a receiver against a selected local defined type in the same directory and package. A method has one semantic identity and publishes addresses through both its declaration file and every selected declaration file for its owner type. Missing receiver types and alias-only method receivers make analysis incomplete. Package functions, values, types, and fields publish addresses through their declaration files.

Treat the configured files as the exact source set. Do not evaluate `//go:build`, legacy build tags, `GOOS`, `GOARCH`, or filename platform suffixes. If selected alternatives declare the same identity, retain their sites and mark the inventory incomplete. Include selected `_test.go` files; keep an ordinary package, its same-package tests, and the matching external `_test` package under their distinct package identities. Incompatible package clauses in one directory are incomplete.

Attach consecutive same-column standalone `//` comments and block comments only when they immediately precede a supported declaration without a blank line. A trailing code comment never joins a following standalone run or documents the next declaration. A comment before a grouped declaration attaches to every supported specification in that group; a specification or member comment attaches only to that declaration. Detached comments, function-body comments and commented-out declarations are unsupported annotation hosts. Interpreted and raw strings are data and create no annotations or fingerprint exclusions. Register accepted documentation and tag-bearing unsupported carriers as annotation ranges so Evidence Graph metadata does not move semantic fingerprints.

Do not run generators or import external package declarations. Generated declarations participate only when their `.go` source is already present in the selected snapshot. Unreadable ownership, duplicate selected declarations, incompatible packages, and parser failures must leave the inventory incomplete instead of reducing its public population.

## Rust inventories

`EvidenceRustAdapter` parses `.rs` snapshots with the pinned Rust grammar acquired through the verified parser cache. It constructs a static crate and module graph from the selected source and never invokes Cargo, rustc, build scripts, or application macros.

Classify supported declarations as follows:

| Source form | Symbol and address |
| --- | --- |
| Public module, struct, enum, trait, or type alias | `type` at its module path and name |
| Public free function | `function` at its module path and name |
| Public named or tuple struct field | `property` at `Owner.name` or `Owner[0]` |
| Enum variant | `property` at `Enum.Variant` |
| Trait method or inherent public method | `function` at `Owner.name` |
| Trait or trait-impl associated constant | `property` below its owner or qualified impl |
| Trait associated type or trait-impl realization | `type` below its owner or qualified impl |
| Public constant or static | `property` at its module path and name |

Treat unrestricted `pub` as externally visible and exclude `pub(crate)`, `pub(super)`, `pub(self)`, `pub(in ...)`, and private declarations from the default public population. Trait items and enum variants inherit their public owner's reachability. Named struct fields retain their own visibility; tuple fields use zero-based numeric accessor segments. An owner must itself be reachable before its fields or associated items can form public units.

Resolve inline modules and conventional file modules through `name.rs` or `name/mod.rs`. A selected file not claimed by another selected module starts an independent crate root. Follow named, aliased, grouped, and wildcard `pub use` paths through selected modules to a fixed point. A private module can carry a public declaration reexported from the crate root. Every alias publishes another address for the originating unit; it does not create another semantic identity. Missing or dual module files, multiple owners, unresolved exports, ambiguous names, and recursive module aliases make the inventory incomplete. `#[path]` remains unsupported.

Associate impl blocks only with one selected local struct or enum. Inherent public members use `Owner.member`. Trait impl members use a literal qualifier segment such as `Owner["impl crate::Trait"].member`, preserving a distinct address when an inherent member has the same name. A selected local trait must also be publicly reachable before its implementation members become units. An explicitly external trait path can qualify members of a local owner, but generic blanket impls, unresolved explicitly local traits, and external nominal owners make analysis incomplete.

Attach outer `///` and `/** */` documentation to the following supported declaration. Attach inner `//!` and `/*! */` documentation to its inline or file-backed module. Accept static outer or inner `#[doc = "..."]` strings with the same ownership rules. Rustdoc controls such as `#[doc(hidden)]` and `#[doc(alias = "...")]` do not become hosts; a nonstatic `#[doc = ...]` value makes documentation analysis incomplete. Ordinary comments between outer attributes and declarations act as whitespace without becoming eligible documentation. Keep those attributes visible to completeness checks, and never count comments as tuple fields or let them consume field visibility. Attributes remain part of the declaration site and semantic fingerprint while recognized annotation ranges are removed. Ordinary comments, body comments, strings, raw strings, and commented-out declarations are unsupported annotation hosts.

The adapter inventories explicit selected source rather than the feature-resolved compiled crate. Report `cfg` and `cfg_attr`, item-position macro invocations, exported macros, and unrecognized expansion attributes as incomplete because they can change the public declaration set. Ignore expression macros contained within a supported function body for declaration completeness. Generated declarations participate only when their expanded `.rs` source is selected directly.

## Java inventories

`EvidenceJavaAdapter` parses `.java` snapshots with the pinned `tree-sitter-java` v0.23.5 grammar acquired through the verified parser cache. It inventories the declared source-public surface without invoking `javac`, a build tool, application code, or annotation processors.

Classify supported declarations as follows:

| Source form | Symbol and address |
| --- | --- |
| Public class, interface, enum, annotation, or record | `type` at `TopLevel` |
| Publicly reachable nested type | `type` at `Owner.Nested` |
| Public class, record, or enum method | `function` at `Owner.name` |
| Non-private interface method, including default and static methods | `function` at `Owner.name` |
| Public field | `property` at `Owner.name` |
| Interface constant | `property` at `Owner.name` |
| Record component | `property` at `Record.name` |
| Enum constant | `property` at `Enum.NAME` |
| Annotation element | `property` at `Annotation.name` |

Require an explicit `public` modifier on top-level types. A nested declaration must have a public enclosing type; members of interfaces and annotations use Java's implicit public visibility unless declared private, while class-like nested declarations and class, record, or enum members require explicit public visibility. Constructors, compact constructors, initializers, package-private members, protected members, private members, and local declarations do not form units. Compiler-generated record accessors and enum methods, inherited members, and imported declarations remain outside the selected source surface.

Include the package and every nested owner in semantic identity. Public addresses omit the package because the target file already selects the compilation unit: `src/com/example/Sale.java#Sale`, `#Sale.total`, and `#Sale.Metadata.label` address identities such as `com.example.Sale.total`. Every logical address of one selected physical file publishes the same units. Java imports do not create aliases or exports.

Group methods by package, owner, and method name. Every overload contributes a declaration site to one `function` unit, so `Sale.java#Sale.calculate` covers the complete overload family. Constructors remain excluded even when their spelling matches the owning type. A field and method may legally share one accessor spelling; selecting one symbol kind disambiguates that target, while selecting both makes the target ambiguous. A duplicate non-method identity makes analysis incomplete.

Attach only a Javadoc block immediately preceding a supported declaration. Modifiers and annotations belong to the declaration and do not break attachment. One Javadoc block on a multi-variable field declaration hosts every public variable from that source site; Javadoc on each overload hosts the shared overload family at that declaration site. Withdrawal on any overload hides the merged family, and withdrawal on a type hides its descendants.

Mask `{@code ...}`, `{@literal ...}`, `{@snippet ...}`, `<code>...</code>`, and `<pre>...</pre>` regions before parsing tags so documentation examples cannot create graph statements. Retain tag-bearing ordinary comments, strings, text blocks, and Javadoc attached only to unpublished declarations as unsupported hosts. Register every recognized carrier range so Evidence Graph metadata does not move semantic fingerprints.

Apply source visibility independently of Java Platform Module System exports. A selected `module-info.java` contributes no units and does not restrict public packages. Do not execute annotation processors; a generated declaration participates only when its `.java` file is selected explicitly. Syntax errors, unreadable selected sources, and conflicting identities leave the inventory incomplete rather than reducing the public denominator.

## C# inventories

`EvidenceCSharpAdapter` parses `.cs` snapshots with the pinned `tree-sitter-c-sharp` v0.23.5 grammar acquired through the verified parser cache. It inventories explicit source declarations without invoking the .NET SDK, loading assemblies, executing source generators, or running application code.

Classify supported declarations as follows:

| Source form | Symbol and address |
| --- | --- |
| Public class, struct, interface, record, enum, or delegate | `type` at `Namespace.Type` |
| Publicly reachable nested type | `type` at `Namespace.Owner.Nested` |
| Public method | `function` at `Namespace.Owner.name` |
| Public field, property, or event | `property` at `Namespace.Owner.name` |
| Enum member | `property` at `Namespace.Enum.Name` |
| Indexer | `property` at `Namespace.Owner["this[]"]` |
| Operator | `function` at a literal segment such as `Namespace.Owner["operator +"]` |
| Conversion operator | `function` at a source-spelled segment such as `Namespace.Owner["implicit operator int"]` |

Apply accessibility after partial type declarations are grouped. A top-level type or a type nested in a class or struct must have `public` accessibility, and each containing type must also be public. A type nested in an interface is public when it omits an accessibility modifier. A partial type may declare accessibility on one part; conflicting explicit accessibilities make the inventory incomplete. Interface methods, fields, properties, indexers, events, operators, constants, and nested types are public when they omit an accessibility modifier, including members with implementations. Exclude `internal`, `file`, `private`, `protected`, `protected internal`, and `private protected` declarations from the external population.

Include block and file-scoped namespaces and nested owners in both semantic identity and public address. A target therefore uses `Sale.cs#Shop.Sale.Total`, even when the file already sits below a `Shop` directory. Static and instance members share the declared-owner address model. Constructors and explicit interface implementations do not create units. The public interface declaration supplies the contract for an explicit implementation; the implementing class does not gain an independently callable public member.

Encode generic type arity in its exact identity segment: `Box<T>` uses ``Box`1``, formatted as ``Shop["Box`1"]``. Also publish the source name `Shop.Box` as a convenient alias. One generic arity can own the alias; multiple generic arities make it ambiguous, and a selected nongeneric `Box` takes precedence over generic aliases. Exact arity addresses remain distinct. Group methods by owner and source name, so generic and non-generic method overloads contribute sites to one name-addressed function family. Group indexer and operator overloads by their documented literal segment. Conversion operator segments retain the normalized source spelling of their destination type because the adapter performs no compiler type resolution.

Treat one configured source snapshot as one logical C# compilation boundary. Include its normalized root display in unit IDs without adding it to author-facing identities or target segments. Compatible partial classes, structs, interfaces, and records share one unit with every declaration site. C# 13 partial properties and indexers also retain both declaring and implementing sites. A withdrawal on any part hides the merged unit; withdrawing a type hides its descendants. Duplicate non-partial types, incompatible partial forms or owners, and conflicting public member identities make analysis incomplete. Configure unrelated projects with separate roots so matching namespace and type names cannot merge.

Attach consecutive same-indent `///` comments or an immediately preceding `/** */` XML documentation block to the following supported declaration. Attributes belong to the declaration and do not break attachment. One comment on a multi-variable field or event declaration hosts every public variable at that site. Mask `<c>`, `<code>`, `<example>`, and `<pre>` elements before parsing graph tags; XML wrapper lines such as `<summary>` remain available around tag lines. Retain tag-bearing ordinary comments and XML documentation on unpublished declarations as unsupported hosts. Ordinary, verbatim, raw and interpolated strings are data and create no annotations.

Report declaration-position preprocessor conditionals as incomplete because Tree-sitter identifies both syntax branches but cannot choose build symbols. Generated declarations participate only when their `.cs` files are selected explicitly. Positional record properties, delegate `Invoke`, inherited declarations, and other compiler-synthesized members remain outside the explicit source surface. Syntax errors and unreadable selected sources also preserve an incomplete inventory instead of silently shrinking the denominator.

The classification follows the C# reference for [accessibility levels](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/accessibility-levels), [interface members](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/interface), [XML documentation formats](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/xmldoc/), and [partial properties and indexers](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-13.0/partial-properties). Syntax support comes from the pinned [tree-sitter-c-sharp](https://github.com/tree-sitter/tree-sitter-c-sharp) release.

## C inventories

`EvidenceCAdapter` parses `.c` and `.h` snapshots with the pinned `tree-sitter-c` v0.24.2 grammar acquired through the verified parser cache. It inventories explicit declarations without invoking a preprocessor, compiler, build system, linker, application, or native toolchain.

Classify supported declarations as follows:

| Source form | Symbol and address |
| --- | --- |
| Named struct, union, or enum tag | `type` at a literal segment such as `["struct Sale"]` |
| Direct typedef of a named or anonymous tag | An additional canonical address for the same `type` unit |
| Other typedef | `type` at its ordinary identifier |
| Non-static function declaration or definition | `function` at its ordinary identifier |
| Non-static external object declaration, tentative definition, or definition | `property` at its ordinary identifier |
| Named struct or union field | `property` below its aggregate type |
| Enumerator of a named or directly typedef-named enum | `property` below its enum type |

Treat every selected physical file as an independent declaration boundary. Merge compatible forward declarations, prototypes, tentative definitions, and definitions by symbol and identity only inside that file, retaining every declaration site. Permit at most one explicit aggregate, enum, or function definition in a family. Keep the same spelling in a header and implementation file as separate units, even when an include would place both in one preprocessed translation unit. This prevents unrelated translation units from merging when the adapter has no compile command, include search path, macro environment, or linker export map.

Follow the declarator path from the declared name outward. The innermost effective function wrapper makes `int add(int)` and `int *make(void)` functions; an intervening pointer or array makes `int (*callback)(int)` and `int (*callbacks[2])(int)` objects. Apply the same structural rule through parentheses, qualifiers, attributes, initializers, and multi-declarator statements. Exclude file-scope `static` functions and objects. Do not inventory locals or function-body declarations.

C's tag namespace supplies exact identities such as `struct Sale`, `union Payload`, and `enum State`. Publish the exact tag segment and a convenient source-name alias. A direct typedef alias is canonical and belongs to the same semantic unit as its tag; other typedef declarators establish their own type units. Suppress a tag's convenient alias and all addresses below it when a canonical ordinary declaration owns that prefix. The exact tag address remains available. This allows `Sale.h#["struct Sale"].total` in every case and `Sale.h#Sale.total` when the source spelling is safe.

An anonymous struct, union, or enum forms a type unit only when one or more direct typedef declarators name it. Multiple direct aliases address the same anonymous type. An anonymous struct or union member without its own declarator promotes its explicit fields into the containing aggregate. A field that names an anonymous aggregate remains one field unit; its nested representation does not invent separately addressable members. Anonymous enums without a direct typedef remain outside the unit set.

Attach consecutive leading `///` or `//!` comments, leading `/** */` or `/*! */` blocks, and same-line trailing `///<`, `//!<`, `/**< */`, or `/*!< */` Doxygen to the supported declaration. One carrier on a multi-declarator statement hosts every unit at that site. Mask Doxygen `@code` or `\code` blocks and HTML `code` or `pre` elements before parsing tags. Retain tag-bearing ordinary comments, function-body comments, detached Doxygen and Doxygen attached only to excluded declarations as unsupported hosts. Strings are data and create no annotations. Withdrawal on a type hides its declared fields and enumerators.

Do not follow `#include` directives; every selected file is analyzed once, so include cycles cannot recurse. Unwrap a conventional whole-file `#ifndef NAME` and matching `#define NAME` include guard, and ignore `#pragma once`, `#line`, and `#undef` because these forms do not select declarations in the physical-file model. Macro definitions alone contribute no units. Report other conditional preprocessing, declaration-position macro invocations, and declaration-affecting directives such as packing pragmas as incomplete. Generated or preprocessed source participates when selected explicitly. Syntax errors, conflicting tag kinds, incompatible same-name declarations, and multiple definitions also leave the inventory incomplete.

The declaration model follows the [C declarator grammar](https://github.com/tree-sitter/tree-sitter-c/tree/v0.24.2) and [Doxygen documentation block forms](https://www.doxygen.nl/manual/docblocks.html) supported by the pinned syntax tree.

## C++ inventories

`EvidenceCppAdapter` parses `.cpp`, `.cc`, `.cxx`, `.c++`, `.C`, `.h`, `.hpp`, `.hh`, `.hxx`, `.h++`, `.H`, `.ipp`, `.tpp`, `.ixx`, `.cppm`, `.ccm`, `.cxxm`, and `.c++m` snapshots with the pinned `tree-sitter-cpp` v0.23.4 grammar acquired through the verified parser cache. It inventories explicit declarations without invoking a preprocessor, compiler, build system, template instantiator, module resolver, linker, application, or native toolchain.

Classify supported declarations as follows:

| Source form | Symbol and address |
| --- | --- |
| Named namespace, class, struct, union, or enum | `type` at its qualified source name |
| Alias declaration, typedef, or concept | `type` below its namespace or public owner |
| Free function or public member function | `function` at its qualified source name |
| Constructor or destructor | `function` below its owner at `constructor` or `destructor` |
| Operator or conversion function | `function` at a literal segment such as `["operator +"]` or `["operator bool"]` |
| External variable | `property` at its qualified source name |
| Public field or static data member | `property` below its owner |
| Enumerator | `property` below its named enum, or below the containing type for an anonymous member enum |

Include namespaces and nested owners in semantic identity and public addresses. Encode every declared template entity's arity in its identity segment: `Box<T>` uses ``Box`1``, formatted as ``shop["Box`1"]``. Function overloads with one owner and source name form one unit with every declaration and definition site. Constructor, destructor, operator, and conversion segments remain separate from ordinary method names; a spelling collision makes analysis incomplete. Template specializations, partial specializations, and explicit instantiations have no common primary-template address and therefore leave analysis incomplete.

Treat the configured snapshot as one C++ declared-source boundary. Merge compatible namespace openings, forward declarations, class declarations and definitions, function overloads, and qualified out-of-class definitions by symbol and fully qualified identity across selected files. A static data member's in-class declaration and qualified definition share one unit. A qualified class member definition needs a selected public declaration that establishes its owner and access. Namespace-level qualified definitions may use a selected public namespace owner. Mixed public and inaccessible overloads with qualified definitions require signature-aware matching and leave the inventory incomplete. Conflicting declaration forms and duplicate non-callable definitions do the same.

Apply access through the complete owner chain. Class members default to private; struct and union members default to public. Exclude private and protected members, every declaration below a non-public owner, anonymous-namespace declarations, namespace-scope `static` declarations, and namespace-scope plain `const` or `constexpr` objects without `extern` or `inline`. Do not project inherited members or friend-introduced namespace declarations. Inheritance and friends make the inventory incomplete because their externally reachable surface requires semantic lookup.

Resolve a `using` declaration or namespace alias only when its explicit target matches exactly one selected public unit. The alias adds its source-spelled address to that unit and its descendants without changing semantic identity. Missing, ambiguous, specialized, and using-directive targets make analysis incomplete. Includes are not followed, and modules receive no export interpretation.

Attach consecutive leading `///` or `//!` comments, leading `/** */` or `/*! */` blocks, and same-line trailing `///<`, `//!<`, `/**< */`, or `/*!< */` Doxygen to the supported declaration. Documentation on a template attaches across the template wrapper, and one carrier on a multi-declarator statement hosts every public unit at that site. Mask Doxygen `@code` or `\code` blocks and HTML `code` or `pre` elements before parsing tags. Retain tag-bearing ordinary comments, function-body comments, detached Doxygen and Doxygen attached only to unpublished declarations as unsupported hosts. Ordinary and raw strings are data and create no annotations. Withdrawal on any declaration hides its merged unit; withdrawing a type or namespace hides its descendants.

Unwrap a conventional whole-file `#ifndef NAME` and matching `#define NAME` include guard, and ignore includes, macro definitions, `#pragma once`, `#line`, `#undef`, and static assertions when they do not choose declarations. Other conditional preprocessing, declaration-position macro invocations, declaration-affecting directives, unreadable qualified owners, unsupported declaration forms, and syntax errors leave the inventory incomplete. Generated or preprocessed source participates when selected explicitly.

The declaration model follows the pinned [tree-sitter-cpp](https://github.com/tree-sitter/tree-sitter-cpp/tree/v0.23.4) syntax and the [Doxygen documentation block forms](https://www.doxygen.nl/manual/docblocks.html) recognized by the scanner.

## Ruby inventories

`EvidenceRubyAdapter` parses `.rb`, `.rake`, and `.gemspec` snapshots, plus `Gemfile` and `Rakefile`, with the pinned `tree-sitter-ruby` v0.23.1 grammar acquired through the verified parser cache. It inventories explicit declarations without starting Ruby, loading the application, or choosing runtime file order.

Classify supported declarations as follows:

| Source form | Symbol and address |
| --- | --- |
| Named class or module | `type` at its constant path |
| Public instance method or bounded alias | `function` directly below its class or module |
| Public singleton method | `function` below the explicit `self` segment |
| Public constant assignment | `property` at its constant path |
| Literal `attr_reader`, `attr_writer`, or `attr_accessor` name | `property` below its class or module, or below `self` in a singleton class |

An ordinary method on `Shop::Sale` uses `Shop.Sale.total`; `def self.find` and an ordinary `def find` inside `class << self` use `Shop.Sale.self.find`. Preserve setters, predicates, bang methods, and operators as literal method-name segments, using bracket notation when punctuation requires it. One attribute property retains separate reader and writer declaration capabilities. If a method, attribute, constant, or container would own the same public file address as another unit, report the ambiguity and keep the inventory incomplete.

Apply lexical `public`, `private`, and `protected` defaults to subsequent supported methods and attributes. Support literal named visibility calls, including `private_class_method`, `public_class_method`, `private_constant`, and `public_constant`, when they identify a prior declaration in the same selected file. A bare visibility directive ends bare `module_function` mode. In a module, `module_function` with literal names or subsequent method definitions makes the instance copy private and publishes a singleton copy. Exclude top-level methods and declarations reachable only through a private constant owner.

Merge compatible class and module reopenings by constant path across the selected snapshot and retain every site. Permit an explicit superclass on one reopening and compatible omissions elsewhere. A class/module kind mismatch or conflicting explicit superclass leaves analysis incomplete. A repeated method, constant assignment, attribute capability, alias destination, or module-function copy is a runtime replacement rather than an overload and retains its sites under an incomplete unit. Qualified containers and singleton declarations require a selected explicit owner.

Resolve `alias` and literal `alias_method` only against one prior method in the same selected file and owner side. Do not infer inherited alias targets or choose between competing definitions. Inherited members remain outside the explicit declared-source population. Detect direct `define_method`, `define_singleton_method`, `class_eval`, `module_eval`, `include`, `prepend`, `extend`, refinements, constant mutation calls, method removal, generated class or module constants, and conditional surface declarations as incomplete. Arbitrary application DSL calls and indirect reflection require a future capability decision.

Attach a consecutive same-indent `#` run or adjacent embedded `=begin`/`=end` RDoc to the following supported declaration without crossing a blank line. Embedded RDoc starts at column zero and may document an indented declaration; only hash-comment runs require matching indentation. One comment on a multi-name attribute declaration hosts every resulting property. Retain tag-bearing detached comments, method-body comments, strings, heredocs, and documentation attached only to unpublished declarations as unsupported hosts. Withdrawal on any reopening hides the merged unit; withdrawing a class or module hides its descendants.

The declaration and visibility model follows the [Ruby module and class syntax](https://ruby-doc.org/3.4.1/syntax/modules_and_classes_rdoc.html), [Module visibility and module-function behavior](https://ruby-doc.org/3.4.1/Module.html), and the pinned [tree-sitter-ruby](https://github.com/tree-sitter/tree-sitter-ruby/tree/v0.23.1) syntax.

## Prisma inventories

`EvidencePrismaAdapter` parses all selected physical files as one schema with `@prisma/prisma-schema-wasm`. Prefer a parser resolvable from the project root, then use the package's pinned fallback. Deduplicate physical sources before parsing and retain every logical address on the resulting source snapshot. A rejected schema makes the inventory incomplete and produces no guessed units.

Use the parser's `models` collection as the denominator. Materialize models and views as `model`, non-object fields as `column`, and object fields as `relation`; this includes relation back-references without a local `@relation` attribute. Enums, composite types, indexes, generators, and datasources remain outside the unit set. The position scanner may attach source sites to parser-established identities, but a missed position must retain the unit with a file-level fallback.

Assign each unit the canonical digest of its parsed declaration without documentation. Exclude fields from a model's own digest because each field is a child unit; the model scope fingerprint composes those children. The whole ordered schema set has a separate content digest for parser-result caching.

Attach `///`, plain block, and JSDoc-style block documentation to the next Prisma declaration. A top-level blank line detaches a run; a blank line inside a model does not. Ordinary `//`, comments above block attributes or closing braces, extra leading slashes, and comments on unsupported declaration kinds produce diagnostics. An unattached top-level `///` run is an exclusion-only carrier, including in explicitly selected files with nonstandard extensions. Withdrawal on a model hides its descendants.
