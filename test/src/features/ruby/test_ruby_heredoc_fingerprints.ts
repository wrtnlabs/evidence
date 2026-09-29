import { EvidenceRubyAdapter, EvidenceFingerprint } from "@wrtnlabs/evidence";
import type {
  IEvidenceInventory,
  IEvidenceUnit,
  IEvidenceDiagnostic,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Includes delayed Ruby heredoc bodies in their exact declaration fingerprints.
 *
 * Heredoc bodies are sibling syntax nodes rather than children of assignment
 * nodes. Omitting them makes reviews stale without detection; absorbing all
 * following bodies instead invalidates unrelated sibling declarations.
 *
 * 1. Analyze nested constants with multiple same-line and multiple-operand
 *    heredocs, plus a method whose ordinary body already contains its heredoc.
 * 2. Change each body's content independently and require only its owning unit and
 *    structural ancestors to change, preserving every sibling fingerprint.
 * 3. Put tag-shaped data and interpolation in a delayed body and require no
 *    annotation spans there; content edits must still move the fingerprint.
 * 4. Edit real documentation prose and normalize CRLF without changing the
 *    implementation fingerprint.
 * 5. Require unresolved nested delayed bodies to mark extraction incomplete even
 *    when the upstream grammar reports no syntax error.
 */
export async function test_ruby_heredoc_fingerprints(): Promise<void> {
  const original: IEvidenceInventory = await inventory(
    "first",
    "second",
    "third",
    "fourth",
    "method",
    "Real documentation.",
  );
  TestValidator.equals("heredoc inventory complete", original.complete, true);
  TestValidator.equals(
    "heredoc inventory diagnostics",
    original.diagnostics,
    [],
  );
  const names: string[] = [
    "Data.First",
    "Data.Second",
    "Data.Multiple",
    "Data.run",
  ];
  const changes: string[][] = [
    ["changed first", "second", "third", "fourth", "method"],
    ["first", "changed second", "third", "fourth", "method"],
    ["first", "second", "changed third", "fourth", "method"],
    ["first", "second", "third", "changed fourth", "method"],
    ["first", "second", "third", "fourth", "changed method"],
  ];
  for (let index: number = 0; index < changes.length; ++index) {
    const change: string[] | undefined = changes[index];
    if (change === undefined) throw new Error("Missing heredoc mutation.");
    const [first, second, third, fourth, method]: string[] = change;
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined ||
      method === undefined
    )
      throw new Error("Incomplete heredoc mutation.");
    const edited: IEvidenceInventory = await inventory(
      first,
      second,
      third,
      fourth,
      method,
      "Real documentation.",
    );
    TestValidator.equals("mutated heredoc complete", edited.diagnostics, []);
    const owner: string =
      index < 2
        ? (names[index] ?? "")
        : index < 4
          ? "Data.Multiple"
          : "Data.run";
    for (const name of names) {
      if (name === owner)
        TestValidator.notEquals(
          `${name} own literal changes`,
          fingerprint(original, name),
          fingerprint(edited, name),
        );
      else
        TestValidator.equals(
          `${name} sibling isolation`,
          fingerprint(original, name),
          fingerprint(edited, name),
        );
    }
    TestValidator.notEquals(
      "parent includes changed child",
      fingerprint(original, "Data"),
      fingerprint(edited, "Data"),
    );
  }
  const prose: IEvidenceInventory = await inventory(
    "first",
    "second",
    "third",
    "fourth",
    "method",
    "Edited documentation.",
  );
  for (const name of names)
    TestValidator.equals(
      `${name} documentation prose is metadata`,
      fingerprint(original, name),
      fingerprint(prose, name),
    );
  const crlf: IEvidenceInventory = await inventory(
    "first",
    "second",
    "third",
    "fourth",
    "method",
    "Real documentation.",
    "\r\n",
  );
  for (const name of [...names, "Data"])
    TestValidator.equals(
      `${name} CRLF normalization`,
      fingerprint(original, name),
      fingerprint(crlf, name),
    );
  const nested: IEvidenceInventory = await new EvidenceRubyAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "nested.rb",
      dedent`
    Value = <<~OUTER
    #{<<~INNER}
    inside
    INNER
    outer
    OUTER
  `,
    ),
  );
  TestValidator.equals(
    "unresolved nested heredoc fails closed",
    nested.complete,
    false,
  );
  TestValidator.predicate(
    "unresolved delayed body diagnosed",
    nested.diagnostics.some(
      (diagnostic: IEvidenceDiagnostic): boolean =>
        diagnostic.code === "ruby-heredoc-body",
    ),
  );
}

/**
 * Builds delayed bodies with independently editable content and real evidence.
 *
 * Two assignments share their physical opening line, while a separate array
 * owns two other bodies. The method exercises an already enclosing range.
 */
async function inventory(
  first: string,
  second: string,
  third: string,
  fourth: string,
  method: string,
  reason: string,
  newline: string = "\n",
): Promise<IEvidenceInventory> {
  return new EvidenceRubyAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "data.rb",
      dedent`
    class Data
      # @evidence requirements.md#real ${reason}
      First = <<~FIRST; Second = <<~SECOND
      @evidence requirements.md#literal ${first}
      FIRST
      ${second}
      SECOND
      Multiple = [<<~THIRD, <<~FOURTH]
      ${third}
      THIRD
      ${fourth} #{1 + 2}
      FOURTH
      def run
        <<~BODY
        ${method}
        BODY
      end
    end
  `.replaceAll("\n", newline),
    ),
  );
}

/**
 * Inspects one independently named unit rather than relying on extraction
 * order.
 *
 * A missing unit fails the scenario instead of reducing its expected
 * denominator.
 */
function fingerprint(inventory: IEvidenceInventory, identity: string): string {
  const unit: IEvidenceUnit | undefined = inventory.units.find(
    (candidate: IEvidenceUnit): boolean =>
      candidate.identity.join(".") === identity,
  );
  if (unit === undefined)
    throw new Error(`Missing Ruby heredoc owner ${identity}`);
  return EvidenceFingerprint.inspect(inventory, unit.id).fingerprint;
}
