import { dedent } from "@typia/utils";
import { TestValidator } from "@nestia/e2e";
import {
  EvidenceTypeScriptAdapter,
  EvidencePythonAdapter,
  EvidenceZigAdapter,
  EvidenceSqlAdapter,
  EvidencePostgresqlAdapter,
  EvidencePhpAdapter,
  EvidenceRubyAdapter,
  EvidenceRustAdapter,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceInventory,
  IEvidenceSourceSnapshot,
} from "@wrtnlabs/evidence";
import { performance } from "node:perf_hooks";
import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";
import type { IEvidencePerformanceAdapterCase } from "../../internal/IEvidencePerformanceAdapterCase";

/**
 * Exercises flat declarations, documentation and ownership at corpus scale.
 *
 * Repeated declarations must retain their language-specific ownership and
 * documentation while extraction avoids joins against every preceding
 * declaration.
 *
 * 1. Warm each real grammar with the same supported source shape.
 * 2. Extract 2,000 independent declarations and verify exact semantic counts,
 *    complete inventories and Zig and SQL documentation attachments.
 * 3. Bound each warmed extraction by fifteen seconds, excluding asset acquisition.
 *
 * @evidence contracts/testing.md#behavioral-verification Calls eight maintained adapters on real generated syntax and asserts completeness, unit counts, documentation ownership and a generous latency ceiling.
 * @evidence contracts/testing.md#independent-expectations Counts follow explicit function, property, table-column, class-method and struct-field declarations in the fixture generators.
 * @evidence contracts/testing.md#distinguishing-cases Covers flat exports, augmented assignment, Zig documentation, SQL and PostgreSQL comments, PHP declared writes, Ruby visibility and Rust member ownership; existing language suites own malformed and ambiguous syntax.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor invokes this in-process test on in-memory snapshots; no CLI, consumer installation or persistent fixture is created.
 */
export async function test_performance_adapter_indexes(): Promise<void> {
  const count: number = 2000;
  const cases: IEvidencePerformanceAdapterCase[] = [
    {
      adapter: new EvidenceTypeScriptAdapter(),
      file: "api.ts",
      prefix: "",
      item: (index: number): string =>
        `/** Function ${index}. */ export function f${index}() {}`,
      suffix: "",
      units: count,
    },
    {
      adapter: new EvidencePythonAdapter(),
      file: "api.py",
      prefix: "",
      item: (index: number): string => dedent`
          v${index} = ${index}
          v${index} += 1
        `,
      suffix: "",
      units: count,
    },
    {
      adapter: new EvidenceZigAdapter(),
      file: "api.zig",
      prefix: "",
      item: (index: number): string =>
        dedent`
          /// Value ${index}.
          pub const v${index}: u32 = ${index};
        `,
      suffix: "",
      units: count,
    },
    {
      adapter: new EvidenceSqlAdapter(),
      file: "schema.sql",
      prefix: "",
      item: (index: number): string =>
        dedent`
          -- Table ${index}
          CREATE TABLE t${index} (id INTEGER);
        `,
      suffix: "",
      units: count * 2,
    },
    {
      adapter: new EvidencePostgresqlAdapter(),
      file: "schema.sql",
      prefix: "CREATE SCHEMA app;\n",
      item: (index: number): string =>
        dedent`
          -- Table ${index}
          CREATE TABLE app.t${index} (id INTEGER);
          COMMENT ON TABLE app.t${index} IS 'Table ${index}';
        `,
      suffix: "",
      units: count * 2,
    },
    {
      adapter: new EvidencePhpAdapter(),
      file: "api.php",
      prefix: "<?php\nclass Example {\n",
      item: (index: number): string =>
        `public $p${index}; public function f${index}() { $this->p${index} = ${index}; }`,
      suffix: "\n}",
      units: count * 2 + 1,
    },
    {
      adapter: new EvidenceRubyAdapter(),
      file: "api.rb",
      prefix: "class Example\n",
      item: (index: number): string => dedent`
          def f${index}; end
          public :f${index}
        `,
      suffix: "\nend",
      units: count + 1,
    },
    {
      adapter: new EvidenceRustAdapter(),
      file: "lib.rs",
      prefix: "",
      item: (index: number): string =>
        `pub struct S${index} { pub field: u32 }`,
      suffix: "",
      units: count * 2,
    },
  ];
  for (const scenario of cases) {
    await scenario.adapter.analyze(
      EvidenceTestSourceSnapshot.create(
        scenario.file,
        scenario.prefix + scenario.item(0) + scenario.suffix,
      ),
    );
    const snapshot: IEvidenceSourceSnapshot = EvidenceTestSourceSnapshot.create(
      scenario.file,
      scenario.prefix +
        Array.from(
          { length: count },
          (_value: unknown, index: number): string => scenario.item(index),
        ).join("\n") +
        scenario.suffix,
    );
    const start: number = performance.now();
    const inventory: IEvidenceInventory =
      await scenario.adapter.analyze(snapshot);
    TestValidator.equals(
      `${scenario.adapter.type} complete`,
      inventory.diagnostics,
      [],
    );
    TestValidator.equals(
      `${scenario.adapter.type} complete flag`,
      inventory.complete,
      true,
    );
    TestValidator.equals(
      `${scenario.adapter.type} semantic units`,
      inventory.units.length,
      scenario.units,
    );
    TestValidator.predicate(
      `${scenario.adapter.type} indexed extraction ceiling`,
      performance.now() - start < 15000,
    );
    if (scenario.adapter.type === "zig" || scenario.adapter.type === "sql")
      TestValidator.equals(
        `${scenario.adapter.type} attached documentation`,
        inventory.hosts.length,
        scenario.adapter.type === "sql" ? count * 2 : count,
      );
  }
}
