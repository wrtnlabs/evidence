import {
  EvidenceCppAdapter,
  EvidenceInventory,
  EvidenceRustAdapter,
  EvidenceTypeScriptAdapter,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceAdapter,
  IEvidenceDiagnostic,
  IEvidenceHost,
  IEvidenceInventory,
  IEvidencePopulation,
  IEvidenceResolution,
  IEvidenceSourceSnapshot,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Keeps programming address containers outside evidence populations and hosts.
 *
 * Namespace and module paths must survive classification without requiring
 * checklist answers on containers or losing their actual declarations.
 *
 * 1. Analyze equivalent TypeScript, C++, and Rust containers, including an empty
 *    container and a nested container with a type, function, and value.
 * 2. Select every inventory ID and require only the three actual declarations,
 *    while resolving the outer container as their aggregate address.
 * 3. Require fallback hosts only for actual declarations, then put an evidence tag
 *    or withdrawal on the outer container and check unsupported attachment or
 *    inherited hiding respectively.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs three adapters and inventory selection and resolution; asserts address-only scope classification, actual obligations and hosts, unsupported container claims, and inherited withdrawal.
 * @evidence contracts/testing.md#independent-expectations The fixtures declare exactly one type, function and property below two address containers; namespaces and Rust modules introduce paths rather than types.
 * @evidence contracts/testing.md#distinguishing-cases Covers empty and nested containers, explicit selection of every ID, aggregate resolution, unsupported container annotations and inherited hiding in all three affected languages. Existing language tests cover aliases, file modules, ambient declarations and merging.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers test_programming_address_scopes and calls maintained adapters and EvidenceInventory in-process with in-memory snapshots.
 */
export async function test_programming_address_scopes(): Promise<void> {
  const cases: Map<IEvidenceAdapter, IEvidenceSourceSnapshot> = new Map<
    IEvidenceAdapter,
    IEvidenceSourceSnapshot
  >([
    [
      new EvidenceTypeScriptAdapter(),
      EvidenceTestSourceSnapshot.create(
        "src/scopes.ts",
        dedent`
          export namespace Empty {}
          export namespace api {
            export namespace nested {
              export interface Shape {}
              export function run(): void {}
              export const value = 1;
            }
          }
        `,
      ),
    ],
    [
      new EvidenceCppAdapter(),
      EvidenceTestSourceSnapshot.create(
        "src/scopes.hpp",
        dedent`
          namespace Empty {}
          namespace api {
            namespace nested {
              struct Shape {};
              void run();
              extern int value;
            }
          }
        `,
      ),
    ],
    [
      new EvidenceRustAdapter(),
      EvidenceTestSourceSnapshot.create(
        "src/lib.rs",
        dedent`
          pub mod Empty {}
          pub mod api {
            pub mod nested {
              pub struct Shape;
              pub fn run() {}
              pub const value: usize = 1;
            }
          }
        `,
      ),
    ],
  ]);
  const results: PromiseSettledResult<undefined>[] = await Promise.allSettled(
    Array.from(
      cases,
      async ([adapter, snapshot]: [
        IEvidenceAdapter,
        IEvidenceSourceSnapshot,
      ]): Promise<undefined> => {
        const inventory: IEvidenceInventory = await adapter.analyze(snapshot);
        TestValidator.equals(
          `${adapter.type} completeness`,
          inventory.diagnostics,
          [],
        );
        for (const name of ["Empty", "api", "api.nested"])
          TestValidator.equals<string | undefined>(
            `${adapter.type} ${name} is an address scope`,
            inventory.units.find(
              (unit: IEvidenceUnit): boolean =>
                unit.identity.join(".") === name,
            )?.symbol,
            "scope",
          );
        const ids: string[] = inventory.units.map(
          (unit: IEvidenceUnit): string => unit.id,
        );
        const index: EvidenceInventory = new EvidenceInventory([inventory]);
        const population: IEvidencePopulation = index.select(ids);
        TestValidator.equals(
          `${adapter.type} actual obligations`,
          population.units
            .map(
              (unit: IEvidenceUnit): string =>
                `${unit.symbol}:${unit.identity.join(".")}`,
            )
            .sort(compare),
          [
            "function:api.nested.run",
            "property:api.nested.value",
            "type:api.nested.Shape",
          ],
        );
        const selected: Set<string> = new Set(
          population.units.map((unit: IEvidenceUnit): string => unit.id),
        );
        TestValidator.equals(
          `${adapter.type} only declaration hosts`,
          inventory.hosts.every((host: IEvidenceHost): boolean =>
            host.unitIds.every((id: string): boolean => selected.has(id)),
          ),
          true,
        );
        TestValidator.equals(
          `${adapter.type} hosted declarations`,
          new Set(
            inventory.hosts.flatMap(
              (host: IEvidenceHost): string[] => host.unitIds,
            ),
          ).size,
          3,
        );
        const file: string = snapshot.files[0]?.physicalPath ?? "";
        const aggregate: IEvidenceResolution = index.resolve(
          { file, segments: ["api"] },
          ids,
        );
        TestValidator.equals(
          `${adapter.type} aggregate address`,
          aggregate.status,
          "resolved",
        );
        for (const marker of [
          "@evidence docs/spec.md#rule Container claims are unsupported.",
          "@internal Hidden container.",
        ]) {
          const source: string = snapshot.files[0]?.content ?? "";
          const prefix: string =
            adapter.type === "rust" ? `/// ${marker}\n` : `/** ${marker} */\n`;
          const declaration: string =
            adapter.type === "typescript"
              ? "export namespace api"
              : adapter.type === "cpp"
                ? "namespace api"
                : "pub mod api";
          const annotated: IEvidenceInventory = await adapter.analyze(
            EvidenceTestSourceSnapshot.create(
              snapshot.files[0]?.fingerprintPath ?? "",
              source.replace(declaration, `${prefix}${declaration}`),
            ),
          );
          if (marker.startsWith("@evidence")) {
            TestValidator.equals(
              `${adapter.type} unsupported claim cannot supply evidence`,
              annotated.declarations,
              [],
            );
            TestValidator.equals(
              `${adapter.type} unsupported container diagnostic`,
              annotated.diagnostics.map(
                (diagnostic: IEvidenceDiagnostic): string => diagnostic.code,
              ),
              ["unsupported-annotation-host"],
            );
            TestValidator.equals(
              `${adapter.type} unsupported container host`,
              annotated.hosts.filter(
                (host: IEvidenceHost): boolean =>
                  host.attachment === "unsupported",
              ).length,
              1,
            );
          } else {
            TestValidator.equals(
              `${adapter.type} withdrawal completeness`,
              annotated.diagnostics,
              [],
            );
            const visible: IEvidencePopulation = new EvidenceInventory([
              annotated,
            ]).select(
              annotated.units.map((unit: IEvidenceUnit): string => unit.id),
            );
            TestValidator.equals(
              `${adapter.type} inherited withdrawal`,
              visible.units,
              [],
            );
          }
        }
        return undefined;
      },
    ),
  );
  const failures: unknown[] = results.flatMap(
    (result: PromiseSettledResult<undefined>): unknown[] =>
      result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length !== 0)
    throw new AggregateError(failures, "Programming address scope regressions");
}

/** Orders exact declaration spellings without locale-dependent comparisons. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
