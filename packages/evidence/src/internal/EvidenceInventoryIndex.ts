import typia from "typia";
import { copyEvidenceInventory } from "./copyEvidenceInventory";

import { EvidenceInventoryMerge } from "../internal/EvidenceInventoryMerge";
import { EvidenceSourceText } from "../internal/EvidenceSourceText";
import type { IEvidenceAddress } from "../structures/IEvidenceAddress";
import type { IEvidenceDiagnostic } from "../structures/IEvidenceDiagnostic";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
import type { IEvidenceInventoryOptions } from "../structures/IEvidenceInventoryOptions";
import type { IEvidencePopulation } from "../structures/IEvidencePopulation";
import type { IEvidenceResolution } from "../structures/IEvidenceResolution";
import type { IEvidenceSourceAddress } from "../structures/IEvidenceSourceAddress";
import type { IEvidenceSourceFile } from "../structures/IEvidenceSourceFile";
import type { IEvidenceSourceLocation } from "../structures/IEvidenceSourceLocation";
import type { IEvidenceUnit } from "../structures/IEvidenceUnit";
import type { IEvidenceUnitSite } from "../structures/IEvidenceUnitSite";
import type { IEvidenceWithdrawal } from "../structures/IEvidenceWithdrawal";

/**
 * Reconciles adapter records and indexes independently selected evidence
 * populations.
 *
 * Construction captures the supplied inventories, merges compatible identities,
 * optionally gives every file-addressed source a structural file unit, and
 * checks source ranges, parent relationships, addresses, and host ownership.
 * Inconsistent records leave diagnostics and an incomplete inventory instead of
 * silently disappearing from the denominator. Normalization makes snapshots and
 * serialization deterministic.
 *
 * Selection distinguishes required units from their addressable ancestors and
 * propagates withdrawals through explicit parent links. Resolution then matches
 * an exact file and segmented accessor within that scope. Aliases can name one
 * identity; an address naming several identities remains ambiguous.
 *
 * Snapshots, populations, and resolutions borrow internal records. Callers must
 * keep the input and returned records immutable for the index lifetime. The
 * public facade owns defensive copies at its boundary.
 *
 * @example
 *   const inventory: EvidenceInventoryIndex = new EvidenceInventoryIndex([
 *     adapterOutput,
 *   ]);
 *   const population: IEvidencePopulation = inventory.select([methodId]);
 *   const target: IEvidenceResolution = inventory.resolve(
 *     { file: "api.ts", segments: ["Client"] },
 *     [methodId],
 *   );
 *   // Client may resolve as an aggregate owner while only its method is required.
 *
 * @evidence contracts/common.md#principled-implementation Construction receives typed internal records, copies fields mutated by merging, merges inventories, on request gives each file-addressed source a structural file unit owning its single-file top-level declarations, validates source ranges, sites, parents, cycles, addresses and hosts against the original text, caches inherited withdrawals per unit, and normalizes ordering.
 * @evidence contracts/common.md#clear-and-simple-design The class owns reconciliation, validation, selection and exact address resolution; merging and canonical keys come from EvidenceInventoryMerge.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Semantic contradictions become diagnostics that mark the inventory incomplete instead of disappearing from the denominator.
 * @evidence contracts/common.md#meaningful-documentation The class comment explains construction, selection, resolution and ownership of results with an example; every public and private member is documented.
 * @evidence contracts/performance.md#efficient-algorithms Construction is linear in records with map lookups (file scoping is one pass over units and their sites), plus one line index per source for range validation; parent cycles and inherited hidden flags are computed in one traversal; directive lists are built lazily for hidden-target explanations.
 * @evidence contracts/performance.md#reuse-equivalent-work Unit and withdrawal maps are built once; resolution adds a lazily built address index and caches each selection's visible and hidden scopes per ID array, so repeated citations against one reference reuse that work.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The index owns a structural copy of the mutable merge records and plain maps; the address index is one entry per public address, scope caches are keyed weakly by immutable internal ID arrays, and everything is released with the index.
 */
export class EvidenceInventoryIndex {
  /**
   * Reconciled records owned by this index.
   *
   * Validation appends findings here before normalization. Internal methods
   * borrow immutable records; public facades capture inputs and copy
   * projections before exposing them.
   */
  private readonly data: IEvidenceInventory;

