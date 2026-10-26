import type { Node as EvidenceNode } from "web-tree-sitter";

/**
 * A deferred finding borrowed only while its owning Lua parse callback is live.
 *
 * @evidence contracts/common.md#principled-implementation The node, original message and traversal category retain a deferred finding only until the Lua scanner finishes.
 * @evidence contracts/common.md#clear-and-simple-design One record holds the node, message and traversal category used by the scanner's existing deferred-diagnostic ordering.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Nodes remain inside their live parse callback; original diagnostic messages and traversal categories preserve duplicate findings and ordering.
 * @evidence contracts/common.md#meaningful-documentation Field comments specify the live-node lifetime, original message and stable traversal category.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no algorithm, computes no reusable result and acquires no runtime resource.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration chooses no algorithm, computes no reusable result and acquires no runtime resource.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration chooses no algorithm, computes no reusable result and acquires no runtime resource.
 */
export interface IEvidenceLuaDeferredFinding {
  /** Original syntax node retained only until this scanner returns. */
  node: EvidenceNode;

  /** Original diagnostic wording. */
  message: string;

  /** Original per-function traversal category, used for stable ordering. */
  category: number;
}
