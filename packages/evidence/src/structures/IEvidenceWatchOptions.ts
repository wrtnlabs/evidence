import type { tags } from "typia";

/**
 * Configuration anchor and timing controls for dependency observation.
 *
 * The watcher compares dependency snapshots and waits for a quiet period before
 * reevaluation. Parser acquisition has a separate retry clock because network
 * or cache recovery may happen without any watched filesystem change.
 */
export interface IEvidenceWatchOptions {
  /**
   * Directory anchoring configuration discovery and relative explicit paths.
   *
   * Omission captures process cwd during construction. Subsequent cwd changes
   * cannot redirect the watcher. Implicit selection is repeated on each cycle.
   */
  cwd?: string;

  /**
   * Positive delay between dependency snapshots, in milliseconds.
   *
   * Shorter intervals detect changes sooner while performing filesystem
   * inspection more often. Omission uses 250 milliseconds.
   *
   * @default 250
   */
  pollIntervalMilliseconds?: number & tags.Type<"uint32"> & tags.Minimum<1>;

  /**
   * Quiet period required before checking a changed snapshot, in milliseconds.
   *
   * Further changes restart settling. Zero skips the quiet wait; omission uses
   * 100 milliseconds to coalesce a burst of related edits.
   *
   * @default 100
   */
  debounceMilliseconds?: number & tags.Type<"uint32">;

  /**
   * Positive delay before retrying failed parser acquisition, in milliseconds.
   *
   * The retry can trigger without a source edit, allowing download, cache, or
   * integrity failures to recover. Omission waits five seconds.
   *
   * @default 5000
   */
  parserRetryMilliseconds?: number & tags.Type<"uint32"> & tags.Minimum<1>;
}
