import type { IEvidenceMaterializedClaim } from "../internal/IEvidenceMaterializedClaim";
import type { IEvidenceHost } from "../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";

/**
 * Holds claim-local indexes while materializing graph reference obligations.
 *
 * Preparation reconciles the claim inventory once, maps declarations to the
 * references where they apply, and keeps review applicability separate. Graph
 * construction consumes this context before it creates per-reference resolution
 * state, preserving independent obligations under one claim.
 */
export interface IEvidenceClaimContext {
  /**
   * Materialized claim input before graph-specific contexts are produced.
   *
   * It contains the configuration-plan coordinates and adapter inventories from
   * the same checker execution, which keeps declaration locations aligned.
   */
  readonly materialized: IEvidenceMaterializedClaim;

  /**
   * Reconciled claim inventory that receives preparation diagnostics.
   *
   * Invalid hosts or participation targets make this inventory incomplete so
   * later graph evaluation can preserve the failure instead of dropping
   * records.
   */
  readonly inventory: IEvidenceInventory;

  /**
   * Claim hosts indexed by the semantic identity that owns their annotations.
   *
   * Multiple physical sites can describe one host identity; the map provides
   * the canonical semantic attachment point used during acknowledgement
   * matching.
   */
  readonly hosts: Map<string, IEvidenceHost>;

  /**
   * Reference positions to which each acknowledgement applies for coverage.
   *
   * The set preserves repeated reference boundaries. An absent entry means
   * another claim that reads the same annotation owns it, so this claim neither
   * evaluates nor reports it. An empty set means no reference of this claim can
   * interpret the annotation and no other claim owns it.
   */
  readonly declarations: Map<string, Set<number>>;

  /**
   * Reference positions to which each review applies, independent of coverage.
   *
   * A review can target a reference without being an acknowledgement. Keeping
   * its index separately prevents review metadata from changing coverage
   * counts. Absent and empty entries follow the same ownership meaning as
   * {@link declarations}.
   */
  readonly reviews: Map<string, Set<number>>;
}
