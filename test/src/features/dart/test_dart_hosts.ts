import {
  EvidenceDartAdapter,
  EvidenceFingerprint,
  EvidenceInventory,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Attaches Dart documentation at source coordinates without accepting inert
 * examples.
 *
 * Eligible DartDoc can acknowledge declarations and withdraw hierarchy, while
 * fenced, indented, HTML, ordinary-comment, and literal annotations must stay
 * inert.
 *
 * 1. Extract type and property evidence from CRLF documentation after astral text
 *    and verify their UTF-16 mapping.
 * 2. Require a hidden type's descendant to resolve hidden, preserve fingerprints
 *    for annotation edits, and change them for semantic edits.
 * 3. Reject every unsupported comment carrier and ignore every Dart string
 *    delimiter as an annotation host.
 */
export async function test_dart_hosts(): Promise<void> {
  const content = dedent`
    /// Contract 한글 😀
    /// @evidence docs/spec.md#type Implements the contract.
    @Deprecated('legacy')
    class Contract {
      /** @evidence docs/spec.md#property Implements the value. */
      int value = 1;
      /// @internal Retired operation.
      int retired() => 0;
    }
    /** @hidden Retired owner. */
    class Retired { int child = 1; }
    /// Examples:
    /// ~~~dart
    /// @evidence docs/spec.md#fence Inert example.
    /// ~~~
    ///
    ///     @evidence docs/spec.md#indent Inert example.
    /// <code>@evidence docs/spec.md#html Inert example.</code>
    int sample() => 1;
  `.replaceAll("\n", "\r\n");
  const adapter = new EvidenceDartAdapter();
  const inventory = await adapter.analyze(
    EvidenceTestSourceSnapshot.create("src/contract.dart", content),
  );

  TestValidator.equals(
    "mapped documentation is complete",
    inventory.diagnostics,
    [],
  );
  TestValidator.equals(
    "examples cannot acknowledge",
    inventory.declarations.map((declaration) => declaration.target),
    ["docs/spec.md#type", "docs/spec.md#property"],
  );
  TestValidator.equals(
    "UTF-16 offset after astral text",
    inventory.declarations[0]?.location?.range?.start?.offset,
    content.indexOf("@evidence"),
  );
  TestValidator.equals(
    "CRLF line mapping",
    inventory.declarations[0]?.location?.range?.start?.line,
    2,
  );
  const graph = new EvidenceInventory([inventory]);
  TestValidator.equals(
    "withdrawal reaches descendants",
    graph.resolve(
      { file: "/project/src/contract.dart", segments: ["Retired", "child"] },
      inventory.units.map((unit) => unit.id),
    ).status,
    "hidden",
  );
  const contract = inventory.units.find((unit) => unit.name === "Contract");
  if (contract === undefined) throw new Error("Missing contract.");
  const annotation = await adapter.analyze(
    EvidenceTestSourceSnapshot.create(
      "src/contract.dart",
      content.replace(
        "Implements the value.",
        "Acknowledges the unchanged value.",
      ),
    ),
  );
  const changed = await adapter.analyze(
    EvidenceTestSourceSnapshot.create(
      "src/contract.dart",
      content.replace("value = 1", "value = 2"),
    ),
  );
  TestValidator.equals(
    "annotation-only edit preserves ancestor fingerprint",
    EvidenceFingerprint.inspect(inventory, contract.id).fingerprint,
    EvidenceFingerprint.inspect(annotation, contract.id).fingerprint,
  );
  TestValidator.notEquals(
    "semantic edit invalidates fingerprint",
    EvidenceFingerprint.inspect(inventory, contract.id).fingerprint,
    EvidenceFingerprint.inspect(changed, contract.id).fingerprint,
  );
  for (const tag of [
    "evidence",
    "evidenceExclude",
    "evidenceReview",
    "evidenceExcludeReview",
    "link",
  ]) {
    const unsupported = await adapter.analyze(
      EvidenceTestSourceSnapshot.create(
        "src/unsupported.dart",
        `// @${tag} docs/spec.md#type Unsupported comment.\nint run() => 1;`,
      ),
    );
    TestValidator.equals(
      `${tag} never acknowledges`,
      unsupported.declarations,
      [],
    );
    TestValidator.equals(`${tag} never reviews`, unsupported.reviews, []);
    TestValidator.equals(
      `${tag} reports carrier`,
      unsupported.diagnostics.map((diagnostic) => diagnostic.code),
      ["unsupported-annotation-host"],
    );
  }
  for (const delimiter of [
    "'",
    '"',
    "'''",
    '"""',
    "r'",
    'r"',
    "r'''",
    'r"""',
  ]) {
    const closing = delimiter.replace(/^r/u, "");
    const unsupported = await adapter.analyze(
      EvidenceTestSourceSnapshot.create(
        "src/literal.dart",
        `final text = ${delimiter}@evidence docs/spec.md#type Inert literal.${closing};`,
      ),
    );
    TestValidator.equals(
      `${delimiter} literal does not acknowledge`,
      unsupported.declarations,
      [],
    );
    TestValidator.equals(
      `${delimiter} literal data is inert`,
      unsupported.diagnostics.map((diagnostic) => diagnostic.code),
      [],
    );
  }
}
