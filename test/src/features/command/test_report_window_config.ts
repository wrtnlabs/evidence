import { EvidenceCommand } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckReport,
  IEvidenceCommandResult,
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
 * Bounds a real check, loaded from a TypeScript or JSON configuration file, one
 * unit at a time.
 *
 * The producer must label each missing-evidence finding with the unit it is
 * about, and the command must narrow by those labels identically for either
 * configuration format while leaving the totals and exit code untouched.
 *
 * 1. Check a source file that cites none of four required units, once per
 *    configuration format, and require equivalent complete reports in which
 *    every finding names a distinct unit.
 * 2. Bound to the first unit and require only that unit's findings, in report
 *    order, with unchanged counts and exit code and the withheld remainder
 *    stated.
 * 3. Bound to two units, to one finding, and to both at once, and require the
 *    matching prefix of the full report each time.
 * 4. Use bounds larger than the report and require the full report with no
 *    omission, then require the text report to announce a narrowed result.
 */
export async function test_report_window_config(): Promise<void> {
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
  const location = join(__dirname, `window ${randomUUID()}`);
  await EvidenceTestFileSystem.experiment(
    location,
    {
      "evidence.config.json": JSON.stringify(config),
      "evidence.config.ts": `export default ${JSON.stringify(config)};\n`,
      "docs/requirements.md": dedent`
        ## Pricing

        Calculate the public price.

        ## Tax

        Apply the regional tax.

        ## Refund

        Return the payment.
      `,
      "src/implementation.ts": dedent`
        export function calculate(): number {
          return 1;
        }
      `,
    },
    async (directory) => {
      const run = async (
        configFile: string,
        ...bounds: string[]
      ): Promise<IEvidenceCheckReport> => {
        const result: IEvidenceCommandResult = await EvidenceCommand.run(
          ["--config", configFile, "--format", "json", ...bounds],
          directory,
        );
        return typia.json.assertParse<IEvidenceCheckReport>(result.stdout);
      };
      const unitOf = (diagnostic: IEvidenceDiagnostic): string | undefined =>
        diagnostic.unitId;

      // Both configuration formats describe the same population and findings.
      const full: IEvidenceCheckReport = await run("evidence.config.json");
      const fromTs: IEvidenceCheckReport = await run("evidence.config.ts");
      TestValidator.equals(
        "formats agree",
        fromTs.diagnostics,
        full.diagnostics,
      );
      TestValidator.equals("violation exit", full.exitCode, 1);
      const units: string[] = full.diagnostics.map(
        (diagnostic: IEvidenceDiagnostic): string => {
          const unit: string | undefined = unitOf(diagnostic);
          if (unit === undefined)
            throw new Error("A missing-evidence finding names no unit.");
          return unit;
        },
      );
      TestValidator.equals(
        "one finding per distinct unit",
        new Set(units).size,
        units.length,
      );
      TestValidator.predicate("several units", units.length >= 3);
      TestValidator.equals(
        "nothing omitted",
        full.omittedDiagnostics,
        undefined,
      );

      for (const configFile of ["evidence.config.json", "evidence.config.ts"]) {
        // One unit keeps exactly its own findings and the complete totals.
        const first: IEvidenceCheckReport = await run(
          configFile,
          "--unit",
          "1",
        );
        TestValidator.equals(
          `${configFile} first unit`,
          first.diagnostics,
          full.diagnostics.slice(0, 1),
        );
        TestValidator.equals(`${configFile} counts`, first.counts, full.counts);
        TestValidator.equals(
          `${configFile} exit`,
          first.exitCode,
          full.exitCode,
        );
        TestValidator.equals(
          `${configFile} omission`,
          first.omittedDiagnostics,
          full.diagnostics.length - 1,
        );

        // Two units and a single finding are report-order prefixes.
        const two: IEvidenceCheckReport = await run(configFile, "--unit", "2");
        TestValidator.equals(
          `${configFile} two units`,
          two.diagnostics,
          full.diagnostics.slice(0, 2),
        );
        const one: IEvidenceCheckReport = await run(configFile, "--limit", "1");
        TestValidator.equals(
          `${configFile} one finding`,
          one.diagnostics,
          full.diagnostics.slice(0, 1),
        );

        // Bounds compose: the stricter one decides.
        const both: IEvidenceCheckReport = await run(
          configFile,
          "--unit",
          "3",
          "--limit",
          "2",
        );
        TestValidator.equals(
          `${configFile} composed`,
          both.diagnostics,
          full.diagnostics.slice(0, 2),
        );

        // Bounds that withhold nothing leave the report unchanged.
        const roomy: IEvidenceCheckReport = await run(
          configFile,
          "--unit",
          "99",
          "--limit",
          "99",
        );
        TestValidator.equals(
          `${configFile} roomy`,
          roomy.diagnostics,
          full.diagnostics,
        );
        TestValidator.equals(
          `${configFile} roomy omission`,
          roomy.omittedDiagnostics,
          undefined,
        );
      }

      // The text report announces that it was narrowed.
      const text: IEvidenceCommandResult = await EvidenceCommand.run(
        ["--config", "evidence.config.json", "--unit", "1"],
        directory,
      );
      TestValidator.predicate(
        "text announces omission",
        text.stdout.includes(
          `Showing 1 of ${full.diagnostics.length} diagnostics`,
        ),
      );
    },
  );
}
