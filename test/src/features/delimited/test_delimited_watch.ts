import { EvidenceWatcher } from "@wrtnlabs/evidence";
import type {
  EvidenceWatchCycle,
  IEvidenceConfig,
  IEvidenceSourceDependency,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Rechecks a watched ledger when its rows change.
 *
 * 1. Watch a Markdown claim citing the only row of a TSV reference; require a
 *    passing first cycle that lists the ledger as a dependency.
 * 2. Append an uncited row; require a failing cycle.
 * 3. Make the new row a duplicate key; require an incomplete cycle.
 * 4. Restore the single row; require a passing cycle.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs EvidenceWatcher over a real ledger and asserts the exit code of each cycle as the file changes, plus its watch dependency.
 * @evidence contracts/testing.md#independent-expectations Exit codes follow the README states: complete and clean 0, a missing row 1, an incomplete ledger 2.
 * @evidence contracts/testing.md#distinguishing-cases Covers a passing baseline, an added uncited row, a malformed edit and recovery; one-shot evaluation belongs to the graph tests.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers the exported test_delimited_watch under test/src/features and it calls EvidenceWatcher in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_delimited_watch(): Promise<void> {
  const config: IEvidenceConfig = {
    claims: [
      {
        type: "markdown",
        files: ["decisions/*.md"],
        symbol: "file",
        reference: { type: "tsv", files: ["data/*.tsv"], key: "id" },
      },
    ],
  };
  await EvidenceTestFileSystem.experiment(
    "delimited-watch",
    {
      "evidence.config.json": JSON.stringify(config),
      "data/projects.tsv": "id\ttitle\nP1\tAlpha\n",
      "decisions/budget.md":
        "<!-- @evidence data/projects.tsv#P1 Funds the project. -->\n",
    },
    async (directory: string): Promise<void> => {
      const watcher: EvidenceWatcher = new EvidenceWatcher(undefined, {
        cwd: directory,
        pollIntervalMilliseconds: 20,
        debounceMilliseconds: 20,
      });
      const exits: number[] = [];
      const timeout: NodeJS.Timeout = setTimeout((): void => {
        void watcher.close();
      }, 30_000);
      try {
        await watcher.watch(async (cycle: EvidenceWatchCycle): Promise<void> => {
          if (cycle.status === "failed") throw new Error(cycle.message);
          exits.push(cycle.exitCode);
          if (cycle.cycle === 1) {
            TestValidator.predicate(
              "ledger is a watch dependency",
              watcher
                .dependencies()
                .some((dependency: IEvidenceSourceDependency): boolean =>
                  dependency.path.replaceAll("\\", "/").endsWith("data/projects.tsv"),
                ),
            );
            await EvidenceTestFileSystem.save(directory, {
              "data/projects.tsv": "id\ttitle\nP1\tAlpha\nP2\tBeta\n",
            });
          } else if (cycle.cycle === 2)
            await EvidenceTestFileSystem.save(directory, {
              "data/projects.tsv": "id\ttitle\nP1\tAlpha\nP1\tAgain\n",
            });
          else if (cycle.cycle === 3)
            await EvidenceTestFileSystem.save(directory, {
              "data/projects.tsv": "id\ttitle\nP1\tAlpha\n",
            });
          else await watcher.close();
        });
      } finally {
        clearTimeout(timeout);
        await watcher.close();
      }
      TestValidator.equals("watched ledger cycles", exits, [0, 1, 2, 0]);
    },
  );
}
