import type { IEvidenceGraphHostCoverage } from "../structures/IEvidenceGraphHostCoverage";
import type { IEvidenceSourceFile } from "../structures/IEvidenceSourceFile";
import type { IEvidenceUnit } from "../structures/IEvidenceUnit";

/**
 * Reusable source lookups for one authored reference boundary.
 *
 * Context rendering builds this only for a displayed missing reference, then
 * reuses it for every diagnostic in the same boundary.
 *
 * @evidence contracts/common.md#principled-implementation Unit, source, address and checklist host identities are indexed independently within one reference boundary.
 * @evidence contracts/common.md#clear-and-simple-design One record groups the four lookups used to capture Markdown sections.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts The boundary owner constructs these maps from captured inventories and evaluated ledgers, never diagnostic prose.
 * @evidence contracts/common.md#meaningful-documentation The comment explains boundary ownership and reuse; members describe their keys and values.
 * @evidenceExclude contracts/performance.md#efficient-algorithms This data contract chooses no algorithm.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work This data contract performs no work.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources This data contract owns no runtime resource.
 */
export interface IEvidenceCheckContextIndex {
  /** Reference units keyed by semantic identity. */
  units: Map<string, IEvidenceUnit>;

  /** Captured source files keyed by physical path. */
  sources: Map<string, IEvidenceSourceFile>;

  /** First public target spelling for each reference identity. */
  targets: Map<string, string>;

  /** Checklist answer ledgers keyed by claim host identity. */
  hostCoverage: Map<string, IEvidenceGraphHostCoverage>;
}
