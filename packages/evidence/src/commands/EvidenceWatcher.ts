import path from "node:path";
import typia from "typia";

import { EvidenceConfigDependencyScanner } from "../internal/EvidenceConfigDependencyScanner";
import { EvidenceTreeSitterAssetScope } from "../internal/EvidenceTreeSitterAssetScope";
import { EvidenceParserError } from "../parsers/EvidenceParserError";
import type { IEvidenceConfigDependencyScan } from "../internal/IEvidenceConfigDependencyScan";
import type { IEvidenceWatchAttempt } from "../internal/IEvidenceWatchAttempt";
import { EvidenceSourcePath } from "../internal/EvidenceSourcePath";
import { EvidenceWatchDependencySet } from "../internal/EvidenceWatchDependencySet";
import { EvidenceWatchDependencySnapshot } from "../internal/EvidenceWatchDependencySnapshot";
import type { IEvidenceCheckAnalysis } from "../structures/IEvidenceCheckAnalysis";
import type { IEvidenceSourceDependency } from "../structures/IEvidenceSourceDependency";
import type { IEvidenceWatchCheckCycle } from "../structures/IEvidenceWatchCheckCycle";
import type { IEvidenceWatchFailureCycle } from "../structures/IEvidenceWatchFailureCycle";
import type { IEvidenceWatchOptions } from "../structures/IEvidenceWatchOptions";
import type { EvidenceWatchPublisher } from "../typings/EvidenceWatchPublisher";
import { EvidenceChecker } from "../EvidenceChecker";
import { EvidenceConfigLoader } from "../loaders/EvidenceConfigLoader";
import { EvidenceQuery } from "../graph/EvidenceQuery";

/**
 * Rechecks active dependencies and publishes stable results in sequence.
 *
 * Start one watch loop per instance and supply an awaited publisher. Each
 * attempt reevaluates configuration and source dependencies, then verifies that
 * its input snapshots stayed stable before publishing. Failed attempts retain
 * dependencies needed to observe repairs; parser acquisition also retries
 * without a file edit.
 *
 * Close stops future publication, interrupts pending delays, and cancels this
 * watcher's asset subscriptions. Await the watch promise to observe completion
 * of any analysis or publisher already in progress.
 *
 * @example
 *   const watcher: EvidenceWatcher = new EvidenceWatcher(
 *     "evidence.config.ts",
 *   );
 *   const watching: Promise<void> = watcher.watch(
 *     async (cycle: EvidenceWatchCycle): Promise<void> => {
 *       console.log(cycle.cycle, cycle.status);
 *     },
 *   );
 *   // When the application shuts down:
 *   await watcher.close();
 *   await watching;
 */
export class EvidenceWatcher {
  /**
   * Explicit absolute configuration anchor captured before observation begins.
   *
   * Omission retains conventional discovery rather than becoming an explicit TS
   * path. Explicit paths do not fall back after deletion or failure.
   */
  private readonly configFile: string | undefined;

  /**
   * Working directory captured for all configuration discovery attempts.
   *
   * Later process cwd changes cannot redirect selection or dependency scans.
   */
  private readonly cwd: string;

  /**
   * Target spellings captured for each cycle's focused report.
   *
   * Omission publishes full checks. Copying prevents caller mutation from
   * changing the watch selection after construction.
   */
  private readonly only: string[] | undefined;

  /**
   * Whether focused reports omit descendants of the named targets.
   *
   * Applies only when an only-selection was supplied.
   */
  private readonly shallow: boolean;

  /**
   * Interval between dependency snapshots during idle observation.
   *
   * Close can interrupt the pending delay rather than waiting out this
   * interval.
   */
  private readonly pollIntervalMilliseconds: number;

  /**
   * Quiet interval used to coalesce related filesystem edits.
   *
   * A changed snapshot restarts settling; zero permits immediate reevaluation.
   */
  private readonly debounceMilliseconds: number;

  /**
   * Retry interval for parser assets that may recover without a filesystem
   * edit.
   *
   * Only acquisition-related failures activate this timer; other stable
   * failures wait for a dependency change.
   */
  private readonly parserRetryMilliseconds: number;

  /**
   * Cancellation owner for parser acquisitions within this watch loop.
   *
   * Closing aborts these subscriptions without cancelling unrelated subscribers
   * that may share the underlying asset transfer.
   */
  private readonly cancellation = new AbortController();

  /**
   * Dependencies whose changes can trigger the next evaluation.
   *
   * Failures retain previously known paths and newly discovered candidates so
   * missing imports or targets can recover after repair.
   */
  private active: IEvidenceSourceDependency[];

  /**
   * Whether the instance has already entered its single allowed watch loop.
   *
   * The guard prevents concurrent loops from sharing cycle and dependency
   * state.
   */
  private started = false;

