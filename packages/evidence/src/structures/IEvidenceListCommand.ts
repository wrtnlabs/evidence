import type { EvidenceArtifactType } from "../typings/EvidenceArtifactType";
import type { EvidenceReportFormat } from "../typings/EvidenceReportFormat";
import type { EvidenceSymbol } from "../typings/EvidenceSymbol";

/**
 * Parsed request to enumerate addressable units from a configured analysis.
 *
 * Language and kind filter displayed rows after the complete check is analyzed.
 * They do not narrow evaluation or erase diagnostics from populations omitted
 * by the list filters.
 */
export interface IEvidenceListCommand {
  /**
   * Discriminator selecting target discovery.
   *
   * The result includes public spellings and structural selection state for
   * each row.
   */
  operation: "list";

  /**
   * Command working directory resolved against the invocation base.
   *
   * It anchors configuration, output, and file-qualified target display without
   * mutating the process working directory.
   */
  cwd: string;

  /**
   * Configuration path relative to the resolved command directory.
   *
   * Omission discovers evidence.config.ts before evidence.config.json. A
   * selected invalid file or an explicit path never falls back.
   */
  config?: string;

  /**
   * Text or JSON representation of the discovery report.
   *
   * The parser defaults to text while both formats retain the analysis outcome.
   */
  format: EvidenceReportFormat;

  /**
   * Optional destination file relative to the command directory.
   *
   * Omission returns report content through the command's standard output
   * channel.
   */
  output?: string;

  /**
   * Optional artifact-family filter for returned rows.
   *
   * Omission retains every family; supplied values must have a shipped adapter.
   */
  language?: EvidenceArtifactType;

  /**
   * Optional symbol-kind filter applied to discovered units.
   *
   * Omission retains all kinds; filtering does not recompute the coverage
   * denominator.
   */
  kind?: EvidenceSymbol;
}
