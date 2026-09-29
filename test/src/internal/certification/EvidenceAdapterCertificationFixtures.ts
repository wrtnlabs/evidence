import {
  EvidenceAccessor,
  EvidenceCAdapter,
  EvidenceCSharpAdapter,
  EvidenceCppAdapter,
  EvidenceGoAdapter,
  EvidenceJavaAdapter,
  EvidenceJavaScriptAdapter,
  EvidenceKotlinAdapter,
  EvidenceObjcAdapter,
  EvidenceDartAdapter,
  EvidenceScalaAdapter,
  EvidenceMatlabAdapter,
  EvidenceSwiftAdapter,
  EvidencePhpAdapter,
  EvidencePythonAdapter,
  EvidenceRubyAdapter,
  EvidenceRustAdapter,
  EvidenceTypeScriptAdapter,
  EvidenceZigAdapter,
} from "@wrtnlabs/evidence";
import type {
  EvidenceProgrammingSymbol,
  IEvidenceWithdrawal,
} from "@wrtnlabs/evidence";
import { dedent } from "@typia/utils";

import { EvidenceLuaCertificationFixture } from "./EvidenceLuaCertificationFixture";
import type { IEvidenceAdapterCertification } from "./IEvidenceAdapterCertification";
import type { IEvidenceAdapterCertificationAddress } from "./IEvidenceAdapterCertificationAddress";
import type { IEvidenceAdapterCertificationRequirement } from "./IEvidenceAdapterCertificationRequirement";
import type { IEvidenceAdapterCertificationUnit } from "./IEvidenceAdapterCertificationUnit";

/**
 * Supplies the complete fixture contract for every initially certified
 * language.
 */
export namespace EvidenceAdapterCertificationFixtures {
  export function all(): IEvidenceAdapterCertification[] {
    return [
      typescript(),
      javascript(),
      python(),
      go(),
      rust(),
      java(),
      kotlin(),
      objc(),
      EvidenceLuaCertificationFixture.create(),
      dart(),
      zig(),
      scala(),
      matlab(),
      swift(),
      php(),
      csharp(),
      c(),
      cpp(),
      ruby(),
    ];
  }

