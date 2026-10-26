import { TestValidator } from "@nestia/e2e";
import { EvidenceFingerprint, EvidenceSourceText } from "@wrtnlabs/evidence";
import type {
  IEvidenceInventory,
  IEvidenceSourceFile,
  IEvidenceUnit,
  IEvidenceUnitSite,
  IEvidenceSourceRange,
} from "@wrtnlabs/evidence";
import { performance } from "node:perf_hooks";
import { EvidenceTestFingerprint } from "../../internal/EvidenceTestFingerprint";
import { EvidenceTestInventory } from "../../internal/EvidenceTestInventory";

/**
 * Hashes disjoint content spans without scanning every annotation per span.
 *
 * Splitting identical content into many spans must preserve its fingerprint,
 * including overlapping annotation removals.
 *
 * 1. Build 12,000 disjoint content spans and an equivalent contiguous control.
 * 2. Compare fingerprints before and after duplicate and nested annotation
 *    removals.
 * 3. Require equal v2 fingerprints within a generous execution ceiling.
 *
 * @evidence contracts/testing.md#behavioral-verification Compares public fingerprints for 12000 separate content spans and an equivalent contiguous span, then adds duplicate removal ranges.
 * @evidence contracts/testing.md#independent-expectations The expected annotation-free text is explicitly AB on every line and the portable identity is authored independently; the separate SHA-256 v2 frame must match contiguous, split and overlapping-removal representations.
 * @evidence contracts/testing.md#distinguishing-cases Covers many disjoint spans, annotations outside each span, duplicate and nested intervals and v2 output equivalence; other fingerprint suites own portability and changed content.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor invokes maintained fingerprint logic on in-memory records without a CLI or filesystem fixture.
 */
export async function test_performance_fingerprint_intervals(): Promise<void> {
  const count: number = 12000;
  const inventory: IEvidenceInventory = EvidenceTestInventory.create();
  const source: IEvidenceSourceFile | undefined = inventory.sources[0];
  if (source === undefined) throw new Error("Missing source.");
  source.content = Array.from({ length: count }, (): string => "A#B").join(
    "\n",
  );
  const text: EvidenceSourceText = new EvidenceSourceText(source.content);
  const unit: IEvidenceUnit = EvidenceTestInventory.unit(
    inventory,
    "many-spans",
    ["Many"],
    "function",
    source.content,
  );
  const site: IEvidenceUnitSite | undefined = unit.sites[0];
  if (site === undefined) throw new Error("Missing site.");
  for (let index: number = 0; index < count; ++index)
    inventory.annotationRanges.push({
      file: source.physicalPath,
      range: text.range(index * 4 + 1, index * 4 + 2),
    });
  const expected: string = EvidenceTestFingerprint.single(
    JSON.stringify(["typescript", "many-spans", "function", ["Many"]]),
    "function",
    Array.from({ length: count }, (): string => "AB").join("\n"),
  );
  TestValidator.equals(
    "contiguous content follows v2 framing",
    EvidenceFingerprint.inspect(inventory, unit.id).fingerprint,
    expected,
  );
  site.content = Array.from(
    { length: count },
    (_value: unknown, index: number): IEvidenceSourceRange =>
      text.range(index * 4, index * 4 + 3),
  );
  const start: number = performance.now();
  TestValidator.equals(
    "disjoint spans retain v2 bytes",
    EvidenceFingerprint.inspect(inventory, unit.id).fingerprint,
    expected,
  );
  TestValidator.predicate(
    "interval lookup ceiling",
    performance.now() - start < 10000,
  );
  inventory.annotationRanges.push(
    { file: source.physicalPath, range: text.range(1, 2) },
    { file: source.physicalPath, range: text.range(1, 1) },
  );
  TestValidator.equals(
    "duplicate and nested intervals preserve content",
    EvidenceFingerprint.inspect(inventory, unit.id).fingerprint,
    expected,
  );
}
