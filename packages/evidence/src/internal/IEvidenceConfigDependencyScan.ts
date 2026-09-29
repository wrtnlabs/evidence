import type { IEvidenceSourceDependency } from "../structures/IEvidenceSourceDependency";

/**
 * Dependencies found while scanning a configuration module graph.
 *
 * A failure does not erase prior discoveries: watch mode needs these paths to
 * observe the repair that makes evaluation possible again.
 */
export interface IEvidenceConfigDependencyScan {
  /**
   * Physical configuration selected before dependency scanning begins.
   *
   * Omission means discovery failed. Watch compares selections across analysis
   * so a newly preferred candidate cannot publish a result from the old file.
   */
  configFile?: string;

  /**
   * File and directory dependencies that must invalidate configuration
   * evaluation.
   *
   * `EvidenceConfigDependencyScanner` records resolved module files, package
   * boundaries, and missing resolution candidates here so watch mode can rerun
   * evaluation after either a content edit or a filesystem-topology repair.
   */
  dependencies: IEvidenceSourceDependency[];

  /**
   * Read, parse, or resolution failure after recoverable dependencies were
   * recorded.
   *
   * Omission means scanning completed. When present, callers retain
   * `dependencies` instead of replacing them with an empty watch set that could
   * miss the change which repairs the configuration graph.
   */
  cause?: unknown;
}
