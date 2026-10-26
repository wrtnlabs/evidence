import type { IEvidenceGraphHostCoverage } from "../structures/IEvidenceGraphHostCoverage";
import { EvidenceAnalysisIndexes } from "../internal/EvidenceAnalysisIndexes";
import type { EvidenceTargetResolverIndex } from "../internal/EvidenceTargetResolverIndex";
import type { EvidenceFingerprintIndex } from "../internal/EvidenceFingerprintIndex";
import { EvidenceQueryInventoryIndex } from "../internal/EvidenceQueryInventoryIndex";
import type { IEvidenceQueryPopulation } from "../internal/IEvidenceQueryPopulation";
import type { IEvidencePublicAddress } from "../structures/IEvidencePublicAddress";
import type { IEvidenceUnit } from "../structures/IEvidenceUnit";

/**
 * Indexes one configured population for repeated structural and coverage
 * queries.
 *
 * The containing facade owns the analysis snapshot. This context borrows its
 * records, distinguishes explicit selection from ancestor closure and
 * visibility, and caches descendant traversal without rebuilding indexes for
 * each operation.
 *
 * @evidence contracts/common.md#principled-implementation Units are indexed by ID, selection is closed over explicit parent links with cycle guards, visibility excludes withdrawn subtrees, and addresses are grouped per unit.
 * @evidence contracts/common.md#clear-and-simple-design The context borrows the facade's isolated snapshot and adds indexes; query programmers use it instead of building their own.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Parent ownership follows explicit parentId links, never dotted name prefixes.
 * @evidence contracts/common.md#meaningful-documentation The class comment explains borrowing and caching; every field and method is documented.
 * @evidence contracts/performance.md#efficient-algorithms Construction is linear in units, selection depth and addresses; later membership checks are constant time.
 * @evidence contracts/performance.md#reuse-equivalent-work Indexes are built once per population and selected-descendant lists are cached per ancestor for repeated queries.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The context borrows records owned by its analysis facade and holds only index maps that die with it.
 */
export class EvidenceQueryPopulationContext {
  /**
   * Claim or reference coordinates identifying the configured population.
   *
   * Query rows qualify semantic identities with this scope to retain
   * independent obligations.
   */
  public readonly scope: IEvidenceQueryPopulation["scope"];

  /**
   * Inventory borrowed from the containing facade's isolated analysis snapshot.
   *
   * It supplies full structural context, including units outside explicit
   * selection.
   */
  public readonly inventory: IEvidenceQueryPopulation["inventory"];

  /**
   * Configured semantic selection in its original order.
   *
   * Descendant results preserve this order rather than adopting map traversal
   * order.
   */
  public readonly unitIds: IEvidenceQueryPopulation["unitIds"];

  /**
   * Effective graph input when the population represents a reference.
   *
   * Claim populations leave this undefined because they do not own a reference
   * policy.
   */
  public readonly reference: IEvidenceQueryPopulation["reference"];

  /**
   * Evaluated obligation ledger for a reference population.
   *
   * Coverage inspection uses this alongside structural selection; claim entries
   * omit it.
   */
  public readonly obligation: IEvidenceQueryPopulation["obligation"];

  /**
   * Full inventory indexed by semantic unit identity.
   *
   * Parent traversal follows these explicit links instead of inferring
   * ownership from public accessor prefixes.
   */
  public readonly units: Map<string, IEvidenceUnit>;

  /**
   * Explicitly selected identities used for direct membership checks.
   *
   * Structural ancestors belong to configured closure separately and do not
   * increase this population's selected denominator.
   */
  public readonly selected: Set<string>;

  /**
   * Selected identities together with their existing structural ancestors.
   *
   * Withdrawn identities remain in this set for exact target applicability even
   * though visible discovery output excludes them.
   */
  public readonly configured = new Set<string>();

