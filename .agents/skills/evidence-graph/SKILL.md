---
name: evidence-graph
description: Keeps the Evidence Graph rules that the README, code, and tests do not state, and the procedure for adding a language adapter. Use before changing graph semantics, configuration types, adapters, grammars, or diagnostics.
---

# Evidence Graph

The README's graph rules, configuration, tags and targets, and languages sections are the user contract, and the certification fixtures and tests fix its invariants. Change the README with the behavior.

## Rules

- Port behavior from the [pinned ttsc domain contract](https://github.com/samchon/ttsc/blob/14a22f077caf23f1bfb8a97b3d9db765912074ef/.agents/skills/project/evidence/SKILL.md) and its linked regressions, and keep each intentional migration difference explicit. Configuration types follow `D:/github/samchon/ttsc/packages/evidence`, generalized into the `Programming` and `Database` families, with no `language` setting beside `type`.
- Keep language rules in adapters; the graph consumes only `IEvidenceInventory`. Fix missing extraction in its adapter, never by changing a coverage policy.
- Never make a graph pass by excluding, retargeting, or deleting an author's citation, by shrinking a population, or by reporting an incomplete inventory as complete, and never add a rule that judges whether a reason is sincere.

## Adding A Language

1. Pin an upstream grammar release whose WASM links with the pinned `web-tree-sitter`, as a `packages/evidence/src/internal/parser-grammars.json` record. Without an upstream WASM, add a recipe to `scripts/parser-builds.json` and build it with `node scripts/build-parser-wasm.js <recipe>`. Never commit WASM or license bytes.
2. Define the declared public surface before writing captures: which declarations are reachable, how they map to `type`, `function`, and `property`, and which detectable constructs make the inventory incomplete instead of smaller.
3. Implement `IEvidenceAdapter` and register the grammar and its extensions in `EvidenceLanguageRegistry`, together with the manifest record. A grammar that parses is not a supported language.
4. Add the adapter's entry to `test/src/internal/certification/EvidenceAdapterCertificationFixtures.ts` and a real declaration to `test_parser_grammars`, leaving the shared certification suite unchanged. An adapter is not certified if weakening an expectation lets a certification mutation pass.
5. Review linking, captures, Unicode coordinates, and external-scanner behavior with the installed binding; matching ABI versions alone do not prove compatibility. Update the README's Languages section.

## Review Questions

- Can loading or extraction fail while a check still reports success?
- Can aliases, merged declarations, or host positions duplicate or lose an obligation?
- Can a review count as evidence, or invalidate its own fingerprint?
- Can cwd, Unicode, case, symlinks, or CRLF change a target's identity?
- Do the source entry points, `publishConfig`, and the package allowlist agree?
