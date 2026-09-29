# `@wrtnlabs/evidence`

![Evidence Graph: make every SKILL instruction 100% enforced](https://raw.githubusercontent.com/wrtnlabs/evidence/master/assets/og.jpg)

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/wrtnlabs/evidence/blob/master/LICENSE) [![npm version](https://img.shields.io/npm/v/@wrtnlabs/evidence.svg)](https://www.npmjs.com/package/@wrtnlabs/evidence) [![npm downloads](https://img.shields.io/npm/dm/@wrtnlabs/evidence.svg)](https://www.npmjs.com/package/@wrtnlabs/evidence) [![build](https://github.com/wrtnlabs/evidence/actions/workflows/build.yml/badge.svg)](https://github.com/wrtnlabs/evidence/actions/workflows/build.yml) [![test](https://github.com/wrtnlabs/evidence/actions/workflows/test.yml/badge.svg)](https://github.com/wrtnlabs/evidence/actions/workflows/test.yml)

Every rule, requirement, schema, and API becomes an obligation the check enforces.

- **100% coverage** of every requirement.
- **100% compliance** with every principle.
- **20+ languages**, plus Markdown and Swagger.

Modern AI already writes code, documents, and fiction well. The remaining bottleneck is not creation but adherence: an agent can understand a specification, ignore one constraint, and still declare the work complete ([_The Compliance Gap_](https://arxiv.org/abs/2605.01771)).

Evidence makes the agent account for every instruction where the work is done, stating how the output satisfies it or why it does not apply. That single obligation turns compliance from a promise into a complete, reviewable graph.

```tsx
/**
 * @evidence docs/discount.md#coupon-stacking States the per-issuer stacking limit this section defines, in the buyer's words.
 * @evidence POST:/orders/{orderId}/coupons Explains the rejection this endpoint returns for an over-stacked coupon set.
 * @evidence ../hooks/useCouponStacking.ts#useCouponStacking Renders the limit this hook resolves.
 * @evidence .agents/skills/principles/SKILL.md#no-hard-coding Renders limits from props instead of branching on known issuer names.
 * @evidenceExclude .agents/skills/principles/SKILL.md#fix-root-causes No failure path exists in a pure renderer.
 */
export function CouponStackingNotice(props: IProps): JSX.Element;
```

`@evidence <target> <reason>` says that the declaration covers the target and explains why. `@evidenceExclude <target> <reason>` records why the target does not apply.

Leave one obligation unanswered and the check stops:

```bash
$ npx evidence
Evidence check complete.
Coverage: 4/5 units covered, 1 missing.

Missing acknowledgement:
  src/hooks/useCouponStacking.ts#useCouponStacking
```

The error list is the task list. The checker verifies that every required connection has an answer; reviewers judge whether each reason is true.

## 1. Spec-driven development

### 1.1. Getting started

```bash
npm install -D typescript ttsc @wrtnlabs/evidence
npx evidence init
npx evidence
```

`typescript` and [`ttsc`](https://github.com/samchon/ttsc) are peer dependencies. `ttsc` supplies `ttsx`, which evaluates `evidence.config.ts` without a project `tsconfig.json`. Grammars download on first use. Replace the generated configuration as shown next.

### 1.2. Start with principles

Start with the rules already written in `AGENTS.md`, `CLAUDE.md`, or a skill file:

```markdown
## No hard coding {#no-hard-coding}
## Fix causes, not symptoms {#fix-root-causes}
## Do not build it before you need it {#yagni}
```

Replace the starter `evidence.config.ts` with one claim:

```ts
import type { IEvidenceConfig } from "@wrtnlabs/evidence";

export default {
  claims: [
    {
      name: "every function answers every engineering principle",
      type: "typescript",
      files: ["src/**/*.ts"],
      symbol: "function",
      reference: {
        type: "markdown",
        files: [".agents/skills/principles/SKILL.md"],
        symbol: "h2",
        checklist: true,
      },
    },
  ],
} satisfies IEvidenceConfig;
```

A **claim** selects what must cite: every function under `src`. Its **reference** selects what must be cited: every H2 in the skill file. `checklist` makes every selected function answer every selected heading.

The first run turns every missing function-heading answer into an error. On an existing repository, that can be hundreds of errors: the real distance between the rule file and the code. Do not pay it down by hand. Put the loop in `AGENTS.md` so the agent works through the list:

```markdown
## Evidence

Run `npx evidence` before finishing any task. Every error names an obligation and its repair.
Do the work first, then write the `@evidence` line on the declaration that supplies it, stating why in one sentence.
Never write a tag to silence an error. Never weaken `evidence.config.ts` to pass.
Use `npx evidence list` to find an address and `npx evidence inspect '<target>'` to see why one does not resolve.
```

The agent works through the list, fixing code wherever an honest answer cannot be written, and the check goes green:

```bash
$ npx evidence
Evidence check complete.
Coverage: 3/3 units covered, 0 missing.
```

Run the same command in CI; exit 1 means a violation, and exit 2 means incomplete analysis.

### 1.3. Ground code in requirements

Evidence links addresses across artifact types, so anything with an address can join the graph.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://ttsc.dev/evidence/documents-dark.svg">
  <img alt="Idea notes grounding Requirements and Specifications, which ground Implementation and Test" src="https://ttsc.dev/evidence/documents-light.svg">
</picture>

Each arrow is one claim. Requirements cite idea notes, so a dropped idea is caught before code exists. Tests cite requirements and implementation, so an untested feature never passes.

Whichever layer a human reviews last is the source of truth. The agent writes everything below it.

Two claims draw the bottom of the graph:

```ts
import type { IEvidenceConfig } from "@wrtnlabs/evidence";

export default {
  claims: [
    {
      name: "implementation",
      type: "typescript",
      files: ["src/**/*.ts"],
      symbol: "function",
      reference: { type: "markdown", files: ["docs/requirements.md"], symbol: "h2" },
    },
    {
      name: "tests",
      type: "typescript",
      files: ["test/**/*.ts"],
      symbol: "function",
      reference: {
        type: "typescript",
        files: ["src/**/*.ts"],
        symbol: "function",
        noEvidenceExclude: true,
      },
    },
  ],
} satisfies IEvidenceConfig;
```

Every requirement must be cited by a function under `src`. Every function under `src` must be cited by a test, with no exclusions. Start with one requirement:

```md
## Exact addition {#exact-addition}

Add prices without intermediate rounding.
```

With `add` and `test_add` still untagged, the first check reports two missing citations: `add` must cite the requirement, and `test_add` must cite `add`.

Add the reasons where the work is done. Markdown targets resolve from the reference root, which defaults to the config directory; programming targets resolve from the citing file:

```ts
/** @evidence docs/requirements.md#exact-addition Implements exact addition without intermediate rounding. */
export function add(left: number, right: number): number {
  return left + right;
}
```

```ts
/** @evidence ../src/calculator.ts#add Verifies exact addition through the public function. */
export function test_add(): void {
  if (add(1, 2) !== 3) throw new Error("Unexpected sum.");
}
```

```bash
$ npx evidence
Evidence check complete.
Coverage: 2/2 units covered, 0 missing.
```

One layer up, Markdown cites Markdown in HTML comments, so the rendered document stays clean:

```md
## Coupon stacking {#coupon-stacking}

<!-- @evidence ideas/2026-03-checkout.md#stacking-limit Turns the note's per-issuer idea into a testable limit. -->

A buyer may apply at most one coupon per issuer to one order.
```

### 1.4. Backend

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://ttsc.dev/evidence/backend-dark.svg">
  <img alt="Requirements and Specifications grounding DB schema, API operation, API schema and Test" src="https://ttsc.dev/evidence/backend-light.svg">
</picture>

The schema, API, and tests form one graph:

- Database models cite the documents behind them.
- API operations cite the models and documents they expose.
- Tests cite every operation, with no exclusions.

The citations stay native to each artifact: a Prisma `///` comment cites Markdown, a Swagger `description` cites `prisma:Order`, and a test cites `POST:/orders/{orderId}/coupons`.

### 1.5. Frontend

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://ttsc.dev/evidence/frontend-dark.svg">
  <img alt="Requirements and Specifications grounding Swagger, Hooks, Screens and Journeys" src="https://ttsc.dev/evidence/frontend-light.svg">
</picture>

A frontend graph can begin with a Swagger document published by another project:

- Hooks cite the operations they call.
- Screens cite the hooks they render.
- Journeys cite the screens they traverse.

"The API is wired up but there is no screen yet" stops being a green check.

### 1.6. Novels

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://ttsc.dev/evidence/novel-dark.svg">
  <img alt="Principles and Settings grounding Treatments, Scripts and Prose" src="https://ttsc.dev/evidence/novel-light.svg">
</picture>

The same graph governs prose. Every layer cites its principles and settings; scripts and prose cite treatments; prose cites the script it executes.

Editing a setting expires every review on it, so a revision leaves no stale scene behind.

## 2. Benchmark

![Coverage and token spend across all four subjects](https://raw.githubusercontent.com/samchon/ttsc/gh-pages/benchmark/png/evidence-summary.png)

Measured upstream on `@ttsc/evidence`, which shares this package's graph semantics: one agent built four applications twice with the same engine and model. Only the graph differed.

- **Plain:** coverage landed between 51.6% and 85.5%, while the repeated review loop consumed about 90% of all tokens.
- **Evidence:** every application reached 100%, and review judged the explicit tag list in one pass.

The [benchmark guide](https://ttsc.dev/docs/benchmark/evidence) breaks each run down by phase, and [`samchon/evidence-benchmark-results`](https://github.com/samchon/evidence-benchmark-results) keeps the raw sessions.

The walkthrough above is enough to start. Everything below is the reference.

## 3. Graph rules

A **claim** selects the hosts that must cite. Each **reference** selects the units those hosts must cover. Every claim/reference pair is an independent obligation: references never pool coverage, and a claim `name` only labels diagnostics.

A **unit** is one declaration, even when several public addresses expose it. A function exported from its own file and from a barrel remains one unit with two addresses.

### 3.1. Coverage

- `@evidence` covers its target and the target's selected descendants: a class covers its methods, a file its sections, a model its columns.
- `@evidenceExclude` covers the same way while recording that the target does not apply. The two cannot overlap in one obligation.
- `noEvidenceExclude` refuses exclusions.
- `uniqueEvidence` allows at most one positive host per unit.
- `singleEvidencePerSymbol` requires every host, tagged or not, to cite exactly one unit.
- `evidenceExcludeCarriers` limits which claim files may carry exclusions.
- `checklist` (Markdown references) requires every host to answer every selected heading; `@evidenceExclude docs/rules.md <reason>` excuses one host from the whole file. It cannot combine with `uniqueEvidence` or `singleEvidencePerSymbol`.

### 3.2. Reviews

A false tag removes the error, not the problem. `requireReview: true` demands a review of the same kind, on the same host, naming the same target, with the current fingerprint:

```ts
/**
 * @evidence .agents/skills/principles/SKILL.md#no-hard-coding Looks the handler up in the registry it was handed and branches on no known name.
 * @evidenceReview .agents/skills/principles/SKILL.md#no-hard-coding #6385235 Searched the body for literal names and fixture values; found none.
 */
```

The fingerprint is seven hexadecimal characters over the cited unit and its subtree. Annotations and whitespace do not change it; content does, and the diagnostic then prints the new value:

```bash
ERROR [graph-missing-review] claim[0] 'every function answers every engineering principle' (typescript) -> reference[0] (markdown)
Location: /workspace/app/src/resolve.ts:4:4
Claim 1 ('every function answers every engineering principle') reference 1: @evidence for '.agents/skills/principles/SKILL.md#no-hard-coding' has no matching @evidenceReview; the current scope fingerprint is '#6385235'.
Repair: Add '@evidenceReview .agents/skills/principles/SKILL.md#no-hard-coding #6385235 <what you checked>' on the same semantic host.
```

Reviews never provide coverage. `@evidenceReview` pairs with `@evidence`; `@evidenceExcludeReview` pairs with `@evidenceExclude`. A fingerprint version upgrade expires every review once; re-review before updating the value. The checker handles omissions; humans handle falsehoods.

### 3.3. States

| State | Result |
| --- | --- |
| A claim selects no units | Inactive, not fabricated coverage. |
| A reference selects no units | `graph-empty-reference`; exit 1. |
| A unit has no valid acknowledgement | Missing coverage; exit 1. |
| A source is unreadable, partially parsed, or unresolved | The population is incomplete, derivative findings are suppressed; exit 2. |
| A claim is disabled or has effective severity `off` | Removed before loading. |

Incomplete analysis never passes as an empty population.

## 4. Configuration

`evidence.config.ts` exports one `IEvidenceConfig` with a `claims` array and an optional top-level `severity`. Severity defaults to `error`; claims inherit the top-level value, and references inherit their claim. The config is evaluated through the consumer's `ttsx` and validated with `typia` before any source is read.

Without `--config`, commands look for `evidence.config.ts` first and `evidence.config.json` only when the TS entry is absent, within the effective `--cwd` directory. JSON is read directly without evaluating `ttsx`. An invalid, unreadable, directory or broken symlink at the preferred name remains an error; explicit paths never fall back. If neither candidate exists, the error names both. No-argument checker and loader APIs use the same order in the current working directory. Roots remain relative to the selected physical configuration file. `init` still defaults to creating `evidence.config.ts`.

### 4.1. Claim

| Property | Type | Default | Behavior |
| --- | --- | --- | --- |
| `type` | Artifact type | required | Selects the adapter: `typescript`, `rust`, `prisma`, `markdown`, `swagger`, and every other certified type. |
| `files` | `string[]` | required | Ordered globs relative to `root`; `!` excludes, a later pattern reincludes. |
| `reference` | `IEvidenceReference \| IEvidenceReference[]` | required | One reference or an array of independent obligations. |
| `name` | `string` | none | Labels diagnostics without merging claims. |
| `severity` | `"error" \| "warning" \| "off"` | config, then `error` | `off` removes the claim; `warning` never fails the check. |
| `disabled` | `boolean` | `false` | Validates the shape but loads nothing. |
| `root` | `string` | config directory | Resolves claim globs; names one directory, not a glob. |
| `symbol` | Symbol or nonempty array | family default | Selects claim hosts. |
| `evidenceExcludeCarriers` | `string[]` | all selected files | Narrows exclusions to matching selected files. |

### 4.2. Reference

| Property | Type | Default | Behavior |
| --- | --- | --- | --- |
| `type` | Artifact type | required | Selects the referenced adapter independently of the claim. |
| `files` / `file` | `string[]` / `string` | required | Globs, or for a Swagger reference one local path or URL. |
| `root` | `string` | config directory | Resolves reference files and Markdown targets; names one directory, not a glob. |
| `symbol` | Symbol or nonempty array | family default | Selects the denominator. |
| `severity` | Evidence severity | claim | `off` removes the reference. |
| `noEvidenceExclude` | `boolean` | `false` | Exclusions fail and provide no coverage. |
| `uniqueEvidence` | `boolean` | `false` | At most one positive host per unit. |
| `singleEvidencePerSymbol` | `boolean` | `false` | Every host cites exactly one unit. |
| `requireReview` | `boolean` | `false` | Every acknowledgement needs a current review. |
| `checklist` | `boolean` | `false` | Markdown only. Every host answers every selected heading. |

### 4.3. Symbols

| Family | Symbols | Claim default | Reference default |
| --- | --- | --- | --- |
| Programming | `type`, `function`, `property` | all | `type`, or all when unavailable |
| Markdown | `file`, `h1`, `h2`, `h3`, `h4` | all | all |
| Database | `model`, `column`, `relation` | all | `model` |
| Swagger | `operation` | `operation` | `operation` |

`type` chooses the language before file selection: `.h` follows `c`, `cpp`, or `objc`; `.sql` follows the configured dialect. Roots resolve from the config file; globs are case-sensitive, and a bare `src` selects nothing.

## 5. Tags and targets

```text
@evidence <target> <reason>
@evidenceExclude <target> <reason>
@evidenceReview <target> [#fingerprint] <description>
@evidenceExcludeReview <target> [#fingerprint] <description>
```

Tags live in documentation attached to selected hosts. A target is one whitespace-free token; the prose is required. `{@link Symbol}` is rejected: addresses are file-qualified. `@internal`, `@hidden`, and `@ignore` withdraw a declaration and its descendants.

| Target | Form |
| --- | --- |
| Programming | `<path>#<accessor>`, path from the citing file: `../calculator.ts#add` |
| Instance member | `SomeClass.prototype.member` in TypeScript, JavaScript, and Python; `SomeClass.member` in other languages; `Shop.Sale.self.find` for Ruby singletons |
| Literal segment | JSON-string brackets: `Namespace["member.with.dots"]`, ``Shop["Box`1"]``, `Sale["impl Service"].run`, `Widget["-send:to:"]` |
| Markdown | `docs/requirements.md#anchor` from the reference root; `{#anchor}` wins, otherwise the lowercased heading |
| Prisma | `prisma:Sale`, `prisma:Sale.price`, no path |
| SQL and DBML | File-qualified: `schema.sql#app.item.id`; `evidence list` prints relation segments |
| Swagger | `POST:/sales`, uppercase method and exact path |

Markdown tags go in HTML comments under the heading they belong to. Prisma tags go in `///` on models and fields. Swagger tags go in each operation's `description`. Aliases such as barrels add addresses without adding obligations.

| Outcome | Meaning |
| --- | --- |
| `resolved` | Exactly one unit owns the address in this scope. |
| `missing-file`, `missing-member`, `out-of-population` | Nothing selected owns it. |
| `ambiguous` | Several units own it. |
| `hidden` | The unit was withdrawn. |
| `malformed`, `unsupported-host`, `incomplete` | The target or its host cannot be interpreted. |

The resolver never falls back to a project-wide name.

## 6. Languages

Every family can be a claim and a reference and can cite every other.

Programming languages and SQL dialects parse through upstream Tree-sitter grammars, Prisma through its own parser, and Swagger as JSON or YAML. Adapters run no compiler, preprocessor, macro, or build; a construct that could change the public surface and cannot be resolved makes analysis incomplete.

`evidence languages` prints the shipped registry.

### 6.1. Programming languages

| Type | Files | Public surface | Documentation |
| --- | --- | --- | --- |
| `typescript` | `.ts`, `.cts`, `.mts`, `.tsx` | Static module exports and declaration files | Attached JSDoc |
| `javascript` | `.js`, `.jsx`, `.cjs`, `.mjs` | Static ESM exports and unconditional CommonJS initialization | Attached JSDoc |
| `python` | `.py`, `.pyi` | Module exports with static import and `__all__` resolution | Docstrings or adjacent `#` runs |
| `go` | `.go` | Exported package declarations with receiver ownership | Adjacent comments |
| `rust` | `.rs` | Crate modules, public reexports, nominal impl members | Doc comments or `#[doc]` |
| `java` | `.java` | Source-public declarations, independent of JPMS | Attached Javadoc |
| `csharp` | `.cs` | Source-public declarations and partial identities | `///` or `/** */` XML |
| `c` | `.c`, `.h` | External declarations, tags, typedefs, fields, enumerators per file | Attached Doxygen |
| `cpp` | `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, and other C++ spellings | Namespaces, public members, templates, bounded aliases | Attached Doxygen |
| `ruby` | `.rb`, `.rake`, `.gemspec`, `Gemfile`, `Rakefile` | Classes, modules, public methods, constants, `attr_*`, reopenings | Adjacent `#` runs or RDoc |
| `kotlin` | `.kt` | Public-by-default declarations, companions, resolvable extensions | Adjacent KDoc |
| `swift` | `.swift` | Public/open declarations of one module per root, extensions merged | `///` or `/** */` DocC |
| `php` | `.php` | Namespace declarations and public class members | Adjacent PHPDoc |
| `dart` | `.dart` | Non-underscore declarations across `part` and relative `export` | `///` or `/** */` |
| `scala` | `.scala` | Unrestricted Scala 2 and 3 declarations, named givens, object exports | Adjacent Scaladoc |
| `lua` | `.lua` | Explicit globals and one returned literal module table | `---` LuaDoc or long comments |
| `matlab` | `.m` | `classdef` types, primary functions, public members, `@Class` folders | Percent help |
| `objc` | `.m`, `.h` | Interfaces, protocols, categories, methods, properties, `@public` ivars | Doxygen, `///`, `//!` |
| `zig` | `.zig` | `pub` declarations, exposed container fields, direct aliases | Adjacent `///` |

Every adapter maps its language onto `type`, `function`, and `property`, keeps undocumented public declarations in the population, and ignores tags inside code examples, strings, and ordinary comments.

<details>
<summary><strong>Per-language addresses and boundaries</strong></summary>

- **TypeScript.** `Class.member` static, `Class.prototype.member` instance. Direct, aliased, default, star, and namespace exports resolve through relative paths; type-only exports keep type-space units. Package `exports`, path aliases, ambient modules, global augmentations, and `export =` are incomplete.
- **JavaScript.** `.js` follows the nearest `package.json` `type`. CommonJS accepts unconditional top-level `exports.x = local`, `module.exports.x = local`, and `module.exports = { x, alias: local }`; computed keys and conditional mutation are incomplete.
- **Python.** `Class.member` static, `Class.prototype.member` instance. Static `__all__` or non-underscore declarations; docstrings or a same-indent `#` run before the declaration. Missing local sources and dynamic `__all__` are incomplete.
- **Go.** `Type.Method`; a grouped declaration's comment hosts every member. Build tags, promoted members, and generated declarations are outside the surface.
- **Rust.** Unrestricted `pub` only; `pub use` chains keep one identity. `Sale["impl crate::Service"].run` for trait impls, `Pair[0]` for tuple fields. Cargo features, macros, `#[path]`, and `cfg` alternatives are incomplete.
- **Java.** `Sale.java#Sale.calculate`; same-owner same-name methods form one overload family. `{@code}` and `<pre>` content is inert.
- **C#.** Namespaced `Sale.cs#Shop.Sale.Total`; ``["Box`1"]`` for generics, `["this[]"]` for indexers, `["operator +"]` for operators. Partial declarations share one unit. Conditional compilation is incomplete.
- **C.** `models.h#["struct Sale"]`, or `models.h#Sale` when unambiguous. Include guards are accepted; other preprocessing is incomplete, and includes are not traversed.
- **C++.** ``shop["Box`1"].value``, `constructor`, `destructor`, `["operator +"]`. Class members default private, struct members public. Macros, specialization, inheritance, and modules are incomplete.
- **Ruby.** `Shop.Sale.total`, `Shop.Sale.self.find`, `Shop.Sale["price="]`. Lexical visibility and `module_function` apply; `define_method` and mixins are not evaluated.
- **Kotlin.** `Contract.Companion.run`, `["extension(kotlin.String)"].measure`. Overrides without explicit visibility and `expect`/`actual` are incomplete; `.kts` is rejected.
- **Swift.** One module per root. `Contract.init`, `Contract.subscript`, `Contract.static["+"]`; extensions merge under their owner. Macros and conditional compilation are incomplete.
- **PHP.** `App.Contract.run`, `App.Contract.$value`. Trait composition, `include`, `eval`, and `class_alias` are incomplete.
- **Dart.** `Contract.new`, `Contract["operator +"]`; `part` and relative `export` graphs resolve. Package or SDK export URIs are incomplete.
- **Scala.** `demo.Contract.run`, `demo["object Contract"].apply`; companions never merge. Anonymous givens, `derives`, and macros are incomplete.
- **Lua.** `contract.lua#module.run`; dot and colon methods share one address; no `type` units. Metatables and `require` are incomplete.
- **MATLAB.** `+pkg/@Widget/Widget.m#pkg.Widget.run`; percent help after signatures or before members. `eval`, `dynamicprops`, and missing class folders are incomplete.
- **Objective-C.** `Widget["-send:to:"]`, `["Widget(Extras)"]["-extra"]`, `["protocol(Widget)"]["-run"]`; configure `type: "objc"` explicitly. Non-guard preprocessing and Objective-C++ are incomplete.
- **Zig.** `contract.zig#Contract.run`; quoted identifiers are literal segments. `usingnamespace`, comptime namespaces, and build options are incomplete.

</details>

### 6.2. Database schema languages

Database adapters share `model`, `column`, and `relation`. Selected files are a declared schema snapshot; migrations, views, and executable statements are incomplete, and no adapter runs SQL.

| Type | Files | Units | Documentation |
| --- | --- | --- | --- |
| `prisma` | `.prisma` | Models and views; parser output decides column versus relation | `///` on models and fields |
| `postgresql` | `.sql` | `schema.table` tables, columns, foreign keys, `ADD COLUMN`, named `ADD CONSTRAINT` | Adjacent comments, `COMMENT ON` |
| `mysql` | `.sql` | `CREATE TABLE` tables, columns, table `FOREIGN KEY` | Adjacent comments, `COMMENT` strings |
| `sqlite` | `.sql`, `.sqlite` | `CREATE TABLE` tables, columns, inline or table foreign keys | Leading `--` runs or one block comment |
| `bigquery` | `.sql`, `.bqsql` | `CREATE TABLE` tables, scalar and `STRUCT` fields, `NOT ENFORCED` foreign keys | Leading comments, `OPTIONS(description)` |
| `sql` | `.sql` | Portable `CREATE TABLE`, inline `REFERENCES`, anonymous `FOREIGN KEY` | Leading `--` runs or block comments |
| `dbml` | `.dbml` | Tables, scalar fields, inline or standalone `Ref` relations | Notes or adjacent standalone comments |

Addresses are file-qualified except Prisma: `schema.sql#app.item.id`, `schema.sql#Store.Child.parent_id`, `schema.dbml#users.id`. Relation segments are dialect-specific (`["constraint owner_fk"]`, `["foreign-key:...]`, `posts["$ref:owner"]`); `evidence list` prints the escaped form.

### 6.3. Markdown and Swagger

Markdown yields one `file` unit and one per ATX `h1` to `h4`; HTML comments are the only hosts.

Swagger 2.0 and OpenAPI 3.x yield `METHOD:/path` operations whose `description` hosts tags. An operation's fingerprint covers its content, effective servers and security, and referenced local components. A reference by URL is fetched on every load.

## 7. CLI

| Command | Purpose | Formats |
| --- | --- | --- |
| `check` | Evaluate every enabled obligation. Default command. | `text`, `json` |
| `list` | List selected units and addressable ancestors with canonical targets. | `text`, `json` |
| `inspect <target>` | Resolve one target in every scope and show its fingerprint and citations. | `text`, `json` |
| `graph` | Export boundaries, nodes, edges, reviews, and diagnostics. | `json`, `mermaid`, `dot` |
| `languages` | Print the certified adapter registry without loading a config. | `text`, `json` |
| `init` | Create a typed starter config without overwriting. | none |

| Option | Behavior |
| --- | --- |
| `-c, --config <path>` | Explicit config path; omission discovers TS before JSON with absence-only fallback. |
| `--cwd <path>` | Resolve CLI paths from another directory. |
| `--format <value>` | Output format from the table above. |
| `-o, --output <path>` | Write the result to a file and keep stdout empty. |
| `--language`, `--kind` | Filter `list` rows after the full check. |
| `-w, --watch` | Recheck `check` when a dependency changes; NDJSON with `--format json`. |

Exit 0 is a complete analysis without errors, 1 is a complete analysis with violations, 2 is an invalid command or incomplete analysis. JSON reports carry `schemaVersion: 1`.

Watch repeats implicit configuration discovery on each evaluation. Creating a preferred TS entry switches a JSON watch to TS; a broken TS entry fails visibly until repaired or removed. Deleting TS permits JSON selection again. Explicit `--config` paths stay fixed and report deletion instead of switching to a default. The watcher captures its working directory when constructed; embedding callers may supply `IEvidenceWatchOptions.cwd`.

## 8. References

### 8.1. Implementations

For projects whose graph uses only TypeScript, Prisma, Swagger, and Markdown, use [`@ttsc/evidence`](https://github.com/samchon/ttsc/tree/master/packages/evidence). Its dedicated compiler integration is slightly more efficient for that scope than the Tree-sitter implementation.

For graphs that include any other supported language, use `evidence`; its Tree-sitter adapters cover the broader set listed above.

### 8.2. Background

[Evidence Graph: Make Every SKILL Instruction 100% Enforced](https://ttsc.dev/blog/evidence-graph-make-every-skill-instruction-100-percent-enforced/) introduces the method. [The `@ttsc/evidence` README](https://github.com/samchon/ttsc/blob/master/packages/evidence/README.md) documents its original implementation.

Written instructions alone are not enforcement. [_The Compliance Gap_](https://arxiv.org/abs/2605.01771) examined the tool logs of six frontier models. Across 60 runs, none followed the written instruction, yet more than 90% reported compliance. [Cheating Agents](https://debugml.github.io/cheating-agents) shows the underlying incentive: when a cheaper path passes the available check, agents take it.

Evidence leaves creation to the model and makes adherence executable.