  /**
   * Configured identities with neither an own withdrawal nor a withdrawn
   * ancestor.
   *
   * List queries use this set to avoid advertising hidden public targets as
   * visible API.
   */
  public readonly visible = new Set<string>();

  /**
   * Public addresses grouped by semantic identity in inventory order.
   *
   * Formatting later sorts and deduplicates target spellings for each query
   * row.
   */
  public readonly addresses: Map<string, IEvidencePublicAddress[]>;

  /** Inventory-wide relations shared with other wrappers over the same view. */
  public readonly records: EvidenceQueryInventoryIndex;

  /** Address resolver shared for this immutable inventory and artifact grammar. */
  public get resolver(): EvidenceTargetResolverIndex {
    return this.indexes.resolver(this.inventory, this.scope.type);
  }

  /** Fingerprints shared for this immutable inventory. */
  public get fingerprints(): EvidenceFingerprintIndex {
    return this.indexes.fingerprint(this.inventory);
  }

  /** Configured exact target spellings, built once per captured cwd. */
  public readonly exactTargets: Map<string, Set<string>> = new Map();

  /** Session owner for lazily requested derived indexes. */
  private readonly indexes: EvidenceAnalysisIndexes;

  /**
   * Selected-descendant results retained per queried ancestor in this immutable
   * context.
   */
  private readonly descendants = new Map<string, string[]>();

  /** Direct obligation coverage, indexed once for constant-time membership. */
  public readonly covered: Set<string>;

  /** Direct obligation missing identities. */
  public readonly missing: Set<string>;

  /** Ancestors having a missing selected identity, including that identity. */
  public readonly subtreeMissing: Set<string> = new Set();

  /** Ancestors whose nonempty selected subtree is entirely covered. */
  public readonly subtreeCovered: Set<string> = new Set();

  /** Host answer ledgers indexed only if focused diagnostics request them. */
  private coverageIndex: Map<string, IEvidenceGraphHostCoverage> | undefined;

  /** Borrows obligation-local ledgers without rebuilding them per diagnostic. */
  public get hostCoverage(): ReadonlyMap<string, IEvidenceGraphHostCoverage> {
    this.coverageIndex ??= new Map(
      (this.obligation?.hostCoverage ?? []).map(
        (
          host: IEvidenceGraphHostCoverage,
        ): [string, IEvidenceGraphHostCoverage] => [host.hostUnitId, host],
      ),
    );
    return this.coverageIndex;
  }

  /**
   * Builds selection, visibility, and address indexes over an owned analysis
   * population.
   *
   * This constructor does not clone records itself; the containing facade
   * supplies isolated data. Parent walks stop at cycles or missing units so
   * inspection cannot loop.
   */
  public constructor(
    population: IEvidenceQueryPopulation,
    records: EvidenceQueryInventoryIndex = EvidenceQueryInventoryIndex.borrow(
      population.inventory,
    ),
    indexes: EvidenceAnalysisIndexes = new EvidenceAnalysisIndexes(),
  ) {
    this.scope = population.scope;
    this.inventory = population.inventory;
    this.unitIds = population.unitIds;
    this.reference = population.reference;
    this.obligation = population.obligation;
    this.records = records;
    this.indexes = indexes;
    this.units = records.units;
    this.addresses = records.addresses;
    this.selected = new Set(this.unitIds);
    this.covered = new Set(this.obligation?.coveredUnitIds ?? []);
    this.missing = new Set(this.obligation?.missingUnitIds ?? []);
    const counts: Map<string, number> = new Map();
    const coveredCounts: Map<string, number> = new Map();

    for (const id of this.unitIds) {
      let current = this.units.get(id);
      const visited = new Set<string>();
      while (current !== undefined && !visited.has(current.id)) {
        this.configured.add(current.id);
        counts.set(current.id, (counts.get(current.id) ?? 0) + 1);
        if (this.covered.has(id))
          coveredCounts.set(
            current.id,
            (coveredCounts.get(current.id) ?? 0) + 1,
          );
        if (this.missing.has(id)) this.subtreeMissing.add(current.id);
        visited.add(current.id);
        current =
          current.parentId === undefined
            ? undefined
            : this.units.get(current.parentId);
      }
    }
    for (const [id, count] of counts)
      if (count !== 0 && coveredCounts.get(id) === count)
        this.subtreeCovered.add(id);
    // Preserve structural closure before applying withdrawal. Exact inspection
    // still needs to recognize a configured target and explain why it is hidden.
    for (const id of this.configured) {
      let current = this.units.get(id);
      const visited = new Set<string>();
      let withdrawn = false;
      while (current !== undefined && !visited.has(current.id)) {
        if (current.withdrawals.length !== 0) {
          withdrawn = true;
          break;
        }
        visited.add(current.id);
        current =
          current.parentId === undefined
            ? undefined
            : this.units.get(current.parentId);
      }
      if (!withdrawn) this.visible.add(id);
    }
  }

