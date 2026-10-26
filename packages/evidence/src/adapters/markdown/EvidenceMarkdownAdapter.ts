import typia from "typia";

import { EvidenceInventoryIndex } from "../../internal/EvidenceInventoryIndex";
import { EvidenceMarkdownScanner } from "./EvidenceMarkdownScanner";
import type { IEvidenceAdapter } from "../../structures/IEvidenceAdapter";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidenceSourceSnapshot } from "../../structures/IEvidenceSourceSnapshot";

/**
 * Extracts Markdown units with HTML-comment and H2-H4 annotation hosts.
 *
 * Every supplied source is interpreted as Markdown regardless of its extension.
 * EvidenceMarkdownScanner owns heading hierarchy, fenced-content boundaries,
 * and comment attachment; this adapter combines those records with discovery
 * diagnostics and validates the resulting shared inventory.
 *
 * @evidence contracts/common.md#principled-implementation Every supplied source is scanned as Markdown into one inventory seeded with discovery diagnostics, then reconciled through EvidenceInventory.
 * @evidence contracts/common.md#clear-and-simple-design The adapter combines scanner output; heading hierarchy, examples and attachment belong to EvidenceMarkdownScanner.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Discovery failures stay in the result so unreadable files cannot shrink the population.
 * @evidence contracts/common.md#meaningful-documentation The class comment explains the division with the scanner; both members are documented.
 * @evidence contracts/performance.md#efficient-algorithms Linear in total Markdown size: one scanner pass per file.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each analysis scans its snapshot once.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The adapter keeps no state between analyses; scanners are discarded after each file.
 */
export class EvidenceMarkdownAdapter implements IEvidenceAdapter<"markdown"> {
  /**
   * Artifact discriminator selecting Markdown structure and target grammar.
   *
   * Population symbol policies can select files or supported exact heading
   * levels.
   */
  public get type(): "markdown" {
    return "markdown";
  }

  /**
   * Scans captured Markdown contents into an owned normalized inventory.
   *
   * Input is validated and cloned before scanners append units and annotations.
   * Discovery failures remain attached to the result, preventing unreadable
   * files from silently reducing the coverage population.
   *
   * @evidence contracts/common.md#principled-implementation The snapshot is asserted and cloned, source diagnostics become inventory diagnostics, each file is scanned, and the result is reconciled.
   * @evidence contracts/common.md#clear-and-simple-design Analyze orchestrates scanners and reconciliation only.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Discovery failures are carried into the inventory rather than dropped.
   * @evidence contracts/common.md#meaningful-documentation The comment explains validation, cloning and failure retention.
   * @evidence contracts/performance.md#efficient-algorithms Linear in total source size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each snapshot is analyzed once.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Scanners and the working inventory are local; the reconciled inventory is owned by the caller.
   */
  public async analyze(
    snapshot: IEvidenceSourceSnapshot,
  ): Promise<IEvidenceInventory> {
    const input = structuredClone(typia.assert(snapshot));
    const inventory: IEvidenceInventory = {
      schemaVersion: 1,
      sources: input.files,
      annotationRanges: [],
      units: [],
      addresses: [],
      hosts: [],
      declarations: [],
      reviews: [],
      diagnostics: input.diagnostics.map((diagnostic) => ({
        code: `source-${diagnostic.code}`,
        severity: "error",
        message: diagnostic.message,
        repair:
          "Restore access to the selected Markdown source before evaluating coverage.",
        location: { file: diagnostic.path },
      })),
      dependencies: input.dependencies,
      complete: input.complete,
    };
    for (const source of input.files)
      new EvidenceMarkdownScanner(inventory, source).scan();
    return new EvidenceInventoryIndex([inventory]).snapshot();
  }
}
