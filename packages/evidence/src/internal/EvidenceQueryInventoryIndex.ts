import type { IEvidenceDeclaration } from "../structures/IEvidenceDeclaration";
import type { IEvidenceReview } from "../structures/IEvidenceReview";
import { EvidenceFileTarget } from "../targets/EvidenceFileTarget";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
import type { IEvidenceUnit } from "../structures/IEvidenceUnit";
import type { IEvidencePublicAddress } from "../structures/IEvidencePublicAddress";
import type { IEvidenceHost } from "../structures/IEvidenceHost";
/**
 * Indexes immutable inventory records shared by query populations.
 *
 * @evidence contracts/common.md#principled-implementation Units, public addresses, logical source aliases, children and host ownership are grouped by their actual identities in inventory order.
 * @evidence contracts/common.md#clear-and-simple-design Inventory-wide maps stay separate from each population wrapper's configured selection and coverage.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Borrowed records come from captured immutable inventories; grouping retains source encounter order and does not choose among aliases.
 * @evidence contracts/common.md#meaningful-documentation The class and field comments identify borrowed ownership, normalized physical aliases and each indexed semantic relation.
 * @evidence contracts/performance.md#efficient-algorithms One pass over units, addresses, sources and hosts; memory is linear in indexed relations.
 * @evidence contracts/performance.md#reuse-equivalent-work All wrappers over the same normalized inventory share this index within their query session.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The session owns this index and releases it with its population contexts.
 */
export class EvidenceQueryInventoryIndex {
  /** Internal immutable inventories own their derived record index weakly. */
  private static readonly indexes: WeakMap<
    IEvidenceInventory,
    EvidenceQueryInventoryIndex
  > = new WeakMap();

  /**
   * Borrows one record index for an internally owned immutable inventory.
   *
   * @evidence contracts/common.md#principled-implementation Exact inventory identity selects one borrowed record index; public facades capture mutable caller data before reaching this boundary.
   * @evidence contracts/common.md#clear-and-simple-design The existing inventory index owns this reuse rather than introducing a second projection layer.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Only internal immutable snapshots share indexes, so public input and output mutations remain isolated.
   * @evidence contracts/common.md#meaningful-documentation The comment states borrowing and the public capture precondition.
   * @evidence contracts/performance.md#efficient-algorithms First use indexes inventory relations once; repeated access is a constant-time weak lookup.
   * @evidence contracts/performance.md#reuse-equivalent-work Query contexts, inspection and focused checks share exact captured inventory identity.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Weak inventory keys release borrowed maps with their owning snapshot.
   */
  public static borrow(
    inventory: IEvidenceInventory,
  ): EvidenceQueryInventoryIndex {
    let index: EvidenceQueryInventoryIndex | undefined =
      this.indexes.get(inventory);
    if (index === undefined) {
      index = new EvidenceQueryInventoryIndex(inventory);
      this.indexes.set(inventory, index);
    }
    return index;
  }

  /** Units by semantic identity. */
  public readonly units: Map<string, IEvidenceUnit> = new Map();

  /** Public addresses in inventory order per unit. */
  public readonly addresses: Map<string, IEvidencePublicAddress[]> = new Map();

  /** Selected logical spellings per normalized absolute source address. */
  public readonly logicalFiles: Map<string, string[]> = new Map();

  /** Direct children in inventory order. */
  public readonly children: Map<string, IEvidenceUnit[]> = new Map();

  /** Hosts in inventory order per owning unit. */
  public readonly hosts: Map<string, IEvidenceHost[]> = new Map();

  /** Documentation hosts indexed by identity. */
  public readonly hostIds: Map<string, IEvidenceHost> = new Map();

  /** Authored acknowledgements indexed by identity. */
  public readonly declarations: Map<string, IEvidenceDeclaration> = new Map();

  /** Authored reviews indexed by identity. */
  public readonly reviews: Map<string, IEvidenceReview> = new Map();

  /** Borrows immutable records without cloning or changing their order. */
  public constructor(inventory: IEvidenceInventory) {
    for (const unit of inventory.units) {
      this.units.set(unit.id, unit);
      if (unit.parentId !== undefined) {
        const children: IEvidenceUnit[] =
          this.children.get(unit.parentId) ?? [];
        children.push(unit);
        this.children.set(unit.parentId, children);
      }
    }
    for (const address of inventory.addresses) {
      const addresses: IEvidencePublicAddress[] =
        this.addresses.get(address.unitId) ?? [];
      addresses.push(address);
      this.addresses.set(address.unitId, addresses);
    }
    for (const source of inventory.sources)
      for (const address of source.addresses)
        if (address.selected !== false) {
          const key: string = EvidenceFileTarget.normalize(address.absolute);
          const files: string[] = this.logicalFiles.get(key) ?? [];
          files.push(address.relative);
          this.logicalFiles.set(key, files);
        }
    for (const host of inventory.hosts) this.hostIds.set(host.id, host);
    for (const declaration of inventory.declarations)
      this.declarations.set(declaration.id, declaration);
    for (const review of inventory.reviews) this.reviews.set(review.id, review);
    for (const host of inventory.hosts)
      for (const id of new Set(host.unitIds)) {
        const hosts: IEvidenceHost[] = this.hosts.get(id) ?? [];
        hosts.push(host);
        this.hosts.set(id, hosts);
      }
  }
}
