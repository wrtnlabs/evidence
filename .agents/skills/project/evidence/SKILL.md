---
name: evidence-graph
description: Defines Evidence Graph units, target grammar, coverage, exclusions, reviews, and language-adapter completeness. Use before changing graph semantics, public configuration, artifact adapters, or diagnostics; distinguish the compatibility baseline from implemented features.
---

# Evidence Graph

## Baseline And Scope

The behavioral baseline is the [pinned original domain contract](https://github.com/samchon/ttsc/blob/14a22f077caf23f1bfb8a97b3d9db765912074ef/.agents/skills/project/evidence/SKILL.md) and its linked code/regressions. Read the relevant original section before porting behavior. Public configuration, claim, and reference types follow `D:/github/samchon/ttsc/packages/evidence`, generalized into the families defined by the [project skill](../SKILL.md). Verify runtime behavior in the implementation rather than inferring availability from a type declaration.

Reuse or port Markdown, Prisma, and Swagger behavior. Replace compiler Program discovery with file snapshots and TypeScript language adapters over upstream `web-tree-sitter`. Keep original semantics and intentional migration differences explicit.

## Identities And Populations

Keep semantic units, public addresses, declaration positions, eligible hosts, selected obligations, and structural scopes separate. Aliases can expose several addresses for one identity. Overloads and merged declarations share identity only when the adapter establishes it. Every registered host position must belong to its semantic unit.

Store explicit parent identities and segmented accessors. A dotted string is not a containment test: literal member names can contain dots. Only selected units and their real structural ancestors enter the resolvable scope closure.

Every artifact family supports both Claim and Reference roles, and every claim can reference any family. Every claim/reference pair is an independent obligation, including repeated reference-array elements. Names label diagnostics; they do not merge coverage. Start from complete selected populations, including hosts without tags.

Claims may select the same host files and then read the same annotations. A claim disowns an annotation when another active claim's reference resolves it further (`EvidenceStatementOwnership`); a citation that no claim accepts still fails in every claim that reads it.

## Tags And Hosts

```text
@evidence <target> <reason>
@link <file>#<Accessor> <reason>
@evidenceExclude <target> <reason>
@evidenceReview <target> [#<fingerprint>] <description>
@evidenceExcludeReview <target> [#<fingerprint>] <description>
```

Require a target and nonempty prose. Parse supported documentation spans attached to eligible hosts, not arbitrary source text. Swagger operation descriptions are eligible documentation; other strings and fenced examples create no acknowledgements. Unsupported or unattached declarations inside configured populations need actionable findings.

Code paths resolve from the citing file, such as `../calculator.ts#add`. Keep segmented accessors and escaped literal names unambiguous. TypeScript static members use `Class.member`; its instance members use `Class.prototype.member`. Other languages publish their own explicit member-address policy. The standalone engine does not inherit compiler import-scoped `{@link Symbol}` resolution.

`@internal`, `@hidden`, and `@ignore` withdraw supported documented declarations and their descendants from both populations. Retain withdrawal metadata for diagnostics and reconcile it across merged identities before selecting hosts.

## Coverage And Policies

Ordinary evidence and permitted exclusions cover a selected target and its selected descendants. Evidence and exclusion scopes cannot overlap in one obligation; overlapping exclusions conflict. An exclusion belongs to one claim and an eligible carrier in that claim's files.

- `noEvidenceExclude` refuses exclusions for its own reference and leaves missing positive coverage visible.
- `uniqueEvidence` counts distinct positive semantic hosts per selected target, not tags or overload locations.
- `singleEvidencePerSymbol` starts with all selected hosts and counts distinct selected units each positively acknowledges. Aggregate descendants each count.
- Markdown `checklist` makes every selected host answer every selected item. Positive evidence answers only the named item; exclusions retain their host-local cascade. Validate incompatible cardinality/carrier combinations at config loading.

Keep reviews in a separate type from acknowledgements. They never discharge coverage. Pair review kind, semantic host, and resolved target. `requireReview` needs the current content fingerprint and diagnoses missing, fingerprintless, stale, orphaned, or wrong-kind reviews appropriately.

## Content And Failure Integrity

A fingerprint belongs to the cited identity and structural subtree, independent of reference selectors and public alias projections. Keep cache digests separate from per-unit digests. Exclude accepted annotation spans so writing a review cannot invalidate itself. Preserve meaningful semantic changes and normalize line endings consistently.

Prisma's parser determines model/column/relation identity; a position scan cannot change its denominator. Swagger uses exact `METHOD:/path` operation identities and normalized operation/component content. Its claims select local JSON/YAML files and extract evidence, exclusion, and review tags from each operation's description. Keep operations without descriptions in the selected host population. Markdown retains file/H1-H4 outlines and its own path/anchor rules.

Grammar availability alone is not language support. Certify declarations, kinds, public visibility, ownership, comment attachment, aliases, addressability, and negative cases. A parse error, inaccessible root, unresolved relevant export, or unsupported surface-changing construct must not become a passing smaller inventory.

Tree-sitter recovery establishes an extraction limitation, not language invalidity. Describe grammar or adapter incompleteness without asserting that the source must be corrected. Support complete recognized forms with their original positions and semantics; accepting one known grammar gap must not hide other recovery nodes. Static foreign forwarding owns no local declaration or acknowledgement obligation. Resolve local forwarding against declaration ownership, keep support-only files outside selected populations, and retain genuine missing local sources, ambiguity, and unresolved explicit Evidence citations.

Tree-sitter does not execute macros, dynamic exports, build scripts, or test functions. Document declared-source boundaries and recognized limitations without claiming compiler-level completeness. Diagnostics should state what failed and a truthful repair, including implementing missing behavior when appropriate. The checker cannot prove prose true or establish who reviewed it.
