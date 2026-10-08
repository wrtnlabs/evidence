import path from "node:path";
import type { IEvidenceQueryContext } from "../contexts/IEvidenceQueryContext";
import { EvidenceQueryProgrammer } from "../programmers/EvidenceQueryProgrammer";
import { EvidenceUnitCheckProgrammer } from "../programmers/EvidenceUnitCheckProgrammer";
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
   * Lists selected identities and addressable ancestors with optional display
   * filters.
   *
   * Language and kind restrict returned rows without changing the check's
   * diagnostic or success state. Aliases remain grouped under each
   * population-qualified identity.
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
   * This query performs no new source extraction or graph evaluation.
   */
  public async check(
    targets: readonly string[],
    shallow: boolean = false,
  ): Promise<IEvidenceCheckReport> {
    const selected: string[] = [...targets];
    return structuredClone(
      await EvidenceUnitCheckProgrammer.check(this.context, selected, shallow),
    );
  }

  /**
   * Focuses a check through an independently captured query snapshot.
   *
   * Uses inspect's target grammar and the supplied cwd. Unknown, hidden,
   * ambiguous, and incomplete requests return failing check reports.
   */
  public static async check(
    analysis: IEvidenceCheckAnalysis,
    cwd: string,
    targets: readonly string[],
    shallow: boolean = false,
  ): Promise<IEvidenceCheckReport> {
    return new EvidenceQuery(analysis, cwd).check(targets, shallow);
  }

  /**
   * Exports independent obligation boundaries, nodes, acknowledgements, and
   * reviews.
   *
   * EvidenceNode identities include their boundary so repeated populations
   * retain separate coverage. Reviews remain distinct relations and never
   * become acknowledgement edges.
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
   */
  public static languages(): IEvidenceLanguagesReport {
    return EvidenceQueryProgrammer.languages();
  }
}
