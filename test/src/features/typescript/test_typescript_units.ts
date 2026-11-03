import { EvidenceTypeScriptAdapter } from "@wrtnlabs/evidence";
import type { IEvidenceUnit } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Classifies TypeScript's supported public declaration matrix.
 *
 * Declaration kind and member path determine the addressable population
 * exported by an artifact.
 *
 * 1. Analyze supported declarations and members.
 * 2. Verify exact symbols, identities, and public paths.
 *
 * @evidence contracts/testing.md#behavioral-verification Analyzes TypeScript's supported declaration and member matrix and asserts symbols, identities and public paths.
 * @evidence contracts/testing.md#independent-expectations Expected units are the declared public surface written in the test.
 * @evidence contracts/testing.md#distinguishing-cases Covers every supported declaration kind and member path.
 * @evidence contracts/testing.md#execution-ownership The exported test_typescript_units is discovered by DynamicExecutor under test/src/features and calls maintained source in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_typescript_units(): Promise<void> {
  const content = dedent`
    export interface IService {
      run(): void;
      callback: () => void;
      value: string;
      get ignored(): string;
    }

    export type Shape = {
      build(): void;
      handler: (value: string) => void;
      count: number;
    };

    export class Box {
      static create(): Box { return new Box("id", "secret"); }
      execute(): void {}
      callback!: () => void;
      handler = (): void => {};
      static factory = function (): void {};
      declare wrapped: (() => void);
      declare static provider: () => void;
      value = 1;
      accessor generated = 2;
      protected hidden = 2;
      get ignored(): number { return 1; }
      constructor(public readonly id: string, protected secret: string) {}
    }

    export const arrow = (): void => {}, data = 1;
    export const expression = function (): void {};
    export const parenthesized = (() => {});
    export const asserted = (() => {}) as () => void;
    export const angle = <() => void>(() => {});
    export const satisfied = (() => {}) satisfies () => void;
    export const generated = function* (): Generator<number> { yield 1; };
    export function* declaredGenerator(): Generator<number> { yield 1; }
    export let mutable = (): void => {};
    export const typed: () => void = callback;
    export const { first, nested: { leaf } } = payload;
    export const { length: named } = function target(): void {};
    export const [callableLeaf] = (): void => {};

    export namespace Tools {
      export function parse(): void {}
      export const format = (): void => {}, version = 1;
      export interface Options { strict: boolean; }
      interface Local { hidden: boolean; }
    }

    export enum Ignored { A }
  `;
  const inventory = await new EvidenceTypeScriptAdapter().analyze(
    EvidenceTestSourceSnapshot.create("src/contracts.ts", content),
  );

  const actual = inventory.units
    .map((unit) => `${unit.symbol}:${unit.identity.join(".")}`)
    .sort(compare);
  const expected = [
    "function:Box.create",
    "function:Box.prototype.callback",
    "function:Box.prototype.execute",
    "function:Box.prototype.handler",
    "function:Box.prototype.wrapped",
    "function:Box.factory",
    "function:Box.provider",
    "function:IService.callback",
    "function:IService.run",
    "function:Shape.build",
    "function:Shape.handler",
    "function:Tools.format",
    "function:Tools.parse",
    "function:angle",
    "function:arrow",
    "function:asserted",
    "function:declaredGenerator",
    "function:expression",
    "function:generated",
    "function:parenthesized",
    "function:satisfied",
    "property:Box.prototype.id",
    "property:Box.prototype.value",
    "property:IService.value",
    "property:Shape.count",
    "property:Tools.Options.strict",
    "property:Tools.version",
    "property:data",
    "property:first",
    "property:leaf",
    "property:callableLeaf",
    "property:mutable",
    "property:named",
    "property:typed",
    "type:Box",
    "type:IService",
    "type:Shape",
    "scope:Tools",
    "type:Tools.Options",
  ].sort(compare);

  TestValidator.equals("complete declaration matrix", actual, expected);

  // Constructors, accessors, non-public members, local namespace members, and enums stay out.
  for (const excluded of ["hidden", "ignored", "secret", "Local", "Ignored"])
    TestValidator.predicate(
      `excluded ${excluded}`,
      !actual.some((entry) => entry.includes(excluded)),
    );

  const box = requireUnit(inventory.units, "type", "Box");
  const id = requireUnit(inventory.units, "property", "Box.prototype.id");
  TestValidator.equals("parameter property parent", id.parentId, box.id);
  TestValidator.equals("valid TypeScript inventory", inventory.diagnostics, []);
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
