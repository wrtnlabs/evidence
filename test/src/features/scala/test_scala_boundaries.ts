import {
  EvidenceLanguageRegistry,
  EvidenceScalaAdapter,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Marks unresolved Scala surface constructs and parse failures incomplete.
 *
 * The fixtures cover givens, exports with non-static or shadowed carriers,
 * unsupported forms, malformed source, and excluded forms to ensure uncertain
 * discovery cannot pass as a smaller population.
 *
 * 1. Analyze each unsupported public construct and verify an incomplete inventory
 *    with its expected diagnostic.
 * 2. Verify excluded or private forms do not create public obligations where the
 *    fixture selects none.
 * 3. Analyze malformed Scala source and verify parser incompleteness replaces a
 *    healthy inventory.
 */
export async function test_scala_boundaries(): Promise<void> {
  for (const source of [
    "given Ordering[Int] = ???",
    "class Container { object Source { val value = 1 } }; object Forward { export Container.Source.value }",
    "object Origin { val value = 1 }; class Forward(Origin: Int) { export Origin.value }",
    "object Origin { val value = 1 }; object Forward { val Origin = ???; export Origin.value }",
    "import other.Origin; object Origin { val value = 1 }; object Forward { export Origin.value }",
    "trait T { def structural: { def value: Int } }",
    "val value = new Object { def extra = 1 }",
    "object Source { class Empty }; object Forward { export Source.Empty }",
    "object Source { val value = 1 }; object Forward { export Source.* }",
    "object Missing {}; object Forward { export Missing.value }",
    "object Source { private val value = 1 }; object Forward { export Source.value }",
    "class Derived derives CanEqual",
    "val Some(value) = Some(1)",
    "class Broken { def run( { }",
    "object Source { class Nested { val value = 1 } }; object Forward { export Source.Nested }",
  ]) {
    const inventory = await new EvidenceScalaAdapter().analyze(
      EvidenceTestSourceSnapshot.create("src/Boundary.scala", source),
    );
    TestValidator.equals(`incomplete ${source}`, inventory.complete, false);
    TestValidator.predicate(
      "actionable error",
      inventory.diagnostics.some(
        (diagnostic) =>
          diagnostic.severity === "error" && diagnostic.repair.length > 0,
      ),
    );
  }
  const unsupported = await new EvidenceScalaAdapter().analyze(
    EvidenceTestSourceSnapshot.create("src/Script.sc", "val value = 1"),
  );
  TestValidator.equals(
    "script source rejected",
    unsupported.diagnostics.map((diagnostic) => diagnostic.code),
    ["inventory-incomplete", "scala-unsupported-extension"],
  );
  const failed = EvidenceTestSourceSnapshot.fail(
    EvidenceTestSourceSnapshot.create("src/Missing.scala", "class Visible"),
    {
      code: "path-unreadable",
      path: "/project/src/Missing.scala",
      message: "Cannot read source.",
    },
  );
  const unavailable = await new EvidenceScalaAdapter().analyze(failed);
  TestValidator.equals(
    "source failure stays incomplete",
    unavailable.complete,
    false,
  );
  TestValidator.equals(
    "source diagnostic retained",
    unavailable.diagnostics
      .filter((diagnostic) => diagnostic.code === "source-path-unreadable")
      .map((diagnostic) => diagnostic.message),
    ["Cannot read source."],
  );
  TestValidator.equals(
    "configured source spelling",
    EvidenceLanguageRegistry.select("scala", "src/Selected.scala").id,
    "scala",
  );
  const privateGiven = await new EvidenceScalaAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "src/Private.scala",
      "private object Hidden { given Ordering[Int] = ???; val Some(value) = Some(1) }",
    ),
  );
  TestValidator.equals(
    "restricted descendants do not fabricate obligations",
    privateGiven.units,
    [],
  );
  TestValidator.equals(
    "restricted unresolved declarations do not affect public surface",
    privateGiven.complete,
    true,
  );
}