  /**
   * Semantic identity lookup over the reconciled units.
   *
   * Parent traversal uses these IDs rather than public names. The same table
   * supports validation of addresses, hosts, and selected identities.
   */
  private readonly units = new Map<string, IEvidenceUnit>();

  /**
   * Effective withdrawals for each unit, including its ancestors' directives.
   *
   * Validation computes these chains once. Selection excludes affected units,
   * while resolution retains the directive locations to explain hidden
   * targets.
   */
  private readonly withdrawals = new Map<string, IEvidenceWithdrawal[]>();

  /** Effective hidden state computed once through explicit parents. */
  private readonly hiddenIds: Set<string> = new Set();

  /** Units whose parent chain enters a cycle, including cycle members. */
  private readonly cyclicIds: Set<string> = new Set();

  /**
   * Unit IDs grouped by public address, keyed by file and serialized segments.
   *
   * Built on first resolution from the normalized addresses so each lookup is a
   * map access instead of a scan of every address.
   */
  private addressIndex: Map<string, string[]> | undefined;

  /**
   * Position of each unit in the normalized unit order.
   *
   * Resolution sorts matches by it so results keep the deterministic order a
   * full scan would produce.
   */
  private unitOrder: Map<string, number> | undefined;

  /**
   * Visible and hidden structural scopes computed for one selected ID array.
   *
   * A reference resolves many citations against the same selection, so the
   * scopes are cached by array identity and dropped with the caller's array.
   * Internal callers keep selection arrays immutable; public facades snapshot
   * mutable caller arrays before passing them to this index.
   */
  private readonly scopeCache: WeakMap<
    string[],
    readonly [ReadonlySet<string>, ReadonlySet<string>]
  > = new WeakMap();

  /**
   * Captures, reconciles, and validates one or more adapter inventories.
   *
   * Public facades validate shapes before this internal boundary. Semantic
   * inconsistencies become inventory diagnostics so callers can inspect the
   * partial records and their incomplete status rather than receiving an
   * apparently healthy subset. With `fileScopes`, each file-addressed source
   * also gains a structural file unit so file-level citations resolve; adapters
   * publishing their own output leave it off.
   */
  public constructor(
    inventories: IEvidenceInventory[],
    options: IEvidenceInventoryOptions = {},
  ) {
    this.data = EvidenceInventoryMerge.combine(
      inventories.map(copyEvidenceInventory),
    );
    if (options.fileScopes === true) this.scopeFiles();
    for (const unit of this.data.units) this.units.set(unit.id, unit);
    this.indexParents();
    this.validate();
    this.normalize();
  }

  /**
   * Borrows the reconciled inventory for internal immutable use.
   *
   * The view includes diagnostics and incomplete records. Internal consumers
   * must not mutate it; public consumers receive a clone from the facade.
   *
   * @evidence contracts/common.md#principled-implementation The reconciled data is borrowed by internal callers, including diagnostics and incomplete records.
   * @evidence contracts/common.md#clear-and-simple-design Snapshot exposes the internal immutable view.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Only internal callers borrow this view; the public facade copies it.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the copy and what it includes.
   * @evidence contracts/performance.md#efficient-algorithms Constant time.
   * @evidence contracts/performance.md#reuse-equivalent-work Internal consumers share the same normalized view.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The borrowed view lives with this internal index.
   */
  public snapshot(): IEvidenceInventory {
    return this.data;
  }

  /**
   * Serializes the normalized inventory in stable schema order.
   *
   * Construction has already reconciled and sorted the collections. Serializing
   * therefore preserves deterministic output without changing selection state
   * or requiring callers to normalize a snapshot themselves.
   *
   * @evidence contracts/common.md#principled-implementation typia's JSON serializer writes the already normalized data in schema order.
   * @evidence contracts/common.md#clear-and-simple-design Serialization relies on construction-time normalization.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No ordering is recomputed or altered here.
   * @evidence contracts/common.md#meaningful-documentation The comment explains determinism.
   * @evidence contracts/performance.md#efficient-algorithms Linear in inventory size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Serialization is requested once per output.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The string is owned by the caller.
   */
  public serialize(): string {
    return typia.json.stringify(this.data);
  }

