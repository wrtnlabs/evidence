import { TestValidator } from "@nestia/e2e";
import { EvidenceInventory } from "@wrtnlabs/evidence";
import type {
  IEvidenceUnit,
  IEvidenceInventory,
  IEvidencePopulation,
} from "@wrtnlabs/evidence";
import { performance } from "node:perf_hooks";
import { EvidenceTestInventory } from "../../internal/EvidenceTestInventory";

/**
 * Validates and selects a deep explicit parent chain without rebuilding
 * ancestry.
 *
 * Deep explicit ownership must preserve all selected units and structural
 * scopes without walking every ancestor for every selected unit.
 *
 * 1. Build a valid 20,000-unit parent chain.
 * 2. Normalize and select the full public inventory.
 * 3. Require complete records and all selected units and scopes within the
 *    execution ceiling.
 *
 * @evidence contracts/testing.md#behavioral-verification Constructs a public inventory with 20000 units and checks complete validation and full units/scopes under a generous latency ceiling.
 * @evidence contracts/testing.md#independent-expectations All explicitly selected units remain visible because the authored chain has no withdrawal, missing parent or cycle.
 * @evidence contracts/testing.md#distinguishing-cases Covers a deep chain and overlapping selected ancestry; existing inventory suites own cycles, missing parents and inherited withdrawals.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor invokes maintained inventory logic on in-memory records without a CLI or temporary files.
 */
export async function test_performance_inventory_parents(): Promise<void> {
  const count: number = 20000;
  const input: IEvidenceInventory = EvidenceTestInventory.create();
  for (let index: number = 0; index < count; ++index)
    EvidenceTestInventory.unit(
      input,
      `unit-${index}`,
      [`Unit${index}`],
      "type",
      "export class Box { value = 1; }",
      index === 0 ? undefined : `unit-${index - 1}`,
    );
  const start: number = performance.now();
  const inventory: EvidenceInventory = new EvidenceInventory([input]);
  TestValidator.equals(
    "deep chain complete",
    inventory.snapshot().complete,
    true,
  );
  const selected: IEvidencePopulation = inventory.select(
    input.units.map((unit: IEvidenceUnit): string => unit.id),
  );
  TestValidator.equals(
    "all explicit requirements",
    selected.units.length,
    count,
  );
  TestValidator.equals(
    "deduplicated ancestor closure",
    selected.scopes.length,
    count,
  );
  TestValidator.predicate(
    "parent preparation ceiling",
    performance.now() - start < 15000,
  );
}
