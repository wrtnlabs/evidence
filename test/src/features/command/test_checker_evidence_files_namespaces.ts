import { EvidenceChecker } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckAnalysis,
  IEvidenceConfig,
  IEvidenceDiagnostic,
  IEvidenceGraphEdge,
  IEvidenceProgrammingClaim,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Names namespace members as separate-evidence owners in every language with a
 * namespace-like container.
 *
 * 1. For each of fourteen languages, declare types, functions, properties,
 *    constants and nested members inside its namespace, module, package,
 *    object, extension, category, module table or package folder.
 * 2. Answer one checklist item for every selected host from a separate document
 *    whose H1 is the member's qualified address, alternating `@evidence` and
 *    `@evidenceExclude`.
 *
 *    - Require no diagnostic.
 *    - Require exactly one accepted edge per selected host.
 * 3. Where the container is an address-only scope, add an H1 naming the scope and
 *    require an `unsupported-host` owner error with a repair naming a
 *    declaration inside it.
 * 4. Select only TypeScript functions and require exactly the type and property
 *    H1s to be reported with a status meaning nothing selected owns them.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs EvidenceChecker on real configurations for fourteen languages and asserts empty diagnostics, one accepted edge per selected host, and owner diagnostics with their statuses for scope and unselected owners; it catches qualified member addresses that fail to bind, bind to the wrong host, or let a scope or unselected unit own evidence.
 * @evidence contracts/testing.md#independent-expectations Every owner address is written from the README's per-language address rules, such as Class.prototype.member in TypeScript, Shop.Orders.SomeType.$value in PHP, demo["object Something"] in Scala and ["Value(Numbers)"]["-run"] in Objective-C; the README states that namespaces, modules, extensions and categories are address-only scopes that host no evidence, while objects, Ruby modules and Zig containers remain types, and its outcome table gives missing-member and out-of-population as the statuses for an address nothing selected owns.
 * @evidence contracts/testing.md#distinguishing-cases Covers namespace, nested namespace, module, package, object, extension, category, module table and package-folder containers, each with members of every extracted kind, scope owners beside type containers that are hosts, and selected beside unselected TypeScript owners; positive detached policies belong to test_checker_evidence_files_policies and exclusion policies to test_checker_evidence_files_exclusions.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers this exported test, which calls EvidenceChecker in-process on configurations written by EvidenceTestFileSystem.
 */
