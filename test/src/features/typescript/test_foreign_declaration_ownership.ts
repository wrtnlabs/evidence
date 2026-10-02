import {
  EvidenceTypeScriptAdapter,
  EvidenceJavaScriptAdapter,
  EvidencePythonAdapter,
  EvidenceRustAdapter,
  EvidenceDartAdapter,
  EvidenceScalaAdapter,
  EvidenceCAdapter,
  EvidenceCppAdapter,
  EvidenceCSharpAdapter,
  EvidenceGoAdapter,
  EvidenceJavaAdapter,
  EvidenceKotlinAdapter,
  EvidenceObjcAdapter,
  EvidencePhpAdapter,
  EvidenceSwiftAdapter,
  EvidenceZigAdapter,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceAdapter,
  IEvidenceInventory,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Keeps static dependency forwarding separate from local declaration ownership.
 *
 * Re-export resolvers and ordinary import/include scanners share the same
 * boundary: dependency declarations are not obligations of their consumers.
 *
 * 1. Analyze dependency-only source across the affected re-export languages and
 *    the ordinary static import/include adapters; require complete empty
 *    units.
 * 2. Add one local declaration to each source; require complete analysis with
 *    exactly that owner and no dependency declarations.
 */
export async function test_foreign_declaration_ownership(): Promise<void> {
  const fixtures: [IEvidenceAdapter, string, string, string][] = [
    [
      new EvidenceTypeScriptAdapter(),
      "owner.ts",
      'export { Value } from "foreign"; export type { Type } from "foreign"; export * from "foreign"; export * as Foreign from "foreign"; export type * from "foreign"; export type * as Types from "foreign";',
      "export interface Own {}",
    ],
    [
      new EvidenceJavaScriptAdapter(),
      "owner.mjs",
      'export { Value } from "foreign"; export * from "foreign"; export * as Foreign from "foreign";',
      "export function Own() {}",
    ],
    [
      new EvidencePythonAdapter(),
      "owner.py",
      "from dependency import Value as Value\nfrom dependency import *\nimport dependency as Foreign\n",
      "def Own():\n    pass\n",
    ],
    [
      new EvidenceRustAdapter(),
      "owner.rs",
      "pub use dependency::{Value, Type as Alias}; pub use dependency::*;",
      "pub fn Own() {}",
    ],
    [
      new EvidenceDartAdapter(),
      "owner.dart",
      "export 'package:dependency/api.dart' show Value; export 'dart:core' hide String;",
      "void Own() {}",
    ],
    [
      new EvidenceScalaAdapter(),
      "Owner.scala",
      "import dependency.Source\nexport Source.value\nexport dependency.Source.*\n",
      "class Own {}",
    ],
    [
      new EvidenceCAdapter(),
      "owner.h",
      "#include <dependency.h>\n",
      "struct Own {};",
    ],
    [
      new EvidenceCppAdapter(),
      "owner.hpp",
      "#include <dependency.hpp>\n",
      "class Own {};",
    ],
    [
      new EvidenceCSharpAdapter(),
      "Owner.cs",
      "using Dependency;\n",
      "public class Own {}",
    ],
    [
      new EvidenceGoAdapter(),
      "owner.go",
      'package owner\nimport _ "example.org/dependency"\n',
      "type Own struct {}",
    ],
    [
      new EvidenceJavaAdapter(),
      "Own.java",
      "import dependency.Source;\n",
      "public class Own {}",
    ],
    [
      new EvidenceKotlinAdapter(),
      "Own.kt",
      "import dependency.Source\n",
      "class Own {}\n",
    ],
    [
      new EvidenceObjcAdapter(),
      "Own.h",
      "#import <Dependency/Dependency.h>\n",
      "@interface Own\n@end",
    ],
    [
      new EvidencePhpAdapter(),
      "owner.php",
      "<?php\nuse Dependency\\Source;\n",
      "class Own {}",
    ],
    [
      new EvidenceSwiftAdapter(),
      "Own.swift",
      "import Dependency\n",
      "public struct Own {}",
    ],
    [
      new EvidenceZigAdapter(),
      "owner.zig",
      'pub const Foreign = @import("dependency"); pub usingnamespace @import("dependency"); const source = @import("dependency"); pub const Alias = source;',
      "pub fn Own() void {}",
    ],
  ];
  for (const [adapter, file, foreign, local] of fixtures) {
    const empty: IEvidenceInventory = await adapter.analyze(
      EvidenceTestSourceSnapshot.create("src/" + file, foreign),
    );
    TestValidator.equals(
      `${adapter.type} dependency-only completeness`,
      empty.diagnostics,
      [],
    );
    TestValidator.equals(
      `${adapter.type} dependency-only owners`,
      empty.units,
      [],
    );

    const mixed: IEvidenceInventory = await adapter.analyze(
      EvidenceTestSourceSnapshot.create(
        "src/" + file,
        foreign + "\n" + local + "\n",
      ),
    );
    TestValidator.equals(
      `${adapter.type} mixed-source completeness`,
      mixed.diagnostics,
      [],
    );
    TestValidator.equals(
      `${adapter.type} local owner survives`,
      mixed.units.map((unit: IEvidenceUnit): string => unit.name),
      ["Own"],
    );
  }
}