  /**
   * Projects selected identities and the structural context needed to resolve
   * them.
   *
   * Required units exclude effective withdrawals, while scopes include their
   * real ancestors. Hosts are narrowed to selected semantic owners, including
   * hosts without tags. Unknown requested IDs throw because they indicate an
   * invalid selection, rather than an empty configured population.
   *
   * @example
   *   // Selecting a method retains its class as a resolvable aggregate scope.
   *   // The class does not become an extra required unit unless its ID is selected.
   *
   * @evidence contracts/common.md#principled-implementation Requested IDs are validated, their ancestor closure kept for explanations, withdrawn units removed, visible scopes rebuilt from surviving units, and attached hosts narrowed to selected owners.
   * @evidence contracts/common.md#clear-and-simple-design Selection uses the private ancestor and hidden helpers.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unknown IDs throw instead of producing an empty population, and owners of only withdrawn units do not re-enter as scopes.
   * @evidence contracts/common.md#meaningful-documentation The comment explains units, scopes and hosts with an example; inline comments explain closure and scope rules.
   * @evidence contracts/performance.md#efficient-algorithms Linear in units and hosts plus ancestor walks of the requested IDs.
   * @evidence contracts/performance.md#reuse-equivalent-work It reuses the precomputed unit and withdrawal maps.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Returned arrays are local and their records borrow this internal index.
   */
  public select(ids: string[]): IEvidencePopulation {
    const requested = new Set(ids);
    const scopes = new Set<string>();
    // Keep the original closure for hidden-target explanations, even when a
    // requested unit is later removed by an inherited withdrawal.
    for (const id of requested) {
      if (!this.units.has(id))
        throw new Error(`Unknown selected semantic identity: ${id}`);
      this.closeParents(id, scopes);
    }
    const visible = this.data.units.filter(
      (unit) => requested.has(unit.id) && !this.hidden(unit.id),
    );
    const selected = new Set(visible.map((unit) => unit.id));
    // Only ancestors of surviving requirements remain visible scopes. An owner
    // of exclusively withdrawn units must not re-enter through aggregate lookup.
    const visibleScopes: Set<string> = new Set();
    for (const unit of visible) this.closeParents(unit.id, visibleScopes);
    return {
      units: visible,
      scopes: this.data.units.filter((unit) => visibleScopes.has(unit.id)),
      hidden: this.data.units.filter(
        (unit) => scopes.has(unit.id) && this.hidden(unit.id),
      ),
      hosts: this.data.hosts
        .filter(
          (host) =>
            host.attachment === "attached" &&
            host.unitIds.some((id) => selected.has(id)),
        )
        .map((host) => ({
          ...host,
          unitIds: host.unitIds.filter((id) => selected.has(id)),
        })),
      complete: this.data.complete,
      diagnostics: this.data.diagnostics,
    };
  }

  /**
   * Resolves an exact public address inside a selected population's structural
   * scope.
   *
   * Aliases resolving to one unit are deduplicated by identity; distinct
   * matching units remain ambiguous. A withdrawn match carries its withdrawal
   * locations. Incomplete inventory takes precedence over all apparent matches
   * because missing extraction may hide another candidate or invalidate the
   * population.
   *
   * @evidence contracts/common.md#principled-implementation The exact file and segments are matched against public addresses within the selected population's visible and hidden scopes, deduplicating aliases by unit ID.
   * @evidence contracts/common.md#clear-and-simple-design Resolution uses the cached selection scopes, the address index and the withdrawal map; select remains the owner of population projection.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Incompleteness takes precedence over any apparent match, and several distinct units are ambiguous rather than arbitrarily chosen.
   * @evidence contracts/common.md#meaningful-documentation The comment explains alias deduplication, withdrawal and incompleteness precedence.
   * @evidence contracts/performance.md#efficient-algorithms After the first call per selection, a resolution costs one scope-cache lookup, one address lookup and sorting its few matches; computing a selection's scopes is linear in units, once per ID array.
   * @evidence contracts/performance.md#reuse-equivalent-work Selection scopes are reused for every citation resolved against the same ID array, and the address index is shared by all resolutions.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Returned arrays are local and their records borrow this internal index.
   */
  public resolve(
    address: IEvidenceAddress,
    ids: string[],
  ): IEvidenceResolution {
    const [visible, hidden] = this.scopes(ids);
    const matching: IEvidenceUnit[] = this.matches(address);
    const found: IEvidenceUnit[] = matching.filter((unit) =>
      visible.has(unit.id),
    );
    const withdrawn: IEvidenceUnit[] = matching.filter((unit) =>
      hidden.has(unit.id),
    );
    // A partial inventory cannot prove uniqueness or absence. Preserve that
    // uncertainty before choosing resolved, ambiguous, hidden, or missing.
    return {
      status: !this.data.complete
        ? "incomplete"
        : found.length > 1
          ? "ambiguous"
          : found.length === 1
            ? "resolved"
            : withdrawn.length > 0
              ? "hidden"
              : "missing",
      units: found.length === 0 ? withdrawn : found,
      withdrawals: EvidenceInventoryMerge.unique(
        withdrawn.flatMap((unit: IEvidenceUnit): IEvidenceWithdrawal[] =>
          this.inheritedWithdrawals(unit.id),
        ),
        (value) => typia.json.stringify(value),
      ),
    };
  }