export async function test_checker_evidence_files_namespaces(): Promise<void> {
  // [file, source, selected owner addresses, address-only scope addresses]
  const cases: Map<
    IEvidenceProgrammingClaim["type"],
    readonly [string, string, string[], string[]]
  > = new Map([
    [
      "typescript",
      [
        "src/contract.ts",
        dedent`
          export namespace Something {
            export function someFunction(): void {}
            export const someArrow = (): void => {};
            export interface SomeType {
              value: number;
            }
            export type SomeAlias = string;
            export const someVariable: number = 1;
            export class SomeClass {
              public run(): void {}
              public static make(): void {}
            }
            export namespace Inner {
              export function deep(): void {}
            }
          }
        `,
        [
          "Something.someFunction",
          "Something.someArrow",
          "Something.SomeType",
          "Something.SomeType.value",
          "Something.SomeAlias",
          "Something.someVariable",
          "Something.SomeClass",
          "Something.SomeClass.prototype.run",
          "Something.SomeClass.make",
          "Something.Inner.deep",
        ],
        ["Something", "Something.Inner"],
      ],
    ],
    [
      "cpp",
      [
        "src/contract.hpp",
        dedent`
          namespace something {
          struct SomeType {
            int value;
          };
          void someFunction();
          extern int someVariable;
          namespace inner {
          void deep();
          }
          }
        `,
        [
          "something.SomeType",
          "something.SomeType.value",
          "something.someFunction",
          "something.someVariable",
          "something.inner.deep",
        ],
        ["something", "something.inner"],
      ],
    ],
    [
      "csharp",
      [
        "src/Contract.cs",
        dedent`
          namespace Shop.Orders {
            public class SomeType {
              public int Value;
              public void Run() {}
              public static int Count = 0;
            }
            namespace Inner {
              public static class Helpers {
                public static void Deep() {}
              }
            }
          }
        `,
        [
          "Shop.Orders.SomeType",
          "Shop.Orders.SomeType.Value",
          "Shop.Orders.SomeType.Run",
          "Shop.Orders.SomeType.Count",
          "Shop.Orders.Inner.Helpers",
          "Shop.Orders.Inner.Helpers.Deep",
        ],
        [],
      ],
    ],
    [
      "rust",
      [
        "src/lib.rs",
        dedent`
          pub mod something {
              pub struct SomeType {
                  pub value: usize,
              }
              pub fn some_function() {}
              pub const SOME_CONSTANT: usize = 1;
              pub static SOME_STATIC: usize = 1;
              pub mod inner {
                  pub fn deep() {}
              }
          }
        `,
        [
          "something.SomeType",
          "something.SomeType.value",
          "something.some_function",
          "something.SOME_CONSTANT",
          "something.SOME_STATIC",
          "something.inner.deep",
        ],
        ["something", "something.inner"],
      ],
    ],
    [
      "php",
      [
        "src/contract.php",
        [
          "<?php",
          "namespace App\\Orders;",
          "",
          "class SomeType {",
          "    public int $value = 0;",
          "    public function run(): void {}",
          "}",
          "",
          "function some_function(): void {}",
          "",
          "const SOME_CONSTANT = 1;",
          "",
        ].join("\n"),
        [
          "App.Orders.SomeType",
          "App.Orders.SomeType.$value",
          "App.Orders.SomeType.run",
          "App.Orders.some_function",
          "App.Orders.SOME_CONSTANT",
        ],
        [],
      ],
    ],
    [
      "scala",
      [
        "src/Contract.scala",
        dedent`
          package demo

          object Something {
            def someFunction(): Unit = ()
            val someVariable: Int = 1
            class SomeType {
              def run(): Unit = ()
            }
          }
        `,
        [
          'demo["object Something"]',
          'demo["object Something"].someFunction',
          'demo["object Something"].someVariable',
          'demo["object Something"].SomeType',
          'demo["object Something"].SomeType.run',
        ],
        [],
      ],
    ],
    [
      "kotlin",
      [
        "src/Contract.kt",
        dedent`
          package demo

          object Something {
              fun someFunction() {}
              val someVariable: Int = 1
              class SomeType {
                  fun run() {}
              }
          }
        `,
        [
          "Something",
          "Something.someFunction",
          "Something.someVariable",
          "Something.SomeType",
          "Something.SomeType.run",
        ],
        [],
      ],
    ],
    [
      "ruby",
      [
        "src/contract.rb",
        dedent`
          module Something
            SOME_CONSTANT = 1

            def self.some_function; end

            class SomeType
              def run; end
            end
          end
        `,
        [
          "Something",
          "Something.SOME_CONSTANT",
          "Something.self.some_function",
          "Something.SomeType",
          "Something.SomeType.run",
        ],
        [],
      ],
    ],
    [
      "zig",
      [
        "src/contract.zig",
        dedent`
          pub const Something = struct {
              pub const some_variable: u32 = 1;
              pub fn someFunction() void {}
              pub const Inner = struct {
                  pub fn deep() void {}
              };
          };
        `,
        [
          "Something",
          "Something.some_variable",
          "Something.someFunction",
          "Something.Inner",
          "Something.Inner.deep",
        ],
        [],
      ],
    ],
    [
      "dart",
      [
        "src/contract.dart",
        dedent`
          class Value {
            int value = 0;
          }
          extension Numbers on int {
            int run() => this;
          }
        `,
        ["Value", "Value.value", "Numbers.run"],
        ["Numbers"],
      ],
    ],
    [
      "objc",
      [
        "src/contract.h",
        dedent`
          @interface Value
          @property int value;
          @end
          @interface Value (Numbers)
          - (int)run;
          @end
        `,
        ["Value", "Value.value", '["Value(Numbers)"]["-run"]'],
        ['["Value(Numbers)"]'],
      ],
    ],
    [
      "swift",
      [
        "src/contract.swift",
        dedent`
          public struct Value {
            public var value = 0
          }
          public extension Value {
            func run() {}
          }
        `,
        ["Value", "Value.value", "Value.run"],
        [],
      ],
    ],
    [
      "lua",
      [
        "src/contract.lua",
        dedent`
          local M = {}

          function M.run() end

          M.value = 1

          return M
        `,
        ["module", "module.run", "module.value"],
        [],
      ],
    ],
    [
      "matlab",
      [
        "src/+pkg/helper.m",
        dedent`
          function helper()
          end
        `,
        ["pkg.helper"],
        [],
      ],
    ],
  ]);
  for (const [type, [file, source, owners, scopes]] of cases)
    await EvidenceTestFileSystem.experiment(
      join(__dirname, `evidence-files-namespaces-${type}-${randomUUID()}`),
      {
        "rules.md": "## Rule {#rule}\n\nImplement the declaration.\n",
        [file]: source,
        "evidence/statements.md": statements(file, owners),
      },
      async (directory: string): Promise<void> => {
        await configure(directory, type, undefined);
        const answered: IEvidenceCheckAnalysis = await EvidenceChecker.analyze(
          join(directory, "evidence.config.json"),
        );
        TestValidator.equals(
          `${type} member owners`,
          answered.report.diagnostics,
          [],
        );
        const edges: IEvidenceGraphEdge[] =
          answered.graph.claims[0]?.obligations[0]?.edges ?? [];
        const hosts: string[] = answered.graphInput.claims[0]?.unitIds ?? [];
        TestValidator.equals(`${type} host count`, hosts.length, owners.length);
        TestValidator.equals(
          `${type} one edge per host`,
          hosts.map(
            (host: string): number =>
              edges.filter((edge: IEvidenceGraphEdge): boolean =>
                edge.hostUnitIds.includes(host),
              ).length,
          ),
          owners.map((): number => 1),
        );
        if (scopes.length === 0) return;

        await EvidenceTestFileSystem.save(directory, {
          "evidence/statements.md": statements(file, [...owners, ...scopes]),
        });
        const scoped: IEvidenceCheckAnalysis = await EvidenceChecker.analyze(
          join(directory, "evidence.config.json"),
        );
        TestValidator.equals(
          `${type} scope owners`,
          ownerErrors(scoped),
          scopes.map(
            (scope: string): string =>
              `${file}#${scope} (unsupported-host) Name a declaration inside this address-only scope; a namespace, module, extension or category hosts no evidence.`,
          ),
        );
        TestValidator.equals(`${type} scope exit`, scoped.report.exitCode, 2);
      },
    );

  const [file, source, owners] = cases.get("typescript") ?? [];
  if (file === undefined || source === undefined || owners === undefined)
    throw new Error("Missing TypeScript namespace fixture.");
  await EvidenceTestFileSystem.experiment(
    join(__dirname, `evidence-files-namespaces-selection-${randomUUID()}`),
    {
      "rules.md": "## Rule {#rule}\n\nImplement the declaration.\n",
      [file]: source,
      "evidence/statements.md": statements(file, owners),
    },
    async (directory: string): Promise<void> => {
      await configure(directory, "typescript", "function");
      const functions: IEvidenceCheckAnalysis = await EvidenceChecker.analyze(
        join(directory, "evidence.config.json"),
      );
      const unselected: string[] = ownerErrors(functions);
      TestValidator.equals(
        "unselected member owners",
        unselected.map((entry: string): string =>
          entry.slice(0, entry.indexOf(" (")),
        ),
        [
          "Something.SomeType",
          "Something.SomeType.value",
          "Something.SomeAlias",
          "Something.someVariable",
          "Something.SomeClass",
        ].map((owner: string): string => `${file}#${owner}`),
      );
      TestValidator.predicate(
        "unselected owners are owned by nothing selected",
        unselected.every(
          (entry: string): boolean =>
            entry.includes(" (missing-member) ") ||
            entry.includes(" (out-of-population) "),
        ),
      );
    },
  );
}

