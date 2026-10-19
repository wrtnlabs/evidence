/**
 * Nearest package metadata relevant to the configuration evaluator's module
 * decision.
 *
 * `configModule` reads this parsed projection while walking upward from a
 * config file. It models only the package field that can change the temporary
 * evaluator project's compiler module kind.
 *
 * @evidence contracts/common.md#principled-implementation The package type field is the only metadata that changes how the evaluator treats a module's format.
 * @evidence contracts/common.md#clear-and-simple-design Only the needed field is modeled.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Absent type falls back to Node's default rather than a guess.
 * @evidence contracts/common.md#meaningful-documentation The comment explains its use; the field documents omission.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceConfigPackageScope {
  /**
   * Node package module mode at this package boundary.
   *
   * The evaluator selects `ESNext` only when this value is `"module"`; omission
   * and every other value retain the CommonJS fallback for an unqualified
   * config.
   */
  type?: string;
}
