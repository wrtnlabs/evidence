import {
  evaluateTypeScriptConfig,
  EvidenceConfigLoader,
} from "@wrtnlabs/evidence";
import type { IEvidenceConfig } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Loads TypeScript configuration dependencies in isolation and preserves
 * failures.
 *
 * Configuration evaluation must follow imported modules without checking
 * unrelated workspace files or leaking configuration logs into report stdout.
 * Validation still applies to artifact contracts before inactive populations
 * are filtered.
 *
 * 1. Use a path containing spaces and literal punctuation; load equivalent ts,
 *    cts, and mts configurations that import helper globs and preserve
 *    evidenceFiles while an unrelated TypeScript file contains a type error.
 * 2. Remove the consumer tsconfig and require the isolated evaluator to load the
 *    same TypeScript configuration and its imported helper.
 * 3. Emit stdout and stderr from configuration evaluation and require both tokens
 *    to reach the supplied diagnostic sink.
 * 4. Configure an unsupported artifact and require its exact claims[0].type path
 *    and adapter-certification cause in the loading error.
 * 5. Plan a disabled claim with missing source, detached evidence and reference
 *    paths; require the correct configuration anchor and no active claims
 *    without touching those inputs.
 * 6. Require runtime exceptions and type errors in an imported helper to reject
 *    loading rather than return partial configuration data.
 *
 * @evidence contracts/testing.md#behavioral-verification Loads ts, cts and mts configurations with helpers and evidenceFiles in a punctuated path and asserts values, isolation, diagnostics routing and failures.
 * @evidence contracts/testing.md#independent-expectations Expected values are the authored helper outputs; failure expectations follow the loader contract.
 * @evidence contracts/testing.md#distinguishing-cases Covers module formats, a removed tsconfig, an unrelated type error, stdout and stderr routing, an unsupported artifact, a disabled claim with missing native and detached paths, and runtime and type errors in helpers.
 * @evidence contracts/testing.md#execution-ownership The exported test_config_loader is discovered by DynamicExecutor and calls maintained source in-process; the only child process is the product's own read-only configuration evaluator started by the code under test. It installs nothing and spawns no CLI.
 */
export async function test_config_loader(): Promise<void> {
  // Resolve workspace peers while preserving spaces and literal path characters.
  const location = join(__dirname, `loader $' ${randomUUID()}`);
  const source = dedent`
    import { files } from "./helpers/files";
    import type { IEvidenceConfig } from "@wrtnlabs/evidence";

    export default {
      claims: [
        {
          type: "typescript",
          files,
          evidenceFiles: ["evidence/**/*.md"],
          reference: { type: "markdown", files: ["docs/**"] },
        },
      ],
    } satisfies IEvidenceConfig;
  `;

  await EvidenceTestFileSystem.experiment(
    location,
    {
      "helpers/files.ts": dedent`
        export const files = ["src/**"];
      `,
      "unrelated.ts": dedent`
        const invalid: number = "unrelated";
      `,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { noEmit: true },
        include: ["**/*.ts"],
      }),
    },
    async (directory) => {
      // All module extensions load imports without checking the unrelated source.
      for (const extension of ["ts", "cts", "mts"]) {
        const filename = `evidence.config.${extension}`;
        await EvidenceTestFileSystem.save(directory, { [filename]: source });

        const output = await EvidenceConfigLoader.load(
          join(directory, filename),
        );

        TestValidator.equals(
          `${extension} imported globs`,
          output.claims[0]?.files,
          ["src/**"],
        );
        TestValidator.equals(
          `${extension} detached evidence globs`,
          output.claims[0]?.evidenceFiles,
          ["evidence/**/*.md"],
        );
      }

      // The evaluator supplies its own compiler project after resolving consumer dependencies.
      await rm(join(directory, "tsconfig.json"));
      const isolated: IEvidenceConfig = await EvidenceConfigLoader.load(
        join(directory, "evidence.config.ts"),
      );
      TestValidator.equals(
        "config without tsconfig",
        isolated.claims[0]?.files,
        ["src/**"],
      );

      // Evaluator stdout and stderr share the diagnostic sink instead of process stdout.
      await EvidenceTestFileSystem.save(directory, {
        "evidence.config.ts": dedent`
          console.log("config-output-token");
          console.error("config-error-token");
          export default { claims: [] };
        `,
      });
      const diagnostics: string[] = [];
      function writeDiagnostic(content: string): void {
        diagnostics.push(content);
      }

      await evaluateTypeScriptConfig(join(directory, "evidence.config.ts"), {
        writeDiagnostic,
      });

      const diagnosticOutput = diagnostics.join("");
      TestValidator.predicate(
        "config stdout isolation",
        diagnosticOutput.includes("config-output-token"),
      );
      TestValidator.predicate(
        "config stderr preservation",
        diagnosticOutput.includes("config-error-token"),
      );

      // Unsupported artifact identifiers fail with their exact configuration path.
      await EvidenceTestFileSystem.save(directory, {
        "evidence.config.ts": dedent`
          export default {
            claims: [
              {
                type: "graphql",
                files: ["schema/**"],
                reference: { type: "markdown", files: ["docs/**"] },
              },
            ],
          };
        `,
      });
      const unsupported = await failure(() =>
        EvidenceConfigLoader.load(join(directory, "evidence.config.ts")),
      );

      TestValidator.predicate(
        "unsupported artifact path",
        unsupported.includes(
          "claims[0].type: artifact type 'graphql' has no certified Evidence adapter",
        ),
      );

      // A disabled population is validated and planned without touching its missing root.
      await EvidenceTestFileSystem.save(directory, {
        "evidence.config.ts": dedent`
          import type { IEvidenceConfig } from "@wrtnlabs/evidence";

          export default {
            claims: [
              {
                type: "typescript",
                disabled: true,
                root: "missing-source",
                files: ["**/*.ts"],
                evidenceFiles: ["missing-evidence/**/*.md"],
                reference: {
                  type: "swagger",
                  file: "missing-openapi.json",
                },
              },
            ],
          } satisfies IEvidenceConfig;
        `,
      });

      const inactive = await EvidenceConfigLoader.plan(
        join(directory, "evidence.config.ts"),
      );

      TestValidator.equals(
        "configuration plan anchor",
        inactive.configFile,
        join(directory, "evidence.config.ts"),
      );
      TestValidator.equals("inactive populations", inactive.claims, []);

      // Runtime exceptions reject the loader promise instead of returning data.
      await EvidenceTestFileSystem.save(directory, {
        "evidence.config.ts": dedent`
          throw new Error("Config failed during evaluation");
          export default {};
        `,
      });

      await TestValidator.error("runtime exception", () =>
        EvidenceConfigLoader.load(join(directory, "evidence.config.ts")),
      );

      // Imported type errors reach the caller through the evaluator failure.
      await EvidenceTestFileSystem.save(directory, {
        "evidence.config.ts": source,
        "helpers/files.ts": dedent`
          export const files: string[] = [123];
        `,
      });

      await TestValidator.error("imported TypeScript error", () =>
        EvidenceConfigLoader.load(join(directory, "evidence.config.ts")),
      );
    },
  );
}

/**
 * Captures a loading error for assertions about its configuration coordinates.
 *
 * Unexpected success fails the scenario, and non-Error rejections are
 * propagated so they cannot be mistaken for the diagnostic message under test.
 */
async function failure(closure: () => Promise<unknown>): Promise<string> {
  try {
    await closure();
  } catch (cause) {
    if (cause instanceof Error) return cause.message;
    throw cause;
  }
  throw new Error("Expected Evidence configuration loading to fail.");
}
