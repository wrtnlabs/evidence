import type { IEvidenceGraphClaimContext } from "../contexts/IEvidenceGraphClaimContext";
import type { IEvidenceDeclaration } from "../structures/IEvidenceDeclaration";
import type { IEvidenceHost } from "../structures/IEvidenceHost";
import type { IEvidenceReview } from "../structures/IEvidenceReview";
/**
 * Indexes claim statements and eligible hosts once for all its references.
 *
 * @evidence contracts/common.md#principled-implementation Normalized claim declarations, reviews and attached hosts are grouped by ID; selected semantic host ownership and explicit detached bindings determine eligible policy hosts.
 * @evidence contracts/common.md#clear-and-simple-design Claim-wide declaration, review and host membership maps are built together; reference-specific policy and resolutions stay outside this index.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Detached host bindings replace selected semantic ownership exactly as authored, and exclusions retain only attached documentation hosts.
 * @evidence contracts/common.md#meaningful-documentation The class and fields distinguish authored statements, positive-evidence owners and eligible exclusion carriers.
 * @evidence contracts/performance.md#efficient-algorithms One pass over claim statements, documentation and selected owner relations builds the claim-wide indexes.
 * @evidence contracts/performance.md#reuse-equivalent-work All reference obligations under one immutable claim borrow the same indexes while keeping their resolutions, coverage and policies independent.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The evaluation owns this index and releases borrowed records and relation sets when the claim evaluation ends.
 */
export class EvidenceGraphClaimIndex {
  /** Authored acknowledgements by inventory-local identity. */
  public readonly declarations: Map<string, IEvidenceDeclaration>;

  /** Authored reviews by inventory-local identity. */
  public readonly reviews: Map<string, IEvidenceReview>;

  /** Documentation hosts by inventory-local identity. */
  public readonly hosts: Map<string, IEvidenceHost>;

  /** Selected semantic claim owners per eligible positive-evidence host. */
  public readonly selectedHosts: Map<string, string[]>;

  /** Attached documentation positions allowed to carry exclusions. */
  public readonly exclusionHosts: Set<string>;

  /**
   * Borrows normalized records while deriving only claim-wide policy
   * membership.
   */
  public constructor(context: IEvidenceGraphClaimContext) {
    this.declarations = new Map(
      context.inventory.declarations.map(
        (entry: IEvidenceDeclaration): [string, IEvidenceDeclaration] => [
          entry.id,
          entry,
        ],
      ),
    );
    this.reviews = new Map(
      context.inventory.reviews.map(
        (entry: IEvidenceReview): [string, IEvidenceReview] => [
          entry.id,
          entry,
        ],
      ),
    );
    this.hosts = new Map(
      context.inventory.hosts.map(
        (host: IEvidenceHost): [string, IEvidenceHost] => [host.id, host],
      ),
    );
    this.selectedHosts = new Map(
      context.population.hosts.map(
        (host: IEvidenceHost): [string, string[]] => [host.id, host.unitIds],
      ),
    );
    for (const [host, unit] of context.detachedHostUnits)
      this.selectedHosts.set(host, [unit]);
    const attached: Set<string> = new Set(
      context.inventory.hosts
        .filter(
          (host: IEvidenceHost): boolean => host.attachment === "attached",
        )
        .map((host: IEvidenceHost): string => host.id),
    );
    this.exclusionHosts = new Set(
      context.claim.exclusionHostIds === undefined
        ? attached
        : context.claim.exclusionHostIds.filter((id: string): boolean =>
            attached.has(id),
          ),
    );
  }
}
