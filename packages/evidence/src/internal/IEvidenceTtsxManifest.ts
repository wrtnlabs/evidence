import type { IEvidenceTtsxExecutables } from "./IEvidenceTtsxExecutables";

/**
 * Consumer-installed `ttsc` manifest fields required for isolated configuration
 * evaluation.
 *
 * `evaluateTypeScriptConfig` validates this narrow manifest projection after
 * resolving `ttsc` from the config's dependency graph, then uses its executable
 * mapping to start the matching `ttsx` launcher.
 *
 * @evidence contracts/common.md#principled-implementation The evaluator reads the consumer's own ttsc manifest so the launcher matches the installed compiler.
 * @evidence contracts/common.md#clear-and-simple-design Only the bin mapping is modeled.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts typia validates the projection before any path is used.
 * @evidence contracts/common.md#meaningful-documentation The comment explains its use; the field documents which entry matters.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceTtsxManifest {
  /**
   * Declared executable names and relative paths from the installed package.
   *
   * The evaluator consumes the `ttsx` entry in this mapping through
   * `IEvidenceTtsxExecutables`; no other package manifest fields affect the
   * launch.
   */
  bin: IEvidenceTtsxExecutables;
}
