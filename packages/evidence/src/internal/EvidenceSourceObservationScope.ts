import { AsyncLocalStorage } from "node:async_hooks";
import type { IEvidenceSourceDependency } from "../structures/IEvidenceSourceDependency";
import type { IEvidenceWatchContentDigest } from "./IEvidenceWatchContentDigest";
import { EvidenceWatchDependencySnapshot } from "./EvidenceWatchDependencySnapshot";

/**
 * Witnesses new watch dependencies before source acquisition.
 *
 * @evidence contracts/common.md#principled-implementation Unknown exact or recursive paths receive a first before-read version; boundary growth is accepted only if every new required witness matches the final snapshot.
 * @evidence contracts/common.md#clear-and-simple-design The watcher owns one observation scope per attempt; collectors only request a before-read witness through observe.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Missing or unequal witnesses reject boundary growth; configuration dependency growth still requires the watcher to retry independently.
 * @evidence contracts/common.md#meaningful-documentation Comments distinguish existing baseline paths from newly witnessed exact and recursive paths and explain the acceptance condition.
 * @evidence contracts/performance.md#efficient-algorithms Known paths use the existing baseline; each unknown path and recursion mode is captured once, and validation is linear in required dependencies plus metadata and content observation.
 * @evidence contracts/performance.md#reuse-equivalent-work In-flight observations share exact dependency identity within one attempt; configuration-boundary changes still trigger fresh evaluation.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The watch attempt owns version promises and releases them after acceptance or retry; snapshot capture hashes and releases file bytes.
 */
export class EvidenceSourceObservationScope {
  /**
   * Observations remain isolated across concurrent watchers and finite
   * commands.
   */
  private static readonly scope: AsyncLocalStorage<EvidenceSourceObservationScope> =
    new AsyncLocalStorage();

  /** Existing baseline keyed separately for exact and recursive observation. */
  private readonly known: Set<string>;

  /** First before-read witness for every newly encountered dependency. */
  private readonly witnesses: Map<
    string,
    Promise<EvidenceWatchDependencySnapshot>
  > = new Map();

  /** Associates this attempt with its existing baseline and digest owner. */
  public constructor(
    dependencies: IEvidenceSourceDependency[],
    private readonly digests: Map<string, IEvidenceWatchContentDigest>,
  ) {
    this.known = new Set(
      dependencies.flatMap((entry: IEvidenceSourceDependency): string[] =>
        entry.recursive
          ? [identity(entry), identity({ path: entry.path, recursive: false })]
          : [identity(entry)],
      ),
    );
  }

  /**
   * Runs analysis with this attempt's before-read observer available to
   * collectors.
   *
   * @evidence contracts/common.md#principled-implementation Async-local binding makes this attempt's observer available throughout the supplied asynchronous analysis without changing its result.
   * @evidence contracts/common.md#clear-and-simple-design The method only establishes scope; collectors request witnesses through observe and the watcher decides acceptance through validates.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts It executes the supplied operation directly and introduces no cached configuration result or replacement method.
   * @evidence contracts/common.md#meaningful-documentation The summary identifies the before-read observer and collector boundary.
   * @evidence contracts/performance.md#efficient-algorithms Scope setup is constant work; the operation owns its analysis and observation costs.
   * @evidence contracts/performance.md#reuse-equivalent-work All collectors in this attempt see the same observer; concurrent attempts use their own scope objects.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The async-local binding follows the operation's lifetime; the watcher drops this attempt owner after acceptance or retry.
   */
  public run<Value>(operation: () => Promise<Value>): Promise<Value> {
    return EvidenceSourceObservationScope.scope.run(this, operation);
  }

  /**
   * Captures a first version before a collector reads the dependency.
   *
   * @evidence contracts/common.md#principled-implementation The active scope checks baseline membership and records one snapshot promise before the first acquisition of each unknown exact or recursive dependency.
   * @evidence contracts/common.md#clear-and-simple-design This entry coalesces first observations while EvidenceWatchDependencySnapshot owns metadata and content capture.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Without an active attempt or for an already known dependency it does nothing; an unknown dependency is never accepted from an after-read observation.
   * @evidence contracts/common.md#meaningful-documentation The summary states the before-read timing requirement and scope fields distinguish known paths from witnesses.
   * @evidence contracts/performance.md#efficient-algorithms Known paths need expected constant-time membership; a first recursive witness costs its observed subtree metadata and uncached bytes.
   * @evidence contracts/performance.md#reuse-equivalent-work The exact path plus recursive mode shares pending or completed capture only within this attempt, using the watcher's metadata-qualified digest cache.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The attempt retains one version promise per newly observed path and mode; snapshot capture releases handles and raw file bytes before resolving.
   */
  public static async observe(
    dependency: IEvidenceSourceDependency,
  ): Promise<void> {
    const scope: EvidenceSourceObservationScope | undefined =
      this.scope.getStore();
    if (scope === undefined || scope.known.has(identity(dependency))) return;
    const key: string = identity(dependency);
    let pending: Promise<EvidenceWatchDependencySnapshot> | undefined =
      scope.witnesses.get(key);
    if (pending === undefined) {
      pending = EvidenceWatchDependencySnapshot.capture(
        [dependency],
        scope.digests,
      );
      scope.witnesses.set(key, pending);
    }
    await pending;
  }

  /**
   * Accepts boundary growth only when all new before-read witnesses match.
   *
   * @evidence contracts/common.md#principled-implementation Every required dependency outside the original baseline must have a first witness equal to its corresponding final snapshot selection.
   * @evidence contracts/common.md#clear-and-simple-design This method owns boundary-growth acceptance only; the watcher separately compares the unchanged baseline and configuration dependencies.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts A missing or unequal witness returns false immediately instead of treating the final snapshot as a valid initial version.
   * @evidence contracts/common.md#meaningful-documentation The summary states the complete new-witness matching condition.
   * @evidence contracts/performance.md#efficient-algorithms It visits required dependencies once and compares only their recorded version data, with no filesystem acquisition.
   * @evidence contracts/performance.md#reuse-equivalent-work Previously captured witnesses and the caller's final snapshot are reused; this method captures no replacement baseline.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Only local keys and comparison selections are allocated; borrowed witness promises stay with the attempt until the watcher discards it.
   */
  public async validates(
    dependencies: IEvidenceSourceDependency[],
    after: EvidenceWatchDependencySnapshot,
  ): Promise<boolean> {
    for (const dependency of dependencies) {
      const key: string = identity(dependency);
      if (this.known.has(key)) continue;
      const witness: Promise<EvidenceWatchDependencySnapshot> | undefined =
        this.witnesses.get(key);
      if (
        witness === undefined ||
        !(await witness).equals(after.select([dependency]))
      )
        return false;
    }
    return true;
  }
}

/** Distinguishes exact and recursive witnesses of the same authored path. */
function identity(dependency: IEvidenceSourceDependency): string {
  return `${dependency.recursive ? "recursive" : "exact"}:${dependency.path}`;
}
