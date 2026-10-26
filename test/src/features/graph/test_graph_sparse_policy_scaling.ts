import { TestValidator } from "@nestia/e2e";
import { EvidenceGraph } from "@wrtnlabs/evidence";
import type {
  IEvidenceGraphInput,
  IEvidenceGraphReference,
  IEvidenceDiagnostic,
  IEvidenceGraphObligation,
  IEvidenceGraphResolution,
  IEvidenceGraphReviewResolution,
  IEvidenceGraphResult,
  IEvidenceInventory,
  IEvidenceUnit,
  IEvidenceHost,
  IEvidenceDeclaration,
} from "@wrtnlabs/evidence";
import { performance } from "node:perf_hooks";

import { EvidenceTestInventory } from "../../internal/EvidenceTestInventory";
import { EvidenceTestGraph } from "../../internal/EvidenceTestGraph";

/**
 * Evaluates thousands of disjoint policy relations without cross-product joins.
 *
 * The graph must preserve reference independence and review diagnostics even
 * when all cardinality relationships are sparse and valid.
 *
 * 1. Build 2,000 independent hosts, targets, positive citations and stale reviews.
 * 2. Evaluate ordinary and required-review reference entries over the same
 *    inventory; require complete coverage and exactly 2,000 stale reviews only
 *    on the latter boundary, with no duplicate or cardinality findings.
 * 3. Mutate a returned edge and reevaluate the captured graph; require its
 *    original result and unchanged caller input within a 15-second ceiling.
 *
 * @evidence contracts/testing.md#behavioral-verification Evaluates a large sparse graph twice and asserts coverage, reference attribution, review findings, input immutability, result isolation and a generous latency ceiling.
 * @evidence contracts/testing.md#independent-expectations Every target has exactly one distinct host and stale review, so both cardinality policies pass, all targets are covered, and only the required-review boundary reports one stale review per citation.
 * @evidence contracts/testing.md#distinguishing-cases Covers 2,000 disjoint relations, repeated inventory identity under different review policies, mutation and repeat evaluation. Aggregate overlap, conflicts and multi-owner review cases are covered by graph policy tests.
 * @evidence contracts/testing.md#execution-ownership The exported test_graph_sparse_policy_scaling is discovered by DynamicExecutor and calls EvidenceGraph directly using explicit inventory records without subprocesses or filesystem access.
 */
export async function test_graph_sparse_policy_scaling(): Promise<void> {
  const claim: IEvidenceInventory = EvidenceTestInventory.create();
  const reference: IEvidenceInventory = EvidenceTestInventory.create();
  const resolutions: IEvidenceGraphResolution[] = [];
  const reviews: IEvidenceGraphReviewResolution[] = [];
  for (let index: number = 0; index < 2000; ++index) {
    const owner: IEvidenceUnit = EvidenceTestInventory.unit(
      claim,
      `owner-${index}`,
      [`owner-${index}`],
      "function",
      "export const first = 1, second = 2;",
    );
    const target: IEvidenceUnit = EvidenceTestInventory.unit(
      reference,
      `target-${index}`,
      [`target-${index}`],
      "function",
      "export const unrelated = 3;",
    );
    const host: IEvidenceHost = EvidenceTestInventory.host(
      claim,
      `host-${index}`,
      `${owner.id}-site`,
      [owner.id],
      "/** Shared documentation. */",
    );
    const declaration: IEvidenceDeclaration = EvidenceTestGraph.declaration(
      claim,
      `declaration-${index}`,
      host,
      "evidence",
      `/project/source.ts#target-${index}`,
    );
    resolutions.push(EvidenceTestGraph.resolved(declaration, target));
    const id: string = `review-${index}`;
    claim.reviews.push({
      id,
      hostId: host.id,
      reviews: "evidence",
      target: declaration.target,
      description: "Reviewed an earlier revision.",
      fingerprint: "0000000",
      location: declaration.location,
    });
    reviews.push({
      reviewId: id,
      resolution: EvidenceTestGraph.resolution(target),
    });
  }
  const input: IEvidenceGraphInput = {
    claims: [
      {
        severity: "error",
        inventory: claim,
        unitIds: claim.units.map((unit: IEvidenceUnit): string => unit.id),
        references: [false, true].map(
          (requireReview: boolean): IEvidenceGraphReference => ({
            severity: "error",
            inventory: reference,
            unitIds: reference.units.map(
              (unit: IEvidenceUnit): string => unit.id,
            ),
            resolutions,
            reviewResolutions: reviews,
            singleEvidencePerSymbol: true,
            uniqueEvidence: true,
            requireReview,
          }),
        ),
      },
    ],
  };
  const captured: IEvidenceGraphInput = structuredClone(input);
  const graph: EvidenceGraph = new EvidenceGraph(input);
  const begin: number = performance.now();
  const result: IEvidenceGraphResult = graph.evaluate();
  TestValidator.equals(
    "one stale review per required edge",
    result.diagnostics.length,
    2000,
  );
  TestValidator.equals(
    "review findings keep their boundary",
    result.diagnostics.every(
      (diagnostic: IEvidenceDiagnostic): boolean =>
        diagnostic.code === "graph-stale-review" && diagnostic.reference === 1,
    ),
    true,
  );
  TestValidator.equals(
    "both references keep all coverage",
    result.claims[0]?.obligations.map(
      (obligation: IEvidenceGraphObligation): number =>
        obligation.coveredUnitIds.length,
    ),
    [2000, 2000],
  );
  TestValidator.equals("input remains immutable", input, captured);
  const baseline: IEvidenceGraphResult = structuredClone(result);
  result.claims[0]?.obligations[0]?.edges[0]?.unitIds.push("mutation");
  TestValidator.equals(
    "repeat evaluation isolates result mutation",
    graph.evaluate(),
    baseline,
  );
  TestValidator.predicate(
    "sparse graph batch stays below 15 seconds",
    performance.now() - begin < 15000,
  );
}
