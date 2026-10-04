import type { EvidenceSeverity } from "../typings/EvidenceSeverity";
import type { IEvidenceSourceLocation } from "./IEvidenceSourceLocation";

/**
 * Actionable finding attributed to a source or configuration boundary.
 *
 * The code identifies the failure category while message and repair explain the
 * observed problem and the author's next step. Optional coordinates allow the
 * same structure to represent source-level findings and aggregate failures that
 * have no single source span. Claim names are display labels, not identities.
 */
export interface IEvidenceDiagnostic {
  /**
   * Stable category used to identify the finding programmatically.
   *
   * Consumers should use this value instead of matching human-readable wording.
   */
  code: string;

  /**
   * Effective reporting level for this finding.
   *
   * Off policies emit no diagnostic; an emitted error contributes to check
   * failure.
   */
  severity: Exclude<EvidenceSeverity, "off">;

  /**
   * Explanation of the observed failure or policy violation.
   *
   * Renderers present this separately from source coordinates and repair
   * guidance.
   */
  message: string;

  /**
   * Concrete corrective action available to the author.
   *
   * This accompanies the finding so a stable code need not encode every remedy.
   */
  repair: string;

  /**
   * Source file and optional span associated with the finding.
   *
   * Omission indicates a configuration or aggregate graph context.
   */
  location?: IEvidenceSourceLocation;

  /**
   * Zero-based authored claim index owning the finding.
   *
   * Omission leaves the diagnostic outside a particular claim boundary.
   */
  claim?: number;

  /**
   * Zero-based authored reference index within the owning claim.
   *
   * Omission permits a claim-level or unscoped finding without inventing a
   * pair.
   */
  reference?: number;

  /**
   * Reference unit the finding is about, such as an uncovered heading.
   *
   * Omission means the finding concerns a statement, a configuration, or the
   * aggregate graph rather than one unit.
   */
  unitId?: string;

  /**
   * Documentation host implicated in the finding.
   *
   * When present, this connects a statement-level error to its extracted
   * carrier.
   */
  hostId?: string;

  /**
   * Authored target text implicated in the finding.
   *
   * This can be retained even when parsing or resolution failed to identify a
   * unit.
   */
  target?: string;
}
