/**
 * Stores literal portable-identity tokens as a prefix tree.
 *
 * @evidence contracts/common.md#principled-implementation UTF-16 edges match original JavaScript string positions and optional values identify complete tokens.
 * @evidence contracts/common.md#clear-and-simple-design The interface stores literal character edges and one optional completed-token replacement.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Character edges store literal tokens, with no regular-expression interpretation or reprocessing of generated replacement text.
 * @evidence contracts/common.md#meaningful-documentation Field comments define UTF-16 edges and the optional completed-token replacement.
 * @evidence contracts/performance.md#efficient-algorithms One node per distinct token prefix; lookup visits only matching prefixes.
 * @evidence contracts/performance.md#reuse-equivalent-work A fingerprint index builds one tree from its validated token table.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The tree contains only token text and replacement values and dies with the index.
 */
export interface IEvidencePortableTrie {
  /** Next UTF-16 code unit of a literal source or root token. */
  children: Map<string, IEvidencePortableTrie>;

  /** Checkout-stable replacement when this prefix completes a token. */
  value?: string;
}
