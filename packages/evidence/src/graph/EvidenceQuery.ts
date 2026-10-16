import path from "node:path";
import type { IEvidenceQueryContext } from "../contexts/IEvidenceQueryContext";
import { EvidenceQueryProgrammer } from "../programmers/EvidenceQueryProgrammer";
import { EvidenceUnitCheckProgrammer } from "../programmers/EvidenceUnitCheckProgrammer";
import { enrichCheckContext } from "../programmers/enrichCheckContext";
import type { IEvidenceCheckAnalysis } from "../structures/IEvidenceCheckAnalysis";
import type { IEvidenceCheckReport } from "../structures/IEvidenceCheckReport";
import type { IEvidenceGraphReport } from "../structures/IEvidenceGraphReport";
import type { IEvidenceInspectReport } from "../structures/IEvidenceInspectReport";
import type { IEvidenceLanguagesReport } from "../structures/IEvidenceLanguagesReport";
import type { IEvidenceListReport } from "../structures/IEvidenceListReport";
import type { EvidenceArtifactType } from "../typings/EvidenceArtifactType";
import type { EvidenceSymbol } from "../typings/EvidenceSymbol";

/**
 * Provides queries over one owned analysis snapshot.
 *
 * Construction clones the supplied check analysis and captures an absolute base
 * directory for file-qualified target formatting. List, inspect, and graph
 * queries reuse population indexes without reevaluating configuration or
 * extraction. Returned reports are cloned so caller mutation cannot invalidate
 * later queries.
 *
 * @example
 *   const query: EvidenceQuery = new EvidenceQuery(analysis, process.cwd());
 *   const list: IEvidenceListReport = query.list("typescript", "function");
 *   const first: IEvidenceListReport["items"][number] | undefined =
 *     list.items[0];
 *   if (first !== undefined) await query.inspect(first.target);
 *
 * @evidence contracts/common.md#principled-implementation A facade clones one analysis, resolves the base directory once, and builds population indexes that list, inspect, check and graph queries share.
 * @evidence contracts/common.md#clear-and-simple-design Query logic lives in the programmers; the facade owns the snapshot and clones results.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Queries never re-run configuration or extraction, and caller mutation of results cannot affect later queries.
 * @evidence contracts/common.md#meaningful-documentation The class comment explains ownership and reuse with an example; every method, static form and field is documented.
 * @evidence contracts/performance.md#efficient-algorithms Construction is linear in the analysis size (one clone plus index building).
 * @evidence contracts/performance.md#reuse-equivalent-work Population indexes are built once per facade and reused by every query.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The facade holds its cloned analysis and indexes until it is discarded; no external resource is held.
 */
export class EvidenceQuery {
  /**
   * Analysis snapshot, target base directory, and reusable population indexes.
   *
   * This context owns its input data; programmer results are cloned before
   * leaving the facade.
   */
  private readonly context: IEvidenceQueryContext;

  /**
   * Captures an analysis snapshot and builds indexes for subsequent queries.
   *
   * The base directory is resolved immediately so later process cwd changes do
   * not redirect file-qualified inspection or target formatting.
   */
  public constructor(analysis: IEvidenceCheckAnalysis, cwd: string) {
    const snapshot = structuredClone(analysis);
    this.context = {
      analysis: snapshot,
      cwd: path.resolve(cwd),
      populations: EvidenceQueryProgrammer.populations(snapshot),
    };
  }

  /**
   * Adds captured Markdown source to displayed missing-reference diagnostics.
   *
   * The supplied report may already be focused and windowed. This reads only
   * the analysis snapshot and returns an independently owned report.
   *
   * @evidence contracts/common.md#principled-implementation Structured missing identities select semantic source spans from the same captured analysis.
   * @evidence contracts/common.md#clear-and-simple-design Enrichment is delegated to its programmer without rechecking coverage.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No source is reopened and no diagnostic prose is parsed.
   * @evidence contracts/common.md#meaningful-documentation The comment explains snapshot ownership and report window support.
   * @evidence contracts/performance.md#efficient-algorithms Cost is one enrichment pass and one clone of the returned report.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work The caller supplies already captured inputs for a single enrichment.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The returned report belongs to the caller; no handle is retained.
   */
  public static context(
    analysis: IEvidenceCheckAnalysis,
    report: IEvidenceCheckReport,
  ): IEvidenceCheckReport {
    return structuredClone(enrichCheckContext(analysis, report));
  }

