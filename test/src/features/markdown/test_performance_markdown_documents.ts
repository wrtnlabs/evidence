import { TestValidator } from "@nestia/e2e";
import { EvidenceMarkdownAdapter } from "@wrtnlabs/evidence";
import type {
  IEvidenceInventory,
  IEvidenceSourceSnapshot,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Analyzes a Markdown population whose headings exceed the engine argument
 * limit.
 *
 * Separate evidence documents reach the Markdown adapter as one population, and
 * its inventory index merges every heading unit and address at once, so the
 * merge must not pass the whole population as call arguments.
 *
 * 1. Combine 2,000 documents with 100 H2 headings each, 200,000 headings in all.
 * 2. Analyze the combined snapshot with the Markdown adapter.
 * 3. Require a complete inventory with every heading unit, every file unit and one
 *    address per unit.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs the real Markdown adapter over 2000 in-memory documents and asserts completeness, no diagnostics, the H2 and file unit counts and the address count.
 * @evidence contracts/testing.md#independent-expectations Every document is one file unit and every authored heading a distinct H2 unit, each with one public address, so a complete analysis keeps 200000 headings, 2000 files and 202000 addresses; spreading the merged arrays into call arguments throws a RangeError instead.
 * @evidence contracts/testing.md#distinguishing-cases Covers the many-document population behind separate evidence files; test_performance_inventory_volume owns the merge alone and test_performance_markdown_line owns one long line.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor invokes the adapter on in-memory sources without filesystem access or a subprocess.
 */
export async function test_performance_markdown_documents(): Promise<void> {
  const documents: number = 2000;
  const headings: number = 100;
  const content: string = Array.from(
    { length: headings },
    (_: unknown, index: number): string => `## Heading ${index}\n\nBody.\n`,
  ).join("\n");
  const snapshots: IEvidenceSourceSnapshot[] = Array.from(
    { length: documents },
    (_: unknown, index: number): IEvidenceSourceSnapshot =>
      EvidenceTestSourceSnapshot.create(`docs/document-${index}.md`, content),
  );
  const inventory: IEvidenceInventory =
    await new EvidenceMarkdownAdapter().analyze(
      EvidenceTestSourceSnapshot.combine(snapshots),
    );
  TestValidator.equals("documents complete", inventory.complete, true);
  TestValidator.equals("no diagnostics", inventory.diagnostics, []);
  TestValidator.equals(
    "every heading unit",
    inventory.units.filter(
      (unit: IEvidenceUnit): boolean => unit.symbol === "h2",
    ).length,
    documents * headings,
  );
  TestValidator.equals(
    "every file unit",
    inventory.units.filter(
      (unit: IEvidenceUnit): boolean => unit.symbol === "file",
    ).length,
    documents,
  );
  TestValidator.equals(
    "every unit address",
    inventory.addresses.length,
    documents * (headings + 1),
  );
}