  /**
   * Returns selected descendants in configured order, including a selected
   * ancestor itself.
   *
   * The cached result follows explicit parent relationships. Callers receive a
   * readonly view because mutating it would corrupt subsequent coverage
   * summaries.
   *
   * @evidence contracts/common.md#principled-implementation Traversing explicit child ownership with a cycle guard and filtering configured IDs preserves selection order and includes the selected ancestor itself.
   * @evidence contracts/common.md#clear-and-simple-design The method uses descends and caches its result.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Callers receive a readonly view so cached results cannot be corrupted.
   * @evidence contracts/common.md#meaningful-documentation The comment explains ordering, caching and the readonly result.
   * @evidence contracts/performance.md#efficient-algorithms First call visits the actual structural subtree and filters selected IDs in configured order; repeats are constant time.
   * @evidence contracts/performance.md#reuse-equivalent-work Results are memoized per ancestor because the snapshot is immutable.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The cache grows by at most one list per queried ancestor and lives as long as the context.
   */
  public selectedDescendants(ancestorId: string): readonly string[] {
    const remembered = this.descendants.get(ancestorId);
    if (remembered !== undefined) return remembered;
    const reached: Set<string> = new Set();
    const pending: string[] = [ancestorId];
    while (pending.length !== 0) {
      const id: string | undefined = pending.pop();
      if (id === undefined || reached.has(id) || !this.units.has(id)) continue;
      reached.add(id);
      for (const child of this.records.children.get(id) ?? [])
        pending.push(child.id);
    }
    const descendants: string[] = this.unitIds.filter((id: string): boolean =>
      reached.has(id),
    );
    this.descendants.set(ancestorId, descendants);
    return descendants;
  }

  /**
   * Tests whether an identity belongs to an ancestor's explicit structural
   * subtree.
   *
   * A unit descends from itself. Missing parents and cycles terminate the walk,
   * and literal dots in names never invent another ownership edge.
   *
   * @evidence contracts/common.md#principled-implementation Walking explicit parent links from the unit with a visited set answers subtree membership and terminates on cycles or missing parents.
   * @evidence contracts/common.md#clear-and-simple-design The method only walks parents.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Literal dots in names never create ownership edges.
   * @evidence contracts/common.md#meaningful-documentation The comment states self-descent and termination rules.
   * @evidence contracts/performance.md#efficient-algorithms O(d) for parent depth d.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each walk answers one pair; selectedDescendants caches aggregate results.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The method keeps no state after returning; its result is owned by the caller.
   */
  public descends(unitId: string, ancestorId: string): boolean {
    const visited = new Set<string>();
    let unit = this.units.get(unitId);
    while (unit !== undefined && !visited.has(unit.id)) {
      if (unit.id === ancestorId) return true;
      visited.add(unit.id);
      unit =
        unit.parentId === undefined ? undefined : this.units.get(unit.parentId);
    }
    return false;
  }
}
