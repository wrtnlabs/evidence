import { TestValidator } from "@nestia/e2e";
import { EvidenceFingerprint } from "@wrtnlabs/evidence";
import type {
  IEvidenceInventory,
  IEvidenceSourceFile,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";

import { EvidenceTestFingerprint } from "../../internal/EvidenceTestFingerprint";
import { EvidenceTestInventory } from "../../internal/EvidenceTestInventory";

/**
 * Rewrites literal identity tokens once using their longest original match.
 *
 * Prefix indexing must preserve versioned hashes when unrelated sources contain
 * token prefixes, regular-expression characters or generated marker text.
 *
 * 1. Fingerprint an explicit unit whose source ID contains Unicode and literal
 *    pattern characters, and whose unit ID embeds that complete source token.
 * 2. Add prefix tokens, a token appearing only in generated replacement text, and
 *    2,000 unrelated source tokens; require the original fingerprint.
 * 3. Give an unrelated source the physical-root token with a conflicting stable
 *    meaning; require ambiguity to throw instead of selecting by scan order.
 *
 * @evidence contracts/testing.md#behavioral-verification Computes public fingerprints before and after controlled token-table changes, asserting stable values and rejection of ambiguous replacements.
 * @evidence contracts/testing.md#independent-expectations An independently authored portable identity and content are SHA-256 framed under v2; prefix and unrelated tokens must preserve that exact result, while conflicting meanings must reject.
 * @evidence contracts/testing.md#distinguishing-cases Covers overlapping prefixes, Unicode and metacharacters, generated-marker tokens, 2,000 unrelated tokens and conflicting root/source tokens. Existing fingerprint tests own changed content and checkout moves.
 * @evidence contracts/testing.md#execution-ownership The exported test_fingerprint_literal_tokens is discovered by DynamicExecutor and calls maintained fingerprint logic directly on explicit inventory records without filesystem access or subprocesses.
 */
export async function test_fingerprint_literal_tokens(): Promise<void> {
  const inventory: IEvidenceInventory = EvidenceTestInventory.create();
  const source: IEvidenceSourceFile | undefined = inventory.sources[0];
  if (source === undefined) throw new Error("Missing source snapshot.");
  source.id = "source+$[Ω].*";
  const unit: IEvidenceUnit = EvidenceTestInventory.unit(
    inventory,
    `typescript:${source.id}:Rule`,
    ["Rule"],
    "type",
    "export class Box { value = 1; }",
  );
  const expected: string = EvidenceTestFingerprint.single(
    JSON.stringify([
      "typescript",
      'typescript:@source:"source.ts":Rule',
      "type",
      ["Rule"],
    ]),
    "type",
    "export class Box { value = 1; }",
  );
  TestValidator.equals(
    "literal identity follows v2 framing",
    EvidenceFingerprint.inspect(inventory, unit.id).fingerprint,
    expected,
  );
  const tokens: string[] = [
    "source",
    "source+$[Ω]",
    "@source:",
    ...Array.from(
      { length: 2000 },
      (_value: unknown, index: number): string => `unrelated-${index}`,
    ),
  ];
  for (let index: number = 0; index < tokens.length; ++index)
    inventory.sources.push({
      id: tokens[index] ?? "",
      physicalPath: `/project/extra-${index}.ts`,
      fingerprintPath: `extra-${index}.ts`,
      content: "",
      digest: source.digest,
      addresses: [],
    });
  TestValidator.equals(
    "unrelated literal tokens preserve hash",
    EvidenceFingerprint.inspect(inventory, unit.id).fingerprint,
    expected,
  );
  inventory.sources.push({
    id: "/project",
    physicalPath: "/project/ambiguous.ts",
    fingerprintPath: "ambiguous.ts",
    content: "",
    digest: source.digest,
    addresses: [],
  });
  let message: string = "";
  try {
    EvidenceFingerprint.inspect(inventory, unit.id);
  } catch (cause: unknown) {
    if (cause instanceof Error) message = cause.message;
    else throw cause;
  }
  TestValidator.predicate(
    "ambiguous portable token rejected",
    message.includes("ambiguous portable token"),
  );
}
