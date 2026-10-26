import type { EvidenceQueryPopulationContext } from "../contexts/EvidenceQueryPopulationContext";
import type { IEvidenceTargetResolution } from "../structures/IEvidenceTargetResolution";
/**
 * Keeps one resolved query target with its configured population boundary.
 *
 * @evidence contracts/common.md#principled-implementation Resolution carries semantic candidates while the context preserves independent selection and policy coordinates.
 * @evidence contracts/common.md#clear-and-simple-design The interface pairs an independent population context with its target resolver outcome before detailed inspection.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts The population accompanies each resolution so overlapping claim and reference boundaries retain their separate policies and selection.
 * @evidence contracts/common.md#meaningful-documentation Field comments distinguish the configured boundary from the resolver outcome before optional inspection details.
 * @evidence contracts/performance.md#efficient-algorithms This data contract chooses no algorithm; query resolution owns the work.
 * @evidence contracts/performance.md#reuse-equivalent-work Inspection and focused selection consume the same indexed target resolution.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The record borrows only query-owned data and is released with the operation.
 */
export interface IEvidenceQueryResolution {
  /** Independent claim or reference boundary interpreting the target. */
  population: EvidenceQueryPopulationContext;

  /** Resolver outcome before optional inspection details are projected. */
  resolution: IEvidenceTargetResolution;
}
