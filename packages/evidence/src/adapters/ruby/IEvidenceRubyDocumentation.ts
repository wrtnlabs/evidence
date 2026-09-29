import type { IEvidenceCommentSyntax } from "../../structures/IEvidenceCommentSyntax";
import type { IEvidenceDocumentation } from "../../structures/IEvidenceDocumentation";
import type { IEvidenceSourceRange } from "../../structures/IEvidenceSourceRange";
import type { IEvidenceRubyDocumentationAttachment } from "./IEvidenceRubyDocumentationAttachment";

/**
 * Retains one Ruby comment run and its declaration attachment candidates.
 *
 * EvidenceRubyAdapter attaches it after reopened declaration groups become
 * public, keeping tags on invalid positions available for diagnostics rather
 * than discarding them.
 */
export interface IEvidenceRubyDocumentation {
  /**
   * Stable identity for the source documentation region.
   *
   * It becomes the evidence-host ID after attachment or unsupported-host
   * creation.
   */
  id: string;

  /**
   * Original text range occupied by the comment run.
   *
   * Annotation ranges exclude this text from associated site fingerprints.
   */
  range: IEvidenceSourceRange;

  /**
   * Delimiter rules used to map raw text when scanning did not precompute a
   * mapping.
   *
   * Omission means `mapping` supplies normalized content for tag parsing.
   */
  syntax?: IEvidenceCommentSyntax;

  /**
   * Precomputed documentation mapping when the carrier needs custom
   * normalization.
   *
   * The adapter uses this instead of syntax to retain original tag coordinates.
   */
  mapping?: IEvidenceDocumentation;

  /**
   * Declaration sites immediately documented by this carrier.
   *
   * Public-group and withdrawal filtering determine the final host membership.
   */
  attachments: IEvidenceRubyDocumentationAttachment[];
}
