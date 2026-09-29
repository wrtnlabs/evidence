import { EvidenceWatcher } from "@wrtnlabs/evidence";
import type { EvidenceWatchCycle, IEvidenceConfig } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Repeats implicit configuration discovery through priority changes and
 * recovery.
 *
 * Candidate paths must remain dependencies after JSON succeeds, and a broken
 * preferred TS entry must fail without silently reverting to JSON. Explicit
 * paths remain fixed even when conventional candidates appear.
 *
 * 1. Start without either config in a captured child cwd and require failure.
 * 2. Create JSON and require recovery; add disabled TS and require TS priority.
 * 3. Break TS and require failure, then delete it and require JSON recovery.
 * 4. Break and delete JSON, requiring failures, then recreate it and recover.
 * 5. Run an explicit-JSON watcher with broken TS present; deleting JSON must fail,
 *    and repairing it must restore the original explicit selection.
 */
export async function test_watch_config_discovery(): Promise<void> {
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
  const json: string = JSON.stringify(config);
  await EvidenceTestFileSystem.experiment(
    "watch-discovery",
    {
      "project/source.md":
        "# Source\n<!-- @evidence target.md#target Implements the target. -->\n",
      "project/target.md": "# Target\n",
      "evidence.config.ts": "throw new Error('Wrong cwd');",
    },
    async (directory: string): Promise<void> => {
      const project: string = join(directory, "project");
      const watcher: EvidenceWatcher = new EvidenceWatcher(undefined, {
        cwd: project,
        pollIntervalMilliseconds: 10,
        debounceMilliseconds: 0,
      });
      const cycles: EvidenceWatchCycle[] = [];
      const previous: string = process.cwd();
      process.chdir(directory);
      const timeout: NodeJS.Timeout = setTimeout((): void => {
        void watcher.close();
      }, 60_000);
      try {
        await watcher.watch(
          async (cycle: EvidenceWatchCycle): Promise<void> => {
            cycles.push(cycle);
            if (cycle.status === "complete") {
              TestValidator.equals(
                "complete cycle passes coverage",
                cycle.exitCode,
                0,
              );
              TestValidator.equals(
                "selected configuration owns denominator",
                cycle.report.counts.units,
                cycle.cycle === 3 ? 0 : 1,
              );
              TestValidator.equals(
                "selected configuration owns claims",
                cycle.report.claims.length,
                cycle.cycle === 3 ? 0 : 1,
              );
            }
            switch (cycle.cycle) {
              case 1:
                TestValidator.equals(
                  "missing candidates",
                  cycle.status,
                  "failed",
                );
                await EvidenceTestFileSystem.save(project, {
                  "evidence.config.json": json,
                });
                break;
              case 2:
                TestValidator.equals("JSON recovery", cycle.status, "complete");
                await EvidenceTestFileSystem.save(project, {
                  "evidence.config.ts": `export default { ...${json}, severity: "off" };`,
                });
                break;
              case 3:
                TestValidator.equals("TS priority", cycle.status, "complete");
                if (cycle.status === "complete")
                  TestValidator.equals(
                    "TS selected physical path",
                    cycle.report.configFile,
                    join(project, "evidence.config.ts"),
                  );
                await EvidenceTestFileSystem.save(project, {
                  "evidence.config.ts":
                    "export default (() => { throw new Error('Preferred TS failed'); })();",
                });
                break;
              case 4:
                TestValidator.equals(
                  "broken TS cannot fall back",
                  cycle.status,
                  "failed",
                );
                await EvidenceTestFileSystem.erase(
                  join(project, "evidence.config.ts"),
                );
                break;
              case 5:
                TestValidator.equals(
                  "TS deletion discovers JSON",
                  cycle.status,
                  "complete",
                );
                await EvidenceTestFileSystem.save(project, {
                  "evidence.config.json": "{",
                });
                break;
              case 6:
                TestValidator.equals("malformed JSON", cycle.status, "failed");
                await EvidenceTestFileSystem.erase(
                  join(project, "evidence.config.json"),
                );
                break;
              case 7:
                TestValidator.equals("deleted JSON", cycle.status, "failed");
                await EvidenceTestFileSystem.save(project, {
                  "evidence.config.json": json,
                });
                break;
              default:
                TestValidator.equals(
                  "final JSON repair",
                  cycle.status,
                  "complete",
                );
                await watcher.close();
            }
          },
        );
      } finally {
        clearTimeout(timeout);
        await watcher.close();
        process.chdir(previous);
      }
      TestValidator.equals(
        "all implicit discovery transitions published",
        cycles.length,
        8,
      );

      await EvidenceTestFileSystem.save(project, {
        "evidence.config.ts":
          "throw new Error('Explicit JSON must ignore TS');",
      });
      const explicit: EvidenceWatcher = new EvidenceWatcher(
        "evidence.config.json",
        { cwd: project, pollIntervalMilliseconds: 10, debounceMilliseconds: 0 },
      );
      const explicitCycles: EvidenceWatchCycle[] = [];
      const explicitTimeout: NodeJS.Timeout = setTimeout((): void => {
        void explicit.close();
      }, 30_000);
      try {
        await explicit.watch(
          async (cycle: EvidenceWatchCycle): Promise<void> => {
            explicitCycles.push(cycle);
            if (cycle.cycle === 1) {
              TestValidator.equals(
                "explicit JSON ignores TS",
                cycle.status,
                "complete",
              );
              await EvidenceTestFileSystem.erase(
                join(project, "evidence.config.json"),
              );
            } else if (cycle.cycle === 2) {
              TestValidator.equals(
                "explicit deletion cannot switch",
                cycle.status,
                "failed",
              );
              await EvidenceTestFileSystem.save(project, {
                "evidence.config.json": json,
              });
            } else {
              TestValidator.equals("explicit repair", cycle.status, "complete");
              await explicit.close();
            }
          },
        );
      } finally {
        clearTimeout(explicitTimeout);
        await explicit.close();
      }
      TestValidator.equals(
        "all explicit transitions published",
        explicitCycles.length,
        3,
      );
    },
  );
}
