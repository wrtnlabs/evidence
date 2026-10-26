import { TestValidator } from "@nestia/e2e";
import { EvidenceTypeScriptAdapter } from "@wrtnlabs/evidence";
import type {
  IEvidencePublicAddress,
  IEvidenceInventory,
  IEvidenceSourceSnapshot,
} from "@wrtnlabs/evidence";
import { performance } from "node:perf_hooks";
import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Resolves a linear-size diamond re-export DAG without enumerating its paths.
 *
 * A shared export graph has linear output even though it has exponentially many
 * paths; extraction must resolve the shared bindings without enumerating every
 * path.
 *
 * 1. Build twenty-four two-barrel layers ending in one function.
 * 2. Require one semantic unit and exactly one address in each of fifty modules.
 * 3. Require completion within ten seconds after grammar warmup; the former
 *    recursive traversal visited exponentially many paths for this fixed
 *    output.
 *
 * @evidence contracts/testing.md#behavioral-verification Extracts a real TypeScript diamond DAG and checks completeness, identity, every public address and a generous warmed latency ceiling.
 * @evidence contracts/testing.md#independent-expectations All barrels forward the single leaf function, so fifty modules expose exactly one unchanged semantic unit each.
 * @evidence contracts/testing.md#distinguishing-cases Covers twenty-four shared diamond layers; existing export tests cover cycles, named shadowing, type-only and namespace projections.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor invokes the maintained adapter directly on in-memory snapshots without a CLI or filesystem fixture.
 */
export async function test_performance_export_diamond(): Promise<void> {
  const adapter: EvidenceTypeScriptAdapter = new EvidenceTypeScriptAdapter();
  await adapter.analyze(
    EvidenceTestSourceSnapshot.create("warm.ts", "export function warm() {}"),
  );
  const sources: IEvidenceSourceSnapshot[] = [
    EvidenceTestSourceSnapshot.create("leaf.ts", "export function value() {}"),
  ];
  let targets: string[] = ["leaf"];
  for (let depth: number = 0; depth < 24; ++depth) {
    const next: string[] = [`a${depth}`, `b${depth}`];
    for (const name of next)
      sources.push(
        EvidenceTestSourceSnapshot.create(
          `${name}.ts`,
          targets
            .map((target: string): string => `export * from './${target}';`)
            .join("\n"),
        ),
      );
    targets = next;
  }
  sources.push(
    EvidenceTestSourceSnapshot.create(
      "entry.ts",
      targets
        .map((target: string): string => `export * from './${target}';`)
        .join("\n"),
    ),
  );
  const start: number = performance.now();
  const inventory: IEvidenceInventory = await adapter.analyze(
    EvidenceTestSourceSnapshot.combine(sources),
  );
  TestValidator.equals("diamond diagnostics", inventory.diagnostics, []);
  TestValidator.equals("one semantic owner", inventory.units.length, 1);
  TestValidator.equals(
    "every barrel exposes its own address",
    inventory.addresses.length,
    50,
  );
  TestValidator.equals(
    "all names survive",
    inventory.addresses.every(
      (address: IEvidencePublicAddress): boolean =>
        address.segments.join(".") === "value",
    ),
    true,
  );
  TestValidator.predicate(
    "diamond traversal is bounded",
    performance.now() - start < 10000,
  );
}