  /**
   * Lists selected identities and addressable ancestors with optional display
   * filters.
   *
   * Language and kind restrict returned rows without changing the check's
   * diagnostic or success state. Aliases remain grouped under each
   * population-qualified identity.
   *
   * @evidence contracts/common.md#principled-implementation Rows come from the shared population indexes with optional language and kind filters applied after analysis.
   * @evidence contracts/common.md#clear-and-simple-design Listing logic is in EvidenceQueryProgrammer.list.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Filters narrow rows only; status still describes the whole check.
   * @evidence contracts/common.md#meaningful-documentation The comment explains filtering and alias grouping.
   * @evidence contracts/performance.md#efficient-algorithms Linear in listed units and their addresses.
   * @evidence contracts/performance.md#reuse-equivalent-work It reuses the facade's population indexes.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The returned report is a clone owned by the caller.
   */
  public list(
    language?: EvidenceArtifactType,
    kind?: EvidenceSymbol,
  ): IEvidenceListReport {
    return structuredClone(
      EvidenceQueryProgrammer.list(this.context, language, kind),
    );
  }

  /**
   * Lists targets through a newly owned query snapshot.
   *
   * Use an instance when several queries should share population indexes; this
   * convenience call captures and indexes the supplied analysis for one
   * operation.
   *
   * @evidence contracts/common.md#principled-implementation The static form captures and indexes the analysis for one listing.
   * @evidence contracts/common.md#clear-and-simple-design It wraps construction plus the instance method.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No separate listing path exists.
   * @evidence contracts/common.md#meaningful-documentation The comment advises using an instance to share indexes.
   * @evidence contracts/performance.md#efficient-algorithms Same as construction plus one listing.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work One-off use builds indexes for a single query by design.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The static form keeps no state after returning; its result is owned by the caller.
   */
  public static list(
    analysis: IEvidenceCheckAnalysis,
    cwd: string,
    language?: EvidenceArtifactType,
    kind?: EvidenceSymbol,
  ): IEvidenceListReport {
    return new EvidenceQuery(analysis, cwd).list(language, kind);
  }

  /**
   * Resolves a target and gathers its evidence context in applicable
   * populations.
   *
   * File-qualified targets use the captured base directory. Artifact-specific
   * grammars retain their own addressing rules, and each population keeps an
   * independent resolution, obligation state, acknowledgements, and reviews.
   *
   * @evidence contracts/common.md#principled-implementation The target is resolved in every applicable population with its own grammar, and each keeps independent resolution, obligation, acknowledgement and review context.
   * @evidence contracts/common.md#clear-and-simple-design Inspection logic is in EvidenceQueryProgrammer.inspect.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts File-qualified targets use the captured base, never the current process cwd.
   * @evidence contracts/common.md#meaningful-documentation The comment explains per-population independence.
   * @evidence contracts/performance.md#efficient-algorithms Linear in applicable populations and their candidates.
   * @evidence contracts/performance.md#reuse-equivalent-work It reuses the facade's population indexes.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The returned report is a clone owned by the caller.
   */
  public async inspect(target: string): Promise<IEvidenceInspectReport> {
    return structuredClone(
      await EvidenceQueryProgrammer.inspect(this.context, target),
    );
  }

  /**
   * Inspects one target through a newly captured analysis context.
   *
   * Input data is isolated before asynchronous resolution begins. Reuse an
   * instance when subsequent inspections should share its population indexes.
   *
   * @evidence contracts/common.md#principled-implementation The static form isolates the analysis before asynchronous resolution and inspects once.
   * @evidence contracts/common.md#clear-and-simple-design It wraps construction plus the instance method.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No separate inspection path exists.
   * @evidence contracts/common.md#meaningful-documentation The comment advises using an instance for repeated inspections.
   * @evidence contracts/performance.md#efficient-algorithms Same as construction plus one inspection.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work One-off use builds indexes for a single query by design.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The static form keeps no state after returning; its result is owned by the caller.
   */
  public static async inspect(
    analysis: IEvidenceCheckAnalysis,
    cwd: string,
    target: string,
  ): Promise<IEvidenceInspectReport> {
    return new EvidenceQuery(analysis, cwd).inspect(target);
  }

