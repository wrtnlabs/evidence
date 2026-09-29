import type { IEvidenceCheckContext } from "./contexts/IEvidenceCheckContext";
import { EvidenceConfigLoader } from "./loaders/EvidenceConfigLoader";
import { EvidenceCheckProgrammer } from "./programmers/EvidenceCheckProgrammer";
import type { IEvidenceCheckAnalysis } from "./structures/IEvidenceCheckAnalysis";
import type { IEvidenceCheckReport } from "./structures/IEvidenceCheckReport";
import type { IEvidenceConfigPlan } from "./structures/IEvidenceConfigPlan";

/**
 * Runs configuration-driven extraction, target resolution, and graph
 * evaluation.
 *
 * Use `check` for the command report, or `analyze` when queries also need the
 * captured inventories and graph relationships. Both operations reload the
 * configured file. `evaluate` accepts an already resolved plan and captures its
 * own copy before loading the selected populations.
 *
 * Each invocation owns its execution context. Reusing a checker does not retain
 * coverage or diagnostics from a previous run, and concurrent evaluations can
 * use different plans without sharing mutable claim state. Static methods offer
 * the same operations for callers that do not need to retain a facade.
 *
 * @example
 *   const checker: EvidenceChecker = new EvidenceChecker(
 *     "evidence.config.ts",
 *   );
 *   const report: IEvidenceCheckReport = await checker.check();
 *   // A subsequent call reloads the configuration and selected source files.
 *   const updated: IEvidenceCheckReport = await checker.check();
 */
export class EvidenceChecker {
  /**
   * Configuration location used by `analyze` and `check`.
   *
   * Retaining a path does not retain its contents. Every invocation reloads the
   * file so edits and recovery from an earlier load failure remain observable.
   */
  private readonly configFile: string | undefined;

  /**
   * Selects the configuration file for subsequent checks.
   *
   * Construction performs no file access or parser initialization. Omission
   * discovers `evidence.config.ts`, then `evidence.config.json` only when the
   * TS entry is absent. Selection happens on each invocation; an explicit path
   * never falls back.
   */
  public constructor(configFile?: string) {
    this.configFile = configFile;
  }

  /**
   * Reloads configuration and returns the complete analysis of its populations.
   *
   * The result retains graph input, graph evaluation, and the command report
   * for queries against the same source snapshots. Configuration loading
   * failures reject the call; materialized analysis findings remain in the
   * result.
   */
  public async analyze(): Promise<IEvidenceCheckAnalysis> {
    return this.evaluate(await EvidenceConfigLoader.plan(this.configFile));
  }

  /**
   * Analyzes one configuration through a temporary checker.
   *
   * This is the static convenience form of the instance `analyze` operation. It
   * returns captured graph context as well as the report, suitable for a
   * subsequent list, inspection, or graph export without another source load.
   * Omission discovers TS before JSON with absence-only fallback.
   */
  public static async analyze(
    configFile?: string,
  ): Promise<IEvidenceCheckAnalysis> {
    return new EvidenceChecker(configFile).analyze();
  }

  /**
   * Runs a fresh analysis and returns its command-facing result.
   *
   * Use this when counts, diagnostics, and exit status are sufficient. Call
   * `analyze` instead when the caller also needs materialized units for
   * queries.
   */
  public async check(): Promise<IEvidenceCheckReport> {
    return (await this.analyze()).report;
  }

  /**
   * Checks one configuration without retaining a facade.
   *
   * The configuration and its selected sources are loaded for this invocation.
   * The returned report has the same status and diagnostic semantics as the
   * instance `check` method. Omission discovers TS before JSON with
   * absence-only fallback.
   */
  public static async check(
    configFile?: string,
  ): Promise<IEvidenceCheckReport> {
    return new EvidenceChecker(configFile).check();
  }

  /**
   * Materializes and evaluates an explicitly supplied configuration plan.
   *
   * The plan is cloned before asynchronous extraction begins, isolating this
   * invocation from caller mutation. It supplies resolved configuration policy;
   * selected source inventories are still loaded afresh for the evaluation.
   */
  public async evaluate(
    input: IEvidenceConfigPlan,
  ): Promise<IEvidenceCheckAnalysis> {
    // Capture policy before awaiting extraction so a caller cannot change the
    // plan halfway through building this invocation's independent populations.
    const plan = structuredClone(input);
    const context: IEvidenceCheckContext = {
      plan,
      claims: await EvidenceCheckProgrammer.materialize(plan),
    };
    return EvidenceCheckProgrammer.evaluate(context);
  }

  /**
   * Evaluates a resolved plan through a temporary checker.
   *
   * The plan supplies its configuration location and is copied by the instance
   * operation. This entry point skips configuration loading while retaining
   * fresh source materialization and per-invocation graph state.
   */
  public static async evaluate(
    input: IEvidenceConfigPlan,
  ): Promise<IEvidenceCheckAnalysis> {
    return new EvidenceChecker(input.configFile).evaluate(input);
  }
}
