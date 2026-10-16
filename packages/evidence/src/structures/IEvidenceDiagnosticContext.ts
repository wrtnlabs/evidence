/**
 * Bounded source section for one missing Markdown obligation.
 *
 * Coordinates refer to the captured source; text preserves its line endings.
 * Truncation counts describe the portion outside the displayed text.
 *
 * @evidence contracts/common.md#principled-implementation A section carries its reference identity, captured source coordinates, preserved text and explicit truncation.
 * @evidence contracts/common.md#clear-and-simple-design The diagnostic owns a list of independent source sections.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Missing or incomplete source ranges produce no invented section.
 * @evidence contracts/common.md#meaningful-documentation The comment explains source ownership and truncation; each field has a documented meaning.
 * @evidenceExclude contracts/performance.md#efficient-algorithms This data contract chooses no algorithm.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work This data contract performs no work.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources This data contract owns no runtime resource.
 */
export interface IEvidenceDiagnosticContext {
  /** Public target for the required reference unit. */
  target: string;

  /** Physical path of the captured Markdown source. */
  file: string;

  /** One-based first source line of the section. */
  startLine: number;

  /** One-based last source line touched by the section. */
  endLine: number;

  /** Original source text, bounded by line and UTF-16 length. */
  text: string;

  /** True when text ends before the semantic section ends. */
  truncated: boolean;

  /** Original UTF-16 code units withheld by the text bound. */
  omittedCharacters: number;

  /** Original source lines withheld by the text bound. */
  omittedLines: number;
}
