import type { IEvidenceResolvedAcknowledgement } from "./IEvidenceResolvedAcknowledgement";
import type { IEvidenceResolvedReview } from "./IEvidenceResolvedReview";
import type { EvidenceAcknowledgementKind } from "../typings/EvidenceAcknowledgementKind";
/**
 * Pairs reviews and acknowledgements by kind, target and their supported host
 * identity.
 *
 * @evidence contracts/common.md#principled-implementation Attached reviews use overlapping semantic owners; reviews without owners match exact documentation hosts. Earliest matching review positions win.
 * @evidence contracts/common.md#clear-and-simple-design Document-host and semantic-owner maps express the two review-host rules, and insertion positions keep first-review precedence.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Ownerless reviews match exact documentation hosts while attached reviews match semantic owners; original review positions preserve precedence.
 * @evidence contracts/common.md#meaningful-documentation Comments distinguish documentation hosts from semantic owners and state earliest-review selection.
 * @evidence contracts/performance.md#efficient-algorithms Linear construction in owner relations and constant lookups per queried owner, independent of unrelated statements.
 * @evidence contracts/performance.md#reuse-equivalent-work The obligation builds one index after resolving its statements and reuses it for orphan, kind and freshness checks.
 * @evidence contracts/performance.md#bound-retention-and-release-resources Only the current obligation records are retained until evaluation returns.
 */
export class EvidenceGraphReviewIndex {
  /** First acknowledgement per semantic owner. */
  private readonly acknowledgements: Map<
    string,
    IEvidenceResolvedAcknowledgement
  > = new Map();

  /**
   * First acknowledgement per exact documentation host, including attached
   * ones.
   */
  private readonly documents: Map<string, IEvidenceResolvedAcknowledgement> =
    new Map();

  /** First review position per semantic owner or unattached document key. */
  private readonly reviews: Map<string, number> = new Map();

  /** Original review order for stable first-match choice. */
  private readonly records: IEvidenceResolvedReview[];

  /** Indexes the complete independent statement lists in their processing order. */
  public constructor(
    acknowledgements: IEvidenceResolvedAcknowledgement[],
    records: IEvidenceResolvedReview[],
  ) {
    this.records = records;
    for (const entry of acknowledgements) {
      const document: string = JSON.stringify([
        entry.declaration.kind,
        entry.targetUnitId,
        entry.declaration.hostId,
      ]);
      if (!this.documents.has(document)) this.documents.set(document, entry);
      for (const host of entry.hostUnitIds) {
        const key: string = JSON.stringify([
          entry.declaration.kind,
          entry.targetUnitId,
          host,
        ]);
        if (!this.acknowledgements.has(key))
          this.acknowledgements.set(key, entry);
      }
    }
    records.forEach(
      (entry: IEvidenceResolvedReview, position: number): void => {
        const keys: string[] =
          entry.hostUnitIds.length === 0
            ? [
                JSON.stringify([
                  entry.review.reviews,
                  entry.targetUnitId,
                  "document",
                  entry.review.hostId,
                ]),
              ]
            : entry.hostUnitIds.map((host: string): string =>
                JSON.stringify([
                  entry.review.reviews,
                  entry.targetUnitId,
                  "unit",
                  host,
                ]),
              );
        for (const key of keys)
          if (!this.reviews.has(key)) this.reviews.set(key, position);
      },
    );
  }

  /**
   * Finds an acknowledgement compatible with a review host and kind.
   *
   * @evidence contracts/common.md#principled-implementation Ownerless reviews use exact documentation-host keys; attached reviews use semantic-owner keys with the same kind and target.
   * @evidence contracts/common.md#clear-and-simple-design Document-host and semantic-owner maps express the two review-host rules, and insertion positions keep first-review precedence.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Ownerless reviews match exact documentation hosts while attached reviews match semantic owners; original review positions preserve precedence.
   * @evidence contracts/common.md#meaningful-documentation Comments distinguish documentation hosts from semantic owners and state earliest-review selection.
   * @evidence contracts/performance.md#efficient-algorithms One document lookup or one lookup per semantic owner.
   * @evidence contracts/performance.md#reuse-equivalent-work The statement relation maps were built once for this obligation.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The returned statement borrows the current obligation and no new state is retained.
   */
  public acknowledgement(
    record: IEvidenceResolvedReview,
    kind: EvidenceAcknowledgementKind,
  ): IEvidenceResolvedAcknowledgement | undefined {
    if (record.hostUnitIds.length === 0)
      return this.documents.get(
        JSON.stringify([kind, record.targetUnitId, record.review.hostId]),
      );
    for (const host of record.hostUnitIds) {
      const entry: IEvidenceResolvedAcknowledgement | undefined =
        this.acknowledgements.get(
          JSON.stringify([kind, record.targetUnitId, host]),
        );
      if (entry !== undefined) return entry;
    }
    return undefined;
  }

  /**
   * Finds the earliest review matching an accepted edge.
   *
   * @evidence contracts/common.md#principled-implementation Ownerless document matches and attached semantic-owner matches are compared by their original review position.
   * @evidence contracts/common.md#clear-and-simple-design Document-host and semantic-owner maps express the two review-host rules, and insertion positions keep first-review precedence.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Ownerless reviews match exact documentation hosts while attached reviews match semantic owners; original review positions preserve precedence.
   * @evidence contracts/common.md#meaningful-documentation Comments distinguish documentation hosts from semantic owners and state earliest-review selection.
   * @evidence contracts/performance.md#efficient-algorithms One lookup per host owner plus a document lookup.
   * @evidence contracts/performance.md#reuse-equivalent-work Repeated freshness and wrong-kind queries reuse the same record index.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Only local lookup keys are allocated and the result borrows the obligation.
   */
  public review(
    kind: EvidenceAcknowledgementKind,
    target: string,
    hostId: string,
    hosts: string[],
  ): IEvidenceResolvedReview | undefined {
    let first: number =
      this.reviews.get(JSON.stringify([kind, target, "document", hostId])) ??
      this.records.length;
    for (const host of hosts)
      first = Math.min(
        first,
        this.reviews.get(JSON.stringify([kind, target, "unit", host])) ??
          this.records.length,
      );
    return this.records[first];
  }
}
