import type { IEvidenceDelimitedOptions } from "../../structures/IEvidenceDelimitedOptions";
import type { EvidenceDelimitedType } from "../../typings/EvidenceDelimitedType";

/**
 * Lexical rules shared by CSV and TSV row extraction, targets, and
 * configuration.
 *
 * Keys become the part of a target after `#`, so they must stay one token for
 * every tag parser: no whitespace, control or format characters, `#`, or `"`.
 * Composite keys join their parts with `:`, which the parts therefore exclude.
 * Annotations inside one evidence cell are separated where a tag token follows
 * whitespace, because a TSV cell cannot contain a line break.
 *
 * @evidence contracts/common.md#principled-implementation Key, joiner, tag-boundary and option rules are stated once and reused by the scanner, the target parser and configuration validation, so the three cannot disagree.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns lexical rules only; reading records and materializing units belong to the reader and scanner.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsafe key characters are rejected rather than escaped, so no second key spelling can name the same row.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains why each rule exists; every export is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; its regular expressions are module constants.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; the module constants are immutable.
 */
export namespace EvidenceDelimitedSyntax {
  /**
   * Separator between the parts of a composite key in a row address.
   *
   * `["crm", "sales"]` is addressed as `crm:sales`.
   */
  export const JOINER: string = ":";

  /**
   * Narrows an artifact discriminator to a delimited-text dialect.
   *
   * @evidence contracts/common.md#principled-implementation Membership in the two dialect literals is the whole test.
   * @evidence contracts/common.md#clear-and-simple-design The guard lets shared modules branch on ledgers without repeating the literals.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No extension or file content takes part in the decision.
   * @evidence contracts/common.md#meaningful-documentation The comment states what the guard narrows.
   * @evidence contracts/performance.md#efficient-algorithms Two string comparisons.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work The comparison is cheaper than any cache.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The guard keeps no state after returning.
   */
  export function is(type: string | undefined): type is EvidenceDelimitedType {
    return type === "csv" || type === "tsv";
  }

  /**
   * Returns the display name of a dialect for diagnostics.
   *
   * @evidence contracts/common.md#principled-implementation Each dialect maps to its conventional uppercase name.
   * @evidence contracts/common.md#clear-and-simple-design One mapping serves every diagnostic.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts The name depends only on the dialect.
   * @evidence contracts/common.md#meaningful-documentation The comment states the purpose.
   * @evidence contracts/performance.md#efficient-algorithms One comparison.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work The comparison is cheaper than any cache.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning.
   */
  export function label(type: EvidenceDelimitedType): string {
    return type === "csv" ? "CSV" : "TSV";
  }

  /**
   * Explains why one key part cannot be an address, or returns undefined.
   *
   * The part is checked as written; callers trim key cells first. `composite`
   * additionally forbids the joiner so the joined address splits back into
   * exactly the configured parts.
   *
   * @evidence contracts/common.md#principled-implementation Emptiness, then one character-class test for whitespace, control and format characters, '#' and '"', then the joiner for composite parts.
   * @evidence contracts/common.md#clear-and-simple-design One function returns the repair text both the scanner and the target parser report.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Invisible format characters are rejected so two keys that look equal cannot address different rows.
   * @evidence contracts/common.md#meaningful-documentation The comment states the trimming precondition and the composite rule.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the key length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each key is checked once.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning.
   */
  export function keyProblem(
    part: string,
    composite: boolean,
  ): string | undefined {
    if (part === "") return "Give every row a nonempty key value.";
    if (UNSAFE_KEY.test(part))
      return "Remove whitespace, control characters, '#', and '\"' from the key value; keys are one target token.";
    if (composite && part.includes(JOINER))
      return `Remove '${JOINER}' from composite key parts; it joins the parts in the row address.`;
    return undefined;
  }

