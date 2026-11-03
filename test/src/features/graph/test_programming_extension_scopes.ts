import {
  EvidenceDartAdapter,
  EvidenceInventory,
  EvidenceObjcAdapter,
  EvidenceSwiftAdapter,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceAdapter,
  IEvidenceDiagnostic,
  IEvidenceHost,
  IEvidenceInventory,
  IEvidencePopulation,
  IEvidenceSourceSnapshot,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Keeps extension containers outside type obligations and declaration hosts.
 *
 * Dart ordinary extensions and Objective-C categories name member scopes; Swift
 * and Objective-C class extensions reopen verified actual types.
 *
 * 1. Analyze one actual type and an extension method in each language, including a
 *    Dart extension type and an Objective-C anonymous class extension.
 * 2. Require the actual type to remain the only type, extension members to keep
 *    their qualified addresses, and containers to add no evidence hosts.
 * 3. Put evidence and withdrawal tags on each extension container and require
 *    unsupported claim diagnostics or inherited withdrawal respectively.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs Dart, Objective-C and Swift adapters and selects and resolves their inventories; asserts actual type classification, no container hosts, member addresses, rejected extension evidence and inherited withdrawals.
 * @evidence contracts/testing.md#independent-expectations Ordinary extensions and Objective-C categories add members to existing types; Dart extension types introduce a type. Fixtures contain one actual type and one extension method, with no independent extension evidence host.
 * @evidence contracts/testing.md#distinguishing-cases Covers ordinary versus type extensions in Dart, named versus anonymous Objective-C extensions, Swift verified nominal ownership, unsupported container claims and inherited hiding. Existing language tests cover cross-file ownership, aliases, privacy and missing owners.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers test_programming_extension_scopes and calls maintained adapters and EvidenceInventory in-process with in-memory snapshots.
 */
export async function test_programming_extension_scopes(): Promise<void> {
  const cases: Map<IEvidenceAdapter, IEvidenceSourceSnapshot> = new Map<
    IEvidenceAdapter,
    IEvidenceSourceSnapshot
  >([
    [
      new EvidenceDartAdapter(),
      EvidenceTestSourceSnapshot.create(
        "src/extensions.dart",
        dedent`
      extension type Value(int value) {}
      extension Numbers on int { int run() => this; }
    `,
      ),
    ],
    [
      new EvidenceObjcAdapter(),
      EvidenceTestSourceSnapshot.create(
        "src/Extensions.h",
        dedent`
      @interface Value
      @end
      @interface Value (Numbers)
      - (int)run;
      @end
      @interface Value ()
      @property int hidden;
      @end
    `,
      ),
    ],
    [
      new EvidenceSwiftAdapter(),
      EvidenceTestSourceSnapshot.create(
        "src/Extensions.swift",
        dedent`
      public struct Value {}
      public extension Value { func run() {} }
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
          `${adapter.type} complete extension surface`,
          inventory.diagnostics,
          [],
        );
        TestValidator.equals(
          `${adapter.type} only actual types`,
          inventory.units
            .filter((unit: IEvidenceUnit): boolean => unit.symbol === "type")
            .map((unit: IEvidenceUnit): string => unit.name),
          ["Value"],
        );
        const value: IEvidenceUnit | undefined = inventory.units.find(
          (unit: IEvidenceUnit): boolean => unit.name === "Value",
        );
        if (value === undefined)
          throw new Error(`${adapter.type}: missing actual type`);
        TestValidator.equals(
          `${adapter.type} one actual type host`,
          inventory.hosts.filter((host: IEvidenceHost): boolean =>
            host.unitIds.includes(value.id),
          ).length,
          1,
        );
        const scopes: Set<string> = new Set(
          inventory.units
            .filter((unit: IEvidenceUnit): boolean => unit.symbol === "scope")
            .map((unit: IEvidenceUnit): string => unit.id),
        );
        TestValidator.equals(
          `${adapter.type} scopes cannot host evidence`,
          inventory.hosts.some((host: IEvidenceHost): boolean =>
            host.unitIds.some((id: string): boolean => scopes.has(id)),
          ),
          false,
        );
        const segments: string[] =
          adapter.type === "dart"
            ? ["Numbers", "run"]
            : adapter.type === "objc"
              ? ["Value(Numbers)", "-run"]
              : ["Value", "run"];
        const ids: string[] = inventory.units.map(
          (unit: IEvidenceUnit): string => unit.id,
        );
        const file: string = snapshot.files[0]?.physicalPath ?? "";
        TestValidator.equals(
          `${adapter.type} extension member address`,
          new EvidenceInventory([inventory]).resolve({ file, segments }, ids)
            .status,
          "resolved",
        );
        const containers: string[] =
          adapter.type === "dart"
            ? ["extension Numbers"]
            : adapter.type === "objc"
              ? ["@interface Value (Numbers)", "@interface Value ()"]
              : ["public extension Value"];
        for (const container of containers)
          for (const marker of [
            "@evidence docs/spec.md#rule Container claims are unsupported.",
            "@internal Hidden extension.",
          ]) {
            const source: string = snapshot.files[0]?.content ?? "";
            const annotated: IEvidenceInventory = await adapter.analyze(
              EvidenceTestSourceSnapshot.create(
                snapshot.files[0]?.fingerprintPath ?? "",
                source.replace(container, `/** ${marker} */\n${container}`),
              ),
            );
            if (marker.startsWith("@evidence")) {
              TestValidator.equals(
                `${adapter.type} ${container} cannot claim evidence`,
                annotated.declarations,
                [],
              );
              TestValidator.equals(
                `${adapter.type} ${container} unsupported host`,
                annotated.diagnostics.map(
                  (diagnostic: IEvidenceDiagnostic): string => diagnostic.code,
                ),
                ["unsupported-annotation-host"],
              );
            } else {
              TestValidator.equals(
                `${adapter.type} ${container} withdrawal diagnostics`,
                annotated.diagnostics,
                [],
              );
              const population: IEvidencePopulation = new EvidenceInventory([
                annotated,
              ]).select(
                annotated.units.map((unit: IEvidenceUnit): string => unit.id),
              );
              if (
                adapter.type === "objc" &&
                container === "@interface Value ()"
              )
                TestValidator.equals(
                  "class-extension withdrawal reaches the actual type",
                  population.units.some(
                    (unit: IEvidenceUnit): boolean => unit.name === "Value",
                  ),
                  false,
                );
              else
                TestValidator.equals(
                  `${adapter.type} inherited member withdrawal`,
                  population.units.filter(
                    (unit: IEvidenceUnit): boolean =>
                      unit.symbol === "function",
                  ),
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
    throw new AggregateError(
      failures,
      "Programming extension scope regressions",
    );
}
