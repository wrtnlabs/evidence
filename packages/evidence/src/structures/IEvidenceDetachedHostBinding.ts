/**
 * Connects a Markdown documentation position to its original claim unit.
 *
 * The Markdown adapter keeps the physical host attached to its own heading for
 * source validation. Graph evaluation uses this separate relation to attribute
 * its Evidence statements to the selected declaration named by the H1 section.
 *
 * @evidence contracts/common.md#principled-implementation A separate host-to-unit relation preserves physical Markdown ownership while selecting the original semantic claim host for coverage.
 * @evidence contracts/common.md#clear-and-simple-design The record contains only the two identities needed for attribution.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts It does not replace either adapter's source site or add a claim unit.
 * @evidence contracts/common.md#meaningful-documentation The comment distinguishes physical and semantic ownership, and each field names its role.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceDetachedHostBinding {
  /** Physical Markdown host carrying an acknowledgement or review. */
  hostId: string;

  /** Selected claim unit named by the enclosing H1 heading. */
  unitId: string;
}
