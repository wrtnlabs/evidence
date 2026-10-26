import typia from "typia";
import { EvidenceGraphEvaluator } from "../internal/EvidenceGraphEvaluator";
import type { IEvidenceGraphInput } from "../structures/IEvidenceGraphInput";
import type { IEvidenceGraphResult } from "../structures/IEvidenceGraphResult";

/**
 * Evaluates coverage and review policies over captured, materialized
 * populations.
 *
 * The checker supplies inventories, selected unit IDs, target resolutions, and
 * reference policies. This facade validates and captures that input; it does
 * not load files or infer declarations. Each call creates a fresh evaluator and
 * returns an owned result, isolating prior diagnostics and caller mutations.
 *
 * Evaluation preserves the following boundaries:
 *
 * 1. Each claim selects its own semantic hosts and exclusion carriers.
 * 2. Each reference independently judges coverage, exclusions, cardinality,
 *    checklist answers, and review freshness, even when populations overlap.
 * 3. Incomplete analysis remains a failure rather than a passing smaller graph.
 * 4. Findings requiring cross-reference participation are finalized after all
 *    applicable references have been examined.
 *
 * @example
 *   const graph: EvidenceGraph = new EvidenceGraph(materializedInput);
 *   const first: IEvidenceGraphResult = graph.evaluate();
 *   const second: IEvidenceGraphResult = graph.evaluate();
 *   // The results have independent storage and no accumulated evaluator state.
 *
 * @evidence contracts/common.md#principled-implementation A facade asserts and clones materialized input, and each evaluate call runs a fresh private evaluator that reconciles every claim and reference inventory, applies coverage, exclusion, cardinality, checklist and review policies per obligation, and finalizes cross-reference findings last.
 * @evidence contracts/common.md#clear-and-simple-design The facade owns input capture; the private evaluator owns one traversal's accumulators and keeps them out of the facade.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Incomplete analysis fails its obligation, and deferred checklist findings wait for every applicable reference instead of guessing early.
 * @evidence contracts/common.md#meaningful-documentation The class comment lists the evaluation boundaries with an example; the facade members and the private evaluator's fields and methods are documented.
 * @evidence contracts/performance.md#efficient-algorithms Capture visits the input bytes once; evaluation indexes inventory records and selected ancestor relations, then processes statements, accepted edge-unit/host relations and fingerprint scope bytes. Deep ancestry and aggregate citations cost their actual relation counts.
 * @evidence contracts/performance.md#reuse-equivalent-work Within one traversal inventory and fingerprint indexes are shared for equivalent immutable views; nothing is shared across evaluate calls.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The facade retains only its cloned input; evaluator state is local to one call and released afterward.
 */
export class EvidenceGraph {
  /**
   * Validated input snapshot owned by this facade.
   *
   * Evaluators read this captured policy and inventory data. Neither later
   * caller edits nor modifications to an earlier result can change the
   * snapshot.
   */
  private readonly input: IEvidenceGraphInput;

  /**
   * Validates the input shape and captures an independent graph snapshot.
   *
   * Semantic inventory and resolution checks occur during evaluation so their
   * findings can be reported in graph context. Construction performs no source
   * IO.
   */
  public constructor(input: IEvidenceGraphInput) {
    this.input = structuredClone(typia.assert(input));
  }

  /**
   * Evaluates every independent obligation in the captured input.
   *
   * A fresh evaluator prevents coverage sets and deferred diagnostics from
   * leaking across calls. The returned clone also prevents consumers from
   * mutating records retained by the facade.
   *
   * @evidence contracts/common.md#principled-implementation A new evaluator processes the captured input and its result is cloned before returning.
   * @evidence contracts/common.md#clear-and-simple-design Evaluation logic lives in the private evaluator.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Fresh state per call keeps coverage sets and deferred diagnostics from leaking between calls.
   * @evidence contracts/common.md#meaningful-documentation The comment explains isolation and result ownership.
   * @evidence contracts/performance.md#efficient-algorithms Traverses indexed inventories, selected ancestor relations and accepted policy relations, computes required fingerprint scopes and clones the result bytes.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each call evaluates independently.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Evaluator state is released when the call returns; the cloned result is owned by the caller.
   */
  public evaluate(): IEvidenceGraphResult {
    return structuredClone(new EvidenceGraphEvaluator(this.input).evaluate());
  }

  /**
   * Captures and evaluates input without retaining a graph facade.
   *
   * This convenience entry point has the same validation and result ownership
   * as construction followed by the instance `evaluate` method.
   *
   * @evidence contracts/common.md#principled-implementation The static form captures and evaluates input without retaining a facade.
   * @evidence contracts/common.md#clear-and-simple-design It wraps construction plus the instance method.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Validation and ownership match the instance form.
   * @evidence contracts/common.md#meaningful-documentation The comment states its equivalence.
   * @evidence contracts/performance.md#efficient-algorithms Same cost as construction plus one evaluation.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work One-off evaluation has nothing to share.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Nothing outlives the call except the caller-owned result.
   */
  public static evaluate(input: IEvidenceGraphInput): IEvidenceGraphResult {
    return new EvidenceGraph(input).evaluate();
  }
}
