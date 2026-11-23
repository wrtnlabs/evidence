import { TestValidator } from "@nestia/e2e";
import { EvidenceInventory } from "@wrtnlabs/evidence";
import type { IEvidenceInventory } from "@wrtnlabs/evidence";

import { EvidenceTestInventory } from "../../internal/EvidenceTestInventory";

/**
 * Merges an inventory whose record arrays exceed the engine argument limit.
 *
 * Separate evidence documents put one address, unit and declaration record per
 * document into a single merged inventory, so merging must move records without
 * passing a whole array as call arguments, whose count the call stack bounds.
 *
 * 1. Build one inventory with 200,000 units and 200,000 matching addresses, more
 *    records than one spread call can pass on a default Node stack.
 * 2. Construct the public inventory, which merges the records.
 * 3. Require a complete snapshot that keeps every unit and address.
 *
 * @evidence contracts/testing.md#behavioral-verification Constructs a public EvidenceInventory from 200000 units and addresses and asserts completeness and both record counts of its snapshot.
 * @evidence contracts/testing.md#independent-expectations Every authored unit has a distinct identity and one address, so a complete merge keeps exactly the authored counts; a merge that spreads the arrays into call arguments throws a RangeError instead.
 * @evidence contracts/testing.md#distinguishing-cases Covers record volume beyond the argument limit; inventory suites own conflicts, aliases and incomplete inputs, and test_performance_inventory_parents owns deep ancestry.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor invokes maintained inventory logic on in-memory records without a CLI or temporary files.
 */
export async function test_performance_inventory_volume(): Promise<void> {
  const count: number = 200_000;
  const input: IEvidenceInventory = EvidenceTestInventory.create();
  for (let index: number = 0; index < count; ++index)
    EvidenceTestInventory.unit(
      input,
      `unit-${index}`,
      [`Unit${index}`],
      "type",
      "export class Box { value = 1; }",
    );
  const inventory: EvidenceInventory = new EvidenceInventory([input]);
  const snapshot: IEvidenceInventory = inventory.snapshot();
  TestValidator.equals("volume complete", snapshot.complete, true);
  TestValidator.equals("every unit kept", snapshot.units.length, count);
  TestValidator.equals("every address kept", snapshot.addresses.length, count);
}
