import type { IEvidenceAdapterCertificationSource } from "./IEvidenceAdapterCertificationSource";

/**
 * Attached documentation paired with inert literal data and misplaced comments.
 *
 * Only the real attached carrier acknowledges a declaration; unsupported
 * comment positions remain diagnosed while literal contents create no tags.
 */
export interface IEvidenceAdapterCertificationFalsePositive {
  source: IEvidenceAdapterCertificationSource;
  attachedTarget: string;
  unsupportedAnnotations: number;
}
