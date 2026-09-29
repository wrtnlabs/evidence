import type { EvidenceGraphFormat } from "../typings/EvidenceGraphFormat";

/**
 * Parsed request to export evaluated Evidence relationships.
 *
 * Execution retains independent obligation boundaries, semantic and carrier
 * nodes, acknowledgement edges, and separate review relations. The selected
 * formatter presents that analysis without changing its coverage or
 * completeness status.
 */
export interface IEvidenceGraphCommand {
  /**
   * Discriminator selecting graph export.
   *
   * The command analyzes configured populations before serializing their
   * relationships.
   */
  operation: "graph";

  /**
   * Command directory resolved against the invocation base.
   *
   * It anchors configuration, output paths, and file-qualified target display.
   */
  cwd: string;

  /**
   * Configuration path used to build the exported graph.
   *
   * Relative paths resolve from command cwd. Omission discovers
   * evidence.config.ts before evidence.config.json with absence-only fallback.
   */
  config?: string;

  /**
   * Requested graph serialization or visualization format.
   *
   * The command parser validates the graph-specific vocabulary before analysis
   * begins.
   */
  format: EvidenceGraphFormat;

  /**
   * Optional file destination for the formatted graph.
   *
   * Relative paths use command cwd; omission emits the result through standard
   * output.
   */
  output?: string;
}