  /**
   * Returns the visible and hidden structural scopes of a selection.
   *
   * This mirrors select without cloning: visible scopes are the ancestors of
   * requested units that are not withdrawn, and hidden units are withdrawn
   * members of the requested units' ancestry. Unknown IDs throw like select.
   */
  private scopes(
    ids: string[],
  ): readonly [ReadonlySet<string>, ReadonlySet<string>] {
    const cached = this.scopeCache.get(ids);
    if (cached !== undefined) return cached;
    const closure: Set<string> = new Set<string>();
    const visible: Set<string> = new Set<string>();
    for (const id of new Set(ids)) {
      if (!this.units.has(id))
        throw new Error(`Unknown selected semantic identity: ${id}`);
      this.closeParents(id, closure);
      if (!this.hidden(id)) this.closeParents(id, visible);
    }
    const hidden: Set<string> = new Set(
      [...closure].filter((id: string): boolean => this.hidden(id)),
    );
    const scopes = [visible, hidden] as const;
    this.scopeCache.set(ids, scopes);
    return scopes;
  }

  /**
   * Returns the units that publish an exact address, in normalized unit order.
   *
   * The address index and unit order are built on first use from the normalized
   * records, which never change afterward.
   */
  private matches(address: IEvidenceAddress): IEvidenceUnit[] {
    if (this.addressIndex === undefined || this.unitOrder === undefined) {
      const index: Map<string, string[]> = new Map<string, string[]>();
      for (const candidate of this.data.addresses) {
        const key: string = JSON.stringify([
          candidate.file,
          candidate.segments,
        ]);
        const entries: string[] = index.get(key) ?? [];
        if (!entries.includes(candidate.unitId)) entries.push(candidate.unitId);
        index.set(key, entries);
      }
      this.addressIndex = index;
      this.unitOrder = new Map(
        this.data.units.map((unit: IEvidenceUnit, position: number) => [
          unit.id,
          position,
        ]),
      );
    }
    const order: Map<string, number> = this.unitOrder;
    const ids: string[] =
      this.addressIndex.get(JSON.stringify([address.file, address.segments])) ??
      [];
    return ids
      .flatMap((id: string): IEvidenceUnit[] => {
        const unit: IEvidenceUnit | undefined = this.units.get(id);
        return unit === undefined ? [] : [unit];
      })
      .sort(
        (x: IEvidenceUnit, y: IEvidenceUnit): number =>
          (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0),
      );
  }

  /**
   * Tests whether a semantic identity is removed by its own or an inherited
   * withdrawal.
   *
   * The map is populated during validation from the explicit parent chain.
   * Consumers use this predicate after retaining structural closure, so a
   * hidden ancestor can still be named in a diagnostic without returning it as
   * a visible requirement.
   */
  private hidden(id: string): boolean {
    return this.hiddenIds.has(id);
  }

