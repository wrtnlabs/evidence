import { EvidenceDartAdapter, EvidenceInventory } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Classifies Dart declarations, complementary accessors, and lexical privacy in
 * the denominator.
 *
 * The selected surface must retain public lexical owners and accessor families
 * while excluding names made private by their Dart spelling.
 *
 * 1. Analyze explicit public types, functions, properties, members, constructors,
 *    and accessors.
 * 2. Compare the complete unit symbols and identities.
 * 3. Verify private declarations are excluded while complementary public accessors
 *    share a unit.
 *
 * @evidence contracts/testing.md#behavioral-verification Analyzes public Dart types, functions, properties, members, constructors and accessors and asserts the unit surface.
 * @evidence contracts/testing.md#independent-expectations Expected units are written from Dart's lexical privacy rule (leading underscore) and the fixture.
 * @evidence contracts/testing.md#distinguishing-cases Covers every declaration kind, accessor families sharing a unit and excluded private names.
 * @evidence contracts/testing.md#execution-ownership The exported test_dart_units is discovered by DynamicExecutor under test/src/features and calls maintained source in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_dart_units(): Promise<void> {
  const inventory = await new EvidenceDartAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "src/contract.dart",
      dedent`
    class Contract {
      Contract();
      Contract.named();
      Contract._private();
      int value = 1, other = 2;
      int get size => value;
      set size(int next) { value = next; }
      static int run() => 1;
      int operator +(Contract other) => value;
      final _hidden = 0;
    }
    class _Private { int child = 1; }
    mixin Behavior { int work() => 1; }
    enum State { ready, stopped; }
    extension Numbers on int { int twice() => this * 2; }
    extension on String { int local() => length; }
    extension type Identifier(int value) { int read() => value; }
    typedef Name = String;
    typedef int Callback(int input);
    int compute() { int local() => 1; return local(); }
    final first = 1, second = 2;
    int get top => first;
    set top(int value) {}
  `,
      ["src/contract.dart", "alias/contract.dart"],
    ),
  );

  TestValidator.equals(
    "complete declared Dart surface",
    inventory.diagnostics,
    [],
  );
  TestValidator.equals(
    "exact public names and kinds",
    inventory.units
      .map((unit) => `${unit.symbol}:${unit.identity.join(".")}`)
      .sort((left, right) => left.localeCompare(right)),
    [
      "type:Contract",
      "function:Contract.new",
      "function:Contract.named",
      "property:Contract.value",
      "property:Contract.other",
      "property:Contract.size",
      "function:Contract.run",
      "function:Contract.operator +",
      "type:Behavior",
      "function:Behavior.work",
      "type:State",
      "property:State.ready",
      "property:State.stopped",
      "scope:Numbers",
      "function:Numbers.twice",
      "type:Identifier",
      "property:Identifier.value",
      "function:Identifier.read",
      "type:Name",
      "type:Callback",
      "function:compute",
      "property:first",
      "property:second",
      "property:top",
    ].sort((left, right) => left.localeCompare(right)),
  );
  TestValidator.equals(
    "complementary member accessors merge",
    inventory.units.find((unit) => unit.name === "size")?.sites?.length,
    2,
  );
  TestValidator.equals(
    "complementary library accessors merge",
    inventory.units.find((unit) => unit.name === "top")?.sites?.length,
    2,
  );
  const graph = new EvidenceInventory([inventory]);
  const ids = inventory.units.map((unit) => unit.id);
  TestValidator.equals(
    "logical alias resolves",
    graph.resolve(
      { file: "/project/alias/contract.dart", segments: ["Contract", "value"] },
      ids,
    ).status,
    "resolved",
  );
  TestValidator.equals(
    "literal operator address",
    graph.resolve(
      {
        file: "/project/src/contract.dart",
        segments: ["Contract", "operator +"],
      },
      ids,
    ).status,
    "resolved",
  );
  TestValidator.equals(
    "private owner hides child",
    graph.resolve(
      { file: "/project/src/contract.dart", segments: ["_Private", "child"] },
      ids,
    ).status,
    "missing",
  );
}
