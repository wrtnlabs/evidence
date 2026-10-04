/**
 * How far one claim's resolution of an annotation got, and at what severity.
 *
 * Statement ownership compares these records between claims that read the same
 * annotation. A record describes one claim only; it never merges the outcomes
 * of different references into a shared obligation.
 */
export interface IEvidenceStatementStanding {
  /**
   * Furthest resolution level reached across the claim's active references.
   *
   * 0 means no active reference selected the annotation, 1 a cited file outside
   * every selected reference, 2 a selected file or schema without the cited
   * address, and 3 any other outcome, `resolved` included.
   */
  level: number;

  /**
   * Severity rank of the findings the claim reports for this annotation.
   *
   * 2 is `error` and 1 is `warning`. A claim that selected no reference reports
   * participation findings at error severity; otherwise the rank follows the
   * reference that reached `level`, taking the higher rank on a tie.
   */
  severity: number;

  /**
   * Whether the reference that reached `level` resolved the target cleanly.
   *
   * A resolved citation raises no resolution finding, so its severity cannot
   * hide another claim's finding.
   */
  resolved: boolean;
}
