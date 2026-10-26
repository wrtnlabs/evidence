import type { IEvidenceGraphReference } from "../structures/IEvidenceGraphReference";
import type { IEvidenceGraphEdge } from "../structures/IEvidenceGraphEdge";
import type { EvidenceAcknowledgementKind } from "../typings/EvidenceAcknowledgementKind";
/**
 * Indexes accepted edges for conflicts and positive cardinality within one
 * obligation.
 *
 * @evidence contracts/common.md#principled-implementation Scope keys contain kind and selected unit plus semantic host for checklists; earliest edge positions preserve first-match diagnostics.
 * @evidence contracts/common.md#clear-and-simple-design The obligation keeps its accepted edge order while this class indexes conflict scopes and positive cardinality relations.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Only accepted edges enter the maps; earliest positions preserve diagnostics and cardinality sets are populated only when their policies are enabled.
 * @evidence contracts/common.md#meaningful-documentation Comments explain obligation ownership, earliest overlap precedence and positive host-target duplicate identity.
 * @evidence contracts/performance.md#efficient-algorithms Insertion and queries follow actual covered-unit/host relations, avoiding scans of unrelated edges.
 * @evidence contracts/performance.md#reuse-equivalent-work One index is updated as edges are accepted and reused by conflict and cardinality checks.
 * @evidence contracts/performance.md#bound-retention-and-release-resources It borrows the obligation edge array and owns relation maps released after that obligation.
 */
export class EvidenceGraphEdgeIndex {
  /** Accepted edges in diagnostic processing order. */
  private readonly edges: IEvidenceGraphEdge[];

  /** Whether conflict scopes include semantic claim hosts. */
  private readonly checklist: boolean;

  /** Whether positive target cardinality is required for claim hosts. */
  private readonly singleEvidence: boolean;

  /** Whether distinct positive hosts must be counted per reference unit. */
  private readonly uniqueEvidence: boolean;

  /** Earliest edge per kind and overlap scope. */
  private readonly scopes: Map<string, number> = new Map();

  /** Positive host/target pairs used by duplicate detection. */
  private readonly evidence: Set<string> = new Set();

  /** Distinct positive selected targets per semantic claim host. */
  public readonly hostTargets: Map<string, Set<string>> = new Map();

  /** Distinct positive semantic hosts per selected reference unit. */
  public readonly unitHosts: Map<string, Set<string>> = new Map();

  /** Starts empty beside the accepted edge array. */
  public constructor(
    edges: IEvidenceGraphEdge[],
    policy: IEvidenceGraphReference,
  ) {
    this.edges = edges;
    this.checklist = policy.checklist === true;
    this.singleEvidence = policy.singleEvidencePerSymbol === true;
    this.uniqueEvidence = policy.uniqueEvidence === true;
  }

  /**
   * Indexes the edge just appended to this obligation, retaining earliest
   * overlap positions.
   *
   * @evidence contracts/common.md#principled-implementation Kind and selected-unit scope keys optionally include checklist hosts; positive edges also populate distinct host-target and unit-host sets.
   * @evidence contracts/common.md#clear-and-simple-design The obligation keeps its accepted edge order while this class indexes conflict scopes and positive cardinality relations.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Only accepted edges enter the maps; earliest positions preserve diagnostics and cardinality sets are populated only when their policies are enabled.
   * @evidence contracts/common.md#meaningful-documentation Comments explain obligation ownership, earliest overlap precedence and positive host-target duplicate identity.
   * @evidence contracts/performance.md#efficient-algorithms Linear in actual unit/host relations on the appended edge.
   * @evidence contracts/performance.md#reuse-equivalent-work Later duplicate, conflict and cardinality checks reuse these incrementally derived relations.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Maps grow with accepted semantic relations and are released after the obligation.
   */
  public add(edge: IEvidenceGraphEdge): void {
    const position: number = this.edges.length - 1;
    const hosts: string[] = this.checklist ? edge.hostUnitIds : [""];
    for (const id of edge.unitIds)
      for (const host of hosts) {
        const key: string = JSON.stringify([edge.kind, id, host]);
        if (!this.scopes.has(key)) this.scopes.set(key, position);
      }
    if (edge.kind !== "evidence") return;
    for (const host of edge.hostUnitIds) {
      this.evidence.add(JSON.stringify([host, edge.targetUnitId]));
      if (this.singleEvidence) {
        const targets: Set<string> = this.hostTargets.get(host) ?? new Set();
        for (const id of edge.unitIds) targets.add(id);
        this.hostTargets.set(host, targets);
      }
    }
    if (this.uniqueEvidence)
      for (const id of edge.unitIds) {
        const owners: Set<string> = this.unitHosts.get(id) ?? new Set();
        for (const host of edge.hostUnitIds) owners.add(host);
        this.unitHosts.set(id, owners);
      }
  }

  /**
   * Finds the earliest accepted edge overlapping the requested semantic scope.
   *
   * @evidence contracts/common.md#principled-implementation Each unit and applicable host key retrieves its first position; the minimum position preserves prior array-find ordering.
   * @evidence contracts/common.md#clear-and-simple-design The obligation keeps its accepted edge order while this class indexes conflict scopes and positive cardinality relations.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Only accepted edges enter the maps; earliest positions preserve diagnostics and cardinality sets are populated only when their policies are enabled.
   * @evidence contracts/common.md#meaningful-documentation Comments explain obligation ownership, earliest overlap precedence and positive host-target duplicate identity.
   * @evidence contracts/performance.md#efficient-algorithms One lookup per requested unit and checklist host relation.
   * @evidence contracts/performance.md#reuse-equivalent-work The accepted-edge index supplies previously recorded positions.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Only local positions and keys are allocated; returned edges borrow the obligation.
   */
  public first(
    kind: EvidenceAcknowledgementKind,
    ids: string[],
    hostIds: string[],
  ): IEvidenceGraphEdge | undefined {
    let first: number = this.edges.length;
    const hosts: string[] = this.checklist ? hostIds : [""];
    for (const id of ids)
      for (const host of hosts)
        first = Math.min(
          first,
          this.scopes.get(JSON.stringify([kind, id, host])) ??
            this.edges.length,
        );
    return this.edges[first];
  }

  /**
   * Tests whether a positive edge repeats any semantic host and exact target
   * pair.
   *
   * @evidence contracts/common.md#principled-implementation Membership uses host-target keys populated only by accepted positive edges.
   * @evidence contracts/common.md#clear-and-simple-design The obligation keeps its accepted edge order while this class indexes conflict scopes and positive cardinality relations.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Only accepted edges enter the maps; earliest positions preserve diagnostics and cardinality sets are populated only when their policies are enabled.
   * @evidence contracts/common.md#meaningful-documentation Comments explain obligation ownership, earliest overlap precedence and positive host-target duplicate identity.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the supplied semantic host IDs.
   * @evidence contracts/performance.md#reuse-equivalent-work The positive relation set avoids rescanning preceding edges.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The method retains nothing beyond the owning index.
   */
  public duplicate(targetId: string, hosts: string[]): boolean {
    return hosts.some((host: string): boolean =>
      this.evidence.has(JSON.stringify([host, targetId])),
    );
  }
}