  /**
   * Computes hidden and cycle reachability once per parent edge, including
   * malformed cycles.
   */
  private indexParents(): void {
    const complete: Set<string> = new Set();
    for (const unit of this.units.values()) {
      if (complete.has(unit.id)) continue;
      const trail: IEvidenceUnit[] = [];
      const positions: Map<string, number> = new Map();
      let current: IEvidenceUnit | undefined = unit;
      while (
        current !== undefined &&
        !complete.has(current.id) &&
        !positions.has(current.id)
      ) {
        positions.set(current.id, trail.length);
        trail.push(current);
        current =
          current.parentId === undefined
            ? undefined
            : this.units.get(current.parentId);
      }
      const cyclic: boolean =
        current !== undefined &&
        (positions.has(current.id) || this.cyclicIds.has(current.id));
      let hidden: boolean =
        current !== undefined && this.hiddenIds.has(current.id);
      const cycle: number | undefined =
        current === undefined ? undefined : positions.get(current.id);
      if (cycle !== undefined)
        hidden ||= trail
          .slice(cycle)
          .some(
            (entry: IEvidenceUnit): boolean => entry.withdrawals.length !== 0,
          );
      for (let index: number = trail.length - 1; index >= 0; --index) {
        const entry: IEvidenceUnit | undefined = trail[index];
        if (entry === undefined) continue;
        hidden ||= entry.withdrawals.length !== 0;
        if (hidden) this.hiddenIds.add(entry.id);
        if (cyclic) this.cyclicIds.add(entry.id);
        complete.add(entry.id);
      }
    }
  }

  /**
   * Builds directive locations in original child-to-root order only for an
   * explanation.
   */
  private inheritedWithdrawals(id: string): IEvidenceWithdrawal[] {
    if (!this.hidden(id)) return [];
    let directives: IEvidenceWithdrawal[] | undefined =
      this.withdrawals.get(id);
    if (directives === undefined) {
      directives = this.ancestors(id).flatMap(
        (unit: IEvidenceUnit): IEvidenceWithdrawal[] => unit.withdrawals,
      );
      this.withdrawals.set(id, directives);
    }
    return directives;
  }

  /**
   * Adds a parent closure, stopping as soon as an earlier selected chain
   * already covers it.
   */
  private closeParents(id: string, output: Set<string>): void {
    let current: IEvidenceUnit | undefined = this.units.get(id);
    while (current !== undefined && !output.has(current.id)) {
      output.add(current.id);
      current =
        current.parentId === undefined
          ? undefined
          : this.units.get(current.parentId);
    }
  }

  /**
   * Returns an identity and its reachable structural ancestors in child-to-root
   * order.
   *
   * Selection uses this closure for aggregate addresses and inherited
   * withdrawals. The visited set bounds malformed parent cycles; validation
   * reports the cycle separately rather than letting a lookup or diagnostic
   * construction loop forever.
   */
  private ancestors(id: string): IEvidenceUnit[] {
    const output: IEvidenceUnit[] = [];
    const seen = new Set<string>();
    let current = this.units.get(id);
    while (current !== undefined && !seen.has(current.id)) {
      output.push(current);
      seen.add(current.id);
      current =
        current.parentId === undefined
          ? undefined
          : this.units.get(current.parentId);
    }
    return output;
  }

