import { EvidenceCommand } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckReport,
  IEvidenceConfig,
  IEvidenceDiagnostic,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import typia from "typia";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Keeps reference units and statement hosts as separate window keys.
 *
 * A check can report uncovered reference units and a broken citation on the
 * claim side at once. The unit bound must count each distinct key once, never
 * merge a reference unit with a claim host, and keep every finding of an
 * admitted key.
 *
 * 1. Check a source file whose only citation names a missing heading while the
 *    reference has several uncovered units, and require both finding kinds:
 *    unit findings carrying a unit identity and a statement finding carrying a
 *    host.
 * 2. Require the unit identities and host identities to be disjoint, so no finding
 *    can be grouped under another namespace's key.
 * 3. For every unit bound from one to the number of distinct keys, require the
 *    result to equal the findings of the first keys in report order, computed
 *    independently from the full report, with exactly that many distinct keys.
 */
export async function test_report_window_keys(): Promise<void> {
  const config: IEvidenceConfig = {
    claims: [
      {
        name: "calculator",
        type: "typescript",
        files: ["src/**/*.ts"],
        reference: { type: "markdown", files: ["docs/requirements.md"] },
      },
    ],
  };
  const location = join(__dirname, `keys ${randomUUID()}`);
  await EvidenceTestFileSystem.experiment(
    location,
    {
      "evidence.config.json": JSON.stringify(config),
      "docs/requirements.md": dedent`
        ## Pricing

        Calculate the public price.

        ## Tax

        Apply the regional tax.
      `,
      "src/implementation.ts": dedent`
        /**
         * @evidence docs/requirements.md#missing-heading Cites a heading that does not exist.
         */
        export function calculate(): number {
          return 1;
        }
      `,
    },
    async (directory) => {
      const check = async (
        ...bounds: string[]
      ): Promise<IEvidenceCheckReport> =>
        typia.json.assertParse<IEvidenceCheckReport>(
          (
            await EvidenceCommand.run(
              ["--format", "json", ...bounds],
              directory,
            )
          ).stdout,
        );
      const key = (diagnostic: IEvidenceDiagnostic): string | undefined =>
        diagnostic.unitId ?? diagnostic.hostId;

      const full: IEvidenceCheckReport = await check();
      const unitIds: Set<string> = new Set();
      const hostIds: Set<string> = new Set();
      for (const diagnostic of full.diagnostics) {
        if (diagnostic.unitId !== undefined) unitIds.add(diagnostic.unitId);
        if (diagnostic.hostId !== undefined) hostIds.add(diagnostic.hostId);
      }
      TestValidator.predicate("unit findings exist", unitIds.size >= 2);
      TestValidator.predicate("host finding exists", hostIds.size >= 1);
      TestValidator.equals(
        "namespaces are disjoint",
        [...unitIds].filter((id: string): boolean => hostIds.has(id)),
        [],
      );

      const keys: string[] = [];
      for (const diagnostic of full.diagnostics) {
        const value: string | undefined = key(diagnostic);
        if (value !== undefined && !keys.includes(value)) keys.push(value);
      }
      for (let bound = 1; bound <= keys.length; bound++) {
        const admitted: string[] = keys.slice(0, bound);
        const expected: IEvidenceDiagnostic[] = full.diagnostics.filter(
          (diagnostic: IEvidenceDiagnostic): boolean => {
            const value: string | undefined = key(diagnostic);
            return value === undefined || admitted.includes(value);
          },
        );
        const narrowed: IEvidenceCheckReport = await check(
          "--unit",
          String(bound),
        );
        TestValidator.equals(
          `unit ${String(bound)}`,
          narrowed.diagnostics,
          expected,
        );
      }
    },
  );
}
