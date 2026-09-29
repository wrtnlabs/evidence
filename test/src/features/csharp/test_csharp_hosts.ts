import { EvidenceCSharpAdapter, EvidenceInventory } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Attaches C# XML documentation and rejects inert source carriers.
 *
 * The fixture separates eligible declaration docs from code examples,
 * directives, body comments and inaccessible members while ignoring strings.
 *
 * 1. Extract evidence from XML documentation on public types, grouped fields, and
 *    methods.
 * 2. Verify grouped fields share a host and XML code/example regions remain inert.
 * 3. Require non-XML comments and inaccessible or directive-separated carriers to
 *    report unsupported annotations, while a withdrawn partial hierarchy stays
 *    hidden.
 */
export async function test_csharp_hosts(): Promise<void> {
  const inventory = await new EvidenceCSharpAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "src/Contracts.cs",
      dedent`
        /// <summary>
        /// @evidence docs/requirements.md#type Implements the public type.
        /// <code>
        /// @evidence docs/requirements.md#code Code examples are inert.
        /// </code>
        /// <example>
        /// @evidence docs/requirements.md#example Examples are inert.
        /// </example>
        /// <c>@evidence docs/requirements.md#inline Inline code is inert.</c>
        /// </summary>
        [Obsolete]
        public class Contracts : IService
        {
            /// @evidence docs/requirements.md#fields Implements both fields.
            public int First = 1, Second = 2;

            /**
             * @evidence docs/requirements.md#method Implements the method.
             */
            public void Run() { }

            // @evidence docs/requirements.md#ordinary Ordinary comments are unsupported.
            public void Ordinary() { }

            /// @evidence docs/requirements.md#private Private members are unsupported.
            private void Private() { }

            /// @evidence docs/requirements.md#explicit Explicit implementations are unsupported.
            void IService.Run() { }

            /// @evidence docs/requirements.md#directive Preprocessor directives break attachment.
            #nullable enable
            public void DirectiveBoundary() { }

            /// @evidence docs/requirements.md#before-directive A directive splits the sequence.
            #nullable disable
            /// @evidence docs/requirements.md#after-directive A new sequence can attach.
            public void AfterDirective() { }

            public void Literals()
            {
                var normal = "@evidence docs/requirements.md#string Strings are unsupported.";
                var verbatim = @"@evidence docs/requirements.md#verbatim Verbatim strings are unsupported.";
                var raw = """@evidence docs/requirements.md#raw Raw strings are unsupported.""";
                var interpolated = $"@evidence docs/requirements.md#interpolated {1}";
                // @evidence docs/requirements.md#body Body comments are unsupported.
            }
        }

        public interface IService
        {
            void Run();
        }
      `,
    ),
  );

  // XML wrappers remain usable while their code and example regions stay inert.
  TestValidator.equals(
    "C# attached declarations",
    inventory.declarations
      .map((declaration) => declaration.target)
      .sort(compare),
    [
      "docs/requirements.md#after-directive",
      "docs/requirements.md#fields",
      "docs/requirements.md#method",
      "docs/requirements.md#type",
    ],
  );
  const grouped = inventory.hosts.find(
    (host) =>
      host.unitIds.some((unitId) => unitId.includes('"First"')) &&
      host.unitIds.some((unitId) => unitId.includes('"Second"')),
  );
  if (grouped === undefined)
    throw new Error("Missing grouped C# field documentation host.");
  TestValidator.equals(
    "C# grouped field host units",
    grouped.unitIds.length,
    2,
  );

  // Non-XML comments and docs on unpublished members remain visible failures.
  TestValidator.equals(
    "unsupported C# annotation count",
    inventory.diagnostics.filter(
      (diagnostic) => diagnostic.code === "unsupported-annotation-host",
    ).length,
    6,
  );

  const withdrawn = await new EvidenceCSharpAdapter().analyze(
    EvidenceTestSourceSnapshot.combine([
      EvidenceTestSourceSnapshot.create(
        "src/Hidden.cs",
        dedent`
          public partial class Hidden
          {
              public int Value { get; set; }
          }
        `,
      ),
      EvidenceTestSourceSnapshot.create(
        "src/Hidden.Partial.cs",
        dedent`
          /// @internal Every selected part belongs to one withdrawn type.
          partial class Hidden
          {
              public void Open() { }
          }
        `,
      ),
    ]),
  );
  const population = new EvidenceInventory([withdrawn]).select(
    withdrawn.units.map((unit) => unit.id),
  );
  TestValidator.equals(
    "withdrawn C# partial hierarchy",
    population.hidden.map((unit) => unit.identity.join(".")).sort(compare),
    ["Hidden", "Hidden.Open", "Hidden.Value"],
  );
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
