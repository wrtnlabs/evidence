import {
  EvidenceChecker,
  EvidenceConfigDependencyScanner,
  EvidenceWatcher,
} from "@wrtnlabs/evidence";
import type {
  EvidenceWatchCycle,
  IEvidenceConfig,
  IEvidenceSourceDependency,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Keeps JSON configuration independent of executable module package scopes.
 *
 * Reading JSON data needs no CommonJS/ESM decision. Malformed package metadata
 * must not make watch fail when the same configuration passes a finite check;
 * TypeScript dependency scanning must still validate its real module scope.
 *
 * 1. Check covered Markdown through JSON beside malformed package metadata.
 * 2. Scan JSON and require no package-manifest dependency, then run implicit and
 *    explicit watchers and require complete reports with the same denominator.
 * 3. Scan TypeScript beside that metadata and require failure; repair the scope
 *    and require successful scanning with the package manifest retained.
 */
export async function test_watch_json_package_scope(): Promise<void> {
  const config: IEvidenceConfig = {
    claims: [
      {
        type: "markdown",
        files: ["source.md"],
        symbol: "h1",
        reference: { type: "markdown", files: ["target.md"], symbol: "h1" },
      },
    ],
  };
  await EvidenceTestFileSystem.experiment(
    "json-package-scope",
    {
      "evidence.config.json": JSON.stringify(config),
      "package.json": "{",
      "source.md":
        "# Source\n<!-- @evidence target.md#target Implements the target. -->\n",
      "target.md": "# Target\n",
    },
    async (directory: string): Promise<void> => {
      const json: string = join(directory, "evidence.config.json");
      TestValidator.equals(
        "JSON finite check ignores module scope",
        (await EvidenceChecker.check(json)).exitCode,
        0,
      );
      const dependencies: IEvidenceSourceDependency[] =
        await new EvidenceConfigDependencyScanner(json).scan();
      TestValidator.predicate(
        "JSON needs no package module scope",
        dependencies.every(
          (dependency: IEvidenceSourceDependency): boolean =>
            !dependency.path.endsWith("/package.json"),
        ),
      );
      const selections: (string | undefined)[] = [undefined, json];
      for (const selection of selections) {
        const watcher: EvidenceWatcher = new EvidenceWatcher(selection, {
          cwd: directory,
        });
        try {
          await watcher.watch(
            async (cycle: EvidenceWatchCycle): Promise<void> => {
              await watcher.close();
              TestValidator.equals(
                "JSON watch complete",
                cycle.status,
                "complete",
              );
              if (cycle.status === "complete") {
                TestValidator.equals("JSON watch passes", cycle.exitCode, 0);
                TestValidator.equals(
                  "JSON watch denominator",
                  cycle.report.counts.units,
                  1,
                );
              }
            },
          );
        } finally {
          await watcher.close();
        }
      }

      const ts: string = join(directory, "evidence.config.ts");
      await EvidenceTestFileSystem.save(directory, {
        "evidence.config.ts": `export default ${JSON.stringify(config)};`,
      });
      await TestValidator.error(
        "TS still validates package scope",
        async (): Promise<void> => {
          await new EvidenceConfigDependencyScanner(ts).scan();
        },
      );
      await EvidenceTestFileSystem.save(directory, {
        "package.json": JSON.stringify({ type: "commonjs" }),
      });
      const repaired: IEvidenceSourceDependency[] =
        await new EvidenceConfigDependencyScanner(ts).scan();
      TestValidator.predicate(
        "TS retains repaired module scope",
        repaired.some(
          (dependency: IEvidenceSourceDependency): boolean =>
            dependency.path ===
            join(directory, "package.json").replaceAll("\\", "/"),
        ),
      );
    },
  );
}