  /**
   * Checks that merged records still describe a coherent source and ownership
   * graph.
   *
   * Validation is deliberately non-throwing for semantic contradictions. Each
   * finding marks the inventory incomplete and remains available to graph
   * reporting, while malformed runtime input has already failed shape
   * validation at construction.
   */
  private validate(): void {
    const sources = new Map<string, EvidenceSourceText>();
    for (const source of this.data.sources) {
      const text = new EvidenceSourceText(source.content);
      for (const file of [
        source.physicalPath,
        ...source.addresses.map((address) => address.absolute),
      ]) {
        const previous = sources.get(file);
        if (previous !== undefined && previous.content !== source.content)
          this.problem(
            "inventory-source",
            "One source path names different source contents.",
            { file },
          );
        sources.set(file, text);
      }
    }
    // Source-coordinate checks run before cross-record ownership checks so every
    // later site, host, declaration, and review can use the same original text map.
    const sites = new Map<string, IEvidenceUnitSite>();
    for (const annotation of this.data.annotationRanges)
      this.checkLocation(annotation, sources);
    for (const unit of this.data.units) {
      if (unit.sites.length === 0)
        this.problem(
          "inventory-site",
          `Identity ${unit.id} has no declaration site.`,
        );
      const ownSites = new Map<string, IEvidenceUnitSite>();
      for (const site of unit.sites) {
        const ownPrevious = ownSites.get(site.id);
        if (
          ownPrevious !== undefined &&
          (EvidenceInventoryMerge.siteKey(ownPrevious) !==
            EvidenceInventoryMerge.siteKey(site) ||
            EvidenceInventoryMerge.contentKey(ownPrevious) !==
              EvidenceInventoryMerge.contentKey(site))
        )
          this.problem(
            "inventory-content",
            `Identity ${unit.id} assigns conflicting content to site ${site.id}.`,
            site,
          );
        ownSites.set(site.id, site);
        const previous = sites.get(site.id);
        if (
          previous !== undefined &&
          EvidenceInventoryMerge.siteKey(previous) !==
            EvidenceInventoryMerge.siteKey(site)
        )
          this.problem(
            "inventory-site",
            `Declaration site ${site.id} has conflicting locations.`,
            site,
          );
        sites.set(site.id, site);
        this.checkLocation(site, sources);
        for (const range of site.content) {
          this.checkLocation({ file: site.file, range }, sources);
          if (
            range.start.offset < site.range.start.offset ||
            range.end.offset > site.range.end.offset
          )
            this.problem(
              "inventory-content",
              `Content of ${unit.id} lies outside its declaration site.`,
              site,
            );
        }
      }
      if (unit.parentId !== undefined && !this.units.has(unit.parentId))
        this.problem(
          "inventory-parent",
          `Identity ${unit.id} names missing parent ${unit.parentId}.`,
        );
      if (this.cyclicIds.has(unit.id))
        this.problem(
          "inventory-cycle",
          `The parent chain of ${unit.id} contains a cycle.`,
        );
      for (const withdrawal of unit.withdrawals)
        this.checkLocation(withdrawal.location, sources);
    }
    for (const address of this.data.addresses)
      if (!this.units.has(address.unitId))
        this.problem(
          "inventory-address",
          `Public address names missing identity ${address.unitId}.`,
          { file: address.file },
        );
    // Annotation attachment is valid only when a host belongs to a declaration
    // site. A matching file name alone is insufficient for generated or repeated text.
    const hosts = new Map(this.data.hosts.map((host) => [host.id, host]));
    for (const host of this.data.hosts) {
      this.checkLocation(host, sources);
      if (host.attachment === "attached") {
        if (host.unitIds.length === 0 && host.siteId !== undefined)
          this.problem(
            "inventory-host",
            `Attached semantic host ${host.id} has no semantic owner.`,
            host,
          );
        if (host.unitIds.length !== 0 && host.siteId === undefined)
          this.problem(
            "inventory-host",
            `Attached semantic host ${host.id} has no declaration site.`,
            host,
          );
        for (const id of host.unitIds) {
          const unit = this.units.get(id);
          if (
            unit === undefined ||
            !unit.sites.some(
              (site) => site.id === host.siteId && site.file === host.file,
            )
          )
            this.problem(
              "inventory-host",
              `Host ${host.id} is not attached to a declaration owned by ${id}.`,
              host,
            );
        }
      } else if (host.unitIds.length !== 0 || host.siteId !== undefined)
        this.problem(
          "inventory-host",
          `Unattached or unsupported host ${host.id} claims a semantic owner.`,
          host,
        );
    }
    for (const entry of this.data.declarations) {
      this.checkLocation(entry.location, sources);
      const host = hosts.get(entry.hostId);
      const range = entry.location.range;
      if (
        host === undefined ||
        host.attachment !== "attached" ||
        range === undefined ||
        host.file !== entry.location.file ||
        range.start.offset < host.range.start.offset ||
        range.end.offset > host.range.end.offset
      )
        this.problem(
          "inventory-host",
          `Annotation ${entry.id} does not belong to an eligible documentation host.`,
          entry.location,
        );
    }
    for (const entry of this.data.reviews) {
      this.checkLocation(entry.location, sources);
      const host = hosts.get(entry.hostId);
      const range = entry.location.range;
      if (
        host === undefined ||
        host.attachment !== "attached" ||
        range === undefined ||
        host.file !== entry.location.file ||
        range.start.offset < host.range.start.offset ||
        range.end.offset > host.range.end.offset
      )
        this.problem(
          "inventory-host",
          `Review ${entry.id} does not belong to an eligible documentation host.`,
          entry.location,
        );
    }
  }

