/**
 * Executable mapping from the consumer-installed `ttsc` package manifest.
 *
 * The isolated configuration evaluator reads this projection through
 * `IEvidenceTtsxManifest` so it can invoke the consumer's compiler launcher
 * instead of resolving a tool from Evidence's own dependency graph.
 *
 * @evidence contracts/common.md#principled-implementation The launcher path comes from the installed package's own bin mapping rather than a hard-coded location.
 * @evidence contracts/common.md#clear-and-simple-design Only the ttsx entry is modeled.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts typia rejects a manifest without a string ttsx entry instead of guessing a path.
 * @evidence contracts/common.md#meaningful-documentation The comment explains its use; the field documents how the path is resolved.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceTtsxExecutables {
  /**
   * Relative path to the `ttsx` launcher within the installed `ttsc` package.
   *
   * The evaluator resolves this path against the manifest directory before it
   * starts the temporary project that evaluates the user's configuration.
   */
  ttsx: string;
}
