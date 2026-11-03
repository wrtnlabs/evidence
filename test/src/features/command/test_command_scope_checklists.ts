import { EvidenceChecker } from "@wrtnlabs/evidence";
import type {
  EvidenceProgrammingSymbol,
  IEvidenceCheckAnalysis,
  IEvidenceConfig,
  IEvidenceGraphClaim,
  IEvidenceProgrammingClaim,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Checks actual programming declarations without requiring container answers.
 *
 * Default and explicit symbol selections must agree with adapter classification
 * when namespaces, modules, categories, or extension containers surround code.
 *
 * 1. Create six language fixtures whose actual type, function, and property each
 *    answer one Markdown checklist item; leave every container unannotated.
 * 2. Keep acknowledgements only on the default, type, function, or property
 *    selection, then require success with three or one declaration IDs.
 * 3. Require no address scope to enter any selected claim population.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs EvidenceChecker against real configurations for six languages and asserts checklist success and exact selected declaration counts for defaults and each programming selector.
 * @evidence contracts/testing.md#independent-expectations Each fixture declares and acknowledges exactly one type, function and property. Containers introduce no checklist obligations or additional type hosts.
 * @evidence contracts/testing.md#distinguishing-cases Covers TypeScript and C++ namespaces, Rust modules, Dart ordinary extensions, Objective-C categories and anonymous extensions, and Swift extensions under default and every explicit programming selection. Adapter regressions own rejected container tags and withdrawals.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers test_command_scope_checklists; EvidenceTestFileSystem owns temporary files and the test calls EvidenceChecker in-process without spawning a CLI or installing a consumer.
 */
export async function test_command_scope_checklists(): Promise<void> {
  const cases: Map<IEvidenceProgrammingClaim["type"], string> = new Map([
    [
      "typescript",
      dedent`
      export namespace Empty {}
      export namespace api {
        /** @evidence checklist.md#rule Implements the type. */
        export interface Value {
          /** @evidence checklist.md#rule Implements the property. */
          value: number;
        }
        /** @evidence checklist.md#rule Implements the function. */
        export function run(): void {}
      }
    `,
    ],
    [
      "cpp",
      dedent`
      namespace Empty {}
      namespace api {
        /** @evidence checklist.md#rule Implements the type. */
        struct Value {
          /** @evidence checklist.md#rule Implements the property. */
          int value;
        };
        /** @evidence checklist.md#rule Implements the function. */
        void run();
      }
    `,
    ],
    [
      "rust",
      dedent`
      pub mod Empty {}
      pub mod api {
        /// @evidence checklist.md#rule Implements the type.
        pub struct Value {
          /// @evidence checklist.md#rule Implements the property.
          pub value: usize,
        }
        /// @evidence checklist.md#rule Implements the function.
        pub fn run() {}
      }
    `,
    ],
    [
      "dart",
      dedent`
      /// @evidence checklist.md#rule Implements the type.
      class Value {
        /// @evidence checklist.md#rule Implements the property.
        int value = 0;
      }
      extension Numbers on int {
        /// @evidence checklist.md#rule Implements the function.
        int run() => this;
      }
    `,
    ],
    [
      "objc",
      dedent`
      /// @evidence checklist.md#rule Implements the type.
      @interface Value
      /// @evidence checklist.md#rule Implements the property.
      @property int value;
      @end
      @interface Value (Numbers)
      /// @evidence checklist.md#rule Implements the function.
      - (int)run;
      @end
      @interface Value ()
      @end
    `,
    ],
    [
      "swift",
      dedent`
      /// @evidence checklist.md#rule Implements the type.
      public struct Value {
        /// @evidence checklist.md#rule Implements the property.
        public var value = 0
      }
      public extension Value {
        /// @evidence checklist.md#rule Implements the function.
        func run() {}
      }
    `,
    ],
  ]);
  const symbols: (EvidenceProgrammingSymbol | undefined)[] = [
    undefined,
    "type",
    "function",
    "property",
  ];
  for (const [type, source] of cases) {
    const file: string = `src/contract.${type === "typescript" ? "ts" : type === "rust" ? "rs" : type === "objc" ? "h" : type}`;
    await EvidenceTestFileSystem.experiment(
      `scope checklists ${type}`,
      {
        "docs/checklist.md":
          "## Rule {#rule}\nImplement the selected declaration.\n",
        [file]: source,
      },
      async (directory: string): Promise<void> => {
        for (const symbol of symbols) {
          const selectedSource: string = source.replace(
            /@evidence checklist\.md#rule Implements the (type|function|property)\./gu,
            (tag: string, kind: string): string =>
              symbol === undefined || symbol === kind
                ? tag
                : `Documents the ${kind}.`,
          );
          const config: IEvidenceConfig = {
            claims: [
              {
                type,
                files: ["src/*"],
                ...(symbol === undefined ? {} : { symbol }),
                reference: {
                  type: "markdown",
                  root: "docs",
                  files: ["checklist.md"],
                  symbol: "h2",
                  checklist: true,
                },
              },
            ],
          };
          await EvidenceTestFileSystem.save(directory, {
            [file]: selectedSource,
            "evidence.config.json": JSON.stringify(config),
          });
          const analysis: IEvidenceCheckAnalysis =
            await EvidenceChecker.analyze(
              join(directory, "evidence.config.json"),
            );
          TestValidator.equals(
            `${type} ${symbol ?? "default"} checklist`,
            analysis.report.diagnostics,
            [],
          );
          TestValidator.equals(
            `${type} ${symbol ?? "default"} succeeds`,
            analysis.report.success,
            true,
          );
          const claims: IEvidenceGraphClaim[] = analysis.graphInput.claims;
          TestValidator.equals(
            `${type} ${symbol ?? "default"} actual declarations`,
            claims.flatMap(
              (claim: IEvidenceGraphClaim): string[] => claim.unitIds,
            ).length,
            symbol === undefined ? 3 : 1,
          );
          TestValidator.equals(
            `${type} ${symbol ?? "default"} excludes address scopes`,
            claims.some((claim: IEvidenceGraphClaim): boolean =>
              claim.inventory.units.some(
                (unit: IEvidenceUnit): boolean =>
                  unit.symbol === "scope" && claim.unitIds.includes(unit.id),
              ),
            ),
            false,
          );
        }
      },
    );
  }
}
