import { EvidenceTypeScriptAdapter } from "@wrtnlabs/evidence";
import type { IEvidenceUnit } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Extracts TypeScript declarations across ambient and structural forms.
 *
 * Ambient, abstract, parameter-property, and dotted namespace syntax each
 * contribute different public units.
 *
 * 1. Analyze the supported declaration matrix.
 * 2. Verify exact identities, symbols, and ownership.
 *
 * @evidence contracts/testing.md#behavioral-verification Analyzes ambient, abstract, parameter-property and dotted-namespace TypeScript declarations and asserts identities, symbols and ownership.
 * @evidence contracts/testing.md#independent-expectations Expected units are the declared surface written in the test.
 * @evidence contracts/testing.md#distinguishing-cases Covers each structural form that contributes different public units.
 * @evidence contracts/testing.md#execution-ownership The exported test_typescript_declarations is discovered by DynamicExecutor under test/src/features and calls maintained source in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_typescript_declarations(): Promise<void> {
  const content = dedent`
    export declare class Declared {
      method(value: string): void;
      field: string;
      callback: () => void;
    }

    export abstract class Abstract {
      abstract run(): void;
      abstract data: string;
      declare ready: boolean;
    }

    export class PrivateConstructor {
      private constructor(public id: string, protected secret: string) {}
    }

    export class WithdrawnConstructor {
      /** @internal This constructor does not expose its generated field. */
      private constructor(public value: string) {}
    }

    export class OverloadedConstructor {
      /** @hidden This overload withdraws the field declared by the implementation. */
      constructor(value: string);
      constructor(public value: string) {}
    }

    export namespace Outer.Inner {
      interface Shape {
        value: string;
      }
      function implicit(): void;
    }
  `;
  const inventory = await new EvidenceTypeScriptAdapter().analyze(
    EvidenceTestSourceSnapshot.create("src/declarations.d.ts", content),
  );

  TestValidator.equals(
    "declaration units",
    inventory.units
      .map((unit) => `${unit.symbol}:${unit.identity.join(".")}`)
      .sort(compare),
    [
      "function:Abstract.prototype.run",
      "function:Declared.prototype.callback",
      "function:Declared.prototype.method",
      "function:Outer.Inner.implicit",
      "property:Abstract.prototype.data",
      "property:Abstract.prototype.ready",
      "property:Declared.prototype.field",
      "property:OverloadedConstructor.prototype.value",
      "property:PrivateConstructor.prototype.id",
      "property:Outer.Inner.Shape.value",
      "property:WithdrawnConstructor.prototype.value",
      "type:Abstract",
      "type:Declared",
      "scope:Outer",
      "scope:Outer.Inner",
      "type:Outer.Inner.Shape",
      "type:OverloadedConstructor",
      "type:PrivateConstructor",
      "type:WithdrawnConstructor",
    ].sort(compare),
  );

  // Every synthesized namespace level remains navigable through the unit tree.
  const outer: IEvidenceUnit = requireUnit(inventory.units, "scope", "Outer");
  const inner: IEvidenceUnit = requireUnit(
    inventory.units,
    "scope",
    "Outer.Inner",
  );
  const shape = requireUnit(inventory.units, "type", "Outer.Inner.Shape");
  const value = requireUnit(
    inventory.units,
    "property",
    "Outer.Inner.Shape.value",
  );
  TestValidator.equals("inner namespace parent", inner.parentId, outer.id);
  TestValidator.equals("nested type parent", shape.parentId, inner.id);
  TestValidator.equals("nested property parent", value.parentId, shape.id);

  for (const identity of [
    "OverloadedConstructor.prototype.value",
    "WithdrawnConstructor.prototype.value",
  ]) {
    const withdrawn = requireUnit(inventory.units, "property", identity);
    TestValidator.equals(
      `${identity} constructor withdrawal`,
      withdrawn.withdrawals.length,
      1,
    );
    TestValidator.predicate(
      `${identity} has no eligible host`,
      !inventory.hosts.some((host) => host.unitIds.includes(withdrawn.id)),
    );
  }
  TestValidator.equals(
    "complete declaration inventory",
    inventory.diagnostics,
    [],
  );

  // Every TypeScript declaration-file extension makes namespace members ambient.
  const extensions = await new EvidenceTypeScriptAdapter().analyze(
    EvidenceTestSourceSnapshot.combine([
      EvidenceTestSourceSnapshot.create(
        "src/module.d.mts",
        "export namespace Mts { function run(): void; }",
      ),
      EvidenceTestSourceSnapshot.create(
        "src/common.d.cts",
        "export namespace Cts { function run(): void; }",
      ),
    ]),
  );
  TestValidator.equals(
    "ambient declaration extensions",
    extensions.units
      .map((unit) => `${unit.symbol}:${unit.identity.join(".")}`)
      .sort(compare),
    ["function:Cts.run", "function:Mts.run", "scope:Cts", "scope:Mts"],
  );
  TestValidator.equals(
    "complete declaration extension inventory",
    extensions.diagnostics,
    [],
  );
}

function requireUnit(
  units: IEvidenceUnit[],
  symbol: IEvidenceUnit["symbol"],
  identity: string,
): IEvidenceUnit {
  const unit = units.find(
    (entry) => entry.symbol === symbol && entry.identity.join(".") === identity,
  );
  if (unit === undefined)
    throw new Error(`Missing TypeScript unit: ${symbol} ${identity}`);
  return unit;
}

function compare(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}