  function objc(): IEvidenceAdapterCertification {
    const file = "src/Contract.h";
    return {
      type: "objc",
      adapter: new EvidenceObjcAdapter(),
      sources: [
        {
          file,
          content: dedent`
        /**
         * 계약 😀
         * @evidence docs/requirements.md#type Implements the certified type.
         */
        @interface Contract {
          @private int hidden;
        }
        /**
         * 실행
         * @evidence docs/requirements.md#function Implements the certified function.
         */
        - (int)run;
        /**
         * 값
         * @evidence docs/requirements.md#property Implements the certified property.
         */
        @property int value;
        /** @internal Retired public contract. */
        @property int legacy;
        @end
      `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "-run"], ["Contract"]),
        unit(file, "property", ["Contract", "value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "legacy"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "-run"]),
        key("property", ["Contract", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "-run"]),
        key("property", ["Contract", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "ivar:hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/Conditional.h",
            content: "#if FEATURE\n@interface Conditional\n@end\n#endif\n",
          },
        ],
        diagnosticCodes: ["objc-surface"],
      },
      malformed: {
        sources: [
          {
            file: "src/Malformed.m",
            content: "@interface Broken\n- (void)run\n",
          },
        ],
        diagnosticCodes: ["objc-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/FalsePositive.m",
          content: dedent`
          /** @evidence docs/requirements.md#attached Attached documentation. */
          const char *run(void) {
            // @evidence docs/requirements.md#comment Ordinary comments are inert.
            return "@evidence docs/requirements.md#literal Literal text is inert.";
          }
        `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 1,
      },
      mutation: mutation(
        key("function", ["Contract", "-run"]),
        "- (int)run;",
        "- (long)run;",
      ),
    };
  }

  function typescript(): IEvidenceAdapterCertification {
    const file = "src/certification.ts";
    return {
      type: "typescript",
      adapter: new EvidenceTypeScriptAdapter(),
      sources: [
        {
          file,
          content: dedent`
            /**
             * 계약 한글
             * @evidence docs/requirements.md#type Implements the certified type.
             */
            export class Contract {
              /**
               * 실행 한글
               * @evidence docs/requirements.md#function Implements the certified function.
               */
              public run(): number { return 1; }

              /**
               * 값 한글
               * @evidence docs/requirements.md#property Implements the certified property.
               */
              public value = 1;

              private hidden = 0;

              /** @internal Retired public contract. */
              public legacy = 1;
            }

            export { Contract as ContractAlias };
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"], undefined, [["ContractAlias"]]),
        unit(
          file,
          "function",
          ["Contract", "prototype", "run"],
          ["Contract"],
          [["ContractAlias", "prototype", "run"]],
        ),
        unit(
          file,
          "property",
          ["Contract", "prototype", "value"],
          ["Contract"],
          [["ContractAlias", "prototype", "value"]],
        ),
        unit(
          file,
          "property",
          ["Contract", "prototype", "legacy"],
          ["Contract"],
          [["ContractAlias", "prototype", "legacy"]],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "prototype", "run"]),
        key("property", ["Contract", "prototype", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "prototype", "run"]),
        key("property", ["Contract", "prototype", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "prototype", "hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/incomplete.ts",
            content: "const contract = {}; export = contract;",
          },
        ],
        diagnosticCodes: ["typescript-export-assignment"],
      },
      malformed: {
        sources: [
          { file: "src/malformed.ts", content: "export interface Broken {" },
        ],
        diagnosticCodes: ["typescript-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/false-positive.ts",
          content: dedent`
            /** @evidence docs/requirements.md#attached Attached documentation. */
            export function run(): string {
              // @evidence docs/requirements.md#comment Ordinary comments are inert.
              return "@evidence docs/requirements.md#literal Literal text is inert.";
            }
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 1,
      },
      mutation: mutation(
        key("function", ["Contract", "prototype", "run"]),
        "public run(): number { return 1; }",
        "public run(): number { return 2; }",
      ),
    };
  }

  function javascript(): IEvidenceAdapterCertification {
    const file = "src/certification.mjs";
    return {
      type: "javascript",
      adapter: new EvidenceJavaScriptAdapter(),
      sources: [
        {
          file,
          content: dedent`
            /**
             * 계약 한글
             * @evidence docs/requirements.md#type Implements the certified type.
             */
            export class Contract {
              /**
               * 실행 한글
               * @evidence docs/requirements.md#function Implements the certified function.
               */
              run() { return 1; }

              /**
               * 값 한글
               * @evidence docs/requirements.md#property Implements the certified property.
               */
              value = 1;

              #hidden = 0;

              /** @internal Retired public contract. */
              legacy = 1;
            }
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "prototype", "run"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "prototype", "value"],
          ["Contract"],
        ),
        unit(
          file,
          "property",
          ["Contract", "prototype", "legacy"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "prototype", "run"]),
        key("property", ["Contract", "prototype", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "prototype", "run"]),
        key("property", ["Contract", "prototype", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "prototype", "hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/incomplete.cjs",
            content: dedent`
              const name = "run";
              function run() {}
              exports[name] = run;
            `,
          },
        ],
        diagnosticCodes: ["javascript-commonjs-computed"],
      },
      malformed: {
        sources: [
          { file: "src/malformed.mjs", content: "export class Broken {" },
        ],
        diagnosticCodes: ["javascript-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/false-positive.mjs",
          content: dedent`
            /** @evidence docs/requirements.md#attached Attached documentation. */
            export function run() {
              // @evidence docs/requirements.md#comment Ordinary comments are inert.
              return "@evidence docs/requirements.md#literal Literal text is inert.";
            }
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 1,
      },
      mutation: mutation(
        key("function", ["Contract", "prototype", "run"]),
        "run() { return 1; }",
        "run() { return 2; }",
      ),
    };
  }

  function python(): IEvidenceAdapterCertification {
    const file = "src/certification.py";
    return {
      type: "python",
      adapter: new EvidencePythonAdapter(),
      sources: [
        {
          file,
          content: dedent`
            # 계약 한글
            # @evidence docs/requirements.md#type Implements the certified type.
            class Contract:
                def run(self):
                    """
                    실행 한글
                    @evidence docs/requirements.md#function Implements the certified function.
                    """
                    return 1

                # 값 한글
                # @evidence docs/requirements.md#property Implements the certified property.
                value = 1

                _hidden = 0

                # @internal Retired public contract.
                legacy = 1
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "prototype", "run"], ["Contract"]),
        unit(file, "property", ["Contract", "value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "legacy"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "prototype", "run"]),
        key("property", ["Contract", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "prototype", "run"]),
        key("property", ["Contract", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "_hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/incomplete.py",
            content: dedent`
              public = 1
              __all__ = ["public"]
              __all__.append(runtime_name)
            `,
          },
        ],
        diagnosticCodes: ["python-dynamic-all"],
      },
      malformed: {
        sources: [
          { file: "src/malformed.py", content: "def broken(:\n    pass\n" },
        ],
        diagnosticCodes: ["python-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/false-positive.py",
          content: dedent`
            # @evidence docs/requirements.md#attached Attached documentation.
            def run():
                # @evidence docs/requirements.md#comment Body comments cannot host evidence.
                return "@evidence docs/requirements.md#literal Literal text is inert."
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        // Both the first body comment and returned string are unsupported carriers.
        unsupportedAnnotations: 2,
      },
      mutation: mutation(
        key("function", ["Contract", "prototype", "run"]),
        "return 1",
        "return 2",
      ),
    };
  }

  function go(): IEvidenceAdapterCertification {
    const file = "src/certification.go";
    return {
      type: "go",
      adapter: new EvidenceGoAdapter(),
      sources: [
        {
          file,
          content: dedent`
            package certification

            // 계약 한글
            // @evidence docs/requirements.md#type Implements the certified type.
            type Contract struct {
                // 값 한글
                // @evidence docs/requirements.md#property Implements the certified property.
                Value int
                hidden int
            }

            // 실행 한글
            // @evidence docs/requirements.md#function Implements the certified function.
            func (Contract) Run() int { return 1 }

            // @internal Retired public contract.
            var Legacy = 1
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"], undefined, [], [], 2),
        unit(file, "function", ["Contract", "Run"], ["Contract"]),
        unit(file, "property", ["Contract", "Value"], ["Contract"]),
        unit(file, "property", ["Legacy"], undefined, [], ["internal"], 2),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "Run"]),
        key("property", ["Contract", "Value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "Run"]),
        key("property", ["Contract", "Value"]),
      ),
      excludedUnits: [key("property", ["Contract", "hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/incomplete.go",
            content: "package certification\nfunc (Missing) Run() {}\n",
          },
        ],
        diagnosticCodes: ["go-receiver"],
      },
      malformed: {
        sources: [
          {
            file: "src/malformed.go",
            content: "package certification\nfunc Broken( {\n",
          },
        ],
        diagnosticCodes: ["go-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/false-positive.go",
          content: dedent`
            package certification

            // @evidence docs/requirements.md#attached Attached documentation.
            func Run() string {
                // @evidence docs/requirements.md#comment Body comments are inert.
                return "@evidence docs/requirements.md#literal Literal text is inert."
            }
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 1,
      },
      mutation: mutation(
        key("function", ["Contract", "Run"]),
        "func (Contract) Run() int { return 1 }",
        "func (Contract) Run() int { return 2 }",
      ),
    };
  }

  function rust(): IEvidenceAdapterCertification {
    const file = "src/certification.rs";
    return {
      type: "rust",
      adapter: new EvidenceRustAdapter(),
      sources: [
        {
          file,
          content: dedent`
            /// 계약 한글
            /// @evidence docs/requirements.md#type Implements the certified type.
            pub struct Contract {
                /// 값 한글
                /// @evidence docs/requirements.md#property Implements the certified property.
                pub value: i32,
                hidden: i32,
            }

            impl Contract {
                /// 실행 한글
                /// @evidence docs/requirements.md#function Implements the certified function.
                pub fn run(&self) -> i32 { 1 }

                /// @internal Retired public contract.
                pub const LEGACY: i32 = 1;
            }
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "run"], ["Contract"]),
        unit(file, "property", ["Contract", "value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "LEGACY"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/incomplete.rs",
            content: dedent`
              #[cfg(feature = "conditional")]
              pub struct Conditional;
            `,
          },
        ],
        diagnosticCodes: ["rust-conditional-item"],
      },
      malformed: {
        sources: [{ file: "src/malformed.rs", content: "pub fn broken( {\n" }],
        diagnosticCodes: ["rust-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/false-positive.rs",
          content: dedent`
            /// @evidence docs/requirements.md#attached Attached documentation.
            pub fn run() -> &'static str {
                // @evidence docs/requirements.md#comment Ordinary comments are inert.
                "@evidence docs/requirements.md#literal Literal text is inert."
            }
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 2,
      },
      mutation: mutation(
        key("function", ["Contract", "run"]),
        "pub fn run(&self) -> i32 { 1 }",
        "pub fn run(&self) -> i32 { 2 }",
      ),
    };
  }

  function php(): IEvidenceAdapterCertification {
    const file = "src/Contract.php";
    return {
      type: "php",
      adapter: new EvidencePhpAdapter(),
      sources: [
        {
          file,
          content: dedent`
            <?php
            /**
             * 계약 한글
             * @evidence docs/requirements.md#type Implements the certified type.
             */
            class Contract {
                /**
                 * 실행 한글
                 * @evidence docs/requirements.md#function Implements the certified function.
                 */
                public function run() { return 1; }

                /**
                 * 값 한글
                 * @evidence docs/requirements.md#property Implements the certified property.
                 */
                public int $value = 1;

                private int $hidden = 0;

                /** @internal Retired public contract. */
                public const LEGACY = 1;
            }
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "run"], ["Contract"]),
        unit(file, "property", ["Contract", "$value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "LEGACY"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "$value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "$value"]),
      ),
      excludedUnits: [key("property", ["Contract", "$hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/first/Conflict.php",
            content: "<?php class Conflict {}\n",
          },
          {
            file: "src/second/Conflict.php",
            content: "<?php class Conflict {}\n",
          },
        ],
        diagnosticCodes: ["php-declaration-conflict"],
      },
      malformed: {
        sources: [
          {
            file: "src/Malformed.php",
            content: "<?php class Malformed { public void run( { }\n",
          },
        ],
        diagnosticCodes: ["php-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/FalsePositive.php",
          content: dedent`
            <?php
            class FalsePositive {
                /** @evidence docs/requirements.md#attached Attached documentation. */
                public function run() {
                    // @evidence docs/requirements.md#comment Ordinary comments are inert.
                    return "@evidence docs/requirements.md#literal Literal text is inert.";
                }
            }
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 0,
      },
      mutation: mutation(
        key("function", ["Contract", "run"]),
        "public function run() { return 1; }",
        "public function run() { return 2; }",
      ),
    };
  }

  function java(): IEvidenceAdapterCertification {
    const file = "src/Contract.java";
    return {
      type: "java",
      adapter: new EvidenceJavaAdapter(),
      sources: [
        {
          file,
          content: dedent`
            /**
             * 계약 한글
             * @evidence docs/requirements.md#type Implements the certified type.
             */
            public class Contract {
                /**
                 * 실행 한글
                 * @evidence docs/requirements.md#function Implements the certified function.
                 */
                public int run() { return 1; }

                /**
                 * 값 한글
                 * @evidence docs/requirements.md#property Implements the certified property.
                 */
                public int value = 1;

                private int hidden = 0;

                /** @internal Retired public contract. */
                public static final int LEGACY = 1;
            }
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "run"], ["Contract"]),
        unit(file, "property", ["Contract", "value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "LEGACY"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/first/Conflict.java",
            content: "public class Conflict {}\n",
          },
          {
            file: "src/second/Conflict.java",
            content: "public class Conflict {}\n",
          },
        ],
        diagnosticCodes: ["java-declaration-conflict"],
      },
      malformed: {
        sources: [
          {
            file: "src/Malformed.java",
            content: "public class Malformed { public void run( { }\n",
          },
        ],
        diagnosticCodes: ["java-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/FalsePositive.java",
          content: dedent`
            public class FalsePositive {
                /** @evidence docs/requirements.md#attached Attached documentation. */
                public String run() {
                    // @evidence docs/requirements.md#comment Ordinary comments are inert.
                    return "@evidence docs/requirements.md#literal Literal text is inert.";
                }
            }
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 2,
      },
      mutation: mutation(
        key("function", ["Contract", "run"]),
        "public int run() { return 1; }",
        "public int run() { return 2; }",
      ),
    };
  }

  /**
   * Supplies exact Dart declarations and counterexamples for the common
   * certification gates.
   */
  function dart(): IEvidenceAdapterCertification {
    const file = "src/Contract.dart";
    return {
      type: "dart",
      adapter: new EvidenceDartAdapter(),
      sources: [
        {
          file,
          content: dedent`
            /**
             * 계약 한글
             * @evidence docs/requirements.md#type Implements the certified type.
             */
            class Contract {
                /**
                 * 실행 한글
                 * @evidence docs/requirements.md#function Implements the certified function.
                 */
                int run() { return 1; }

                /**
                 * 값 한글
                 * @evidence docs/requirements.md#property Implements the certified property.
                 */
                final value = 1;

                final _hidden = 0;

                /** @internal Retired public contract. */
                final LEGACY = 1;
            }
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "run"], ["Contract"]),
        unit(file, "property", ["Contract", "value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "LEGACY"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "_hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/first/Conflict.dart",
            content: "class Conflict {} class Conflict {}\n",
          },
          {
            file: "src/second/Conflict.dart",
            content: "class Conflict {}\n",
          },
        ],
        diagnosticCodes: ["dart-declaration-conflict"],
      },
      malformed: {
        sources: [
          {
            file: "src/Malformed.dart",
            content: "class Malformed { run( { }\n",
          },
        ],
        diagnosticCodes: ["dart-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/FalsePositive.dart",
          content: dedent`
            class FalsePositive {
                /** @evidence docs/requirements.md#attached Attached documentation. */
                String run() {
                    // @evidence docs/requirements.md#comment Ordinary comments are inert.
                    return "@evidence docs/requirements.md#literal Literal text is inert.";
                }
            }
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 2,
      },
      mutation: mutation(
        key("function", ["Contract", "run"]),
        "int run() { return 1; }",
        "int run() { return 2; }",
      ),
    };
  }

  /**
   * Supplies exact Kotlin declarations and counterexamples for the common
   * certification gates.
   */
  function kotlin(): IEvidenceAdapterCertification {
    const file = "src/Contract.kt";
    return {
      type: "kotlin",
      adapter: new EvidenceKotlinAdapter(),
      sources: [
        {
          file,
          content: dedent`
            /**
             * 계약 한글
             * @evidence docs/requirements.md#type Implements the certified type.
             */
            class Contract {
                /**
                 * 실행 한글
                 * @evidence docs/requirements.md#function Implements the certified function.
                 */
                fun run(): Int { return 1 }

                /**
                 * 값 한글
                 * @evidence docs/requirements.md#property Implements the certified property.
                 */
                val value = 1

                private val hidden = 0

                /** @internal Retired public contract. */
                val LEGACY = 1
            }
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "run"], ["Contract"]),
        unit(file, "property", ["Contract", "value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "LEGACY"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/first/Conflict.kt",
            content: "class Conflict {}\n",
          },
          {
            file: "src/second/Conflict.kt",
            content: "class Conflict {}\n",
          },
        ],
        diagnosticCodes: ["kotlin-declaration-conflict"],
      },
      malformed: {
        sources: [
          {
            file: "src/Malformed.kt",
            content: "class Malformed { fun run( { }\n",
          },
        ],
        diagnosticCodes: ["kotlin-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/FalsePositive.kt",
          content: dedent`
            class FalsePositive {
                /** @evidence docs/requirements.md#attached Attached documentation. */
                fun run(): String {
                    // @evidence docs/requirements.md#comment Ordinary comments are inert.
                    return "@evidence docs/requirements.md#literal Literal text is inert."
                }
            }
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 2,
      },
      mutation: mutation(
        key("function", ["Contract", "run"]),
        "fun run(): Int { return 1 }",
        "fun run(): Int { return 2 }",
      ),
    };
  }

  function swift(): IEvidenceAdapterCertification {
    const file = "src/Contract.swift";
    return {
      type: "swift",
      adapter: new EvidenceSwiftAdapter(),
      sources: [
        {
          file,
          content: dedent`
            /**
             * 계약 한글
             * @evidence docs/requirements.md#type Implements the certified type.
             */
            public struct Contract {
                /**
                 * 실행 한글
                 * @evidence docs/requirements.md#function Implements the certified function.
                 */
                public func run() -> Int { return 1 }

                /**
                 * 값 한글
                 * @evidence docs/requirements.md#property Implements the certified property.
                 */
                public let value = 1

                private let hidden = 0

                /** @internal Retired public contract. */
                public let LEGACY = 1
            }
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "run"], ["Contract"]),
        unit(file, "property", ["Contract", "value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "LEGACY"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/first/Conflict.swift",
            content: "public struct Conflict {}\n",
          },
          {
            file: "src/second/Conflict.swift",
            content: "public struct Conflict {}\n",
          },
        ],
        diagnosticCodes: ["swift-declaration-conflict"],
      },
      malformed: {
        sources: [
          {
            file: "src/Malformed.swift",
            content: "public struct Malformed { func run( { }\n",
          },
        ],
        diagnosticCodes: ["swift-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/FalsePositive.swift",
          content: dedent`
            public struct FalsePositive {
                /** @evidence docs/requirements.md#attached Attached documentation. */
                public func run() -> String {
                    // @evidence docs/requirements.md#comment Ordinary comments are inert.
                    return "@evidence docs/requirements.md#literal Literal text is inert."
                }
            }
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 2,
      },
      mutation: mutation(
        key("function", ["Contract", "run"]),
        "public func run() -> Int { return 1 }",
        "public func run() -> Int { return 2 }",
      ),
    };
  }

  /**
   * Supplies exact MATLAB declarations and counterexamples for the common
   * certification gates.
   */
  function matlab(): IEvidenceAdapterCertification {
    const file = "src/Contract.m";
    return {
      type: "matlab",
      adapter: new EvidenceMatlabAdapter(),
      sources: [
        {
          file,
          content: dedent`
            classdef Contract
              % 계약 한글
              % @evidence docs/requirements.md#type Implements the certified type.
              methods
                function value = run(obj)
                  % @evidence docs/requirements.md#function Implements the certified function.
                  value = 1;
                end
              end
              properties
                % @evidence docs/requirements.md#property Implements the certified property.
                value = 1
                % @internal Retired public contract.
                LEGACY = 1
              end
              properties (Access=private)
                hidden = 0
              end
            end
          `.concat("\n"),
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "run"], ["Contract"]),
        unit(file, "property", ["Contract", "value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "LEGACY"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/Dynamic.m",
            content: "classdef Dynamic < dynamicprops\nend\n",
          },
        ],
        diagnosticCodes: ["matlab-dynamic-surface"],
      },
      malformed: {
        sources: [
          {
            file: "src/Malformed.m",
            content: "classdef Malformed\nproperties\nvalue\n",
          },
        ],
        diagnosticCodes: ["matlab-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/run.m",
          content: dedent`
            function value = run()
              % @evidence docs/requirements.md#attached Attached documentation.
              value = "@evidence docs/requirements.md#literal Literal text is inert.";
              % @evidence docs/requirements.md#comment Body comments are inert.
            end
          `.concat("\n"),
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 0,
      },
      mutation: mutation(
        key("function", ["Contract", "run"]),
        "value = 1;",
        "value = 2;",
      ),
    };
  }

  /**
   * Supplies exact Scala declarations and counterexamples for the common
   * certification gates.
   */
  function scala(): IEvidenceAdapterCertification {
    const file = "src/Contract.scala";
    return {
      type: "scala",
      adapter: new EvidenceScalaAdapter(),
      sources: [
        {
          file,
          content: dedent`
            /**
             * 계약 한글
             * @evidence docs/requirements.md#type Implements the certified type.
             */
            class Contract {
                /**
                 * 실행 한글
                 * @evidence docs/requirements.md#function Implements the certified function.
                 */
                def run(): Int = { return 1 }

                /**
                 * 값 한글
                 * @evidence docs/requirements.md#property Implements the certified property.
                 */
                val value = 1

                private val hidden = 0

                /** @internal Retired public contract. */
                val LEGACY = 1
            }
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "run"], ["Contract"]),
        unit(file, "property", ["Contract", "value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "LEGACY"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/first/Conflict.scala",
            content: "class Conflict {}\n",
          },
          {
            file: "src/second/Conflict.scala",
            content: "class Conflict {}\n",
          },
        ],
        diagnosticCodes: ["scala-declaration-conflict"],
      },
      malformed: {
        sources: [
          {
            file: "src/Malformed.scala",
            content: "class Malformed { fun run( { }\n",
          },
        ],
        diagnosticCodes: ["scala-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/FalsePositive.scala",
          content: dedent`
            class FalsePositive {
                /** @evidence docs/requirements.md#attached Attached documentation. */
                def run(): String = {
                    // @evidence docs/requirements.md#comment Ordinary comments are inert.
                    return "@evidence docs/requirements.md#literal Literal text is inert."
                }
            }
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 2,
      },
      mutation: mutation(
        key("function", ["Contract", "run"]),
        "def run(): Int = { return 1 }",
        "def run(): Int = { return 2 }",
      ),
    };
  }

  function zig(): IEvidenceAdapterCertification {
    const file = "src/certification.zig";
    return {
      type: "zig",
      adapter: new EvidenceZigAdapter(),
      sources: [
        {
          file,
          content: dedent`
        /// 계약 🔎
        /// @evidence docs/requirements.md#type Implements the certified type.
        pub const Contract = struct {
          /// 계약 🔎
          /// @evidence docs/requirements.md#function Implements the certified function.
          pub fn run() i32 { return 1; }
          /// 값 🔎
          /// @evidence docs/requirements.md#property Implements the certified property.
          value: i32,
          const hidden = 0;
          /// @internal Retired public contract.
          pub const legacy = 1;
        };
      `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "run"], ["Contract"]),
        unit(file, "property", ["Contract", "value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "legacy"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/incomplete.zig",
            content: 'pub usingnamespace @import("other.zig");',
          },
        ],
        diagnosticCodes: ["zig-usingnamespace"],
      },
      malformed: {
        sources: [{ file: "src/malformed.zig", content: "pub fn broken( {" }],
        diagnosticCodes: ["zig-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/false-positive.zig",
          content: dedent`
          /// @evidence docs/requirements.md#attached Attached documentation.
          pub fn run() []const u8 {
            // @evidence docs/requirements.md#comment Ordinary comments are inert.
            return "@evidence docs/requirements.md#literal Literal text is inert.";
          }
        `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 2,
      },
      mutation: mutation(
        key("function", ["Contract", "run"]),
        "pub fn run() i32 { return 1; }",
        "pub fn run() i32 { return 2; }",
      ),
    };
  }

  function csharp(): IEvidenceAdapterCertification {
    const file = "src/Contract.cs";
    return {
      type: "csharp",
      adapter: new EvidenceCSharpAdapter(),
      sources: [
        {
          file,
          content: dedent`
            /// 계약 한글
            /// @evidence docs/requirements.md#type Implements the certified type.
            public class Contract
            {
                /// 실행 한글
                /// @evidence docs/requirements.md#function Implements the certified function.
                public int Run() { return 1; }

                /// 값 한글
                /// @evidence docs/requirements.md#property Implements the certified property.
                public int Value { get; set; } = 1;

                private int Hidden { get; set; }

                /// @internal Retired public contract.
                public int Legacy { get; set; } = 1;
            }
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "Run"], ["Contract"]),
        unit(file, "property", ["Contract", "Value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "Legacy"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "Run"]),
        key("property", ["Contract", "Value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "Run"]),
        key("property", ["Contract", "Value"]),
      ),
      excludedUnits: [key("property", ["Contract", "Hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/Incomplete.cs",
            content: dedent`
              #if DEBUG
              public class DebugContract { }
              #else
              public class ReleaseContract { }
              #endif
            `,
          },
        ],
        diagnosticCodes: ["csharp-preprocessor-conditional"],
      },
      malformed: {
        sources: [
          {
            file: "src/Malformed.cs",
            content: "public class Malformed { public void Run( { }\n",
          },
        ],
        diagnosticCodes: ["csharp-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/FalsePositive.cs",
          content: dedent`
            public class FalsePositive
            {
                /// @evidence docs/requirements.md#attached Attached documentation.
                public string Run()
                {
                    // @evidence docs/requirements.md#comment Ordinary comments are inert.
                    return "@evidence docs/requirements.md#literal Literal text is inert.";
                }
            }
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 1,
      },
      mutation: mutation(
        key("function", ["Contract", "Run"]),
        "public int Run() { return 1; }",
        "public int Run() { return 2; }",
      ),
    };
  }

  function c(): IEvidenceAdapterCertification {
    const file = "src/certification.c";
    return {
      type: "c",
      adapter: new EvidenceCAdapter(),
      sources: [
        {
          file,
          content: dedent`
            /**
             * 계약 한글
             * @evidence docs/requirements.md#type Implements the certified type.
             */
            struct Contract {
                /**
                 * 값 한글
                 * @evidence docs/requirements.md#property Implements the certified property.
                 */
                int value;
            };

            /**
             * 실행 한글
             * @evidence docs/requirements.md#function Implements the certified function.
             */
            int run(void) { return 1; }

            static int hidden;

            /** @internal Retired public contract. */
            int legacy = 1;
          `,
        },
      ],
      units: [
        unit(file, "type", ["struct Contract"], undefined, [["Contract"]]),
        unit(file, "function", ["run"]),
        unit(
          file,
          "property",
          ["struct Contract", "value"],
          ["struct Contract"],
          [["Contract", "value"]],
        ),
        unit(file, "property", ["legacy"], undefined, [], ["internal"]),
      ],
      hosts: hosts(
        key("type", ["struct Contract"]),
        key("function", ["run"]),
        key("property", ["struct Contract", "value"]),
      ),
      requirements: requirements(
        key("type", ["struct Contract"]),
        key("function", ["run"]),
        key("property", ["struct Contract", "value"]),
      ),
      excludedUnits: [key("property", ["hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/incomplete.c",
            content: dedent`
              #if DEBUG
              int debug_value;
              #else
              int release_value;
              #endif
            `,
          },
        ],
        diagnosticCodes: ["c-preprocessor-conditional"],
      },
      malformed: {
        sources: [
          { file: "src/malformed.c", content: "int broken( { return 0; }\n" },
        ],
        diagnosticCodes: ["c-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/false-positive.c",
          content: dedent`
            /** @evidence docs/requirements.md#attached Attached documentation. */
            const char *run(void) {
                // @evidence docs/requirements.md#comment Ordinary comments are inert.
                return "@evidence docs/requirements.md#literal Literal text is inert.";
            }
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 1,
      },
      mutation: mutation(
        key("function", ["run"]),
        "int run(void) { return 1; }",
        "int run(void) { return 2; }",
      ),
    };
  }

  function cpp(): IEvidenceAdapterCertification {
    const file = "src/certification.cpp";
    return {
      type: "cpp",
      adapter: new EvidenceCppAdapter(),
      sources: [
        {
          file,
          content: dedent`
            /**
             * 계약 한글
             * @evidence docs/requirements.md#type Implements the certified type.
             */
            class Contract {
            public:
                /**
                 * 실행 한글
                 * @evidence docs/requirements.md#function Implements the certified function.
                 */
                int run() const { return 1; }

                /**
                 * 값 한글
                 * @evidence docs/requirements.md#property Implements the certified property.
                 */
                int value;

                /** @internal Retired public contract. */
                int legacy;

            private:
                int hidden;
            };
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "run"], ["Contract"]),
        unit(file, "property", ["Contract", "value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "legacy"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/incomplete.cpp",
            content: dedent`
              #if DEBUG
              int debug_value;
              #else
              int release_value;
              #endif
            `,
          },
        ],
        diagnosticCodes: ["cpp-preprocessor-conditional"],
      },
      malformed: {
        sources: [
          {
            file: "src/malformed.cpp",
            content: "class Broken { public: int run( { return 0; }\n",
          },
        ],
        diagnosticCodes: ["cpp-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/false-positive.cpp",
          content: dedent`
            /** @evidence docs/requirements.md#attached Attached documentation. */
            const char *run() {
                // @evidence docs/requirements.md#comment Ordinary comments are inert.
                return "@evidence docs/requirements.md#literal Literal text is inert.";
            }
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 1,
      },
      mutation: mutation(
        key("function", ["Contract", "run"]),
        "int run() const { return 1; }",
        "int run() const { return 2; }",
      ),
    };
  }

  function ruby(): IEvidenceAdapterCertification {
    const file = "src/certification.rb";
    return {
      type: "ruby",
      adapter: new EvidenceRubyAdapter(),
      sources: [
        {
          file,
          content: dedent`
            # 계약 한글
            # @evidence docs/requirements.md#type Implements the certified type.
            class Contract
              # 실행 한글
              # @evidence docs/requirements.md#function Implements the certified function.
              def run; 1; end

              # 값 한글
              # @evidence docs/requirements.md#property Implements the certified property.
              attr_reader :value

              private
              attr_reader :hidden
              public

              # @internal Retired public contract.
              attr_reader :legacy
            end
          `,
        },
      ],
      units: [
        unit(file, "type", ["Contract"]),
        unit(file, "function", ["Contract", "run"], ["Contract"]),
        unit(file, "property", ["Contract", "value"], ["Contract"]),
        unit(
          file,
          "property",
          ["Contract", "legacy"],
          ["Contract"],
          [],
          ["internal"],
        ),
      ],
      hosts: hosts(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      requirements: requirements(
        key("type", ["Contract"]),
        key("function", ["Contract", "run"]),
        key("property", ["Contract", "value"]),
      ),
      excludedUnits: [key("property", ["Contract", "hidden"])],
      annotationRanges: 4,
      incomplete: {
        sources: [
          {
            file: "src/incomplete.rb",
            content: dedent`
              class Dynamic
                define_method(name) { }
              end
            `,
          },
        ],
        diagnosticCodes: ["ruby-dynamic-surface"],
      },
      malformed: {
        sources: [{ file: "src/malformed.rb", content: "module Broken\n" }],
        diagnosticCodes: ["ruby-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file: "src/false-positive.rb",
          content: dedent`
            class FalsePositive
              # @evidence docs/requirements.md#attached Attached documentation.
              def run
                # @evidence docs/requirements.md#comment Body comments are inert.
                "@evidence docs/requirements.md#literal Literal text is inert."
              end
            end
          `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 2,
      },
      mutation: mutation(
        key("function", ["Contract", "run"]),
        "def run; 1; end",
        "def run; 2; end",
      ),
    };
  }

  function unit(
    file: string,
    symbol: EvidenceProgrammingSymbol,
    identity: string[],
    parent?: string[],
    aliases: string[][] = [],
    withdrawals: IEvidenceWithdrawal["tag"][] = [],
    sites: number = 1,
  ): IEvidenceAdapterCertificationUnit {
    const addresses: IEvidenceAdapterCertificationAddress[] = [
      identity,
      ...aliases,
    ].map((segments) => ({
      file,
      accessor: EvidenceAccessor.format(segments),
    }));
    return {
      key: key(symbol, identity),
      symbol,
      identity,
      ...(parent === undefined ? {} : { parent: key("type", parent) }),
      sites,
      addresses,
      withdrawals,
    };
  }

  function hosts(
    type: string,
    callable: string,
    property: string,
  ): IEvidenceAdapterCertification["hosts"] {
    return [type, callable, property].map((unitKey) => ({
      attachment: "attached",
      units: [unitKey],
    }));
  }

  function requirements(
    type: string,
    callable: string,
    property: string,
  ): IEvidenceAdapterCertificationRequirement[] {
    return [
      { unit: type, target: "docs/requirements.md#type" },
      { unit: callable, target: "docs/requirements.md#function" },
      { unit: property, target: "docs/requirements.md#property" },
    ];
  }

  function mutation(
    unitKey: string,
    contentBefore: string,
    contentAfter: string,
  ): IEvidenceAdapterCertification["mutation"] {
    return {
      unit: unitKey,
      reasonBefore: "Implements the certified function.",
      reasonAfter: "Explains the certified function differently.",
      contentBefore,
      contentAfter,
    };
  }

  function key(symbol: EvidenceProgrammingSymbol, identity: string[]): string {
    return `${symbol}:${EvidenceAccessor.format(identity)}`;
  }
}
