import { EvidenceSelectionSnapshot } from "../internal/EvidenceSelectionSnapshot";
import typia from "typia";
import { EvidenceInventoryIndex } from "../internal/EvidenceInventoryIndex";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
import type { IEvidenceInventoryOptions } from "../structures/IEvidenceInventoryOptions";
import type { IEvidencePopulation } from "../structures/IEvidencePopulation";
import type { IEvidenceResolution } from "../structures/IEvidenceResolution";
import type { IEvidenceAddress } from "../structures/IEvidenceAddress";
/**
 * Captures adapter inventories and exposes isolated normalization, selection
 * and resolution results.
 *
 * @evidence contracts/common.md#principled-implementation Input is asserted and captured once; an internal index owns reconciliation and every returned record is cloned.
 * @evidence contracts/common.md#clear-and-simple-design The facade owns capture and copied outputs, while EvidenceInventoryIndex owns normalization, selection and address lookup.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Construction validates the full inventory and captures all nested records; operations preserve incomplete diagnostics and clone any returned records.
 * @evidence contracts/common.md#meaningful-documentation The class and method comments state input capture, independent snapshots, unknown-selection failure and ambiguity or incomplete resolution precedence.
 * @evidence contracts/performance.md#efficient-algorithms Capture and snapshots are linear in records; selection and indexed resolution are delegated.
 * @evidence contracts/performance.md#reuse-equivalent-work One internal index serves every operation on this facade.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The facade owns its captured records; returned copies belong to callers.
 */
export class EvidenceInventory {
  /** Value snapshots isolate mutable caller selections from cached scopes. */
  private readonly selections: EvidenceSelectionSnapshot =
    new EvidenceSelectionSnapshot();

  /** Normalized index over the facade-owned input snapshot. */
  private readonly index: EvidenceInventoryIndex;

  /** Captures caller records before reconciling; malformed shapes throw. */
  public constructor(
    inventories: IEvidenceInventory[],
    options: IEvidenceInventoryOptions = {},
  ) {
    this.index = new EvidenceInventoryIndex(
      structuredClone(typia.assert(inventories)),
      options,
    );
  }

  /**
   * Returns an independent copy including incomplete records and diagnostics.
   *
   * @evidence contracts/common.md#principled-implementation Cloning the internal snapshot isolates all nested records.
   * @evidence contracts/common.md#clear-and-simple-design The facade owns capture and copied outputs, while EvidenceInventoryIndex owns normalization, selection and address lookup.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Construction validates the full inventory and captures all nested records; operations preserve incomplete diagnostics and clone any returned records.
   * @evidence contracts/common.md#meaningful-documentation The class and method comments state input capture, independent snapshots, unknown-selection failure and ambiguity or incomplete resolution precedence.
   * @evidence contracts/performance.md#efficient-algorithms Linear in snapshot size.
   * @evidence contracts/performance.md#reuse-equivalent-work Each caller deliberately receives a separate copy.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The caller owns the result.
   */
  public snapshot(): IEvidenceInventory {
    return structuredClone(this.index.snapshot());
  }

  /**
   * Serializes normalized records in deterministic schema order.
   *
   * @evidence contracts/common.md#principled-implementation The internal index serializes its normalized records with typia.
   * @evidence contracts/common.md#clear-and-simple-design The facade owns capture and copied outputs, while EvidenceInventoryIndex owns normalization, selection and address lookup.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Construction validates the full inventory and captures all nested records; operations preserve incomplete diagnostics and clone any returned records.
   * @evidence contracts/common.md#meaningful-documentation The class and method comments state input capture, independent snapshots, unknown-selection failure and ambiguity or incomplete resolution precedence.
   * @evidence contracts/performance.md#efficient-algorithms Linear in serialized bytes.
   * @evidence contracts/performance.md#reuse-equivalent-work Normalization is reused from construction.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The caller owns the returned string.
   */
  public serialize(): string {
    return this.index.serialize();
  }

  /**
   * Selects visible units and structural scopes into an independent population;
   * unknown IDs throw.
   *
   * @evidence contracts/common.md#principled-implementation The index computes selection and withdrawal closure; a clone isolates its records.
   * @evidence contracts/common.md#clear-and-simple-design The facade owns capture and copied outputs, while EvidenceInventoryIndex owns normalization, selection and address lookup.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Construction validates the full inventory and captures all nested records; operations preserve incomplete diagnostics and clone any returned records.
   * @evidence contracts/common.md#meaningful-documentation The class and method comments state input capture, independent snapshots, unknown-selection failure and ambiguity or incomplete resolution precedence.
   * @evidence contracts/performance.md#efficient-algorithms Linear in units and hosts plus selection ancestry and output size.
   * @evidence contracts/performance.md#reuse-equivalent-work Precomputed unit and withdrawal maps are reused.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The caller owns the result.
   */
  public select(ids: string[]): IEvidencePopulation {
    return structuredClone(this.index.select(ids));
  }

  /**
   * Resolves an exact address into an isolated result, preserving ambiguity and
   * incomplete precedence.
   *
   * @evidence contracts/common.md#principled-implementation The index matches visible and hidden scopes and aliases; a clone isolates returned records.
   * @evidence contracts/common.md#clear-and-simple-design The facade owns capture and copied outputs, while EvidenceInventoryIndex owns normalization, selection and address lookup.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Construction validates the full inventory and captures all nested records; operations preserve incomplete diagnostics and clone any returned records.
   * @evidence contracts/common.md#meaningful-documentation The class and method comments state input capture, independent snapshots, unknown-selection failure and ambiguity or incomplete resolution precedence.
   * @evidence contracts/performance.md#efficient-algorithms Indexed address lookup plus selection comparison and output size.
   * @evidence contracts/performance.md#reuse-equivalent-work The index reuses address and selection-scope maps.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The caller owns the result.
   */
  public resolve(
    address: IEvidenceAddress,
    ids: string[],
  ): IEvidenceResolution {
    return structuredClone(
      this.index.resolve(address, this.selections.capture(ids)),
    );
  }
}
