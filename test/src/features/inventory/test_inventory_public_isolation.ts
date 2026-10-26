import { TestValidator } from "@nestia/e2e";
import { EvidenceInventory, EvidenceTargetResolver } from "@wrtnlabs/evidence";
import type {
  IEvidenceInventory,
  IEvidenceSourceFile,
  IEvidenceUnitSite,
  IEvidenceResolution,
  IEvidenceTargetResolution,
  IEvidenceTargetStatement,
  IEvidenceUnit,
  IEvidenceHost,
} from "@wrtnlabs/evidence";

import { EvidenceTestInventory } from "../../internal/EvidenceTestInventory";

/**
 * Protects normalized indexes from mutation through every public inventory
 * boundary.
 *
 * Internal sharing is safe only when caller inputs and nested result records
 * cannot alter retained source, scope or resolver state.
 *
 * 1. Capture two units and a host in inventory and resolver facades, then mutate
 *    the original nested source and identity arrays; require the captured
 *    view.
 * 2. Mutate snapshots, selected records, resolution records and resolver results;
 *    require later reads to reproduce their original independent values.
 * 3. Change a reused selection array from the first unit to the second and back;
 *    require missing and resolved outcomes to follow current values.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs public snapshot, select, resolve and target resolution operations and asserts isolation after nested mutations and selection-array edits.
 * @evidence contracts/testing.md#independent-expectations Two distinct authored addresses resolve only when their semantic unit is selected; capture semantics require values from before caller mutation.
 * @evidence contracts/testing.md#distinguishing-cases Covers input and output mutation, nested coordinates and identities, source text and aliases, repeated snapshots and mutable selection-array identity. Existing inventory tests own conflicts, malformed shapes and withdrawals.
 * @evidence contracts/testing.md#execution-ownership The exported test_inventory_public_isolation is discovered by DynamicExecutor and calls public maintained inventory and resolver logic directly without subprocesses or filesystem fixtures.
 */
export async function test_inventory_public_isolation(): Promise<void> {
  const input: IEvidenceInventory = EvidenceTestInventory.create();
  const first: IEvidenceUnit = EvidenceTestInventory.unit(
    input,
    "first",
    ["first"],
    "function",
    "export const first = 1, second = 2;",
  );
  const second: IEvidenceUnit = EvidenceTestInventory.unit(
    input,
    "second",
    ["second"],
    "function",
    "export const unrelated = 3;",
  );
  const host: IEvidenceHost = EvidenceTestInventory.host(
    input,
    "host",
    "first-site",
    [first.id],
    "/** Shared documentation. */",
  );
  const inventory: EvidenceInventory = new EvidenceInventory([input]);
  const resolver: EvidenceTargetResolver = new EvidenceTargetResolver([input]);
  const baseline: IEvidenceInventory = inventory.snapshot();
  first.identity.push("mutated");
  const source: IEvidenceSourceFile | undefined = input.sources[0];
  if (source === undefined) throw new Error("Missing fixture source.");
  source.content = "mutated";
  source.addresses.length = 0;
  TestValidator.equals("input capture", inventory.snapshot(), baseline);
  const snapshot: IEvidenceInventory = inventory.snapshot();
  const unit: IEvidenceUnit | undefined = snapshot.units[0];
  if (unit === undefined) throw new Error("Missing captured unit.");
  unit.identity.push("mutated");
  const site: IEvidenceUnitSite | undefined = unit.sites[0];
  if (site === undefined) throw new Error("Missing captured site.");
  site.range.start.offset = 999;
  snapshot.diagnostics.push({
    code: "mutation",
    severity: "error",
    message: "mutation",
    repair: "mutation",
  });
  const ids: string[] = ["first"];
  const resolved: IEvidenceResolution = inventory.resolve(
    { file: "/project/source.ts", segments: ["first"] },
    ids,
  );
  const expected: IEvidenceResolution = structuredClone(resolved);
  const resolvedUnit: IEvidenceUnit | undefined = resolved.units[0];
  if (resolvedUnit === undefined) throw new Error("Missing resolved unit.");
  resolvedUnit.sites.length = 0;
  inventory.select(ids).units[0]?.identity.push("mutated");
  TestValidator.equals(
    "snapshot and selection outputs isolated",
    inventory.snapshot(),
    baseline,
  );
  TestValidator.equals(
    "resolution isolated",
    inventory.resolve({ file: "/project/source.ts", segments: ["first"] }, ids),
    expected,
  );
  ids[0] = second.id;
  TestValidator.equals(
    "changed selection invalidates scopes",
    inventory.resolve({ file: "/project/source.ts", segments: ["first"] }, ids)
      .status,
    "missing",
  );
  ids[0] = "first";
  const statement: IEvidenceTargetStatement = {
    hostId: host.id,
    target: "/project/source.ts#first",
    location: { file: host.file, range: host.range },
  };
  const target: IEvidenceTargetResolution = await resolver.resolve(
    statement,
    host,
    ids,
  );
  const targetBaseline: IEvidenceTargetResolution = structuredClone(target);
  const targetUnit: IEvidenceUnit | undefined = target.units[0];
  if (targetUnit === undefined) throw new Error("Missing target unit.");
  targetUnit.identity.push("mutated");
  targetUnit.sites.length = 0;
  TestValidator.equals(
    "resolver output isolated",
    await resolver.resolve(statement, host, ids),
    targetBaseline,
  );
  ids[0] = second.id;
  TestValidator.equals(
    "resolver selection mutation observed",
    (await resolver.resolve(statement, host, ids)).status,
    "missing-member",
  );
  ids[0] = "first";
  TestValidator.equals(
    "resolver selection recovers",
    await resolver.resolve(statement, host, ids),
    targetBaseline,
  );
}
