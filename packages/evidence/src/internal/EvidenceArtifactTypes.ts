import { EvidenceLanguageRegistry } from "../parsers/EvidenceLanguageRegistry";
import type { EvidenceArtifactType } from "../typings/EvidenceArtifactType";

/**
 * Provides the runtime set of artifact types with certified adapters.
 *
 * Configuration validation uses this boundary instead of language identifier
 * unions, since a grammar candidate must not become selectable before its
 * extraction and target behavior are complete.
 *
 * @evidence contracts/common.md#principled-implementation The supported set is derived from registry entries that have certified adapters, so validation cannot accept a grammar-only candidate.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns the runtime set; the registry owns language metadata.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts No type is hardcoded beyond the document, ledger and schema families without registry entries.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains why validation uses this set instead of the identifier unions.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace's functions do linear scans of a list of about thirty entries; the namespace adds no algorithm.
 * @evidence contracts/performance.md#reuse-equivalent-work The supported list is computed once at module load and reused by every validation call.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The module-level list is a small immutable array of strings and holds no external resource.
 */
export namespace EvidenceArtifactTypes {
  /**
   * Narrows a configuration discriminator to a certified artifact type.
   *
   * Configuration validation uses this guard before adapter construction,
   * keeping grammar-only candidates outside the supported product surface.
   *
   * @evidence contracts/common.md#principled-implementation A type guard over the certified list narrows configuration input to EvidenceArtifactType.
   * @evidence contracts/common.md#clear-and-simple-design The guard only checks membership; adapter construction happens later.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Grammar-only candidates fail the guard instead of being accepted.
   * @evidence contracts/common.md#meaningful-documentation The comment states where the guard runs and what it keeps out.
   * @evidence contracts/performance.md#efficient-algorithms A linear scan over about thirty entries is cheaper than maintaining a separate set for this size.
   * @evidence contracts/performance.md#reuse-equivalent-work It reuses the module-level list rather than recomputing it.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The guard keeps no state after returning; its result is owned by the caller.
   */
  export function isSupported(type: string): type is EvidenceArtifactType {
    return SUPPORTED.some((supported) => supported === type);
  }

  /**
   * Returns the certified artifact types in a defensive copy.
   *
   * Callers can inspect or sort their result without mutating the module-level
   * support baseline used by validation.
   *
   * @evidence contracts/common.md#principled-implementation Returning a copy lets callers sort or inspect the list without changing the validation baseline.
   * @evidence contracts/common.md#clear-and-simple-design The function only exposes the list.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts The defensive copy prevents callers from mutating shared state.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the defensive copy.
   * @evidence contracts/performance.md#efficient-algorithms Copying about thirty strings is linear and small.
   * @evidence contracts/performance.md#reuse-equivalent-work It reuses the module-level list and copies it only to protect it.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The copy keeps no state after returning; its result is owned by the caller.
   */
  export function supported(): EvidenceArtifactType[] {
    return [...SUPPORTED];
  }
}

const SUPPORTED: EvidenceArtifactType[] = [
  "csv",
  "markdown",
  "prisma",
  "swagger",
  "tsv",
  ...[
    ...EvidenceLanguageRegistry.list(),
    ...EvidenceLanguageRegistry.databases(),
  ]
    .filter((language) => language.adapter !== undefined)
    .map((language) => language.type),
];
