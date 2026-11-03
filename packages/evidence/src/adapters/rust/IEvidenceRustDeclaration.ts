import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { EvidenceRustDeclarationForm } from "./EvidenceRustDeclarationForm";
import type { EvidenceRustVisibility } from "./EvidenceRustVisibility";

/**
 * Captures one Rust declaration before module reachability and impl ownership
 * resolve.
 *
 * EvidenceRustModuleResolver combines this lexical record with the selected
 * crate graph; scanners do not assume that a visible spelling is externally
 * reachable.
 *
 * @evidence contracts/common.md#principled-implementation A declaration keeps form, visibility, path and site without assuming its spelling is externally reachable.
 * @evidence contracts/common.md#clear-and-simple-design The scanner records declarations; the module resolver decides reachability.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Fields hold values derived from parsed syntax; no project-specific value is encoded.
 * @evidence contracts/common.md#meaningful-documentation The comment states what the record represents and its role in the adapter; each field is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceRustDeclaration {
  /**
   * Stable scanner identity for this declaration.
   *
   * Modules, implementations, and documentation attachments use it before
   * semantic IDs exist.
   */
  id: string;

  /**
   * Lexical module segments containing the declaration.
   *
   * Public aliases expand from this location only after crate graph resolution.
   */
  modulePath: string[];

  /**
   * Source name used as the final identity or member segment.
   *
   * The resolver preserves this spelling while it derives public paths.
   */
  name: string;

  /**
   * Declaration or address-only scope kind assigned to the item.
   *
   * Modules use scope; actual declarations use type, function, or property.
   */
  symbol: EvidenceProgrammingSymbol | "scope";

  /**
   * Rust grammar form establishing the declaration.
   *
   * It selects the resolver's ownership and publication rules.
   */
  form: EvidenceRustDeclarationForm;

  /**
   * Lexical visibility controlling whether a use can publish this item.
   *
   * Its scope is evaluated at module boundaries rather than from the
   * declaration alone.
   */
  visibility: EvidenceRustVisibility;

  /**
   * Source ranges used for documentation hosts and review fingerprints.
   *
   * They remain valid after the borrowed parser tree closes.
   */
  site: IEvidenceUnitSite;

  /**
   * Enclosing declaration identity for directly lexical members.
   *
   * Omission leaves owner resolution to a separate impl record or module
   * context.
   */
  ownerDeclarationId?: string;

  /**
   * Impl record supplying a nominal owner after cross-module resolution.
   *
   * Omission means this declaration has no impl-mediated ownership.
   */
  implementationId?: string;

  /**
   * Public child segment when this declaration is an impl member.
   *
   * Omission keeps non-member declarations from acquiring an artificial
   * accessor.
   */
  memberSegment?: string;
}
