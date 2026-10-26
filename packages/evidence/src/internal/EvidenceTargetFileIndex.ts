import { EvidenceFileTarget } from "../targets/EvidenceFileTarget";
import { EvidenceMarkdownTarget } from "../adapters/markdown/EvidenceMarkdownTarget";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
/**
 * Indexes selected file membership for target-affinity scoring within one
 * immutable preparation session.
 *
 * @evidence contracts/common.md#principled-implementation Absolute paths and Markdown root-relative paths use their owning normalizers; dependency-only addresses are omitted.
 * @evidence contracts/common.md#clear-and-simple-design Two spelling sets share one inventory scan and stay local to target-affinity preparation.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Only selected source aliases enter membership sets; absolute and Markdown-relative spellings use their existing artifact normalizers.
 * @evidence contracts/common.md#meaningful-documentation Comments distinguish selected absolute membership, root-relative Markdown membership and immutable preparation-session ownership.
 * @evidence contracts/performance.md#efficient-algorithms Each inventory is scanned once; later membership is constant time.
 * @evidence contracts/performance.md#reuse-equivalent-work Weak inventory identity keys are valid only within the immutable session; standalone public selection creates a fresh owner.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The preparation session owns the maps and releases them after its claims are prepared.
 */
export class EvidenceTargetFileIndex {
  /** Normalized selected absolute paths. */
  private readonly files: WeakMap<IEvidenceInventory, Set<string>> =
    new WeakMap();

  /** Selected root-relative Markdown paths. */
  private readonly relatives: WeakMap<IEvidenceInventory, Set<string>> =
    new WeakMap();

  /**
   * Returns normalized selected absolute paths for one immutable inventory.
   *
   * @evidence contracts/common.md#principled-implementation The shared builder records selected source addresses through EvidenceFileTarget normalization.
   * @evidence contracts/common.md#clear-and-simple-design Two spelling sets share one inventory scan and stay local to target-affinity preparation.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Only selected source aliases enter membership sets; absolute and Markdown-relative spellings use their existing artifact normalizers.
   * @evidence contracts/common.md#meaningful-documentation Comments distinguish selected absolute membership, root-relative Markdown membership and immutable preparation-session ownership.
   * @evidence contracts/performance.md#efficient-algorithms One linear source-address pass on first use, then constant-time retrieval.
   * @evidence contracts/performance.md#reuse-equivalent-work The same immutable inventory reuses both absolute and relative sets within this preparation.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The returned readonly set borrows this session and the weak entry dies with its inventory.
   */
  public absolute(inventory: IEvidenceInventory): ReadonlySet<string> {
    this.index(inventory);
    return this.files.get(inventory) ?? new Set();
  }

  /**
   * Returns normalized selected root-relative Markdown paths.
   *
   * @evidence contracts/common.md#principled-implementation The shared builder records selected logical aliases through Markdown normalization and omits dependency-only addresses.
   * @evidence contracts/common.md#clear-and-simple-design Two spelling sets share one inventory scan and stay local to target-affinity preparation.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Only selected source aliases enter membership sets; absolute and Markdown-relative spellings use their existing artifact normalizers.
   * @evidence contracts/common.md#meaningful-documentation Comments distinguish selected absolute membership, root-relative Markdown membership and immutable preparation-session ownership.
   * @evidence contracts/performance.md#efficient-algorithms One linear source-address pass on first use, then constant-time retrieval.
   * @evidence contracts/performance.md#reuse-equivalent-work The same immutable inventory reuses both relative and absolute membership sets.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The readonly set and weak entry live only within this preparation session.
   */
  public markdown(inventory: IEvidenceInventory): ReadonlySet<string> {
    this.index(inventory);
    return this.relatives.get(inventory) ?? new Set();
  }

  /** Keeps both spelling sets aligned with one immutable source snapshot. */
  private index(inventory: IEvidenceInventory): void {
    if (this.files.has(inventory)) return;
    const files: Set<string> = new Set();
    const relatives: Set<string> = new Set();
    for (const source of inventory.sources)
      for (const address of source.addresses)
        if (address.selected !== false) {
          files.add(EvidenceFileTarget.normalize(address.absolute));
          relatives.add(EvidenceMarkdownTarget.normalize(address.relative));
        }
    this.files.set(inventory, files);
    this.relatives.set(inventory, relatives);
  }
}
