import {
  EvidenceGraph,
  EvidenceMarkdownAdapter,
  EvidenceTypeScriptAdapter,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceGraphResult,
  IEvidenceInventory,
  IEvidenceSourceSnapshot,
  IEvidencePublicAddress,
  IEvidenceDiagnostic,
  IEvidenceGraphResolution,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestGraph } from "../../internal/EvidenceTestGraph";
import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Keeps foreign re-exports outside the direct declaration population.
 *
 * Broad source selection may include dependency barrels alongside local owners.
 * Foreign bindings must neither enroll dependency declarations nor prevent
 * checklist evaluation for local owners.
 *
 * 1. Analyze foreign named value, named type, star, namespace, and imported-alias
 *    exports alongside an acknowledged local function and a local alias barrel.
 *    Require one declaration identity and a passing checklist.
 * 2. Put the same foreign exports in the local owner's file and require the same
 *    population and coverage.
 * 3. Remove the local acknowledgement and require a missing-checklist finding
 *    without an incomplete inventory.
 * 4. Cite a foreign binding explicitly and require an unresolved target instead of
 *    inventing a dependency declaration.
 */
export async function test_typescript_foreign_reexports(): Promise<void> {
  const adapter: EvidenceTypeScriptAdapter = new EvidenceTypeScriptAdapter();
  const requirements: IEvidenceInventory =
    await new EvidenceMarkdownAdapter().analyze(
      EvidenceTestSourceSnapshot.create(
        "docs/rules.md",
        "# Rules\n\n## Ownership {#ownership}\n\nAcknowledge local declarations.\n",
      ),
    );
  const foreign: string = dedent`
    // Consumer-facing exports do not own their dependency declarations.
    export { tags } from "@typia/interface";
    export type { AssertionGuard, IValidation } from "@typia/interface";
    export * from "foreign-package";
    export * as Foreign from "foreign-package";
    import { Imported } from "foreign-package";
    import * as ImportedNamespace from "foreign-package";
    export { Imported, ImportedNamespace };
  `;
  const acknowledged: string = dedent`
    /** @evidence docs/rules.md#ownership Owns the local implementation. */
    export function local(): void {}
  `;

  for (const mixed of [false, true]) {
    const snapshots: IEvidenceSourceSnapshot[] = [
      EvidenceTestSourceSnapshot.create(
        "src/owner.ts",
        acknowledged + (mixed ? "\n" + foreign : ""),
      ),
      EvidenceTestSourceSnapshot.create(
        "src/local-barrel.ts",
        'export { local as alias } from "./owner";',
      ),
      EvidenceTestSourceSnapshot.create(
        "src/foreign-barrel.ts",
        mixed ? "export {};" : foreign,
      ),
      EvidenceTestSourceSnapshot.create(
        "src/transitive.ts",
        'export * from "./foreign-barrel";',
      ),
    ];
    const claims: IEvidenceInventory = await adapter.analyze(
      EvidenceTestSourceSnapshot.combine(snapshots),
    );
    TestValidator.equals(
      "foreign exports leave analysis complete",
      claims.complete,
      true,
    );
    TestValidator.equals(
      "foreign exports produce no diagnostics",
      claims.diagnostics,
      [],
    );
    TestValidator.equals(
      "only the local declaration is enrolled",
      claims.units.map((unit: IEvidenceUnit): string => unit.name),
      ["local"],
    );
    TestValidator.equals(
      "local alias retains its owner identity",
      claims.addresses
        .filter((address: IEvidencePublicAddress): boolean =>
          address.file.endsWith("/local-barrel.ts"),
        )
        .map((address: IEvidencePublicAddress): string => address.unitId),
      claims.units.map((unit: IEvidenceUnit): string => unit.id),
    );
    TestValidator.equals(
      "foreign barrel has no declaration addresses",
      claims.addresses.filter(
        (address: IEvidencePublicAddress): boolean =>
          address.file.endsWith("/foreign-barrel.ts") ||
          address.file.endsWith("/transitive.ts"),
      ),
      [],
    );

    const covered: IEvidenceGraphResult = await evaluate(claims, requirements);
    TestValidator.equals(
      "acknowledged local checklist passes",
      covered.diagnostics,
      [],
    );
    TestValidator.equals(
      "aliases do not duplicate checklist hosts",
      EvidenceTestGraph.obligation(covered, 0, 0).hostCoverage.length,
      1,
    );

    // Removing evidence must expose the owner even when dependency barrels remain.
    snapshots[0] = EvidenceTestSourceSnapshot.create(
      "src/owner.ts",
      "export function local(): void {}" + (mixed ? "\n" + foreign : ""),
    );
    const missing: IEvidenceInventory = await adapter.analyze(
      EvidenceTestSourceSnapshot.combine(snapshots),
    );
    const uncovered: IEvidenceGraphResult = await evaluate(
      missing,
      requirements,
    );
    TestValidator.equals(
      "missing evidence remains a complete analysis",
      missing.complete,
      true,
    );
    TestValidator.equals(
      "local owner still owes its checklist",
      uncovered.diagnostics.map(
        (diagnostic: IEvidenceDiagnostic): string => diagnostic.code,
      ),
      ["graph-checklist-missing"],
    );
  }

  const citation: IEvidenceInventory = await adapter.analyze(
    EvidenceTestSourceSnapshot.create(
      "src/citation.ts",
      dedent`
      /** @evidence ./foreign-barrel.ts#tags Requires an explicit target. */
      export function cite(): void {}
    `,
    ),
  );
  const dependency: IEvidenceInventory = await adapter.analyze(
    EvidenceTestSourceSnapshot.create("src/foreign-barrel.ts", foreign),
  );
  const resolutions: IEvidenceGraphResolution[] =
    await EvidenceTestGraph.resolveDeclarations(citation, dependency, []);
  TestValidator.equals(
    "explicit foreign target remains unresolved",
    resolutions.map(
      (entry: IEvidenceGraphResolution): string => entry.resolution.status,
    ),
    ["missing-member"],
  );
}

/**
 * Evaluates the local owner against the selected Markdown checklist item.
 *
 * Real extracted tags pass through target resolution before graph evaluation;
 * removing a tag therefore tests host coverage rather than mocked resolution.
 */
async function evaluate(
  claims: IEvidenceInventory,
  requirements: IEvidenceInventory,
): Promise<IEvidenceGraphResult> {
  const unitIds: string[] = requirements.units
    .filter((unit: IEvidenceUnit): boolean => unit.symbol === "h2")
    .map((unit: IEvidenceUnit): string => unit.id);
  return EvidenceGraph.evaluate({
    claims: [
      {
        severity: "error",
        inventory: claims,
        unitIds: claims.units.map((unit: IEvidenceUnit): string => unit.id),
        references: [
          {
            severity: "error",
            inventory: requirements,
            unitIds,
            checklist: true,
            resolutions: await EvidenceTestGraph.resolveDeclarations(
              claims,
              requirements,
              unitIds,
            ),
          },
        ],
      },
    ],
  });
}