  /**
   * Verifies that an optional source range belongs to the recorded source
   * snapshot.
   *
   * Adapter records must point into the exact original content, not merely to a
   * path that happens to exist. Missing source text, absent ranges, and
   * out-of-bounds coordinates all make later diagnostics and fingerprints
   * unreliable.
   */
  private checkLocation(
    location: IEvidenceSourceLocation,
    sources: Map<string, EvidenceSourceText>,
  ): void {
    const text = sources.get(location.file);
    if (
      text === undefined ||
      location.range === undefined ||
      !text.contains(location.range)
    )
      this.problem(
        "inventory-location",
        "A declaration location does not match its original source snapshot.",
        location,
      );
  }

  /**
   * Appends one inventory diagnostic and permanently marks this snapshot
   * incomplete.
   *
   * This central path keeps all validation failures visible to the graph
   * evaluator. An optional location is reduced to the portable file/range form
   * accepted by the report schema, preserving a specific repair site when the
   * source record supplied one.
   */
  private problem(
    code: string,
    message: string,
    location?: IEvidenceSourceLocation,
  ): void {
    this.data.complete = false;
    this.data.diagnostics.push({
      code,
      severity: "error",
      message,
      repair:
        "Correct the adapter's source, identity, or ownership records before evaluating coverage.",
      ...(location === undefined
        ? {}
        : {
            location: {
              file: location.file,
              ...(location.range === undefined
                ? {}
                : { range: location.range }),
            },
          }),
    });
  }

  /**
   * Deduplicates and canonically orders merged records after validation.
   *
   * Normalization does not repair contradictions already reported. It only
   * gives snapshots, serialized output, and diagnostic ordering a stable
   * representation when equivalent adapter records arrived from independent
   * scan inputs.
   */
  /**
   * Gives each file-addressed source a structural file unit owning its
   * top-level declarations.
   *
   * Markdown already publishes one per document. Every other file-addressed
   * adapter publishes declarations without an owner, so a file-only target such
   * as `src/a.ts` had nothing to resolve to. The synthesized unit carries the
   * source's public spellings with empty segments and no own content, so an
   * exclusion on it propagates to every declaration of the file through the
   * ordinary descendant rule, and its fingerprint changes exactly when one of
   * them does. Existing fingerprints are unaffected because a fingerprint
   * covers only a unit's own subtree.
   */
  private scopeFiles(): void {
    const existing: Set<string> = new Set(
      this.data.units.map((unit: IEvidenceUnit): string => unit.id),
    );
    const sources: Map<string, IEvidenceSourceFile> = new Map(
      this.data.sources.map((source: IEvidenceSourceFile) => [
        source.physicalPath,
        source,
      ]),
    );
    // Physical aliases can leave several records of one source until
    // normalization; merge their spellings so input order cannot choose them.
    const spellings: Map<string, IEvidenceSourceAddress[]> = new Map();
    for (const source of this.data.sources)
      spellings.set(source.id, [
        ...(spellings.get(source.id) ?? []),
        ...source.addresses,
      ]);
    const members: Map<string, IEvidenceUnit[]> = new Map();
    for (const unit of this.data.units) {
      // A file unit from an earlier capture owns declarations; it has no owner.
      if (
        unit.parentId !== undefined ||
        unit.symbol === "file" ||
        UNSCOPED_TYPES.has(unit.type)
      )
        continue;
      const files: string[] = EvidenceInventoryMerge.unique(
        unit.sites.map((site: IEvidenceUnitSite): string => site.file),
        (file: string): string => file,
      );
      const file: string | undefined = files[0];
      // A unit declared across several files has no single owning file. One
      // file must not retire a declaration another file still contributes.
      if (files.length !== 1 || file === undefined) continue;
      const key: string = JSON.stringify([unit.type, file]);
      const group: IEvidenceUnit[] = members.get(key) ?? [];
      group.push(unit);
      members.set(key, group);
    }
    for (const group of members.values()) {
      const first: IEvidenceUnit | undefined = group[0];
      const file: string | undefined = first?.sites[0]?.file;
      const source: IEvidenceSourceFile | undefined =
        file === undefined ? undefined : sources.get(file);
      if (first === undefined || file === undefined || source === undefined)
        continue;
      const id: string = `${first.type}:${source.id}:file`;
      const addresses: IEvidenceSourceAddress[] =
        EvidenceInventoryMerge.sourceAddresses(spellings.get(source.id) ?? []);
      if (!existing.has(id)) {
        existing.add(id);
        this.data.units.push({
          id,
          type: first.type,
          symbol: "file",
          identity: [],
          name: addresses[0]?.relative ?? source.physicalPath,
          sites: [
            {
              id: `${id}:site`,
              file,
              range: EvidenceSourceText.of(source.content).range(
                0,
                source.content.length,
              ),
              content: [],
            },
          ],
          withdrawals: [],
        });
        for (const address of addresses)
          if (address.selected !== false)
            this.data.addresses.push({
              unitId: id,
              file: address.absolute,
              segments: [],
            });
      }
      for (const unit of group) unit.parentId = id;
    }
  }

