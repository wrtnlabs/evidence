import { EvidenceCommand } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckReport,
  IEvidenceCommandResult,
  IEvidenceConfig,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import typia from "typia";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Honors report bounds authored in the configuration and lets command options
 * override them.
 *
 * Authoring the bounds once keeps an agent's checks focused without repeating
 * flags, while an explicit option must still win bound by bound, and a
 * malformed bound must stop the run instead of silently printing everything.
 *
 * 1. Check a source file that cites none of several required units with no
 *    `report` setting to capture the complete report.
 * 2. Configure a unit bound in JSON and a count bound in TypeScript, and require
 *    the matching prefix of the complete report, the unchanged counts and exit
 *    code, the omission count, and the authored bounds echoed in the report.
 * 3. Override the configured unit bound with a larger option and require the
 *    larger result; override only the unit of a config that also sets a count
 *    and require the untouched count to still apply.
 * 4. Configure a zero and a fractional bound and require an exit-2 failure naming
 *    each offending setting.
 */
export async function test_report_window_configured(): Promise<void> {
  const base: IEvidenceConfig = {
    claims: [
      {
        name: "calculator",
        type: "typescript",
        files: ["src/**/*.ts"],
        reference: { type: "markdown", files: ["docs/requirements.md"] },
      },
    ],
  };
  const withReport = (report: IEvidenceConfig["report"]): IEvidenceConfig => ({
    ...base,
    report,
  });
  const location = join(__dirname, `configured ${randomUUID()}`);
  await EvidenceTestFileSystem.experiment(
    location,
    {
      "plain.json": JSON.stringify(base),
      "unit.json": JSON.stringify(withReport({ unit: 1 })),
      "limit.config.ts": `export default ${JSON.stringify(withReport({ limit: 2 }))};\n`,
      "both.json": JSON.stringify(withReport({ unit: 1, limit: 1 })),
      "zero.json": JSON.stringify(withReport({ unit: 0 })),
      "fraction.json": JSON.stringify(withReport({ limit: 1.5 })),
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
      const run = async (...args: string[]): Promise<IEvidenceCommandResult> =>
        EvidenceCommand.run([...args, "--format", "json"], directory);
      const check = async (...args: string[]): Promise<IEvidenceCheckReport> =>
        typia.json.assertParse<IEvidenceCheckReport>(
          (await run(...args)).stdout,
        );

      const full: IEvidenceCheckReport = await check("--config", "plain.json");
      TestValidator.predicate("several findings", full.diagnostics.length >= 3);
      TestValidator.equals("plain has no bounds", full.bounds, undefined);

      // A configured unit bound and a configured count bound narrow the same way as options.
      const unit: IEvidenceCheckReport = await check("--config", "unit.json");
      TestValidator.equals(
        "configured unit",
        unit.diagnostics,
        full.diagnostics.slice(0, 1),
      );
      TestValidator.equals("configured bound echoed", unit.bounds, { unit: 1 });
      TestValidator.equals(
        "configured omission",
        unit.omittedDiagnostics,
        full.diagnostics.length - 1,
      );
      TestValidator.equals("configured counts", unit.counts, full.counts);
      TestValidator.equals("configured exit", unit.exitCode, full.exitCode);
      const limit: IEvidenceCheckReport = await check(
        "--config",
        "limit.config.ts",
      );
      TestValidator.equals(
        "configured limit",
        limit.diagnostics,
        full.diagnostics.slice(0, 2),
      );

      // Options win bound by bound; a bound they leave alone still applies.
      const wider: IEvidenceCheckReport = await check(
        "--config",
        "unit.json",
        "--unit",
        "3",
      );
      TestValidator.equals(
        "option widens configured unit",
        wider.diagnostics,
        full.diagnostics.slice(0, 3),
      );
      const merged: IEvidenceCheckReport = await check(
        "--config",
        "both.json",
        "--unit",
        "3",
      );
      TestValidator.equals(
        "configured limit survives unit option",
        merged.diagnostics,
        full.diagnostics.slice(0, 1),
      );

      // Malformed bounds fail the run rather than printing everything.
      const malformed: [string, string][] = [
        ["zero.json", "report.unit"],
        ["fraction.json", "report.limit"],
      ];
      for (const [file, setting] of malformed) {
        const result: IEvidenceCommandResult = await run("--config", file);
        TestValidator.equals(`${file} exit`, result.exitCode, 2);
        TestValidator.predicate(
          `${file} names ${setting}`,
          result.stdout.includes(setting),
        );
      }
    },
  );
}
