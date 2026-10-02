import { EvidenceDartAdapter } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Keeps unresolved Dart topology and unsupported changes incomplete.
 *
 * The adapter must not publish a smaller public surface when parts, exports,
 * augmentation, parsing, or declaration uniqueness cannot be determined.
 *
 * 1. Analyze missing parts, invalid part URIs and conditional exports,
 *    augmentation, malformed syntax, and duplicate declarations.
 * 2. Require the matching incomplete diagnostic and repair for each rejected case.
 * 3. Accept supported external imports and local forms, reject an unadvertised
 *    extension, and retain an unreadable-source failure.
 */
export async function test_dart_boundaries(): Promise<void> {
  const adapter = new EvidenceDartAdapter();
  for (const [content, code] of new Map<string, string>([
    ["part 'missing.g.dart'; class Existing {}", "dart-unresolved-library"],
    ["part of missing.library; class Model {}", "dart-part-owner"],
    ["part 'package:external/api.dart';", "dart-external-uri"],
    ["part 'dart:core';", "dart-external-uri"],
    ["export 'a.dart' if (dart.library.io) 'b.dart';", "dart-directive-uri"],
    ["augment class Changed {}", "dart-augmentation"],
    ["class Broken {", "dart-parse-incomplete"],
    ["int run() => 1; int run() => 2;", "dart-declaration-conflict"],
    ["int get value => 1; int get value => 2;", "dart-declaration-conflict"],
  ])) {
    const inventory = await adapter.analyze(
      EvidenceTestSourceSnapshot.create("src/boundary.dart", content),
    );
    TestValidator.equals(`incomplete ${content}`, inventory.complete, false);
    TestValidator.predicate(
      `diagnostic ${code}`,
      inventory.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === code && diagnostic.repair !== undefined,
      ),
    );
  }
  for (const content of [
    "import 'package:external/api.dart'; class Own {}",
    "class Derived extends External { int own() => 1; }",
    "// GENERATED CODE.\nclass ExplicitGenerated {}",
    "extension on String { int local() => 1; }",
  ]) {
    const inventory = await adapter.analyze(
      EvidenceTestSourceSnapshot.create("src/accepted.dart", content),
    );
    TestValidator.equals(
      `explicit source ${content}`,
      inventory.diagnostics,
      [],
    );
  }
  const wrong = await adapter.analyze(
    EvidenceTestSourceSnapshot.create("src/code.DART", "class Contract {}"),
  );
  TestValidator.equals(
    "unadvertised extension is incomplete",
    wrong.complete,
    false,
  );
  TestValidator.predicate(
    "extension diagnostic",
    wrong.diagnostics.some(
      (diagnostic) => diagnostic.code === "dart-unsupported-extension",
    ),
  );
  const failed = await adapter.analyze(
    EvidenceTestSourceSnapshot.fail(
      EvidenceTestSourceSnapshot.create("src/unavailable.dart", ""),
      {
        code: "path-unreadable",
        path: "/project/src/unavailable.dart",
        message: "Unavailable",
      },
    ),
  );
  TestValidator.equals(
    "source failure survives empty inventory",
    failed.complete,
    false,
  );
}