  private normalize(): void {
    this.data.sources = EvidenceInventoryMerge.unique(
      this.data.sources,
      (source) => source.id,
    );
    for (const source of this.data.sources)
      source.addresses = EvidenceInventoryMerge.sourceAddresses(
        source.addresses,
      );
    this.data.annotationRanges = EvidenceInventoryMerge.unique(
      this.data.annotationRanges,
      (location) => typia.json.stringify(location),
    );
    this.data.units = EvidenceInventoryMerge.unique(
      this.data.units,
      (unit) => unit.id,
    );
    for (const unit of this.data.units) {
      unit.sites = EvidenceInventoryMerge.unique(unit.sites, (site) => site.id);
      for (const site of unit.sites)
        site.content = EvidenceInventoryMerge.unique(site.content, (range) =>
          JSON.stringify([range.start.offset, range.end.offset]),
        ).sort((x, y) => {
          const start = x.start.offset - y.start.offset;
          return start !== 0 ? start : x.end.offset - y.end.offset;
        });
      unit.withdrawals = EvidenceInventoryMerge.unique(
        unit.withdrawals,
        (withdrawal) => typia.json.stringify(withdrawal),
      );
    }
    this.data.addresses = EvidenceInventoryMerge.unique(
      this.data.addresses,
      (address) =>
        JSON.stringify([address.file, address.segments, address.unitId]),
    );
    this.data.hosts = EvidenceInventoryMerge.unique(
      this.data.hosts,
      (host) => host.id,
    );
    for (const host of this.data.hosts) {
      host.unitIds = EvidenceInventoryMerge.unique(host.unitIds, (id) => id);
      host.origins = EvidenceInventoryMerge.unique(
        host.origins ?? [host.file],
        (file) => file,
      );
      // Citation origin is required to explain generated or shared hosts. Keep the
      // host record for diagnostics instead of silently deleting an invalid entry.
      if (host.origins.length === 0)
        this.problem(
          "inventory-host",
          `Host ${host.id} has no citation origin.`,
          host,
        );
    }
    this.data.declarations = EvidenceInventoryMerge.unique(
      this.data.declarations,
      (entry) => entry.id,
    );
    this.data.reviews = EvidenceInventoryMerge.unique(
      this.data.reviews,
      (entry) => entry.id,
    );
    this.data.dependencies = EvidenceInventoryMerge.unique(
      this.data.dependencies,
      (dependency) => JSON.stringify([dependency.path, dependency.recursive]),
    );
    this.data.diagnostics = EvidenceInventoryMerge.unique(
      this.data.diagnostics,
      (diagnostic: IEvidenceDiagnostic) => typia.json.stringify(diagnostic),
    );
  }
}

/**
 * Artifact types whose units never receive a synthesized file unit.
 *
 * Markdown publishes its own file unit, and Prisma and Swagger address
 * schema-wide identities that no single file owns.
 */
const UNSCOPED_TYPES: ReadonlySet<string> = new Set([
  "markdown",
  "prisma",
  "swagger",
]);
