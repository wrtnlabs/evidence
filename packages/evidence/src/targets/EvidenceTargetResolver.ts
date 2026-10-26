import { EvidenceSelectionSnapshot } from "../internal/EvidenceSelectionSnapshot";
import typia from "typia";
import { EvidenceInventoryIndex } from "../internal/EvidenceInventoryIndex";
import { EvidenceTargetResolverIndex } from "../internal/EvidenceTargetResolverIndex";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
import type { IEvidenceHost } from "../structures/IEvidenceHost";
import type { IEvidenceTargetStatement } from "../structures/IEvidenceTargetStatement";
import type { IEvidenceTargetResolution } from "../structures/IEvidenceTargetResolution";
import type { EvidenceArtifactType } from "../typings/EvidenceArtifactType";
/**
 * Resolves citation targets against a captured reference population with
 * isolated results.
 *
 * @evidence contracts/common.md#principled-implementation The constructor asserts and captures inputs once, reconciles file scopes and builds the artifact resolver; each result is cloned.
 * @evidence contracts/common.md#clear-and-simple-design The facade owns input and output capture; EvidenceTargetResolverIndex owns artifact parsing, membership and failure classification.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Statement and host records are captured before asynchronous probes; selected IDs are compared by value so later caller mutations cannot stale the scope cache.
 * @evidence contracts/common.md#meaningful-documentation The class and resolve comments explain captured reference ownership, host origins, independent results and incomplete precedence.
 * @evidence contracts/performance.md#efficient-algorithms Linear construction in records; each resolution uses origin and address indexes plus unmatched file probes.
 * @evidence contracts/performance.md#reuse-equivalent-work One resolver serves all statements for this captured population.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The facade owns captured records and indexes; all result copies belong to callers.
 */
export class EvidenceTargetResolver {
  /** Value snapshots isolate mutable caller selections from cached scopes. */
  private readonly selections: EvidenceSelectionSnapshot =
    new EvidenceSelectionSnapshot();

  /** Resolver over records captured at construction. */
  private readonly index: EvidenceTargetResolverIndex;

  /**
   * Captures and validates reference inputs; type is the empty-selection
   * grammar fallback.
   */
  public constructor(
    inventories: IEvidenceInventory[],
    type?: EvidenceArtifactType,
  ) {
    this.index = new EvidenceTargetResolverIndex(
      new EvidenceInventoryIndex(structuredClone(typia.assert(inventories)), {
        fileScopes: true,
      }),
      type,
    );
  }

  /**
   * Resolves a citation using its host origins and selected IDs; incomplete
   * inventories retain precedence.
   *
   * @evidence contracts/common.md#principled-implementation Statement, host and IDs are captured before awaiting; the internal resolver classifies candidates, then its result is cloned.
   * @evidence contracts/common.md#clear-and-simple-design The facade owns input and output capture; EvidenceTargetResolverIndex owns artifact parsing, membership and failure classification.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Statement and host records are captured before asynchronous probes; selected IDs are compared by value so later caller mutations cannot stale the scope cache.
   * @evidence contracts/common.md#meaningful-documentation The class and resolve comments explain captured reference ownership, host origins, independent results and incomplete precedence.
   * @evidence contracts/performance.md#efficient-algorithms Linear in captured input and output plus candidate origins, spellings and file probes.
   * @evidence contracts/performance.md#reuse-equivalent-work The resolver reuses captured file and scope indexes without caching filesystem failures.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The call awaits probes and returns a caller-owned result with no external handles.
   */
  public async resolve(
    statement: IEvidenceTargetStatement,
    host: IEvidenceHost,
    unitIds: string[],
  ): Promise<IEvidenceTargetResolution> {
    return structuredClone(
      await this.index.resolve(
        structuredClone(statement),
        structuredClone(host),
        this.selections.capture(unitIds),
      ),
    );
  }
}