  /**
   * Lists configuration problems of delimited column options.
   *
   * Validation and the public adapter constructor both use this list, so the
   * same options are accepted everywhere. Messages name the offending field
   * relative to `path`.
   *
   * @evidence contracts/common.md#principled-implementation The key is normalized to its part list, then emptiness, duplicate parts, an empty evidence column and an evidence column that is also a key column are each reported.
   * @evidence contracts/common.md#clear-and-simple-design Problems are returned, not thrown, so configuration validation can aggregate them with other entries.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts An evidence column that is also a key would remove identity from fingerprints, so it is refused.
   * @evidence contracts/common.md#meaningful-documentation The comment states the shared use and the path prefix.
   * @evidence contracts/performance.md#efficient-algorithms Linear in key parts with one set.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Options are validated once per configuration or adapter.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The returned list is owned by the caller.
   */
  export function optionProblems(
    path: string,
    options: IEvidenceDelimitedOptions,
  ): string[] {
    const problems: string[] = [];
    const keys: string[] = keyColumns(options);
    if (keys.length === 0)
      problems.push(
        `${path}.key: name at least one header; a row needs a key to have an address.`,
      );
    const seen: Set<string> = new Set();
    for (const key of keys) {
      if (key === "")
        problems.push(`${path}.key: header names cannot be empty.`);
      else if (seen.has(key))
        problems.push(
          `${path}.key: header '${key}' is repeated; each composite part names a different column.`,
        );
      seen.add(key);
    }
    if (options.evidenceColumn === "")
      problems.push(`${path}.evidenceColumn: header names cannot be empty.`);
    else if (
      options.evidenceColumn !== undefined &&
      seen.has(options.evidenceColumn)
    )
      problems.push(
        `${path}.evidenceColumn: '${options.evidenceColumn}' is a key column; annotations cannot share a column with row identity.`,
      );
    return problems;
  }

  /**
   * Returns the configured key headers as a list.
   *
   * @evidence contracts/common.md#principled-implementation A single header becomes a one-element list; a composite list is copied.
   * @evidence contracts/common.md#clear-and-simple-design Callers handle one shape instead of two.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts The copy keeps callers from mutating the configuration.
   * @evidence contracts/common.md#meaningful-documentation The comment states the normalization.
   * @evidence contracts/performance.md#efficient-algorithms Linear in key parts.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Normalization is cheaper than any cache.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The returned list is owned by the caller.
   */
  export function keyColumns(options: IEvidenceDelimitedOptions): string[] {
    return Array.isArray(options.key) ? [...options.key] : [options.key];
  }

  /**
   * Offsets in one evidence cell's text where a later annotation begins.
   *
   * A boundary is a tag token preceded by a space or tab and followed by
   * whitespace or the end of the text. The first annotation of a cell needs no
   * boundary because it already starts a line.
   *
   * @evidence contracts/common.md#principled-implementation One global scan with a lookbehind finds tag tokens that follow inline whitespace, which is the boundary rule for single-line cells.
   * @evidence contracts/common.md#clear-and-simple-design The scanner turns these offsets into line breaks for the shared tag parser.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Tokens glued to other text, such as {@link, are not boundaries.
   * @evidence contracts/common.md#meaningful-documentation The comment states the boundary rule and the first-annotation case.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the cell length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each cell is scanned once.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The returned list is owned by the caller.
   */
  export function tagBoundaries(text: string): number[] {
    return Array.from(
      text.matchAll(BOUNDARY),
      (match: RegExpExecArray): number => match.index,
    );
  }

  /**
   * Offset of the first tag token at the start of the text or after any
   * whitespace, or the text length when there is none.
   *
   * Text before this offset is not part of any annotation, so the scanner
   * reports it when it is not blank. Line breaks count as whitespace, which
   * keeps the result stable after boundaries are rewritten as line breaks.
   *
   * @evidence contracts/common.md#principled-implementation One search for a tag token preceded by the text start or whitespace finds where the first annotation begins.
   * @evidence contracts/common.md#clear-and-simple-design The scanner slices the leading text with this offset.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Prose before the first tag is located instead of silently ignored.
   * @evidence contracts/common.md#meaningful-documentation The comment states the result, its use and why line breaks count.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the cell length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each cell is searched once.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning.
   */
  export function firstTag(text: string): number {
    return FIRST.exec(text)?.index ?? text.length;
  }
}

/** Characters that cannot appear in a key part. */
const UNSAFE_KEY: RegExp = /[\s#"\p{Cc}\p{Cf}]/u;

/** A tag token that follows inline whitespace. */
const BOUNDARY: RegExp =
  /(?<=[ \t])@(?:evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link)(?=\s|$)/gu;

/** A tag token at the start of the text or after any whitespace. */
const FIRST: RegExp =
  /(?<=^|\s)@(?:evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link)(?=\s|$)/u;
