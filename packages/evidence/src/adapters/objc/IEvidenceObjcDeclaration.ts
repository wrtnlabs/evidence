import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";
import type { EvidenceObjcDeclarationForm } from "./EvidenceObjcDeclarationForm";

/**
 * Represents one Objective-C declaration before interface and implementation
 * reconciliation.
 *
 * The adapter keeps declarations from headers, implementations, categories, and
 * extensions distinct until it can establish the one public semantic identity.
 *
 * @evidence contracts/common.md#principled-implementation A declaration keeps its form and site from headers, implementations, categories or extensions until one public identity is established.
 * @evidence contracts/common.md#clear-and-simple-design The scanner records declarations; the adapter reconciles them.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Fields hold values derived from parsed syntax; no project-specific value is encoded.
 * @evidence contracts/common.md#meaningful-documentation The comment states what the record represents and its role in the adapter; each field is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceObjcDeclaration {
  /**
   * Physical declaration identity within the snapshot.
   *
   * Reconciliation uses this value to retain each contributing source site.
   */
  id: string;

  /**
   * Exact declaration name, including selector punctuation.
   *
   * Selector colons and method prefixes remain literal identity spelling.
   */
  name: string;

  /**
   * Programming declaration or address-only category kind.
   *
   * Population selection uses this category independently of source form.
   */
  symbol: EvidenceProgrammingSymbol | "scope";

  /**
   * Source form governing exposure and merging.
   *
   * Interfaces, implementations, and extensions follow distinct publication
   * rules.
   */
  form: EvidenceObjcDeclarationForm;

  /**
   * Segmented identity in the configured declared-source boundary.
   *
   * This semantic path remains independent of public accessor spelling.
   */
  identity: string[];

  /**
   * Segmented file-qualified public accessor.
   *
   * Published addresses combine these literal segments with each selected file.
   */
  address: string[];

  /**
   * Original source declaration and fingerprint content ranges.
   *
   * Merged units preserve every site that contributes semantic content.
   */
  site: IEvidenceUnitSite;

  /**
   * Whether this declaration participates in the public inventory after
   * reconciliation.
   *
   * Private records can still become merge sites for a separately public
   * identity.
   */
  public: boolean;

  /**
   * Permits an implementation or extension site to join a public identity.
   *
   * The flag never makes a private declaration public by itself; it authorizes
   * reconciliation with the separately extracted interface declaration.
   */
  merge: boolean;

  /**
   * Marks a body or nominal implementation site that must be unique.
   *
   * Multiple declarations can describe a selector, but conflicting definitions
   * leave the analysis incomplete rather than choosing an arbitrary site.
   */
  definition: boolean;

  /**
   * Physical owner declaration, reconciled to a semantic parent later.
   *
   * Omission denotes a root declaration in the selected source.
   */
  ownerDeclarationId?: string;
}
