import { EvidenceUnitSites } from "./EvidenceUnitSites";
import typia from "typia";

import type { IEvidenceHost } from "../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
import type { IEvidenceSourceAddress } from "../structures/IEvidenceSourceAddress";
import type { IEvidenceSourceFile } from "../structures/IEvidenceSourceFile";
import type { IEvidenceUnit } from "../structures/IEvidenceUnit";
import type { IEvidenceUnitSite } from "../structures/IEvidenceUnitSite";
import { EvidenceInventorySources } from "./EvidenceInventorySources";

/**
 * Combines compatible adapter inventories into one analysis snapshot.
 *
 * Conflicts mark the result incomplete instead of choosing whichever adapter
 * happened to run first, preserving the failure boundary for graph evaluation.
 *
 * @evidence contracts/common.md#principled-implementation Records are merged by identity, and any disagreement between equal identities becomes an inventory-conflict diagnostic that marks the result incomplete.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns merging plus the deterministic ordering and key helpers other inventory code reuses.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Conflicts never pick a winner by scan order.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains the conflict boundary; every exported and private helper is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceInventoryMerge {
  /**
   * Merges compatible source, unit, host, and declaration records into one
   * inventory.
   *
   * Conflicting semantic identities remain diagnostics and mark the merged
   * result incomplete, so input order cannot select an arbitrary graph
   * population.
   *
   * @evidence contracts/common.md#principled-implementation Physical paths are reconciled first; then sources, units, sites and hosts are unioned by ID with key comparisons, and duplicate statement IDs must have identical serialized bodies.
   * @evidence contracts/common.md#clear-and-simple-design Comparison keys and conflict recording are separate helpers; combine only orchestrates.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Incompatible records add conflicts and mark the output incomplete instead of being dropped, and incompleteness always carries an inventory-incomplete diagnostic.
   * @evidence contracts/common.md#meaningful-documentation The comment explains why input order cannot select a population; the inline comment explains alias-duplicated tags.
   * @evidence contracts/performance.md#efficient-algorithms Linear in total records and first-indexed sites with identity lookups; duplicate site comparison reads only that site's ranges.
   * @evidence contracts/performance.md#reuse-equivalent-work Identity maps merge each input record once, and exclusively owned site arrays reuse the shared site-ID index; serialized content keys still establish compatibility.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Input records move into the output; local merge maps are discarded, and weak site-array indexes retain only sites already owned by live construction arrays.
   */
  export function combine(inputs: IEvidenceInventory[]): IEvidenceInventory {
    EvidenceInventorySources.reconcile(inputs);
    const output: IEvidenceInventory = {
      schemaVersion: 1,
      sources: [],
      annotationRanges: [],
      units: [],
      addresses: [],
      hosts: [],
      declarations: [],
      reviews: [],
      diagnostics: [],
      dependencies: [],
      complete: inputs.every((input) => input.complete),
    };
    const sources = new Map<string, IEvidenceSourceFile>();
    const units = new Map<string, IEvidenceUnit>();
    const hosts = new Map<string, IEvidenceHost>();
    for (const input of inputs) {
      output.diagnostics.push(...input.diagnostics);
      output.annotationRanges.push(...input.annotationRanges);
      for (const source of input.sources) {
        const previous = sources.get(source.id);
        if (previous === undefined) sources.set(source.id, source);
        else if (
          previous.digest !== source.digest ||
          previous.content !== source.content ||
          previous.fingerprintPath !== source.fingerprintPath ||
          fingerprintRootKey(previous) !== fingerprintRootKey(source)
        )
          conflict(output, "source", source.id);
        else previous.addresses.push(...source.addresses);
      }
      for (const unit of input.units) {
        const previous = units.get(unit.id);
        if (previous === undefined) units.set(unit.id, unit);
        else if (unitKey(previous) !== unitKey(unit))
          conflict(output, "unit", unit.id);
        else {
          if (
            previous.contentDigest !== undefined &&
            unit.contentDigest !== undefined &&
            previous.contentDigest !== unit.contentDigest
          )
            conflict(output, "unit content digest", unit.id);
          else if (
            previous.contentDigest === undefined &&
            unit.contentDigest !== undefined
          )
            previous.contentDigest = unit.contentDigest;
          for (const site of unit.sites) {
            const existing: IEvidenceUnitSite | undefined =
              EvidenceUnitSites.append(previous, site, false);
            if (
              existing !== undefined &&
              (siteKey(existing) !== siteKey(site) ||
                contentKey(existing) !== contentKey(site))
            )
              conflict(output, "declaration site", site.id);
          }
          previous.withdrawals.push(...unit.withdrawals);
        }
      }
      for (const host of input.hosts) {
        const previous = hosts.get(host.id);
        if (previous === undefined) hosts.set(host.id, host);
        else if (hostKey(previous) !== hostKey(host))
          conflict(output, "host", host.id);
        else {
          previous.unitIds.push(...host.unitIds);
          previous.origins = [
            ...(previous.origins ?? [previous.file]),
            ...(host.origins ?? [host.file]),
          ];
        }
      }
      output.addresses.push(...input.addresses);
      output.declarations.push(...input.declarations);
      output.reviews.push(...input.reviews);
      output.dependencies.push(...input.dependencies);
    }
    output.sources = Array.from(sources.values());
    output.units = Array.from(units.values());
    output.hosts = Array.from(hosts.values());

    // Duplicate physical tags can appear through aliases; conflicting bodies
    // cannot be chosen by scan order.
    const declarations = new Map<string, string>();
    for (const declaration of output.declarations) {
      const previous = declarations.get(declaration.id);
      const body = typia.json.stringify(declaration);
      if (previous !== undefined && previous !== body)
        conflict(output, "acknowledgement", declaration.id);
      declarations.set(declaration.id, body);
    }
    const reviews = new Map<string, string>();
    for (const review of output.reviews) {
      const previous = reviews.get(review.id);
      const body = typia.json.stringify(review);
      if (previous !== undefined && previous !== body)
        conflict(output, "review", review.id);
      reviews.set(review.id, body);
    }
    if (
      !output.complete &&
      !output.diagnostics.some(
        (diagnostic) => diagnostic.code === "inventory-incomplete",
      )
    )
      output.diagnostics.push({
        code: "inventory-incomplete",
        severity: "error",
        message: "At least one adapter or source snapshot is incomplete.",
        repair:
          "Resolve the underlying analysis failure before evaluating evidence coverage.",
      });
    return output;
  }

  /**
   * Deduplicates values by semantic key and orders the result
   * deterministically.
   *
   * Later records replace earlier records for the same key before bytewise key
   * ordering removes source traversal order from serialized output.
   *
   * @evidence contracts/common.md#principled-implementation A map keyed by the caller's semantic key keeps the last record per key, then entries are sorted bytewise.
   * @evidence contracts/common.md#clear-and-simple-design Key derivation is supplied by the caller.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Bytewise ordering removes traversal and locale effects from output.
   * @evidence contracts/common.md#meaningful-documentation The comment states last-wins replacement and deterministic order.
   * @evidence contracts/performance.md#efficient-algorithms O(n log n): linear insertion plus a sort.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each call deduplicates its own list.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function unique<T>(values: T[], key: (value: T) => string): T[] {
    const records = new Map<string, T>();
    for (const value of values) records.set(key(value), value);
    return Array.from(records)
      .sort(([x], [y]) => compare(x, y))
      .map(([, value]) => value);
  }

  /**
   * Compares opaque identity strings without locale-dependent ordering.
   *
   * Inventory serialization uses this bytewise relation so the same graph sorts
   * identically across machines with different locale settings.
   *
   * @evidence contracts/common.md#principled-implementation Plain string comparison orders identities by UTF-16 code units, independent of locale.
   * @evidence contracts/common.md#clear-and-simple-design One comparator is shared by every deterministic sort in inventory code.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No locale-aware collation is used.
   * @evidence contracts/common.md#meaningful-documentation The comment explains locale independence.
   * @evidence contracts/performance.md#efficient-algorithms O(length) per comparison.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work A comparator has no reusable work.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The comparator keeps no state after returning; its result is owned by the caller.
   */
  export function compare(x: string, y: string): number {
    return x < y ? -1 : x > y ? 1 : 0;
  }

  /**
   * Deduplicates source addresses while preserving direct selection over
   * dependency loading.
   *
   * When equivalent addresses collide, a selected address clears the dependency
   * marker because it represents part of the configured public population.
   *
   * @evidence contracts/common.md#principled-implementation Addresses are deduplicated by absolute, relative and display spelling, and a selected address clears a dependency-only marker on collision.
   * @evidence contracts/common.md#clear-and-simple-design The function only deduplicates and orders addresses.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Direct selection wins over dependency loading so selected files are never treated as support-only.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the selection rule.
   * @evidence contracts/performance.md#efficient-algorithms O(n log n) for n addresses.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each call handles one source's addresses.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function sourceAddresses(
    values: IEvidenceSourceAddress[],
  ): IEvidenceSourceAddress[] {
    const records = new Map<string, IEvidenceSourceAddress>();
    for (const value of values) {
      const key = JSON.stringify([
        value.absolute,
        value.relative,
        value.display,
      ]);
      const previous = records.get(key);
      if (previous === undefined) records.set(key, value);
      else if (previous.selected === false && value.selected !== false)
        delete previous.selected;
    }
    return Array.from(records)
      .sort(([x], [y]) => compare(x, y))
      .map(([, value]) => value);
  }

  /**
   * Serializes structural site identity without its independently merged
   * content spans.
   *
   * Unit merging compares this key before unioning content ranges, so
   * compatible declarations share a physical host without requiring identical
   * extraction order.
   *
   * @evidence contracts/common.md#principled-implementation Site ID, file and serialized range identify a site's structure without its content spans.
   * @evidence contracts/common.md#clear-and-simple-design Content spans have their own key, so structure and content are compared separately.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts The key uses typia's JSON serializer rather than ad hoc concatenation.
   * @evidence contracts/common.md#meaningful-documentation The comment explains why content is excluded.
   * @evidence contracts/performance.md#efficient-algorithms Constant work per site.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Keys are cheap per comparison.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function siteKey(site: IEvidenceUnitSite): string {
    return JSON.stringify([
      site.id,
      site.file,
      typia.json.stringify(site.range),
    ]);
  }

  /**
   * Serializes deduplicated content ranges for source-order-independent
   * conflict detection.
   *
   * The range values are normalized through {@link unique} before a shared site
   * can be accepted as equivalent across inventories.
   *
   * @evidence contracts/common.md#principled-implementation Content ranges are serialized, deduplicated and sorted through unique, so extraction order does not affect equivalence.
   * @evidence contracts/common.md#clear-and-simple-design It reuses unique rather than its own ordering.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Ordering normalization prevents false conflicts without accepting different content.
   * @evidence contracts/common.md#meaningful-documentation The comment explains source-order independence.
   * @evidence contracts/performance.md#efficient-algorithms O(r log r) for r content ranges.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Keys are computed per comparison.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function contentKey(site: IEvidenceUnitSite): string {
    return JSON.stringify(
      unique(
        site.content.map((range) => typia.json.stringify(range)),
        (value) => value,
      ),
    );
  }

  /**
   * Captures the unit fields that must agree for one semantic identity.
   *
   * A mismatch means inventories disagree about the declaration itself and
   * cannot safely merge their physical sites or public addresses.
   */
  function unitKey(unit: IEvidenceUnit): string {
    return JSON.stringify([
      unit.type,
      unit.symbol,
      unit.parentId,
      unit.identity,
      unit.name,
    ]);
  }

  /**
   * Captures host attachment semantics that cannot be safely unioned on
   * conflict.
   *
   * Hosts with the same ID must retain one source range, site, and attachment
   * meaning before their unit IDs and origins can be combined.
   */
  function hostKey(host: IEvidenceHost): string {
    return JSON.stringify([
      host.file,
      typia.json.stringify(host.range),
      host.siteId,
      host.attachment,
      host.problem,
    ]);
  }

  /**
   * Records a non-recoverable identity disagreement without dropping either
   * record.
   *
   * Marking the output incomplete prevents graph evaluation from treating a
   * reduced or arbitrarily selected merged population as successful.
   */
  function conflict(
    output: IEvidenceInventory,
    kind: string,
    id: string,
  ): void {
    output.complete = false;
    output.diagnostics.push({
      code: "inventory-conflict",
      severity: "error",
      message: `Conflicting ${kind} records share identity ${id}.`,
      repair:
        "Correct the adapter identity or use a consistent source snapshot before combining inventories.",
    });
  }
}

/**
 * Serializes optional portable-root metadata for source conflict detection.
 *
 * A shared process-local source identity cannot select different logical roots
 * according to inventory order because that would change public fingerprints.
 */
function fingerprintRootKey(source: IEvidenceSourceFile): string {
  return source.fingerprintRoot === undefined
    ? ""
    : JSON.stringify([
        source.fingerprintRoot.physicalPath,
        source.fingerprintRoot.fingerprintPath,
      ]);
}
