import type { IEvidenceSourceLocation } from "../structures/IEvidenceSourceLocation";
import type { EvidenceTargetResolutionStatus } from "../typings/EvidenceTargetResolutionStatus";

/**
 * Resolution of one authored H1 owner across a participating claim.
 *
 * Claims sharing one evidence document resolve the same H1 independently.
 * Materialization reports an orphan only when no participating claim selected
 * it, so a valid section for another claim does not poison this one.
 *
 * @evidence contracts/common.md#principled-implementation The physical H1 key survives independent claim resolution and lets global materialization identify genuinely unowned sections.
 * @evidence contracts/common.md#clear-and-simple-design The record stores one location, authored address and optional selected owner.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts An unresolved claim does not silently certify the H1; another claim must resolve the same physical key.
 * @evidence contracts/common.md#meaningful-documentation The comment explains the cross-claim purpose and optional owner meaning.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceDetachedOwner {
  /** Physical H1 identity shared by claims reading the same source. */
  key: string;

  /** Authored claim address for diagnostics. */
  target: string;

  /** H1 source position. */
  location: IEvidenceSourceLocation;

  /** Resolution status when this claim could not select the H1. */
  status: EvidenceTargetResolutionStatus;

  /** Original semantic claim unit when this claim selected the H1. */
  unitId?: string;
}
