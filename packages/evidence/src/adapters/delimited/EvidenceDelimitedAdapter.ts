import typia from "typia";

import { EvidenceInventoryIndex } from "../../internal/EvidenceInventoryIndex";
import type { IEvidenceAdapter } from "../../structures/IEvidenceAdapter";
import type { IEvidenceDelimitedOptions } from "../../structures/IEvidenceDelimitedOptions";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidenceSourceSnapshot } from "../../structures/IEvidenceSourceSnapshot";
import type { EvidenceDelimitedType } from "../../typings/EvidenceDelimitedType";
import { EvidenceDelimitedScanner } from "./EvidenceDelimitedScanner";
import { EvidenceDelimitedSyntax } from "./EvidenceDelimitedSyntax";

/**
 * Extracts keyed CSV or TSV rows as evidence units and hosts.
 *
 * Every supplied source is read with the grammar of the configured dialect,
 * regardless of its extension. Each valid row becomes a `row` unit addressed by
 * its key beneath an addressable `file` aggregate. Rows host annotations in the
 * configured evidence column; structural failures leave an incomplete inventory
 * instead of a smaller population.
 *
 * @example
 *   const adapter = new EvidenceDelimitedAdapter("tsv", { key: "id" });
 *   const inventory = await adapter.analyze(snapshot);
 *   // data/projects.tsv#P3 now names the row whose id cell is P3.
 *
 * @evidence contracts/common.md#principled-implementation Validated column options and the dialect are fixed at construction; every snapshot file is scanned into one inventory seeded with discovery diagnostics, then reconciled through EvidenceInventoryIndex.
 * @evidence contracts/common.md#clear-and-simple-design The adapter combines scanner output; record grammar, header roles and annotation mapping belong to the reader, syntax and scanner modules.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Invalid options throw before any source is read, and discovery failures stay in the result so unreadable files cannot shrink the population.
 * @evidence contracts/common.md#meaningful-documentation The class comment explains dialect selection, units, hosts and failure handling with an example; every member is documented.
 * @evidence contracts/performance.md#efficient-algorithms Linear in total source size: one scanner pass per file.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each analysis scans its snapshot once; sharing identical loads belongs to the checker.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The adapter keeps only its immutable options between analyses; scanners are discarded after each file.
 */
export class EvidenceDelimitedAdapter implements IEvidenceAdapter<EvidenceDelimitedType> {
  /** Validated copy of the column roles used for every analysis. */
  private readonly options: IEvidenceDelimitedOptions;

  /**
   * Fixes the dialect and the column roles for every later analysis.
   *
   * Options are validated with the same rules as configuration, so an empty or
   * repeated key column, or an evidence column that is also a key column,
   * throws here.
   */
  public constructor(
    private readonly dialect: EvidenceDelimitedType,
    options: IEvidenceDelimitedOptions,
  ) {
    typia.assert(dialect);
    this.options = structuredClone(typia.assert(options));
    const problems: string[] = EvidenceDelimitedSyntax.optionProblems(
      "options",
      this.options,
    );
    if (problems.length !== 0) throw new Error(problems.join("\n"));
  }

  /**
   * Artifact discriminator naming the configured grammar.
   *
   * Population symbol policies select `row`; the file stays an aggregate.
   */
  public get type(): EvidenceDelimitedType {
    return this.dialect;
  }

  /**
   * Scans captured ledgers into an owned normalized inventory.
   *
   * Input is validated and cloned before scanners append records. Discovery
   * failures remain attached to the result, preventing unreadable files from
   * silently reducing the row population.
   *
   * @evidence contracts/common.md#principled-implementation The snapshot is asserted and cloned, source diagnostics become inventory diagnostics, each file is scanned, and the result is reconciled.
   * @evidence contracts/common.md#clear-and-simple-design Analyze orchestrates scanners and reconciliation only.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Discovery failures are carried into the inventory and keep its completeness flag.
   * @evidence contracts/common.md#meaningful-documentation The comment explains validation, cloning and failure retention.
   * @evidence contracts/performance.md#efficient-algorithms Linear in total source size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each snapshot is analyzed once.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Scanners and the working inventory are local; the reconciled inventory is owned by the caller.
   */
  public async analyze(
    snapshot: IEvidenceSourceSnapshot,
  ): Promise<IEvidenceInventory> {
    const input: IEvidenceSourceSnapshot = structuredClone(
      typia.assert(snapshot),
    );
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
        repair: `Restore access to the selected ${EvidenceDelimitedSyntax.label(this.dialect)} source before evaluating coverage.`,
        location: { file: diagnostic.path },
      })),
      dependencies: input.dependencies,
      complete: input.complete,
    };
    for (const source of input.files)
      new EvidenceDelimitedScanner(
        inventory,
        source,
        this.dialect,
        this.options,
      ).scan();
    return new EvidenceInventoryIndex([inventory]).snapshot();
  }
}
