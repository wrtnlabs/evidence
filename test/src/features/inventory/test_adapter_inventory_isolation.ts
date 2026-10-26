import { TestValidator } from "@nestia/e2e";
import {
  EvidenceDbmlAdapter,
  EvidenceMarkdownAdapter,
  EvidencePrismaAdapter,
  EvidenceSqlAdapter,
  EvidenceSwaggerAdapter,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceInventory,
  IEvidenceSourceFile,
  IEvidenceSourceSnapshot,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";

import { EvidenceAdapterCertificationFixtures } from "../../internal/certification/EvidenceAdapterCertificationFixtures";
import type { IEvidenceAdapterCertification } from "../../internal/certification/IEvidenceAdapterCertification";
import type { IEvidenceAdapterCertificationSource } from "../../internal/certification/IEvidenceAdapterCertificationSource";
import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";
import type { IEvidenceAdapterIsolationCase } from "../../internal/IEvidenceAdapterIsolationCase";

/**
 * Transfers adapter-owned inventories without exposing caller or cached
 * records.
 *
 * Normalizing a private extraction result can borrow its immutable leaves, but
 * every public input capture and every later extraction must remain
 * independent.
 *
 * 1. Analyze every programming certification fixture plus Markdown, SQL, DBML,
 *    Prisma and Swagger examples; require complete nonempty inventories and
 *    unchanged caller snapshots.
 * 2. Mutate returned source text, public paths, unit identities and site arrays;
 *    analyze again and require the original inventory.
 * 3. Mutate caller source content after extraction and require the returned
 *    inventory to keep the previously captured source text.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs real adapters, asserts complete nonempty extraction, and compares inventories before and after mutations of caller inputs and nested outputs.
 * @evidence contracts/testing.md#independent-expectations The ownership contract requires extraction to leave caller snapshots unchanged and repeated extraction of identical input to reproduce the original records; mutated text cannot rewrite an already returned inventory.
 * @evidence contracts/testing.md#distinguishing-cases Covers every programming certification fixture and five document/database paths, fresh and cached extraction, nested source, alias, identity and site mutations. Certification suites own syntax and failure expectations.
 * @evidence contracts/testing.md#execution-ownership The exported test_adapter_inventory_isolation is discovered by DynamicExecutor and invokes maintained adapters directly with in-memory snapshots and the shared parser asset scope; it spawns no CLI or consumer.
 */
export async function test_adapter_inventory_isolation(): Promise<void> {
  const cases: IEvidenceAdapterIsolationCase[] =
    EvidenceAdapterCertificationFixtures.all().map(
      (
        fixture: IEvidenceAdapterCertification,
      ): IEvidenceAdapterIsolationCase => ({
        adapter: fixture.adapter,
        snapshot: EvidenceTestSourceSnapshot.combine(
          fixture.sources.map(
            (
              source: IEvidenceAdapterCertificationSource,
            ): IEvidenceSourceSnapshot =>
              EvidenceTestSourceSnapshot.create(source.file, source.content),
          ),
        ),
      }),
    );
  cases.push(
    {
      adapter: new EvidenceMarkdownAdapter(),
      snapshot: EvidenceTestSourceSnapshot.create(
        "rules.md",
        "## Rule\nRequired behavior.\n",
      ),
    },
    {
      adapter: new EvidenceSqlAdapter(),
      snapshot: EvidenceTestSourceSnapshot.create(
        "schema.sql",
        "CREATE TABLE users (id INTEGER PRIMARY KEY);\n",
      ),
    },
    {
      adapter: new EvidenceDbmlAdapter(),
      snapshot: EvidenceTestSourceSnapshot.create(
        "schema.dbml",
        "Table users {\n id integer [pk]\n}\n",
      ),
    },
    {
      adapter: new EvidencePrismaAdapter(),
      snapshot: EvidenceTestSourceSnapshot.create(
        "schema.prisma",
        "model User {\n id Int @id\n}\n",
      ),
    },
    {
      adapter: new EvidenceSwaggerAdapter(),
      snapshot: EvidenceTestSourceSnapshot.create(
        "api.json",
        '{"openapi":"3.0.3","info":{"title":"API","version":"1"},"paths":{"/users":{"get":{"responses":{"200":{"description":"OK"}}}}}}',
      ),
    },
  );
  for (const scenario of cases) {
    const input: IEvidenceSourceSnapshot = structuredClone(scenario.snapshot);
    const first: IEvidenceInventory = await scenario.adapter.analyze(
      scenario.snapshot,
    );
    TestValidator.equals(
      `${scenario.adapter.type} complete`,
      first.complete,
      true,
    );
    TestValidator.predicate(
      `${scenario.adapter.type} nonempty`,
      first.units.length > 0,
    );
    TestValidator.equals(
      `${scenario.adapter.type} input unchanged`,
      scenario.snapshot,
      input,
    );
    const expected: IEvidenceInventory = structuredClone(first);
    const source: IEvidenceSourceFile | undefined = first.sources[0];
    const unit: IEvidenceUnit | undefined = first.units[0];
    if (source === undefined || unit === undefined)
      throw new Error("Missing ownership fixture records.");
    source.content = "mutated output";
    source.addresses.length = 0;
    unit.identity.push("mutated");
    unit.sites.length = 0;
    const second: IEvidenceInventory = await scenario.adapter.analyze(
      scenario.snapshot,
    );
    TestValidator.equals(
      `${scenario.adapter.type} output mutation isolated`,
      second,
      expected,
    );
    const caller: IEvidenceSourceFile | undefined = scenario.snapshot.files[0];
    if (caller === undefined) throw new Error("Missing caller source.");
    caller.content = "mutated input";
    TestValidator.equals(
      `${scenario.adapter.type} captured result isolated`,
      second,
      expected,
    );
  }
}
