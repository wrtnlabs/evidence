import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";

/**
 * Retains exact identity branches and template-arity-optional query labels.
 *
 * @evidence contracts/common.md#principled-implementation Exact segments own unique trie children, while query labels retain every compatible child and terminal units retain encounter order.
 * @evidence contracts/common.md#clear-and-simple-design Alias matching owns this transient trie independently of unit and address publication.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Candidate arrays preserve ambiguity and allow explicit and omitted template arities within the same target path.
 * @evidence contracts/common.md#meaningful-documentation Each field distinguishes construction identity from query spelling and terminal candidates.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no algorithm.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes no result.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The resolver owns trie instances, not this type declaration.
 */
export interface IEvidenceCppAliasTrie {
  /** Unique children for exact identity construction. */
  exact: Map<string, IEvidenceCppAliasTrie>;

  /** Compatible exact children under literal or omitted-arity query labels. */
  names: Map<string, IEvidenceCppAliasTrie[]>;

  /** Units ending at this complete identity. */
  units: IEvidenceUnit[];
}
