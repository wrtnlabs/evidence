import { EvidenceInventory, EvidenceJavaAdapter } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Attaches Java evidence to Javadoc and rejects inert carriers.
 *
 * Only Javadoc owned by eligible declarations can acknowledge units.
 *
 * 1. Analyze annotated Javadoc.
 * 2. Compare hosted declarations.
 * 3. Require inert Java carriers to report diagnostics.
 */
export async function test_java_hosts(): Promise<void> {
  const inventory = await new EvidenceJavaAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "src/Contracts.java",
      dedent`
        /**
         * @evidence docs/requirements.md#type Implements the public type.
         * {@code @evidence docs/requirements.md#inline This example is inert.}
         * <pre>
         * @evidence docs/requirements.md#preformatted This example is inert.
         * </pre>
         * <code>
         * @evidence docs/requirements.md#html-code This example is inert.
         * </code>
         */
        @Deprecated
        public class Contracts {
            /** @evidence docs/requirements.md#fields Implements both constants. */
            public static final int FIRST = 1, SECOND = 2;

            /** @evidence docs/requirements.md#method Implements the first overload. */
            public void calculate() {}

            /** @evidence docs/requirements.md#method Implements the second overload. */
            @Deprecated
            public void calculate(int value) {}

            // @evidence docs/requirements.md#ordinary Ordinary comments are unsupported.
            public void ordinary() {}

            public void literals() {
                String text = "@evidence docs/requirements.md#string Strings are unsupported.";
                String block = """
                    @evidence docs/requirements.md#text-block Text blocks are unsupported.
                    """;
            }

            public enum State {
                /** @evidence docs/requirements.md#constant Implements the enum constant. */
                READY
            }

            public @interface Label {
                /** @evidence docs/requirements.md#element Implements the annotation element. */
                String value();
            }

            public record Point(
                /** @evidence docs/requirements.md#component Implements the record component. */
                int x
            ) {}

            /** @evidence docs/requirements.md#unpublished Cannot attach to a private member. */
            private void unpublished() {}
        }
      `,
    ),
  );

  // Javadoc attaches across modifiers and annotations; code examples stay inert.
  TestValidator.equals(
    "Java attached declarations",
    inventory.declarations
      .map((declaration) => declaration.target)
      .sort(compare),
    [
      "docs/requirements.md#component",
      "docs/requirements.md#constant",
      "docs/requirements.md#element",
      "docs/requirements.md#fields",
      "docs/requirements.md#method",
      "docs/requirements.md#method",
      "docs/requirements.md#type",
    ],
  );
  const grouped = inventory.hosts.find(
    (host) =>
      host.unitIds.some((unitId) => unitId.includes('"FIRST"')) &&
      host.unitIds.some((unitId) => unitId.includes('"SECOND"')),
  );
  if (grouped === undefined)
    throw new Error("Missing grouped Java field documentation host.");
  TestValidator.equals(
    "Java grouped field host units",
    grouped.unitIds.length,
    2,
  );

  // Unsupported comment positions remain diagnosable; strings remain data.
  TestValidator.equals(
    "unsupported Java annotation count",
    inventory.diagnostics.filter(
      (diagnostic) => diagnostic.code === "unsupported-annotation-host",
    ).length,
    2,
  );

  const withdrawn = await new EvidenceJavaAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "src/Hidden.java",
      dedent`
        /** @internal This type and every public descendant are internal. */
        public class Hidden {
            public int value;
            public void open() {}
        }

        public class Visible {
            /** @internal This withdrawal hides the complete overload family. */
            public void calculate() {}
            public void calculate(int value) {}

            /** @internal This property is internal. */
            public int hiddenValue;
        }
      ` + "\n",
    ),
  );
  const population = new EvidenceInventory([withdrawn]).select(
    withdrawn.units.map((unit) => unit.id),
  );
  TestValidator.equals(
    "withdrawn Java hierarchy and overload family",
    population.hidden.map((unit) => unit.identity.join(".")).sort(compare),
    [
      "Hidden",
      "Hidden.open",
      "Hidden.value",
      "Visible.calculate",
      "Visible.hiddenValue",
    ],
  );
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