  /**
   * Shutdown state checked between asynchronous analysis and publication
   * phases.
   *
   * A completed attempt is discarded if shutdown was requested before
   * publication.
   */
  private closed = false;

  /**
   * Resolver that interrupts the current polling or settling delay.
   *
   * Each delay clears only its own resolver so stale completion cannot erase a
   * newer wake callback.
   */
  private wake: (() => void) | undefined;

  /**
   * Sequence number of the most recently admitted publication.
   *
   * Stable failures advance the sequence like normal reports; unstable attempts
   * repeat before a new number is committed.
   */
  private cycles = 0;

  /**
   * Captures the configuration anchor and validates observation timing.
   *
   * Construction prepares fallback dependencies but does not evaluate
   * configuration or start polling. Omitted timing options use the documented
   * watch defaults. Omitted configuration paths discover TS before JSON on
   * every evaluation, and candidate changes remain watched after failures.
   */
  public constructor(
    configFile: string | undefined = undefined,
    options: IEvidenceWatchOptions = {},
  ) {
    const checked: IEvidenceWatchOptions = typia.assert(options);
    if (checked.shallow === true && checked.only === undefined)
      throw new Error("Shallow watch selection requires only targets.");
    this.cwd = path.resolve(checked.cwd ?? process.cwd());
    this.only = checked.only === undefined ? undefined : [...checked.only];
    this.shallow = checked.shallow === true;
    this.configFile =
      configFile === undefined ? undefined : path.resolve(this.cwd, configFile);
    this.pollIntervalMilliseconds = checked.pollIntervalMilliseconds ?? 250;
    this.debounceMilliseconds = checked.debounceMilliseconds ?? 100;
    this.parserRetryMilliseconds = checked.parserRetryMilliseconds ?? 5_000;
    this.active = configurationFallback(
      this.configFile ?? path.join(this.cwd, "evidence.config.ts"),
    );
  }

  /**
   * Returns the current dependency set without exposing mutable watcher state.
   *
   * Before the first analysis this contains configuration fallback paths; after
   * evaluation it includes discovered inputs and repair dependencies.
   */
  public dependencies(): IEvidenceSourceDependency[] {
    return structuredClone(this.active);
  }

  /**
   * Publishes an initial check and subsequent stable reevaluations until
   * shutdown.
   *
   * The publisher is awaited, preserving cycle order and applying backpressure.
   * Starting twice or after close rejects. Analysis failures become cycle data;
   * a publisher exception escapes and closes the loop in cleanup.
   */
  public async watch(publish: EvidenceWatchPublisher): Promise<void> {
    if (this.started)
      throw new Error("An Evidence Graph watcher can be started only once.");
    if (this.closed)
      throw new Error("A closed Evidence Graph watcher cannot be started.");
    this.started = true;

    try {
      let attempt = await this.evaluate();
      if (this.isClosed()) return;
      this.active = attempt.dependencies;
      this.cycles = attempt.cycle.cycle;
      await publish(attempt.cycle);
      let baseline = attempt.snapshot;
      // Acquisition can recover while source snapshots remain identical. Keep
      // that retry deadline independent from ordinary filesystem invalidation.
      let retryAt = attempt.retryParser
        ? Date.now() + this.parserRetryMilliseconds
        : Infinity;

      while (!this.isClosed()) {
        await this.pause(this.pollIntervalMilliseconds);
        if (this.isClosed()) break;
        const changed = await EvidenceWatchDependencySnapshot.capture(
          this.active,
        );
        if (changed.equals(baseline) && Date.now() < retryAt) continue;

        await this.settle(changed);
        if (this.isClosed()) break;
        attempt = await this.evaluate();
        if (this.isClosed()) break;
        this.active = attempt.dependencies;
        this.cycles = attempt.cycle.cycle;
        await publish(attempt.cycle);
        baseline = attempt.snapshot;
        retryAt = attempt.retryParser
          ? Date.now() + this.parserRetryMilliseconds
          : Infinity;
      }
    } finally {
      this.closed = true;
      this.wake = undefined;
    }
  }

  /**
   * Requests shutdown and wakes any polling or settling delay immediately.
   *
   * Asset subscriptions owned by this watcher are cancelled. This method does
   * not join the active watch loop; await its watch promise to finish
   * outstanding analysis or publication work.
   */
  public async close(): Promise<void> {
    this.closed = true;
    this.cancellation.abort();
    this.wake?.();
  }

  /**
   * Runs an attempt under this watcher's execution-local asset cancellation.
   *
   * An inherited caller signal remains effective alongside watcher shutdown,
   * and the scope reaches parsers created by configuration scanning as well as
   * analysis.
   */
  private async evaluate(): Promise<IEvidenceWatchAttempt> {
    const inherited = EvidenceTreeSitterAssetScope.current().signal;
    const signal =
      inherited === undefined
        ? this.cancellation.signal
        : AbortSignal.any([inherited, this.cancellation.signal]);
    return EvidenceTreeSitterAssetScope.run({ signal }, () =>
      this.evaluateStable(),
    );
  }

