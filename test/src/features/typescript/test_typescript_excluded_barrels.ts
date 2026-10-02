import { EvidenceChecker } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckReport,
  IEvidenceDiagnostic,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Resolves excluded forwarding chains without enrolling their declaration
 * owners.
 *
 * Named dependency exports beneath a selected ordinary star barrel previously
 * made direct-owner claims incomplete when the dependency barrel was excluded.
 * Support reads must preserve file selection and real missing-source failures.
 *
 * 1. Check a broad source claim with an excluded foreign named-export barrel and
 *    its selected star/named callers; require a passing local checklist.
 * 2. Put an unacknowledged local declaration in the excluded support file and
 *    require it to remain outside the claim population.
 * 3. Remove the selected owner's evidence; require a missing-checklist error.
 * 4. Restore evidence, delete the dependency barrel, and require incompleteness;
 *    recreate it and require recovery.
 */
export async function test_typescript_excluded_barrels(): Promise<void> {
  await EvidenceTestFileSystem.experiment(
    "excluded-barrels",
    {
      "evidence.config.ts": dedent`
      export default { claims: [{ type: "typescript", files: ["src/**/*.ts", "!src/dependency.ts"], symbol: ["type", "function"], reference: { type: "markdown", files: ["rules.md"], symbol: "h2", checklist: true } }] };
    `,
      "rules.md":
        "# Rules\n\n## Ownership {#ownership}\n\nAcknowledge local owners.\n",
      "src/owner.ts":
        "/** @evidence rules.md#ownership Owns the implementation. */\nexport function local(): void {}",
      "src/dependency.ts": 'export { HttpError } from "@typia/utils";',
      "src/index.ts":
        'export * from "./dependency"; export { local } from "./owner";',
      "src/chain.ts": 'export { HttpError } from "./index";',
    },
    async (directory: string): Promise<void> => {
      const file: string = join(directory, "evidence.config.ts");
      const initial: IEvidenceCheckReport = await EvidenceChecker.check(file);
      TestValidator.equals(
        "excluded foreign barrel caller passes",
        initial.diagnostics,
        [],
      );
      TestValidator.equals(
        "excluded foreign barrel caller exit",
        initial.exitCode,
        0,
      );

      // A support read cannot override an explicit owner exclusion.
      await EvidenceTestFileSystem.save(directory, {
        "src/dependency.ts":
          'export { HttpError } from "@typia/utils"; export interface Excluded {}',
      });
      const excluded: IEvidenceCheckReport = await EvidenceChecker.check(file);
      TestValidator.equals(
        "support declaration remains excluded",
        excluded.diagnostics,
        [],
      );
      TestValidator.equals(
        "support read preserves claim counts",
        excluded.counts,
        initial.counts,
      );

      await EvidenceTestFileSystem.save(directory, {
        "src/owner.ts": "export function local(): void {}",
      });
      const missing: IEvidenceCheckReport = await EvidenceChecker.check(file);
      TestValidator.equals(
        "selected owner missing evidence exit",
        missing.exitCode,
        1,
      );
      TestValidator.equals(
        "selected owner missing evidence finding",
        missing.diagnostics.map(
          (diagnostic: IEvidenceDiagnostic): string => diagnostic.code,
        ),
        ["graph-checklist-missing"],
      );

      await EvidenceTestFileSystem.save(directory, {
        "src/owner.ts":
          "/** @evidence rules.md#ownership Owns the implementation. */\nexport function local(): void {}",
      });
      await EvidenceTestFileSystem.erase(join(directory, "src/dependency.ts"));
      const absent: IEvidenceCheckReport = await EvidenceChecker.check(file);
      TestValidator.equals(
        "genuinely missing local dependency remains incomplete",
        absent.exitCode,
        2,
      );

      await EvidenceTestFileSystem.save(directory, {
        "src/dependency.ts": 'export { HttpError } from "@typia/utils";',
      });
      const restored: IEvidenceCheckReport = await EvidenceChecker.check(file);
      TestValidator.equals(
        "excluded dependency repair recovers",
        restored.exitCode,
        0,
      );
    },
  );
}
