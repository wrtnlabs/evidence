import type { IEvidenceAdapter } from "@wrtnlabs/evidence";

/**
 * Supplies a language-specific expression-string carrier for shared
 * regressions.
 *
 * The source factory embeds authored data in a public declaration while keeping
 * real documentation independently selectable as a preservation control.
 */
export interface IEvidenceLiteralFixture {
  /**
   * Adapter whose inventory is compared before and after changing literal data.
   *
   * Each instance analyzes fresh snapshots without graph policy shortcuts.
   */
  adapter: IEvidenceAdapter;

  /**
   * File spelling selecting the fixture's grammar and module identity.
   *
   * All comparisons use this same source path so identities remain stable.
   */
  file: string;

  /**
   * Constructs valid source with literal data and an optional real annotation.
   *
   * Factories encode the data according to their language's string syntax.
   */
  source: (data: string, documentation: string) => string;
}
