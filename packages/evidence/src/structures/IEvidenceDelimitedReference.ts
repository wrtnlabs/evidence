import type { EvidenceDelimitedType } from "../typings/EvidenceDelimitedType";
import type { IEvidenceDelimitedOptions } from "./IEvidenceDelimitedOptions";
import type { IEvidenceReferenceBase } from "./IEvidenceReferenceBase";

/**
 * CSV or TSV rows that the owning claim must acknowledge.
 *
 * Each keyed row is one required unit, and the file is an unselected aggregate
 * that stays citable: `data/projects.tsv` covers every selected row of that
 * file. Identity is the key alone, so inserting, deleting, or reordering other
 * rows changes no address and no coverage result.
 *
 * Set the same `evidenceColumn` as a claim reading these files when rows cite
 * rows of the same ledger; the reference's row fingerprints then ignore those
 * annotations as well.
 *
 * @example
 *   const reference: IEvidenceDelimitedReference = {
 *     type: "csv",
 *     files: ["data/requirements.csv"],
 *     key: "id",
 *     requireReview: true,
 *   };
 *   // Cite one row as data/requirements.csv#R-017.
 *
 * @evidence contracts/common.md#principled-implementation Root-relative files plus the shared column options specialize the reference base for keyed ledger rows.
 * @evidence contracts/common.md#clear-and-simple-design Only files is added; key and evidence column come from IEvidenceDelimitedOptions and policy from the base.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Identity is the key alone, so row order can never move coverage between rows.
 * @evidence contracts/common.md#meaningful-documentation The comment explains row and aggregate addressing, the evidence column's fingerprint role and gives an example.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceDelimitedReference
  extends IEvidenceReferenceBase<EvidenceDelimitedType, "row">,
    IEvidenceDelimitedOptions {
  /**
   * Ledger globs relative to the reference root.
   *
   * Selection uses the claim glob rules. Every matching regular file is parsed
   * with the grammar named by `type`, regardless of extension. Targets name
   * these files by the same root-relative path.
   */
  files: string[];
}
