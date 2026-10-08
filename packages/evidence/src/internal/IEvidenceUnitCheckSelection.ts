import type { EvidenceQueryPopulationContext } from "../contexts/EvidenceQueryPopulationContext";

/**
 * Indexes a focused unit selection within one configured population.
 *
 * Reference selections narrow incoming coverage; claim selections narrow
 * outgoing annotation and host-policy findings. Indexes borrow the captured
 * population without altering its configured policy.
 */
export interface IEvidenceUnitCheckSelection {
  /**
   * Configured boundary and inventory supplying selected identities.
   *
   * Repeated reference entries retain separate contexts.
   */
  population: EvidenceQueryPopulationContext;

  /**
   * Visible configured identities admitted by requested subtrees.
   *
   * Aliases and overlapping subtrees share one entry per identity.
   */
  unitIds: Set<string>;

  /**
   * Selected identities and their real structural ancestors.
   *
   * Incoming aggregate citations and reviews can name these scopes.
   */
  scopeIds: Set<string>;

  /**
   * Physical documentation hosts belonging to selected claim identities.
   *
   * Reference selections leave this empty because their incoming annotations
   * belong to the citing claim.
   */
  hostIds: Set<string>;

  /**
   * Claim identities whose citations touch selected reference scopes.
   *
   * Host cardinality retains its original full target set for these identities.
   */
  relatedUnitIds: Set<string>;

  /**
   * Host-and-target keys of annotations touching selected reference scopes.
   *
   * Both coordinates keep unrelated annotations on one carrier distinct.
   */
  statements: Set<string>;
}