  /**
   * Projects the captured check onto selected targets and their descendants.
   *
   * Shallow omits descendants. Reference targets retain incoming coverage and
   * claim targets retain outgoing annotations and host policies. Full policy
   * context is preserved; counts and exit status describe the focused outcome.
   * Context requests retain selected checklist IDs for later source enrichment.
   * This query performs no new source extraction or graph evaluation.
   *
   * @evidence contracts/common.md#principled-implementation The captured check is projected onto selected targets (and descendants unless shallow) while full policy context is kept.
   * @evidence contracts/common.md#clear-and-simple-design Focusing logic is in EvidenceUnitCheckProgrammer.check.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No extraction or evaluation is repeated; counts and exit status describe the focused outcome only.
   * @evidence contracts/common.md#meaningful-documentation The comment explains shallow, claim versus reference targets and preserved policy.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the selected targets' scopes and related statements.
   * @evidence contracts/performance.md#reuse-equivalent-work It reuses the facade's indexes and the existing evaluation.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The returned report is a clone owned by the caller.
   */
  public async check(
    targets: readonly string[],
    shallow: boolean = false,
    context: boolean = false,
  ): Promise<IEvidenceCheckReport> {
    const selected: string[] = [...targets];
    return structuredClone(
      await EvidenceUnitCheckProgrammer.check(
        this.context,
        selected,
        shallow,
        context,
      ),
    );
  }

  /**
   * Focuses a check through an independently captured query snapshot.
   *
   * Uses inspect's target grammar and the supplied cwd. Unknown, hidden,
   * ambiguous, and incomplete requests return failing check reports. Context
   * requests retain selected checklist IDs for later source enrichment.
   *
   * @evidence contracts/common.md#principled-implementation The static form focuses a check through an independently captured snapshot.
   * @evidence contracts/common.md#clear-and-simple-design It wraps construction plus the instance method.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unknown, hidden, ambiguous and incomplete requests return failing reports, as in the instance form.
   * @evidence contracts/common.md#meaningful-documentation The comment states the target grammar and failure behavior.
   * @evidence contracts/performance.md#efficient-algorithms Same as construction plus one focused check.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work One-off use builds indexes for a single query by design.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The static form keeps no state after returning; its result is owned by the caller.
   */
  public static async check(
    analysis: IEvidenceCheckAnalysis,
    cwd: string,
    targets: readonly string[],
    shallow: boolean = false,
    context: boolean = false,
  ): Promise<IEvidenceCheckReport> {
    return new EvidenceQuery(analysis, cwd).check(targets, shallow, context);
  }

  /**
   * Exports independent obligation boundaries, nodes, acknowledgements, and
   * reviews.
   *
   * EvidenceNode identities include their boundary so repeated populations
   * retain separate coverage. Reviews remain distinct relations and never
   * become acknowledgement edges.
   *
   * @evidence contracts/common.md#principled-implementation Boundaries, boundary-qualified nodes, acknowledgement edges and separate review relations are exported from the captured analysis.
   * @evidence contracts/common.md#clear-and-simple-design Export logic is in EvidenceQueryProgrammer.graph.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Reviews never become acknowledgement edges.
   * @evidence contracts/common.md#meaningful-documentation The comment explains boundary-qualified identity.
   * @evidence contracts/performance.md#efficient-algorithms Linear in obligations, nodes and edges.
   * @evidence contracts/performance.md#reuse-equivalent-work It reuses the facade's indexes.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The returned report is a clone owned by the caller.
   */
  public graph(): IEvidenceGraphReport {
    return structuredClone(EvidenceQueryProgrammer.graph(this.context));
  }

  /**
   * Exports a graph through a newly owned query snapshot.
   *
   * The supplied base directory controls file-qualified target display;
   * extraction and evaluation results come entirely from the provided
   * analysis.
   *
   * @evidence contracts/common.md#principled-implementation The static form exports a graph through a newly owned snapshot with the supplied base directory.
   * @evidence contracts/common.md#clear-and-simple-design It wraps construction plus the instance method.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No new extraction occurs.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the base directory's role.
   * @evidence contracts/performance.md#efficient-algorithms Same as construction plus one export.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work One-off use builds indexes for a single export by design.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The static form keeps no state after returning; its result is owned by the caller.
   */
  public static graph(
    analysis: IEvidenceCheckAnalysis,
    cwd: string,
  ): IEvidenceGraphReport {
    return new EvidenceQuery(analysis, cwd).graph();
  }

  /**
   * Lists certified programming and database adapter capabilities.
   *
   * This metadata query requires no configuration, source scan, or grammar load
   * and excludes candidates that only have parsing metadata.
   *
   * @evidence contracts/common.md#principled-implementation Certified capability metadata is reported from the registry without configuration, scanning or grammar loading.
   * @evidence contracts/common.md#clear-and-simple-design It delegates to EvidenceQueryProgrammer.languages.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Candidates with only parsing metadata are excluded.
   * @evidence contracts/common.md#meaningful-documentation The comment states what the query does not require.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the catalog size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Metadata is read fresh per call.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  public static languages(): IEvidenceLanguagesReport {
    return EvidenceQueryProgrammer.languages();
  }
}