/**
 * Writes a checklist configuration for one language, optionally narrowed to one
 * symbol kind.
 */
async function configure(
  directory: string,
  type: IEvidenceProgrammingClaim["type"],
  symbol: IEvidenceProgrammingClaim["symbol"],
): Promise<void> {
  const config: IEvidenceConfig = {
    claims: [
      {
        type,
        files: ["src/**/*"],
        ...(symbol === undefined ? {} : { symbol }),
        evidenceFiles: ["evidence/*.md"],
        reference: {
          type: "markdown",
          files: ["rules.md"],
          symbol: "h2",
          checklist: true,
        },
      },
    ],
  };
  await EvidenceTestFileSystem.save(directory, {
    "evidence.config.json": JSON.stringify(config),
  });
}

/**
 * Renders one H1 section per owner, alternating positive evidence and exclusion
 * headings.
 */
function statements(file: string, owners: string[]): string {
  return owners
    .map((owner: string, index: number): string =>
      [
        `# ${file}#${owner}`,
        "",
        `## ${index % 2 === 0 ? "@evidence" : "@evidenceExclude"} rules.md#rule`,
        "",
        `Answers the rule for ${owner}.`,
        "",
      ].join("\n"),
    )
    .join("\n");
}

/** Lists H1 owner errors as their address, status and repair. */
function ownerErrors(analysis: IEvidenceCheckAnalysis): string[] {
  return analysis.report.diagnostics
    .filter(
      (diagnostic: IEvidenceDiagnostic): boolean =>
        diagnostic.code === "evidence-files-owner",
    )
    .map((diagnostic: IEvidenceDiagnostic): string => {
      const owner: string =
        /H1 owner '(.*)' does not name/u.exec(diagnostic.message)?.[1] ??
        diagnostic.message;
      const status: string =
        /\(([a-z-]+)\)\.$/u.exec(diagnostic.message)?.[1] ?? "";
      return `${owner} (${status}) ${diagnostic.repair ?? ""}`;
    });
}
