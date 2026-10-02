# Programming adapter onboarding

A programming language becomes supported only when its adapter can establish a complete declared public surface. A grammar proves that Evidence Graph can parse syntax. Certification additionally proves semantic unit identity, visibility, ownership, target spelling, documentation attachment, graph coverage, and conservative failure behavior.

The common graph consumes `IEvidenceInventory` and does not contain language-specific rules. Add support through the language registry, the pinned grammar manifest, one `IEvidenceAdapter`, and the shared certification fixtures. Do not change coverage policy to compensate for missing extraction.

## 1. Select and pin the grammar

Choose an upstream Tree-sitter grammar that is maintained, has a usable license, and can produce WebAssembly compatible with the pinned `web-tree-sitter` runtime.

- Record the repository, release or commit, WASM URL, SHA-256 digest, byte size, license URL, license digest, and license size in `packages/evidence/src/internal/parser-grammars.json`.
- Prefer an upstream release asset. If upstream does not publish WASM, add a recipe to `scripts/parser-builds.json` and publish the reproducibly built artifact through the `parser-wasm` workflow.
- Do not commit WASM or license bytes; the runtime downloads and verifies them on first use.
- Add the grammar ID and its exact extensions or special filenames to `EvidenceLanguageRegistry`.
- Keep multiple syntax variants, such as TypeScript and TSX, under one programming-language entry when they share one Evidence Graph surface contract.