  /**
   * Repeats analysis until dependency discovery and source snapshots agree.
   *
   * Newly discovered paths enlarge the observed boundary before acceptance.
   * Input changes during evaluation cause another attempt, while stable
   * failures retain enough dependency state for a later repair to trigger
   * reevaluation.
   */
  private async evaluateStable(): Promise<IEvidenceWatchAttempt> {
    for (;;) {
      if (this.isClosed()) {
        const snapshot = await EvidenceWatchDependencySnapshot.capture(
          this.active,
        );
        return {
          cycle: failureCycle(
            this.cycles + 1,
            this.configFile ?? path.join(this.cwd, "evidence.config.ts"),
            new Error("The Evidence Graph watcher was closed."),
          ),
          dependencies: this.active,
          snapshot,
          retryParser: false,
        };
      }
      const beforeConfig: IEvidenceConfigDependencyScan =
        await scanConfiguration(this.configFile, this.cwd);
      const candidates = EvidenceWatchDependencySet.merge(
        this.active,
        beforeConfig.dependencies,
      );
      const before = await EvidenceWatchDependencySnapshot.capture(candidates);

      let analysis: IEvidenceCheckAnalysis | undefined;
      let analysisCause: unknown;
      try {
        if (beforeConfig.configFile === undefined) throw beforeConfig.cause;
        analysis = await EvidenceChecker.analyze(beforeConfig.configFile);
        if (this.only !== undefined)
          analysis.report = await EvidenceQuery.check(
            analysis,
            this.cwd,
            this.only,
            this.shallow,
          );
      } catch (cause) {
        analysisCause = cause;
      }
      const afterConfig: IEvidenceConfigDependencyScan =
        await scanConfiguration(this.configFile, this.cwd);
      const scanCause = afterConfig.cause;
      const cause = analysisCause ?? scanCause;
      // A failed evaluation cannot replace the previous dependency set with a
      // smaller partial discovery, or repairing a lost input might never wake us.
      const active: IEvidenceSourceDependency[] =
        EvidenceWatchDependencySet.merge(
          configurationCandidates(this.configFile, this.cwd),
          analysis === undefined
            ? EvidenceWatchDependencySet.merge(
                this.active,
                afterConfig.dependencies,
              )
            : cause === undefined
              ? EvidenceWatchDependencySet.analysis(
                  analysis,
                  afterConfig.dependencies,
                )
              : EvidenceWatchDependencySet.merge(
                  this.active,
                  afterConfig.dependencies,
                  EvidenceWatchDependencySet.analysis(analysis, []),
                ),
        );

      const retryParser =
        parserFailure(cause) ||
        (analysis !== undefined &&
          analysis.report.diagnostics.some((diagnostic) =>
            /(?:^|-)asset-(?:download|cache|corrupt)$/u.test(diagnostic.code),
          ));
      if (!EvidenceWatchDependencySet.contains(candidates, active)) {
        this.active = active;
        // A preparation failure already proves this cycle incomplete. Publish it
        // before retrying, while still recording every newly discovered dependency.
        if (!retryParser) continue;
      }
      const after = await EvidenceWatchDependencySnapshot.capture(
        EvidenceWatchDependencySet.merge(candidates, active),
      );
      // Compare the same pre-analysis boundary. A report built across two source
      // versions must be retried rather than published as a stable cycle.
      if (
        beforeConfig.configFile !== afterConfig.configFile ||
        !before.equals(after.select(candidates))
      ) {
        this.active = active;
        continue;
      }

      const number = this.cycles + 1;
      const cycle =
        analysis !== undefined && cause === undefined
          ? checkCycle(number, analysis)
          : failureCycle(
              number,
              beforeConfig.configFile ??
                this.configFile ??
                path.join(this.cwd, "evidence.config.ts"),
              cause,
            );
      return {
        cycle,
        dependencies: active,
        snapshot: after.select(active),
        retryParser,
      };
    }
  }

  /**
   * Waits until watched inputs remain unchanged for one quiet interval.
   *
   * Further edits restart the interval. Shutdown and zero debounce skip
   * additional waiting so the outer loop can handle cancellation or evaluate
   * immediately.
   */
  private async settle(
    initial: EvidenceWatchDependencySnapshot,
  ): Promise<EvidenceWatchDependencySnapshot> {
    let previous = initial;
    while (!this.isClosed() && this.debounceMilliseconds !== 0) {
      await this.pause(this.debounceMilliseconds);
      if (this.isClosed()) return previous;
      const current = await EvidenceWatchDependencySnapshot.capture(
        this.active,
      );
      if (current.equals(previous)) return current;
      previous = current;
    }
    return previous;
  }

