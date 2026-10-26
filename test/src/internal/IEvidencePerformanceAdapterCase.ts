import type { IEvidenceAdapter } from "@wrtnlabs/evidence";

/**
 * Supported source generator and independently counted output for a scale
 * regression.
 */
export interface IEvidencePerformanceAdapterCase {
  /** Real extraction boundary under test. */
  adapter: IEvidenceAdapter;

  /** Grammar-selecting logical source name. */
  file: string;

  /** Source wrapper before the repeated independent declarations. */
  prefix: string;

  /** One supported declaration group for a distinct authored index. */
  item: (index: number) => string;

  /** Source wrapper after the declarations. */
  suffix: string;

  /** Exact expected number of semantic units. */
  units: number;
}
