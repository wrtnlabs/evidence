import { EvidenceWatcher } from "@wrtnlabs/evidence";
import type { EvidenceWatchCycle } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Invalidates excluded forwarding dependencies without editing selected owners.
 *
 * Support-only files remain watch inputs even though their declarations cannot
 * enlarge the selected claim population.
 *
 * 1. Start with an acknowledged owner and excluded foreign-export dependency;
 *    require a passing cycle.
 * 2. Change only the excluded barrel to another foreign export; require a fresh
 *    passing cycle.
 * 3. Delete only the excluded barrel; require incomplete analysis.
 * 4. Restore it without editing the caller; require recovery and stop watch.
 */
export async function test_typescript_excluded_barrel_watch(): Promise<void> {
  await EvidenceTestFileSystem.experiment(
    "excluded-barrel-watch",
    {
      "evidence.config.ts": dedent`
      export default { claims: [{ type: "typescript", files: ["src/**/*.ts", "!src/dependency.ts"], reference: { type: "markdown", files: ["rules.md"], symbol: "h2", checklist: true } }] };
    `,
      "rules.md": "# Rules\n\n## Owner {#owner}\n\nAcknowledge owners.\n",
      "src/owner.ts":
        "/** @evidence rules.md#owner Owns the implementation. */\nexport function local(): void {}",
      "src/index.ts": 'export * from "./dependency";',
      "src/dependency.ts": 'export { Original } from "foreign";',
    },
    async (directory: string): Promise<void> => {
      const watcher: EvidenceWatcher = new EvidenceWatcher(
        join(directory, "evidence.config.ts"),
        { pollIntervalMilliseconds: 10, debounceMilliseconds: 10 },
      );
      try {
        await watcher.watch(
          async (cycle: EvidenceWatchCycle): Promise<void> => {
            if (cycle.status === "failed") throw new Error(cycle.message);
            TestValidator.equals(
              `support cycle ${cycle.cycle}`,
              cycle.report.exitCode,
              cycle.cycle === 3 ? 2 : 0,
            );
            if (cycle.cycle === 1)
              await EvidenceTestFileSystem.save(directory, {
                "src/dependency.ts": 'export { Changed } from "foreign";',
              });
            else if (cycle.cycle === 2)
              await EvidenceTestFileSystem.erase(
                join(directory, "src/dependency.ts"),
              );
            else if (cycle.cycle === 3)
              await EvidenceTestFileSystem.save(directory, {
                "src/dependency.ts": 'export { Recovered } from "foreign";',
              });
            else {
              TestValidator.equals(
                "support dependency recovery cycle",
                cycle.cycle,
                4,
              );
              await watcher.close();
            }
          },
        );
      } finally {
        await watcher.close();
      }
    },
  );
}
