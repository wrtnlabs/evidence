import type { IEvidenceClaimContext } from "../contexts/IEvidenceClaimContext";
import type { IEvidenceGraphClaim } from "../structures/IEvidenceGraphClaim";
import type { IEvidenceGraphResolution } from "../structures/IEvidenceGraphResolution";
import type { IEvidenceGraphReviewResolution } from "../structures/IEvidenceGraphReviewResolution";
import type { IEvidenceTargetStatement } from "../structures/IEvidenceTargetStatement";
import type { EvidenceTargetResolutionStatus } from "../typings/EvidenceTargetResolutionStatus";

/**
 * Decides which claim answers for an annotation that several claims can see.
 *
 * Claims that select the same host files read the same annotations, yet each
 * annotation cites one population. A claim whose references do not contain the
 * cited target has nothing to say about it, and must not report the annotation
 * as its own mistake while another claim's reference accepts the citation.
 *
 * Ownership compares how far each claim's resolution got:
 *
 * 1. No selected active reference: the annotation never reached a population.
 * 2. `missing-file` or `out-of-population`: the cited file is outside every
 *    selected reference.
 * 3. `missing-member`: the file or schema is selected, but it has no such address.
 * 4. Every other status, including `resolved`: the target belongs to this claim,
 *    so its outcome, an error included, is the claim's own.
 *
 * A claim disowns an annotation only when another active claim holds the same
 * annotation at a strictly higher level. Ties stay with every claim, so an
 * annotation that no claim accepts, such as a mistyped file, still fails
 * instead of vanishing.
 */
export namespace EvidenceStatementOwnership {
  /**
   * Withdraws every annotation that another active claim owns from a claim.
   *
   * The call mutates the supplied contexts and graph claims in place. A
   * disowned annotation loses its reference resolutions and its participation
   * entry, so neither the graph nor the participation report evaluates it for
   * that claim. Both arrays are indexed by claim position.
   */
  export function release(
    contexts: IEvidenceClaimContext[],
    claims: IEvidenceGraphClaim[],
  ): void {
    const levels: Map<string, number>[] = claims.map(measure);
    claims.forEach((claim: IEvidenceGraphClaim, index: number): void => {
      const context: IEvidenceClaimContext | undefined = contexts[index];
      if (context === undefined)
        throw new Error(`Graph claim ${index} has no preparation context.`);
      const own: Map<string, number> | undefined = levels[index];
      if (own === undefined)
        throw new Error(`Graph claim ${index} has no ownership levels.`);
      const lost: Set<string> = new Set<string>();
      for (const [key, level] of own)
        if (
          levels.some(
            (other: Map<string, number>, position: number): boolean =>
              position !== index && (other.get(key) ?? -1) > level,
          )
        )
          lost.add(key);
      if (lost.size === 0) return;

      const declarations: Set<string> = new Set<string>();
      for (const declaration of claim.inventory.declarations)
        if (lost.has(declarationKey(declaration, declaration.kind)))
          declarations.add(declaration.id);
      const reviews: Set<string> = new Set<string>();
      for (const review of claim.inventory.reviews)
        if (lost.has(reviewKey(review, review.reviews))) reviews.add(review.id);

      for (const id of declarations) context.declarations.delete(id);
      for (const id of reviews) context.reviews.delete(id);
      for (const reference of claim.references) {
        reference.resolutions = reference.resolutions.filter(
          (entry: IEvidenceGraphResolution): boolean =>
            !declarations.has(entry.declarationId),
        );
        if (reference.reviewResolutions !== undefined)
          reference.reviewResolutions = reference.reviewResolutions.filter(
            (entry: IEvidenceGraphReviewResolution): boolean =>
              !reviews.has(entry.reviewId),
          );
      }
    });
  }

  /**
   * Records the highest resolution level each annotation reached in one claim.
   *
   * An inactive claim yields no entries: it evaluates nothing, so it can
   * neither own an annotation nor lose one. In an active claim, an annotation
   * whose references are all inactive or never selected keeps level 0.
   */
  function measure(claim: IEvidenceGraphClaim): Map<string, number> {
    const output: Map<string, number> = new Map<string, number>();
    if (claim.severity === "off") return output;

    const declarations: Map<string, string> = new Map<string, string>();
    for (const declaration of claim.inventory.declarations) {
      const key: string = declarationKey(declaration, declaration.kind);
      declarations.set(declaration.id, key);
      output.set(key, 0);
    }
    const reviews: Map<string, string> = new Map<string, string>();
    for (const review of claim.inventory.reviews) {
      const key: string = reviewKey(review, review.reviews);
      reviews.set(review.id, key);
      output.set(key, 0);
    }

    for (const reference of claim.references) {
      if (reference.severity === "off") continue;
      for (const entry of reference.resolutions)
        lift(output, declarations.get(entry.declarationId), entry);
      for (const entry of reference.reviewResolutions ?? [])
        lift(output, reviews.get(entry.reviewId), entry);
    }
    return output;
  }

  /** Stores the larger of the recorded level and the level of one status. */
  function lift(
    output: Map<string, number>,
    key: string | undefined,
    entry: IEvidenceGraphResolution | IEvidenceGraphReviewResolution,
  ): void {
    if (key === undefined) return;
    output.set(
      key,
      Math.max(output.get(key) ?? 0, level(entry.resolution.status)),
    );
  }

  /** Maps a resolution status to its ownership level. */
  function level(status: EvidenceTargetResolutionStatus): number {
    if (status === "missing-file" || status === "out-of-population") return 1;
    return status === "missing-member" ? 2 : 3;
  }

  /**
   * Identifies one authored acknowledgement across independently loaded claim
   * inventories.
   *
   * Claim inventories assign their own IDs, so the authored kind, target, and
   * source span are the only identity that two claims share.
   */
  function declarationKey(
    statement: IEvidenceTargetStatement,
    kind: string,
  ): string {
    return identity("declaration", statement, kind);
  }

  /** Identifies one authored review across claim inventories. */
  function reviewKey(
    statement: IEvidenceTargetStatement,
    kind: string,
  ): string {
    return identity("review", statement, kind);
  }

  /** Serializes the authored identity shared by every claim reading a span. */
  function identity(
    family: "declaration" | "review",
    statement: IEvidenceTargetStatement,
    kind: string,
  ): string {
    return JSON.stringify([
      family,
      kind,
      statement.target,
      statement.location.file,
      statement.location.range ?? null,
    ]);
  }
}
