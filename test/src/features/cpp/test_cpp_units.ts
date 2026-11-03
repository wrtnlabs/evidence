import {
  EvidenceCppAdapter,
  EvidenceLanguageRegistry,
} from "@wrtnlabs/evidence";
import type { IEvidenceInventory, IEvidenceUnit } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Classifies the public C++ surface across namespaces, types, callables, and
 * properties.
 *
 * The adapter must publish full identities for public declarations and retain
 * owner relationships for nested members and overload families.
 *
 * 1. Analyze C++ declarations spanning namespaces, classes, templates, and
 *    members.
 * 2. Compare the complete unit symbols and accessor identities.
 * 3. Verify callable overloads and owned properties retain their expected sites
 *    and owners.
 *
 * @evidence contracts/testing.md#behavioral-verification Analyzes C++ namespaces, classes, templates and members and asserts symbols, identities, sites and owners.
 * @evidence contracts/testing.md#independent-expectations Expected units are the declared C++ surface written in the test.
 * @evidence contracts/testing.md#distinguishing-cases Covers namespaces, classes, templates, overload families and owned properties.
 * @evidence contracts/testing.md#execution-ownership The exported test_cpp_units is discovered by DynamicExecutor under test/src/features and calls maintained source in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_cpp_units(): Promise<void> {
  // Certified metadata names the exact grammar and explicit declared surface.
  const language = EvidenceLanguageRegistry.list().find(
    (entry) => entry.type === "cpp",
  );
  if (language?.adapter === undefined)
    throw new Error("Missing C++ adapter metadata.");
  TestValidator.equals(
    "certified C++ adapter",
    language.adapter.entry,
    "EvidenceCppAdapter",
  );
  TestValidator.equals(
    "published C++ grammar version",
    language.adapter.publicSurface.includes("tree-sitter-cpp v0.23.4"),
    true,
  );

  const inventory = await new EvidenceCppAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "include/shop.hpp",
      dedent`
        namespace shop::models {
            template <class T>
            class Box final {
            public:
                Box();
                ~Box();
                int get() const;
                int get(int index) const;
                static int count;
                int value;
                operator bool() const;
                Box operator +(const Box &) const;

                template <class U>
                U convert(U value) const;

                enum class State {
                    ready,
                    stopped,
                };

                using Value = T;

            protected:
                int protected_value;

            private:
                int secret;
                int get(const char *value) const;
                class Hidden {
                public:
                    int leaked;
                };
            };

            struct Record {
                int id;

            private:
                int secret;
            };

            union Payload {
                int number;

            private:
                int secret;
            };

            typedef int Identifier;

            template <class T>
            using Vector = Box<T>;

            template <class T>
            concept Numeric = true;

            template <class T>
            constexpr T zero = T{};

            int run(int value);
            int run(double value);
            extern int external;
            inline constexpr int shared_constant = 3;
            const int internal_constant = 1;
            constexpr int internal_constexpr = 2;
            const int *external_pointer = &internal_constant;
            const int &external_reference = internal_constant;
            int *const internal_pointer = nullptr;
            int *const internal_array[] = { nullptr };
            static int hidden_variable;
            static int hidden_function();
        }

        namespace {
            int anonymous_value;
        }
      `,
    ),
  );

  TestValidator.equals("complete C++ units", inventory.diagnostics, []);
  TestValidator.equals(
    "C++ declaration units",
    inventory.units
      .map((unit) => `${unit.symbol}:${unit.identity.join(".")}`)
      .sort(compare),
    [
      "function:shop.models.Box`1.constructor",
      "function:shop.models.Box`1.convert`1",
      "function:shop.models.Box`1.destructor",
      "function:shop.models.Box`1.get",
      "function:shop.models.Box`1.operator +",
      "function:shop.models.Box`1.operator bool",
      "function:shop.models.run",
      "property:shop.models.Box`1.count",
      "property:shop.models.Box`1.State.ready",
      "property:shop.models.Box`1.State.stopped",
      "property:shop.models.Box`1.value",
      "property:shop.models.external",
      "property:shop.models.external_pointer",
      "property:shop.models.external_reference",
      "property:shop.models.Payload.number",
      "property:shop.models.Record.id",
      "property:shop.models.shared_constant",
      "property:shop.models.zero`1",
      "scope:shop",
      "scope:shop.models",
      "type:shop.models.Box`1",
      "type:shop.models.Box`1.State",
      "type:shop.models.Box`1.Value",
      "type:shop.models.Identifier",
      "type:shop.models.Numeric`1",
      "type:shop.models.Payload",
      "type:shop.models.Record",
      "type:shop.models.Vector`1",
    ].sort(compare),
  );

  // Name-only overloads remain one family with every declaration site.
  const overload = inventory.units.find(
    (unit) => unit.identity.join(".") === "shop.models.Box`1.get",
  );
  if (overload === undefined) throw new Error("Missing C++ overload family.");
  TestValidator.equals("C++ overload sites", overload.sites.length, 2);

  // Parent IDs retain the namespace, type, and nested enum hierarchy.
  const shop = requireUnit(inventory, "shop");
  const models = requireUnit(inventory, "shop.models");
  const box = requireUnit(inventory, "shop.models.Box`1");
  const state = requireUnit(inventory, "shop.models.Box`1.State");
  const ready = requireUnit(inventory, "shop.models.Box`1.State.ready");
  TestValidator.equals("C++ nested namespace parent", models.parentId, shop.id);
  TestValidator.equals("C++ template owner parent", box.parentId, models.id);
  TestValidator.equals("C++ nested enum parent", state.parentId, box.id);
  TestValidator.equals("C++ enumerator parent", ready.parentId, state.id);
}

function requireUnit(
  inventory: IEvidenceInventory,
  identity: string,
): IEvidenceUnit {
  const unit = inventory.units.find(
    (candidate) => candidate.identity.join(".") === identity,
  );
  if (unit === undefined) throw new Error(`Missing C++ unit: ${identity}`);
  return unit;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
