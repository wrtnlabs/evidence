import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { EvidenceCppDeclarationForm } from "./EvidenceCppDeclarationForm";
import type { EvidenceCppVisibility } from "./EvidenceCppVisibility";

/**
 * Captures one supported C++ declaration before semantic units are
 * materialized.
 *
 * EvidenceCppFileScanner records source occurrences in this form;
 * EvidenceCppAdapter groups compatible occurrences by identity, validates their
 * declaration family, and publishes the resulting unit's addresses and sites.
 * The record therefore keeps physical source facts separate from the semantic
 * identity shared by declarations, definitions, and overloads.
 *
 * @evidence contracts/common.md#principled-implementation A declaration keeps form, qualified identity, visibility, address candidates and site separate from the shared semantic identity.
 * @evidence contracts/common.md#clear-and-simple-design The scanner records occurrences; the adapter groups them.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Fields hold values derived from parsed syntax; no project-specific value is encoded.
 * @evidence contracts/common.md#meaningful-documentation The comment states what the record represents and its role in the adapter; each field is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceCppDeclaration {
  /**
   * Scanner-local key for attachments and family reconciliation.
   *
   * The adapter replaces this physical-record ID with a semantic unit ID.
   */
  id: string;

  /**
   * Unqualified source spelling used in diagnostics and the published unit.
   *
   * Enclosing scopes remain in `identity` and `addresses`.
   */
  name: string;

  /**
   * Evidence symbol category assigned after declaration-family materialization.
   *
   * Namespaces use the address-only scope kind rather than a type selector.
   */
  symbol: EvidenceProgrammingSymbol | "scope";

  /**
   * C++ declaration form that controls compatibility within one family.
   *
   * Definitions and overloads are reconciled only among compatible forms.
   */
  form: EvidenceCppDeclarationForm;

  /**
   * Semantic qualified path used to merge compatible source occurrences.
   *
   * This identity is distinct from every public alias spelling.
   */
  identity: string[];

  /**
   * Public accessor candidates projected from namespaces and using
   * declarations.
   *
   * Each nested array retains segment boundaries for target resolution.
   */
  addresses: string[][];

  /**
   * Physical declaration span retained for hosts and content fingerprints.
   *
   * A merged unit may retain several sites from compatible declarations.
   */
  site: IEvidenceUnitSite;

  /**
   * Visibility result before public-address publication.
   *
   * Qualified declarations remain distinguishable until their owner is known.
   */
  visibility: EvidenceCppVisibility;

  /**
   * Whether this occurrence contributes an implementation body.
   *
   * Multiple bodies for one applicable family make the inventory incomplete.
   */
  definition: boolean;

  /**
   * Semantic parent path for a member or enumerator.
   *
   * Omission denotes a declaration that owns its own top-level unit.
   */
  parentIdentity?: string[];
}
