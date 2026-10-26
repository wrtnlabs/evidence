import type { IEvidenceCheckAnalysis } from "../structures/IEvidenceCheckAnalysis";
import type { EvidenceQueryPopulationContext } from "./EvidenceQueryPopulationContext";

/**
 * Owned query state shared by list, inspect, and graph programmers.
 *
 * Public EvidenceQuery facades capture analysis and clone returned reports.
 * Commands borrow their exclusively owned analysis until rendering completes.
 * Population indexes can therefore cache traversal results without depending on
 * caller-owned mutable inventory data.
 *
 * @evidence contracts/common.md#principled-implementation The analysis, cwd and population contexts are shared by list, inspect and graph programmers.
 * @evidence contracts/common.md#clear-and-simple-design Programmers receive this owned state instead of rebuilding indexes.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Queries read retained analysis rather than reloading files.
 * @evidence contracts/common.md#meaningful-documentation The comment explains sharing across queries; each field is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The context chooses no algorithm; population contexts own their indexes.
 * @evidence contracts/performance.md#reuse-equivalent-work Population contexts are built once per analysis and reused by every list, inspect and graph query over it.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The context holds plain analysis data owned by its query session and no external resource.
 */
export interface IEvidenceQueryContext {
  /**
   * Complete analysis bundle captured by the query facade.
   *
   * Its plan, inventories, graph input, and report remain aligned throughout
   * the lifetime of the population indexes.
   */
  readonly analysis: IEvidenceCheckAnalysis;

  /**
   * Absolute directory anchoring file-qualified query targets.
   *
   * Capturing it once prevents later cwd changes from altering target
   * formatting or inspection within the same facade.
   */
  readonly cwd: string;

  /**
   * Claim and reference indexes belonging to the captured analysis.
   *
   * Each index keeps independent selection and obligation state despite shared
   * semantic identities across configuration boundaries.
   */
  readonly populations: EvidenceQueryPopulationContext[];
}
