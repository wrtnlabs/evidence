import { TestValidator } from "@nestia/e2e";
import { EvidenceInventory } from "@wrtnlabs/evidence";
import type {
  IEvidenceHost,
  IEvidenceInventory,
  IEvidenceSourceFile,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";

import { EvidenceTestInventory } from "../../internal/EvidenceTestInventory";

/**
 * Merges an inventory that lists the same record objects more than once.
 *
 * Merging appends a repeated record's arrays onto its first occurrence; when
 * both occurrences are one object, the target array is also the source and must
 * be read before it grows.
 *
 * 1. Build one source, unit and host, then list each object twice in the same
 *    inventory.
 * 2. Construct the public inventory.
 * 3. Require a complete snapshot with one source address, one unit, one host and
 *    the host's single unit ID and origin.
 *
 * @evidence contracts/testing.md#behavioral-verification Constructs a public EvidenceInventory from repeated source, unit and host objects and asserts completeness, diagnostics and every merged record count.
 * @evidence contracts/testing.md#independent-expectations A repeated object carries no new identity, so merging and normalization keep exactly the one authored source address, unit, host, unit ID and origin; appending an array to itself while iterating it never terminates.
 * @evidence contracts/testing.md#distinguishing-cases Covers one object repeated within an inventory; test_inventory_aliases owns an inventory combined with its separate copy and export aliases, and test_performance_inventory_volume owns record volume.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor invokes maintained inventory logic on in-memory records without a CLI or temporary files.
 */
export async function test_inventory_shared_records(): Promise<void> {
  const input: IEvidenceInventory = EvidenceTestInventory.create();
  const unit: IEvidenceUnit = EvidenceTestInventory.unit(
    input,
    "box",
    ["Box"],
    "type",
    "export class Box { value = 1; }",
  );
  const host: IEvidenceHost = EvidenceTestInventory.host(
    input,
    "box-host",
    "box-site",
    ["box"],
    "/** Class documentation. */",
  );
  const source: IEvidenceSourceFile | undefined = input.sources[0];
  if (source === undefined) throw new Error("The fixture has no source.");
  input.sources.push(source);
  input.units.push(unit);
  input.hosts.push(host);

  const snapshot: IEvidenceInventory = new EvidenceInventory([
    input,
  ]).snapshot();
  TestValidator.equals("shared records complete", snapshot.complete, true);
  TestValidator.equals("no conflicts", snapshot.diagnostics, []);
  TestValidator.equals(
    "one source address",
    snapshot.sources.map(
      (file: IEvidenceSourceFile): number => file.addresses.length,
    ),
    [1],
  );
  TestValidator.equals("one unit", snapshot.units.length, 1);
  TestValidator.equals(
    "one host with one unit and origin",
    snapshot.hosts.map((entry: IEvidenceHost): string[][] => [
      entry.unitIds,
      entry.origins ?? [],
    ]),
    [[["box"], ["/project/source.ts"]]],
  );
}
