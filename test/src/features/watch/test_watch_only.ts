import { EvidenceCommand, EvidenceWatcher } from "@wrtnlabs/evidence";
import type {
  EvidenceWatchCycle,
  IEvidenceCheckReport,
  IEvidenceCommandResult,
  IEvidenceConfig,
  IEvidenceDiagnostic,
  IEvidenceSourceDependency,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import typia from "typia";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Re-resolves focused targets while retaining dependencies outside their scope.
 *
 * Removing a selected heading must publish failure and recover after repair. A
 * new citation from another host can change uniqueness inside the focus, so
 * filtering reports must never shrink watch dependency observation.
 *
 * 1. Watch a covered parent subtree while an unrelated requirement is missing;
 *    require a passing focused report equal to the finite command.
 * 2. Remove and restore the selected subtree; require failure and recovery.
 * 3. Add a duplicate citation in another watched source and require a focused
 *    uniqueness failure, then remove it and require recovery.
 * 4. Mutate the caller's target array after construction and verify the watcher
 *    retained its original selection through all five cycles.
 */
export async function test_watch_only(): Promise<void> {
  const config: IEvidenceConfig = {
    claims: [
      {
        type: "typescript",
        files: ["src/*.ts"],
        symbol: "function",
        reference: {
          type: "markdown",
          root: "docs",
          files: ["*.md"],
          symbol: ["h2", "h3"],
          uniqueEvidence: true,
        },
      },
    ],
  };
  const requirements: string = dedent`
    ## Pricing {#pricing}
    Pricing requirements.
    ### Tax {#tax}
    Tax requirements.
    ## Refund {#refund}
    Refund requirements.
  `;
  await EvidenceTestFileSystem.experiment(
    "watch only",
    {
      "evidence.config.json": JSON.stringify(config),
      "docs/requirements.md": requirements,
      "src/main.ts": dedent`
      /** @evidence requirements.md#pricing Implements pricing. */
      export function main(): void {}
    `,
      "src/other.ts": "export function other(): void {}\n",
    },
    async (directory: string): Promise<void> => {
      const only: string[] = ["requirements.md#pricing"];
      const watcher: EvidenceWatcher = new EvidenceWatcher(undefined, {
        cwd: directory,
        only,
        pollIntervalMilliseconds: 20,
        debounceMilliseconds: 20,
      });
      only[0] = "requirements.md#refund";
      const exits: number[] = [];
      const timeout: NodeJS.Timeout = setTimeout((): void => {
        void watcher.close();
      }, 30_000);
      try {
        await watcher.watch(
          async (cycle: EvidenceWatchCycle): Promise<void> => {
            if (cycle.status === "failed") throw new Error(cycle.message);
            const finite: IEvidenceCommandResult = await EvidenceCommand.run(
              ["--only", "requirements.md#pricing", "--format", "json"],
              directory,
            );
            const report: IEvidenceCheckReport =
              typia.json.assertParse<IEvidenceCheckReport>(finite.stdout);
            TestValidator.equals(
              "finite/watch agreement",
              cycle.report,
              report,
            );
            TestValidator.equals(
              "envelope exit",
              cycle.exitCode,
              report.exitCode,
            );
            exits.push(cycle.exitCode);
            if (cycle.cycle === 1) {
              TestValidator.equals(
                "initial focused coverage",
                cycle.report.counts.units,
                2,
              );
              TestValidator.predicate(
                "outside host retained",
                watcher
                  .dependencies()
                  .some((dependency: IEvidenceSourceDependency): boolean =>
                    dependency.path
                      .replaceAll("\\", "/")
                      .endsWith("src/other.ts"),
                  ),
              );
              await EvidenceTestFileSystem.save(directory, {
                "docs/requirements.md":
                  "## Refund {#refund}\nRefund requirements.\n",
              });
            } else if (cycle.cycle === 2) {
              await EvidenceTestFileSystem.save(directory, {
                "docs/requirements.md": requirements,
              });
            } else if (cycle.cycle === 3) {
              await EvidenceTestFileSystem.save(directory, {
                "src/other.ts": dedent`
            /** @evidence requirements.md#pricing Also implements pricing. */
            export function other(): void {}
          `,
              });
            } else if (cycle.cycle === 4) {
              TestValidator.predicate(
                "outside citation affects focus",
                cycle.report.diagnostics.some(
                  (diagnostic: IEvidenceDiagnostic): boolean =>
                    diagnostic.code === "graph-unique-evidence",
                ),
              );
              await EvidenceTestFileSystem.save(directory, {
                "src/other.ts": "export function other(): void {}\n",
              });
            } else await watcher.close();
          },
        );
      } finally {
        clearTimeout(timeout);
        await watcher.close();
      }
      TestValidator.equals(
        "focused failure and recovery",
        exits,
        [0, 1, 0, 1, 0],
      );
    },
  );
}
