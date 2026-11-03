import { EvidenceTypeScriptAdapter } from "@wrtnlabs/evidence";
import type {
  IEvidenceInventory,
  IEvidenceHost,
  IEvidencePublicAddress,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Reconciles TypeScript merged declarations into stable units.
 *
 * TypeScript overloads and declaration merging share semantic identity while
 * retaining every site needed for review. A namespace nested interface remains
 * addressable through the merged outer interface and namespace spelling.
 *
 * 1. Analyze function overloads, class/interface merges, function namespaces, and
 *    an interface with a companion namespace containing another interface.
 * 2. Require overload and class/interface sites to merge without duplicating
 *    semantic units.
 * 3. Verify namespace members retain public paths and parents, including
 *    `IShoppingSale.ICreate.title`, and either declaration order leaves one
 *    actual type host without an additional namespace host.
 * 4. Require the resulting inventory to remain complete and diagnostic-free.
 *
 * @evidence contracts/testing.md#behavioral-verification Analyzes overloads, class and interface merges, function namespaces and an interface with a companion namespace and asserts units, sites and nested paths.
 * @evidence contracts/testing.md#independent-expectations Expected merging follows TypeScript declaration merging, written in the test.
 * @evidence contracts/testing.md#distinguishing-cases Covers each merge form, nested namespace paths, namespace-before-type promotion and type-before-namespace preservation, one actual type host in either order, and a complete diagnostic-free inventory.
 * @evidence contracts/testing.md#execution-ownership The exported test_typescript_merges is discovered by DynamicExecutor under test/src/features and calls maintained source in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_typescript_merges(): Promise<void> {
  const content = dedent`
    /** Text overload. */
    export function format(value: string): string;
    /** Numeric overload. */
    export function format(value: number): string;
    export function format(value: string | number): string { return String(value); }

    export class Service {
      run(): void {}
    }
    export interface Service {
      stop(): void;
      state: string;
    }

    export function helper(): void {}
    export namespace helper {
      export const generated = 1;
    }

    interface Order {
      member: number;
    }
    namespace Order {
      export const member = 1;
    }
    export type { Order };

    export interface IShoppingSale {
      id: string;
    }
    export namespace IShoppingSale {
      export interface ICreate {
        title: string;
      }
    }

    export namespace NamespaceFirst {
      export interface Child {}
    }
    export interface NamespaceFirst {
      id: string;
    }
  `;
  const inventory = await new EvidenceTypeScriptAdapter().analyze(
    EvidenceTestSourceSnapshot.create("src/merged.ts", content),
  );

  const overload = requireUnit(inventory, "function", "format");
  TestValidator.equals("one overload identity", count(inventory, "format"), 1);
  TestValidator.equals(
    "all overload declaration sites",
    overload.sites.length,
    3,
  );

  const service = requireUnit(inventory, "type", "Service");
  TestValidator.equals(
    "class and interface sites merge",
    service.sites.length,
    2,
  );
  TestValidator.equals(
    "interface members join the class instance side",
    inventory.units
      .filter((unit) => unit.parentId === service.id)
      .map((unit) => unit.identity.join("."))
      .sort(compare),
    [
      "Service.prototype.run",
      "Service.prototype.state",
      "Service.prototype.stop",
    ],
  );

  TestValidator.equals(
    "function namespace static side excluded",
    inventory.units.some(
      (unit) => unit.identity.join(".") === "helper.generated",
    ),
    false,
  );

  const orderMember = requireUnit(inventory, "property", "Order.member");
  TestValidator.equals(
    "merged member retains both declarations",
    orderMember.sites.length,
    2,
  );
  TestValidator.predicate(
    "type-only merge keeps the interface member",
    inventory.addresses.some(
      (address: IEvidencePublicAddress): boolean =>
        address.unitId === orderMember.id &&
        address.segments.join(".") === "Order.member",
    ),
  );

  const shoppingSale: IEvidenceUnit = requireUnit(
    inventory,
    "type",
    "IShoppingSale",
  );
  TestValidator.equals(
    "interface and namespace sites merge",
    shoppingSale.sites.length,
    2,
  );
  const create: IEvidenceUnit = requireUnit(
    inventory,
    "type",
    "IShoppingSale.ICreate",
  );
  const title: IEvidenceUnit = requireUnit(
    inventory,
    "property",
    "IShoppingSale.ICreate.title",
  );
  TestValidator.equals(
    "nested interface parent",
    create.parentId,
    shoppingSale.id,
  );
  TestValidator.equals("nested property parent", title.parentId, create.id);
  TestValidator.predicate(
    "nested namespace type address",
    inventory.addresses.some(
      (address: IEvidencePublicAddress): boolean =>
        address.unitId === create.id &&
        address.segments.join(".") === "IShoppingSale.ICreate",
    ),
  );
  TestValidator.predicate(
    "nested namespace property address",
    inventory.addresses.some(
      (address: IEvidencePublicAddress): boolean =>
        address.unitId === title.id &&
        address.segments.join(".") === "IShoppingSale.ICreate.title",
    ),
  );
  TestValidator.equals("valid merged inventory", inventory.diagnostics, []);
  for (const name of ["IShoppingSale", "NamespaceFirst"]) {
    const owner: IEvidenceUnit = requireUnit(inventory, "type", name);
    TestValidator.equals(
      `${name} retains both source sites`,
      owner.sites.length,
      2,
    );
    TestValidator.equals(
      `${name} has one actual type host`,
      inventory.hosts.filter((host: IEvidenceHost): boolean =>
        host.unitIds.includes(owner.id),
      ).length,
      1,
    );
  }
  TestValidator.equals(
    "namespace-first child retains the actual type owner",
    requireUnit(inventory, "type", "NamespaceFirst.Child").parentId,
    requireUnit(inventory, "type", "NamespaceFirst").id,
  );
}

/**
 * Requires one TypeScript unit with an exact symbol and semantic identity.
 *
 * Merge assertions must fail on absence before site or ownership checks can
 * accidentally inspect a different declaration kind at the same address.
 */
function requireUnit(
  inventory: IEvidenceInventory,
  symbol: IEvidenceUnit["symbol"],
  identity: string,
): IEvidenceUnit {
  const unit = inventory.units.find(
    (entry) => entry.symbol === symbol && entry.identity.join(".") === identity,
  );
  if (unit === undefined)
    throw new Error(`Missing TypeScript unit: ${symbol} ${identity}`);
  return unit;
}

/**
 * Counts units sharing one rendered semantic identity.
 *
 * The count exposes duplicate merge records even when a public-address lookup
 * could resolve only the first occurrence.
 */
function count(inventory: IEvidenceInventory, identity: string): number {
  return inventory.units.filter((unit) => unit.identity.join(".") === identity)
    .length;
}

/**
 * Orders expected TypeScript identities by exact spelling.
 *
 * Locale-independent comparison keeps fixture output stable across CI hosts.
 */
function compare(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}
