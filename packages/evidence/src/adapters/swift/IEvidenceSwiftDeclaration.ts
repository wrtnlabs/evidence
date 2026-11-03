import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { EvidenceProgrammingSymbol } from "../../typings/EvidenceProgrammingSymbol";

/**
 * Represents one explicit Swift declaration before module-wide extension
 * reconciliation.
 *
 * Extensions, aliases, and nominal declarations are recorded separately so the
 * adapter can attach members to their real type without losing their source
 * site.
 *
 * @evidence contracts/common.md#principled-implementation A declaration records whether it is nominal, an extension or an alias, keeping its source site while module-wide reconciliation finds its real owner.
 * @evidence contracts/common.md#clear-and-simple-design The scanner records declarations; ownership resolution and the adapter consume them.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Fields hold values derived from parsed syntax; no project-specific value is encoded.
 * @evidence contracts/common.md#meaningful-documentation The comment states what the record represents and its role in the adapter; each field is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceSwiftDeclaration {
  /**
   * Extraction identity of the physical declaration.
   *
   * Documentation attachments use this scanner-local key before semantic units
   * are materialized.
   */
  id: string;

  /**
   * Literal declaration name, with overloads grouped by base name.
   *
   * The adapter uses identity and symbol to distinguish families beyond this
   * display name.
   */
  name: string;

  /**
   * Common programming selector.
   *
   * It supplies Evidence's language-independent category for population
   * selection.
   */
  symbol: EvidenceProgrammingSymbol;

  /**
   * Module-relative semantic ownership segments.
   *
   * Ownership resolution rewrites extension members to the resolved nominal
   * path.
   */
  identity: string[];

  /**
   * File-qualified accessor segments.
   *
   * The adapter publishes these segments with the configured source address.
   */
  address: string[];

  /**
   * Original source site used for fingerprints and attached hosts.
   *
   * Reconciled declarations retain their distinct physical sites in one unit.
   */
  site: IEvidenceUnitSite;

  /**
   * Effective public/open visibility after ownership resolution.
   *
   * A public member still becomes unavailable when an enclosing owner is
   * inaccessible.
   */
  public: boolean;

  /**
   * Marks a record that reopens a nominal type instead of defining one.
   *
   * Extension records contribute source positions and visibility directives,
   * while their members acquire identity from the resolved nominal target. An
   * extension container never creates an additional evidence host.
   */
  extension: boolean;

  /**
   * Names the statically recognized target of an extension or type alias.
   *
   * Omission preserves an unresolved boundary so the adapter can diagnose it
   * instead of inventing a public owner from textual spelling.
   */
  target?: string[];

  /**
   * States whether `target` names a type alias rather than its final nominal
   * type.
   *
   * The ownership resolver follows aliases deliberately, avoiding a merge with
   * an unrelated type that happens to share the alias's source spelling.
   */
  alias: boolean;

  /**
   * Declaration kind controlling member visibility defaults.
   *
   * The scanner uses it for protocol and extension behavior without reparsing
   * the node.
   */
  form: string;

  /**
   * Whether nominal lookup is restricted to this physical file.
   *
   * Local aliases and extensions cannot resolve a fileprivate target in another
   * file.
   */
  filePrivate: boolean;

  /**
   * Explicit lexical owner, retained independently of accessor text.
   *
   * Parent traversal uses this key so literal name segments do not imply
   * containment.
   */
  ownerDeclarationId?: string;
}
