import { EvidenceInventoryIndex } from "./EvidenceInventoryIndex";
import { EvidenceTargetResolverIndex } from "./EvidenceTargetResolverIndex";
import { EvidenceFingerprintIndex } from "./EvidenceFingerprintIndex";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
import type { EvidenceArtifactType } from "../typings/EvidenceArtifactType";
/**
 * Shares derived inventory, resolution and fingerprint indexes within one
 * immutable analysis.
 *
 * @evidence contracts/common.md#principled-implementation Weak maps key complete inventory identity; file-scoped views are separate from claim views and resolver grammars remain distinct.
 * @evidence contracts/common.md#clear-and-simple-design Separate weak maps own plain views, file-scoped views, artifact resolvers and fingerprint memoization; methods return the corresponding session-owned index.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Only internally immutable inventories share identity-keyed entries; scope mode and artifact grammar remain part of equivalence.
 * @evidence contracts/common.md#meaningful-documentation Comments state immutable analysis ownership and distinguish normalization mode, artifact resolution and fingerprint state.
 * @evidence contracts/performance.md#efficient-algorithms Each view is reconciled once; subsequent index retrieval is constant time.
 * @evidence contracts/performance.md#reuse-equivalent-work The owner creates one cache per evaluation or query session; input records must remain immutable and fresh runs create new owners.
 * @evidence contracts/performance.md#bound-retention-and-release-resources Weak keys retain no dead inputs; values live at most as long as the owning session and its inventories.
 */
export class EvidenceAnalysisIndexes {
  /** Claim views without synthesized file scopes. */
  private readonly plain: WeakMap<IEvidenceInventory, EvidenceInventoryIndex> =
    new WeakMap();

  /** Resolution views with synthesized file scopes. */
  private readonly scoped: WeakMap<IEvidenceInventory, EvidenceInventoryIndex> =
    new WeakMap();

  /** Resolver instances separated by artifact grammar. */
  private readonly resolvers: WeakMap<
    IEvidenceInventory,
    Map<EvidenceArtifactType | undefined, EvidenceTargetResolverIndex>
  > = new WeakMap();

  /** Fingerprint memoization for each normalized immutable view. */
  private readonly fingerprints: WeakMap<
    IEvidenceInventory,
    EvidenceFingerprintIndex
  > = new WeakMap();

  /**
   * Borrows one normalized inventory view for the requested file-scope mode.
   *
   * @evidence contracts/common.md#principled-implementation A mode-specific WeakMap keys immutable input identity, reconciles once on a miss, and registers the normalized view as equivalent to itself.
   * @evidence contracts/common.md#clear-and-simple-design Separate weak maps own plain views, file-scoped views, artifact resolvers and fingerprint memoization; methods return the corresponding session-owned index.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Only internally immutable inventories share identity-keyed entries; scope mode and artifact grammar remain part of equivalence.
   * @evidence contracts/common.md#meaningful-documentation Comments state immutable analysis ownership and distinguish normalization mode, artifact resolution and fingerprint state.
   * @evidence contracts/performance.md#efficient-algorithms One linear reconciliation per inventory and mode; later accesses are constant time.
   * @evidence contracts/performance.md#reuse-equivalent-work Input identity and file-scope mode decide equivalence within this session.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Weak entries belong to this analysis owner and retain only live immutable inventories.
   */
  public inventory(
    input: IEvidenceInventory,
    fileScopes: boolean = false,
  ): EvidenceInventoryIndex {
    const cache: WeakMap<IEvidenceInventory, EvidenceInventoryIndex> =
      fileScopes ? this.scoped : this.plain;
    let index: EvidenceInventoryIndex | undefined = cache.get(input);
    if (index === undefined) {
      index = new EvidenceInventoryIndex([input], { fileScopes });
      cache.set(input, index);
      cache.set(index.snapshot(), index);
    }
    return index;
  }

  /**
   * Borrows the resolver for one immutable inventory and artifact grammar.
   *
   * @evidence contracts/common.md#principled-implementation A weak inventory map contains grammar-keyed resolvers over the shared file-scoped view.
   * @evidence contracts/common.md#clear-and-simple-design Separate weak maps own plain views, file-scoped views, artifact resolvers and fingerprint memoization; methods return the corresponding session-owned index.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Only internally immutable inventories share identity-keyed entries; scope mode and artifact grammar remain part of equivalence.
   * @evidence contracts/common.md#meaningful-documentation Comments state immutable analysis ownership and distinguish normalization mode, artifact resolution and fingerprint state.
   * @evidence contracts/performance.md#efficient-algorithms One resolver construction per inventory and grammar; retrieval is constant time.
   * @evidence contracts/performance.md#reuse-equivalent-work Selection IDs and statements remain per-call inputs while immutable address maps are reused.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Resolver maps die with this session or their inventory keys.
   */
  public resolver(
    input: IEvidenceInventory,
    type?: EvidenceArtifactType,
  ): EvidenceTargetResolverIndex {
    let cache:
      | Map<EvidenceArtifactType | undefined, EvidenceTargetResolverIndex>
      | undefined = this.resolvers.get(input);
    if (cache === undefined) {
      cache = new Map();
      this.resolvers.set(input, cache);
    }
    let resolver: EvidenceTargetResolverIndex | undefined = cache.get(type);
    if (resolver === undefined) {
      resolver = new EvidenceTargetResolverIndex(
        this.inventory(input, true),
        type,
      );
      cache.set(type, resolver);
    }
    return resolver;
  }

  /**
   * Borrows memoized fingerprints for one normalized immutable view.
   *
   * @evidence contracts/common.md#principled-implementation A WeakMap creates a fingerprint index on first use and returns it for the same view.
   * @evidence contracts/common.md#clear-and-simple-design Separate weak maps own plain views, file-scoped views, artifact resolvers and fingerprint memoization; methods return the corresponding session-owned index.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Only internally immutable inventories share identity-keyed entries; scope mode and artifact grammar remain part of equivalence.
   * @evidence contracts/common.md#meaningful-documentation Comments state immutable analysis ownership and distinguish normalization mode, artifact resolution and fingerprint state.
   * @evidence contracts/performance.md#efficient-algorithms One index construction linear in records, then constant-time retrieval.
   * @evidence contracts/performance.md#reuse-equivalent-work Only identical normalized view identity shares fingerprint state.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The weak entry and fingerprint memoization live with the owning analysis.
   */
  public fingerprint(input: IEvidenceInventory): EvidenceFingerprintIndex {
    let index: EvidenceFingerprintIndex | undefined =
      this.fingerprints.get(input);
    if (index === undefined) {
      index = new EvidenceFingerprintIndex(input);
      this.fingerprints.set(input, index);
    }
    return index;
  }
}
