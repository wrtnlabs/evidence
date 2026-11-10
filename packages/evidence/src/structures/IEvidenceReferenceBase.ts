import type { EvidenceSeverity } from "../typings/EvidenceSeverity";

/**
 * Shared selection and coverage policy for one referenced population.
 *
 * A reference creates an independent obligation within its claim. Ordinary
 * evidence and permitted exclusions cover selected targets and their selected
 * descendants. Unselected structural ancestors can remain addressable so
 * authors can cite an aggregate scope without changing the required
 * population.
 *
 * The optional policies tighten different parts of that obligation:
 *
 * 1. `noEvidenceExclude` requires positive evidence rather than non-applicability.
 * 2. `uniqueEvidence` limits positive semantic hosts for each selected unit.
 * 3. `singleEvidencePerSymbol` requires one selected target per claim host.
 * 4. `requireReview` validates a paired review against current target content.
 *
 * Defaults are permissive. A strict reference and a permissive reference can
 * judge the same annotation differently without changing the shared inventory.
 * Artifact-specific interfaces add file selection and, for Markdown, checklist
 * semantics that require every host to answer every item.
 *
 * @evidence contracts/common.md#principled-implementation Generic type and symbol parameters plus shared policy flags define one referenced population and its coverage rules.
 * @evidence contracts/common.md#clear-and-simple-design Shared policy lives here once; families add only their file fields.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Policies refuse or require behavior explicitly; none can be bypassed by naming.
 * @evidence contracts/common.md#meaningful-documentation The comment explains selection and policy; each field documents its default and effect.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceReferenceBase<
  Type extends string,
  SymbolKind extends string,
> {
  /**
   * Artifact discriminator selecting the reference's extraction and target
   * rules.
   *
   * This can differ from the claim's artifact type. It determines supported
   * symbol selectors and target grammar, not which host language must
   * acknowledge them.
   */
  type: Type;

  /**
   * Base directory for file globs and local file paths.
   *
   * - Defaults to the directory containing evidence.config.ts; relative roots
   *   resolve from that directory.
   * - Accepts absolute paths, directory symlinks, and Windows junctions.
   * - Names one directory, not a glob. Windows drive-relative paths are invalid.
   * - Markdown, CSV, and TSV citations use this root; programming citations use
   *   the citing file. Prisma model addresses do not contain paths.
   */
  root?: string;

  /**
   * Evidence symbol kinds selected as required units.
   *
   * Accepts one kind or a nonempty array. Defaults by family:
   *
   * - Programming: type when supported; otherwise every supported kind.
   * - Database: model.
   * - Markdown: file, h1, h2, h3, h4.
   * - Swagger: operation.
   * - CSV and TSV: row.
   *
   * Unselected structural ancestors remain addressable as aggregate targets.
   */
  symbol?: SymbolKind | SymbolKind[];

  /**
   * Overrides the claim's inherited diagnostic severity.
   *
   * Omit or use `undefined` to inherit. `"off"` disables this reference's
   * population and obligation after validating its configuration shape.
   */
  severity?: EvidenceSeverity | undefined;

  /**
   * Refuses exclusion acknowledgements for this reference.
   *
   * Report refused exclusions at their declarations and leave their targets
   * uncovered unless positive evidence acknowledges them. The same declaration
   * may still cover another reference that allows exclusions.
   *
   * @default false
   */
  noEvidenceExclude?: boolean;

  /**
   * Allows at most one distinct positive claim host per evidence unit.
   *
   * Repeated tags, overloads, and merged declarations do not create extra
   * hosts. Exclusions do not count; an uncited unit still fails coverage.
   *
   * @default false
   */
  uniqueEvidence?: boolean;

  /**
   * Require every selected claim host to cite exactly one selected evidence
   * unit.
   *
   * - Hosts without tags count as zero; repeated citations to one unit count
   *   once.
   * - Aggregate targets count every selected descendant they cover.
   * - An empty reference population is reported as empty and evaluates no hosts.
   *
   * @default false
   */
  singleEvidencePerSymbol?: boolean;

  /**
   * Require a matching review with the current target content fingerprint.
   *
   * - Evidence needs evidenceReview; exclusions need evidenceExcludeReview.
   *   Reviews do not provide coverage.
   * - Reviews carry a #-prefixed fingerprint. Missing or stale reviews fail the
   *   obligation; diagnostics provide the expected fingerprint.
   * - Fingerprints belong to the cited unit and its structural subtree,
   *   independently of reference selectors.
   * - TypeScript fingerprints include nested declarations, even withdrawn ones.
   *   Swagger uses normalized operation content; Prisma uses parsed
   *   declarations without the documentation comments that carry reviews. CSV
   *   and TSV rows use their header-to-value pairs without the evidence
   *   column.
   * - This verifies the recorded review and fingerprint, not the truth of its
   *   prose.
   *
   * @default false
   */
  requireReview?: boolean;
}
