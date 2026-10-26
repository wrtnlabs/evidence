import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import {
  EvidenceWatcher,
  EvidenceTreeSitterAssets,
  EvidenceTreeSitterAssetScope,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceConfig,
  IEvidenceGrammar,
  EvidenceWatchCycle,
} from "@wrtnlabs/evidence";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";
import { EvidenceTestParserAssets } from "../../internal/EvidenceTestParserAssets";

/**
 * Accepts stable source discovery and retries a source changed during
 * extraction.
 *
 * Configuration evaluation records each actual attempt, while the supported
 * asset transport pauses the first Python extraction to change its already read
 * source.
 *
 * 1. Publish an initial Markdown population and then discover a second glob
 *    member.
 * 2. Require one configuration execution per stable published cycle.
 * 3. Switch to Python and edit its source during grammar acquisition.
 * 4. Require a discarded attempt, a fresh evaluation and a complete final cycle.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs the real watcher and observes configuration side effects and published cycles; a supported grammar transport edits a source during extraction.
 * @evidence contracts/testing.md#independent-expectations Two stable populations need two evaluations; the source changed after acquisition requires two further evaluations before publication.
 * @evidence contracts/testing.md#distinguishing-cases Covers first discovery, a new glob member, a changed configuration and a torn source followed by stable recovery; parser recovery tests own failed downloads.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor invokes the watcher in-process over disposable fixtures; no methods or globals are replaced, and the watcher and timeout close in finally.
 */
export async function test_watch_discovery_witness(): Promise<void> {
  const markdown: IEvidenceConfig = {
    claims: [
      {
        type: "markdown",
        files: ["docs/*.md"],
        symbol: "h2",
        reference: { type: "markdown", files: ["rules.md"], symbol: "h2" },
      },
    ],
  };
  const python: IEvidenceConfig = {
    claims: [
      {
        type: "python",
        files: ["docs/*.py"],
        symbol: "function",
        reference: { type: "markdown", files: ["rules.md"], symbol: "h2" },
      },
    ],
  };
  const grammars: IEvidenceGrammar[] =
    await new EvidenceTreeSitterAssets().list();
  const files: Map<string, IEvidenceGrammar> = new Map(
    grammars.map((grammar: IEvidenceGrammar): [string, IEvidenceGrammar] => [
      grammar.wasm.url,
      grammar,
    ]),
  );
  await EvidenceTestFileSystem.experiment(
    "watch-discovery-witness",
    {
      "project/evidence.config.ts": configuration(markdown),
      "executions.log": "",
      "project/docs/first.md": dedent`
      ## First
      Body.
    `,
      "project/rules.md": dedent`
      ## Rule
      Required.
    `,
    },
    async (directory: string): Promise<void> => {
      let torn: boolean = false;
      let published: number = 0;
      const watcher: EvidenceWatcher = new EvidenceWatcher(
        join(directory, "project", "evidence.config.ts"),
        { pollIntervalMilliseconds: 10, debounceMilliseconds: 0 },
      );
      const timeout: ReturnType<typeof setTimeout> = setTimeout((): void => {
        void watcher.close();
      }, 60_000);
      async function fetchFixture(
        input: string | URL | Request,
      ): Promise<Response> {
        const url: string =
          input instanceof Request ? input.url : String(input);
        const grammar: IEvidenceGrammar | undefined = files.get(url);
        if (grammar === undefined)
          throw new Error(`No pinned parser fixture for ${url}`);
        if (grammar.id === "python" && !torn) {
          torn = true;
          await EvidenceTestFileSystem.save(directory, {
            "project/docs/final.py": dedent`
          def final():
              return 2
        `,
          });
        }
        return new Response(
          Uint8Array.from(await EvidenceTestParserAssets.bytes(grammar)),
        );
      }
      try {
        await EvidenceTreeSitterAssetScope.run(
          { cacheDirectory: join(directory, "cache"), fetch: fetchFixture },
          (): Promise<void> =>
            watcher.watch(async (cycle: EvidenceWatchCycle): Promise<void> => {
              ++published;
              TestValidator.equals(
                "complete source snapshot",
                cycle.status,
                "complete",
              );
              const executions: number = (
                await readFile(join(directory, "executions.log"), "utf8")
              )
                .trim()
                .split("\n").length;
              if (cycle.cycle === 1) {
                TestValidator.equals(
                  "first discovery evaluated once",
                  executions,
                  1,
                );
                await EvidenceTestFileSystem.save(directory, {
                  "project/docs/second.md": dedent`
              ## Second
              Body.
            `,
                });
              } else if (cycle.cycle === 2) {
                TestValidator.equals(
                  "new glob member evaluated once",
                  executions,
                  2,
                );
                await EvidenceTestFileSystem.save(directory, {
                  "project/evidence.config.ts": configuration(python),
                  "project/docs/final.py": dedent`
                def initial():
                    return 1
              `,
                });
              } else {
                TestValidator.equals(
                  "source changed during extraction",
                  torn,
                  true,
                );
                TestValidator.equals(
                  "torn snapshot evaluated again",
                  executions,
                  4,
                );
                await watcher.close();
              }
            }),
        );
        TestValidator.equals("all expected cycles published", published, 3);
      } finally {
        clearTimeout(timeout);
        await watcher.close();
      }
    },
  );
}

/** Records an observable evaluation without modifying the checker. */
function configuration(config: IEvidenceConfig): string {
  return dedent`
    import { appendFile } from "node:fs/promises";
    import { join } from "node:path";
    void appendFile(join(__dirname, "..", "executions.log"), "evaluation\\n");
    export default ${JSON.stringify(config)};
  `;
}
