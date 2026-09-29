import { EvidenceCAdapter, EvidenceInventory } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Attaches C Doxygen evidence and rejects annotations in inert source carriers.
 *
 * Only documentation that leads an eligible declaration may satisfy evidence;
 * comments in unsupported positions must remain visible failures. Literal data
 * contributes no annotations.
 *
 * 1. Analyze Doxygen comments before supported declarations.
 * 2. Compare the resulting declarations and attached hosts.
 * 3. Require misplaced comment tags to produce unsupported-host diagnostics.
 */
export async function test_c_hosts(): Promise<void> {
  const inventory = await new EvidenceCAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "src/contracts.c",
      dedent`
        /**
         * @evidence docs/requirements.md#type Implements the aggregate.
         * @code
         * @evidence docs/requirements.md#code Doxygen source is inert.
         * @endcode
         * <pre>@evidence docs/requirements.md#pre Preformatted text is inert.</pre>
         */
        struct Contracts {
            /// @evidence docs/requirements.md#field Implements the field.
            int value;
        };

        /// @evidence docs/requirements.md#function Implements the function.
        int run(void) {
            /** @evidence docs/requirements.md#body Body documentation is unsupported. */
            const char *text = "@evidence docs/requirements.md#string Strings are unsupported.";
            return text[0];
        }

        int first, second; ///< @evidence docs/requirements.md#trailing Implements both objects.

        enum Result {
            SUCCESS, /**< @evidence docs/requirements.md#enumerator Implements the enumerator. */
            FAILURE,
        };

        // @evidence docs/requirements.md#ordinary Ordinary comments are unsupported.
        int ordinary;

        /*
         * @evidence docs/requirements.md#ordinary-block Ordinary block comments are unsupported.
         */
        int ordinary_block;

        /** @evidence docs/requirements.md#static Static declarations are unsupported. */
        static int hidden;

        /** @evidence docs/requirements.md#detached Detached Doxygen is unsupported. */

        int detached;

        /** @evidence docs/requirements.md#directive A directive breaks attachment. */
        #define CONTRACT_VALUE 1
        int after_directive;
      `,
    ),
  );

  TestValidator.equals(
    "C attached declarations",
    inventory.declarations
      .map((declaration) => declaration.target)
      .sort(compare),
    [
      "docs/requirements.md#enumerator",
      "docs/requirements.md#field",
      "docs/requirements.md#function",
      "docs/requirements.md#trailing",
      "docs/requirements.md#type",
    ],
  );

  // One trailing statement comment owns every declarator from that site.
  const groupedDeclaration = inventory.declarations.find(
    (declaration) => declaration.target === "docs/requirements.md#trailing",
  );
  if (groupedDeclaration === undefined)
    throw new Error("Missing trailing C evidence declaration.");
  const groupedHost = inventory.hosts.find(
    (host) => host.id === groupedDeclaration.hostId,
  );
  if (groupedHost === undefined)
    throw new Error("Missing trailing C evidence host.");
  TestValidator.equals("C grouped object host", groupedHost.unitIds.length, 2);

  // Misplaced comment tags remain visible while expression strings are ignored.
  TestValidator.equals(
    "unsupported C annotation count",
    inventory.diagnostics.filter(
      (diagnostic) => diagnostic.code === "unsupported-annotation-host",
    ).length,
    6,
  );

  const withdrawn = await new EvidenceCAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "include/hidden.h",
      dedent`
        /** @internal This forward declaration withdraws the merged type. */
        struct Hidden;

        struct Hidden {
            int value;
        };
      `,
    ),
  );
  const population = new EvidenceInventory([withdrawn]).select(
    withdrawn.units.map((unit) => unit.id),
  );
  TestValidator.equals(
    "withdrawn C hierarchy",
    population.hidden.map((unit) => unit.identity.join(".")).sort(compare),
    ["struct Hidden", "struct Hidden.value"],
  );
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