Follow [parser assets](#parser-assets) below for acquisition, checksum, and build rules. A normal `evidence` package update ships new certified grammar support; consumers do not install a separate grammar package or language plugin.

## 2. Define the declared public surface

Write the semantic boundary before writing captures. Tree-sitter exposes syntax and source coordinates; it does not execute a compiler, build system, macro expander, module loader, or application.

Specify:

- which explicit declarations are externally reachable;
- which declarations map to `type`, `function`, and `property`;
- how language visibility, containing visibility, export lists, and file or module boundaries affect reachability;
- which generated, inherited, promoted, conditional, or dynamically installed members are omitted;
- which detectable unresolved constructs make the inventory incomplete instead of silently reducing it.

Classes, interfaces, traits, enums, type aliases, namespaces, and comparable nominal or grouping declarations normally map to `type`. Callable declarations and overload families map to `function`. Values, fields, properties, constants, enum members, and comparable data declarations map to `property`. Record a deliberate exception when the language cannot fit this contract.

## 3. Specify identity, addresses, and documentation

Semantic identity is distinct from a public address. Reexports, aliases, reopenings, partial declarations, prototypes, and definitions may add sites or addresses to one unit. They must not fabricate duplicate obligations.

Define:

- segmented identity and parent identity;
- canonical file-qualified accessor spelling, including literal or operator segments;
- instance, static, receiver, extension, namespace, and module ownership;
- overload, forward-declaration, partial, reopening, and alias merge rules;
- documentation forms that can attach to a supported declaration;
- exact adjacency, indentation, attribute, decorator, or trailing-comment rules;
- documentation examples and arbitrary strings or comments that must remain inert;
- `@internal`, `@hidden`, and `@ignore` propagation across merged identities and descendants.

Use `EvidenceDocumentation` and `EvidenceTagParser` only after the adapter has classified the documentation span and established its semantic host. Preserve original UTF-16 offsets and one-based line and column coordinates.

## 4. Implement the typed adapter

Implement `IEvidenceAdapter.analyze(snapshot)` and return a serializable `IEvidenceInventory`. Keep parser sessions bounded to the callback, copy all needed values from Tree-sitter nodes, and release runtime resources through the common parser.

Every object shape has a named interface in its own file. Keep reusable scanner and resolver logic outside the adapter entry class. Use named functions and asynchronous APIs where I/O or parser work permits them.

The adapter must retain source-loader diagnostics, report unsupported parser recovery as incomplete extraction, and add actionable diagnostics for every detected construct that can change the selected public denominator beyond its supported model. Apply the [content and failure integrity contract](SKILL.md#content-and-failure-integrity) to grammar boundaries and declaration ownership. An empty but fully understood file may be complete. A smaller inventory produced after unresolved relevant export, visibility, ownership, or generation behavior may not be complete.

## 5. Add certification fixtures

Add one `IAdapterCertification` entry to `test/src/internal/certification/AdapterCertificationFixtures.ts`. The shared suite must run unchanged.

The fixture declares exact:

- units, common kinds, identities, parents, site counts, addresses, aliases, and withdrawals;
- attached hosts and their semantic owners;
- evidence declarations and their resolved requirement targets;
- excluded private or otherwise unpublished declarations;
- annotation range count and Unicode source offsets.

It also supplies:

- a passing graph and one missing-evidence result for each of `type`, `function`, and `property`;
- a detected unsupported construct that leaves the public surface incomplete;
- malformed syntax;
- attached documentation beside tag-shaped content in an ineligible comment or string;
- an ambiguous public address;
- an annotation-only edit that preserves a fingerprint;
- a semantic source edit that changes the fingerprint.

The harness deliberately removes a unit, changes a common kind, detaches a documentation host, and rewires an alias. Each mutation must fail exact certification. A new adapter is not certified if weakening an expectation makes one of these defects pass.

## 6. Certify distribution and documentation

Update the root README with the supported surface and its limits. Add the adapter entry point to the public package exports when users need it. Keep candidate status separate from certified support.

The distribution certification checks that:

- every supported registry entry has one adapter certification;
- every grammar selected by those entries exists in the pinned manifest;
- every manifest record passes `EvidenceTreeSitterAssets` validation of its provenance paths and HTTPS asset URLs;
- every pinned grammar is acquired at its declared size and digest into the test fixture cache;
- every pinned grammar parses a real declaration through `EvidenceParser` in `test_parser_grammars`.

Inspect package metadata and preparation scripts directly. Do not add tarball installation, packed-consumer, or CLI subprocess tests.

Run:

```bash
pnpm start --include test_parser_grammars
pnpm start --include test_adapter_certification
pnpm check:format
```

`pnpm build` remains the package compilation and lint command. The unit-test command executes source through `ttsx`, so adapter logic does not require a preceding build.

## Capability counts

Count each concept separately:

- **Programming languages:** entries returned by `EvidenceLanguageRegistry.list()` that have certified adapters; `evidence languages` renders the current set.
- **Pinned grammar variants:** unique grammar IDs across the registry entries. TypeScript and TSX use separate grammars; JSX shares the JavaScript grammar.
- **Database schema languages:** entries returned by `EvidenceLanguageRegistry.databases()` plus the Prisma parser. They share the `model`, `column`, and `relation` symbols and are counted separately from programming languages.
- **Artifact formats:** Markdown and Swagger/OpenAPI are two additional non-programming Evidence Graph families. They are not included in either language count.
- **Candidates:** researched entries returned by `EvidenceLanguageRegistry.candidates()`. They are excluded from supported counts until their adapters pass this process. The registry record is the checked candidate matrix; a candidate is not supported because a grammar exists or parses a fixture.

## Parser assets

The runtime uses the official CommonJS entry of `web-tree-sitter`, pinned in the `tree-sitter` family catalog. The binding's core WASM comes from that npm dependency and is resolved through `require.resolve`, independent of the caller's working directory.

Language grammars are not packaged. The grammar manifest at `packages/evidence/src/internal/parser-grammars.json` pins every grammar the runtime may acquire: upstream repository, release or reproducible build identifier, full source commit, WASM download URL, SHA-256 digest, byte length, and the license asset with its own digest and length. `EvidenceTreeSitterAssets` imports the manifest directly, validates every record with `typia`, rejects duplicate identifiers, and refuses non-HTTPS or credential-bearing URLs before any record can choose a cache key or download destination. The package emits the manifest into `lib` during the build; there is no generated catalog to regenerate. TypeScript and TSX share an upstream repository and license but use separate grammars.

### Acquisition at runtime

`TreeSitterAssetCache` downloads a pinned grammar the first time a selected source needs it, verifies the byte length and SHA-256 against the manifest, and publishes the file atomically under `grammars-v1/<sha256>.wasm` in the project cache. Every later read verifies size and digest again, so a damaged entry is downloaded afresh instead of being trusted. Concurrent callers in one process share a transfer and receive independent byte arrays; a cross-process lock prevents two processes from publishing the same entry at once, and stale locks from dead processes are recovered.

An explicit `IEvidenceTreeSitterAssetOptions.cacheDirectory` wins. Without one, the cache root is `EVID_CACHE_DIR` when set, then `node_modules/.cache/evidence` under the current working directory. The same options let an embedding caller override fetch transport, per-attempt timeout, attempt count, cancellation signal, and progress sink; `EvidenceTreeSitterAssetScope` carries those controls through one asynchronous execution chain so nested checker and adapter instances inherit them. Imports, configuration loading, help, version, init, and `evidence languages` never download a grammar.

### Tests and CI

Logic tests obtain the real pinned grammars into the gitignored `test/.tmp/parser-fixtures` cache through `TestParserAssets`. A cold checkout therefore needs network access once; the test workflow caches that directory keyed by the manifest's hash. Acquisition tests copy those verified bytes into a disposable cache and drive a controlled fetch implementation, so cold, warm, offline, corrupt, and repair paths are exercised without touching the shared fixtures. `test_parser_assets` and the `test_parser_acquisition_*` scenarios in `test/src/features/parser` own that coverage.

### Add or update a grammar

1. Choose an upstream release that publishes a WASM asset compatible with the pinned `web-tree-sitter` ABI, and resolve its tag to a full source commit. If upstream publishes no WASM, add a recipe to `scripts/parser-builds.json` and let the `parser-wasm` workflow build, verify, and publish it as described below.
2. Obtain the WASM and the license at that commit. Record both files' byte lengths and SHA-256 digests, the download URLs, the repository, the version, and the commit as one record in the manifest. Register a record only alongside its implemented, certified adapter.
3. Add the grammar ID and its exact extensions or special filenames to `EvidenceLanguageRegistry`.
4. Add a real declaration fixture to `test_parser_grammars` and run the parser logic tests through the test workspace: `pnpm start --include parser`.
5. Review successful linking, parsing, query captures, Unicode coordinates, and external-scanner behavior with the installed binding. Matching ABI versions alone do not prove compatibility.

The runtime releases parsers, trees, cursors, and per-session queries; immutable language modules remain cached for the process lifetime because the binding exposes no language-unload API.

### Build a grammar without an upstream WASM release

Add a recipe to `scripts/parser-builds.json` with its full source commit, grammar subdirectory, license path, ABI, and a real declaration/query probe. The manifest pins the Tree-sitter CLI and WASI SDK versions and download digests. Run `node scripts/build-parser-wasm.js <recipe>` on Linux or Windows x64. It builds two independent checkouts, compares their WASM bytes, and verifies parsing and capture through the installed `web-tree-sitter`. Outputs under `test/.tmp/parser-builds` include the grammar record and source/scanner/toolchain provenance. A recipe may pin a patch file under `scripts/parser-patches` with its SHA-256; the builder verifies and applies it to both checkouts, and provenance retains the exact patch bytes as base64. Upstream repositories may omit `tree-sitter.json`; when present, it participates in the input hashes. These are maintainer operations; checking a consumer project never builds a parser.

The `parser-wasm` workflow validates recipes on pull requests. To publish a verified artifact, dispatch it on `master` with the recipe identifier and `publish: true`. Its release tag includes the complete WASM digest, and publication never replaces existing assets. The publication job verifies a cold download through `EvidenceTreeSitterAssets` and then reads the same cache with network access disabled. Register the resulting grammar record in the manifest only alongside its implemented, certified adapter.