  /**
   * Waits for a deadline or an explicit shutdown wake, whichever occurs first.
   *
   * One completion closure owns timer cleanup and resolver removal, avoiding a
   * double completion when close races the timer callback.
   */
  private async pause(milliseconds: number): Promise<void> {
    if (this.isClosed()) return;
    await new Promise<undefined>((resolve) => {
      let settled = false;
      const complete = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.wake === complete) this.wake = undefined;
        resolve(undefined);
      };
      const timer = setTimeout(complete, milliseconds);
      this.wake = complete;
    });
  }

  /**
   * Reads shutdown state after asynchronous boundaries.
   *
   * The loop checks this before starting another phase or publishing a
   * completed attempt, since close can run while an awaited operation is
   * pending.
   */
  private isClosed(): boolean {
    return this.closed;
  }
}

/**
 * Preserves discovered configuration dependencies even when scanning throws.
 *
 * Missing or malformed imports must remain observable for recovery; propagating
 * only the exception would discard the scanner's partial dependency knowledge.
 */
async function scanConfiguration(
  configFile: string | undefined,
  cwd: string,
): Promise<IEvidenceConfigDependencyScan> {
  const candidates: IEvidenceSourceDependency[] = configurationCandidates(
    configFile,
    cwd,
  );
  let selected: string;
  try {
    selected = await EvidenceConfigLoader.locate(configFile, cwd);
  } catch (cause: unknown) {
    return { dependencies: candidates, cause };
  }
  const scanner: EvidenceConfigDependencyScanner =
    new EvidenceConfigDependencyScanner(selected);
  try {
    return {
      configFile: selected,
      dependencies: EvidenceWatchDependencySet.merge(
        candidates,
        await scanner.scan(),
      ),
    };
  } catch (cause) {
    return {
      configFile: selected,
      dependencies: EvidenceWatchDependencySet.merge(
        candidates,
        scanner.list(),
      ),
      cause,
    };
  }
}

/**
 * Retains logical candidates independently of a selected physical config file.
 *
 * Symlink replacement and the appearance of a higher-priority TS entry must
 * wake implicit discovery even after a successful JSON analysis.
 */
function configurationCandidates(
  configFile: string | undefined,
  cwd: string,
): IEvidenceSourceDependency[] {
  const files: string[] =
    configFile === undefined
      ? [
          path.join(cwd, "evidence.config.ts"),
          path.join(cwd, "evidence.config.json"),
        ]
      : [configFile];
  return files.map((file: string): IEvidenceSourceDependency => ({
    path: EvidenceSourcePath.slash(file),
    recursive: false,
  }));
}

/**
 * Wraps a fresh report with its watch publication sequence.
 *
 * Outcome fields are copied from the report so stream consumers and full-report
 * consumers observe the same completeness and failure semantics.
 */
function checkCycle(
  cycle: number,
  analysis: IEvidenceCheckAnalysis,
): IEvidenceWatchCheckCycle {
  return {
    schemaVersion: 1,
    command: "check",
    watch: true,
    cycle,
    status: analysis.report.status,
    success: analysis.report.success,
    exitCode: analysis.report.exitCode,
    report: analysis.report,
  };
}

/**
 * Builds a watch result when no normal report can represent the attempt.
 *
 * The envelope retains configuration context and repair guidance while allowing
 * the watcher to continue observing the dependencies of this failed cycle.
 */
function failureCycle(
  cycle: number,
  configFile: string,
  cause: unknown,
): IEvidenceWatchFailureCycle {
  return {
    schemaVersion: 1,
    command: "check",
    watch: true,
    cycle,
    status: "failed",
    success: false,
    exitCode: 2,
    configFile,
    message: cause instanceof Error ? cause.message : String(cause),
    repair:
      "Correct the current configuration, dependency, or source failure. Parser acquisition failures retry automatically; other failures retry after the next filesystem change.",
  };
}

/**
 * Identifies parser preparation failures eligible for timed recovery.
 *
 * Download, cache, and integrity failures can change independently of watched
 * inputs; source syntax or configuration errors instead wait for an edit.
 */
function parserFailure(cause: unknown): boolean {
  return (
    cause instanceof EvidenceParserError &&
    ["asset-download", "asset-cache", "asset-corrupt"].includes(cause.code)
  );
}

/**
 * Seeds observation before a configuration dependency graph is available.
 *
 * Watching the configuration path and its directory permits recovery when the
 * file or a nearby imported input is initially missing or cannot be evaluated.
 */
function configurationFallback(
  configFile: string,
): IEvidenceSourceDependency[] {
  const normalized = EvidenceSourcePath.slash(configFile);
  return [
    { path: normalized, recursive: false },
    {
      path: EvidenceSourcePath.slash(path.dirname(normalized)),
      recursive: true,
    },
  ];
}
