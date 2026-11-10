import type { EvidenceDelimitedType } from "../typings/EvidenceDelimitedType";
import type { IEvidenceClaimBase } from "./IEvidenceClaimBase";
import type { IEvidenceDelimitedOptions } from "./IEvidenceDelimitedOptions";

/**
 * CSV or TSV rows that host evidence for the claim's references.
 *
 * Every keyed row is one semantic host, whether or not it already carries an
 * annotation, so checklist and cardinality policies can report a row that
 * answers nothing. Rows carry evidence in the configured `evidenceColumn`, in
 * separate `evidenceFiles` documents whose H1 names the row address, or both.
 *
 * - `files` globs select ledgers parsed by `type`, regardless of extension.
 * - Each row is addressed as `<root-relative path>#<key>`.
 * - Without `evidenceColumn`, rows host no in-file annotations.
 *
 * @example
 *   const claim: IEvidenceDelimitedClaim = {
 *     type: "tsv",
 *     files: ["data/projects.tsv"],
 *     key: "id",
 *     evidenceColumn: "evidence",
 *     reference: { type: "markdown", files: ["context/goals.md"], symbol: "h2" },
 *   };
 *
 * @evidence contracts/common.md#principled-implementation The claim base is specialized with the delimited discriminators and the row symbol, and the shared column options supply identity and carrier.
 * @evidence contracts/common.md#clear-and-simple-design The interface adds no field of its own; key and evidence column come from IEvidenceDelimitedOptions.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Rows without annotations stay selected hosts so per-host policies can detect them.
 * @evidence contracts/common.md#meaningful-documentation The comment explains host participation, both carriers, addressing and gives an example.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceDelimitedClaim
  extends IEvidenceClaimBase<EvidenceDelimitedType, "row">,
    IEvidenceDelimitedOptions {}
