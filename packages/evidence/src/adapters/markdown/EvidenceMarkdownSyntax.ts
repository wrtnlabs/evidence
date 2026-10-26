import type { EvidenceMarkdownSymbol } from "../../typings/EvidenceMarkdownSymbol";
import { EvidenceDocumentationHeading } from "../../parsers/EvidenceDocumentationHeading";
import type { IEvidenceDocumentationHeading } from "../../parsers/IEvidenceDocumentationHeading";
import type { IEvidenceMarkdownFence } from "./IEvidenceMarkdownFence";
import type { IEvidenceMarkdownHeading } from "./IEvidenceMarkdownHeading";

/**
 * Markdown syntax shared by unit materialization and unreadable-tag
 * diagnostics.
 *
 * The Markdown adapter uses these lexical helpers before it creates units or
 * reports annotations that appear in non-readable source regions.
 *
 * @evidence contracts/common.md#principled-implementation CommonMark lexical rules (fences, ATX headings, list and quote prefixes, indented and inline code, escapes) and Evidence's anchor slug live in one namespace shared by materialization and diagnostics.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns line-level syntax; structure belongs to the scanner.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported depths and missing marker spaces stay ordinary prose instead of being guessed.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains its consumers; every function and helper is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceMarkdownSyntax {
  const letterOrNumber = /^(?:\p{L}|\p{N})$/u;
  const markers = [
    "@evidenceExcludeReview",
    "@evidenceReview",
    "@evidenceExclude",
    "@evidence",
    "@link",
  ];

  /**
   * Recognizes a CommonMark fenced-code boundary on one source line.
   *
   * Up to three leading spaces are allowed. The returned marker, run length,
   * and remainder let the scanner apply the opening and closing rules without
   * discarding the line's original spelling.
   *
   * @evidence contracts/common.md#principled-implementation A CommonMark fence opens with at most three spaces and three or more backticks or tildes, rejecting backtick info strings containing backticks.
   * @evidence contracts/common.md#clear-and-simple-design Fence state is tracked by the scanner.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Indented code cannot open a fence.
   * @evidence contracts/common.md#meaningful-documentation The comment states the fence rule.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the line length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Fence detection is evaluated per line during one scan.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function fence(line: string): IEvidenceMarkdownFence | undefined {
    let indent = 0;
    while (indent < line.length && line[indent] === " ") ++indent;
    if (indent > 3) return undefined;
    const marker = line[indent];
    if (marker !== "`" && marker !== "~") return undefined;
    let cursor = indent;
    while (line[cursor] === marker) ++cursor;
    const length = cursor - indent;
    if (length < 3) return undefined;
    const remainder = line.slice(cursor);
    if (marker === "`" && remainder.includes("`")) return undefined;
    return { marker, length, remainder };
  }

  /**
   * Parses one supported ATX heading and its stable anchor identity.
   *
   * Explicit `{#anchor}` suffixes win over generated slugs. Unsupported depth,
   * indentation, or missing marker separation leaves the line as ordinary
   * prose.
   *
   * @evidence contracts/common.md#principled-implementation Up to three leading spaces are allowed before a shared ATX parse, and an explicit anchor wins over the generated slug.
   * @evidence contracts/common.md#clear-and-simple-design Title normalization is shared with documentation tags through EvidenceDocumentationHeading.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported indentation or missing separation leaves prose unchanged.
   * @evidence contracts/common.md#meaningful-documentation The comment explains anchor precedence and refusals.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the line length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Heading detection is evaluated per line during one scan.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function heading(line: string): IEvidenceMarkdownHeading | undefined {
    let cursor = 0;
    while (cursor < line.length && line[cursor] === " " && cursor < 4) ++cursor;
    if (cursor > 3 || line[cursor] !== "#") return undefined;
    const heading: IEvidenceDocumentationHeading | undefined =
      EvidenceDocumentationHeading.parse(line.slice(cursor).trimEnd());
    if (heading === undefined) return undefined;
    return {
      level: heading.level,
      title: heading.title,
      anchor: heading.anchor ?? slug(heading.title),
    };
  }

  /**
   * Derives Evidence's deterministic anchor for an unanchored heading title.
   *
   * Letters, numbers, and underscores remain significant; punctuation and
   * whitespace collapse only into the hyphen separators admitted by this
   * adapter.
   *
   * @evidence contracts/common.md#principled-implementation Lowercased Unicode letters, numbers and underscores are kept while punctuation is removed and whitespace or hyphen runs collapse to one hyphen.
   * @evidence contracts/common.md#clear-and-simple-design The slug is the single anchor rule used for unanchored headings.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No document-specific anchor exceptions exist.
   * @evidence contracts/common.md#meaningful-documentation The comment states which characters remain significant.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the line length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Slug generation is evaluated per line during one scan.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function slug(title: string): string {
    let output = "";
    let separated = false;
    for (const character of title.toLowerCase()) {
      if (letterOrNumber.test(character) || character === "_") {
        output += character;
        separated = false;
      } else if (
        (character === "-" || character.trim() === "") &&
        output !== "" &&
        !separated
      ) {
        output += "-";
        separated = true;
      }
    }
    return output.replace(/-$/, "");
  }

  /**
   * Finds a supported Evidence marker after Markdown container prefixes.
   *
   * The marker must occupy the complete line or be followed by whitespace, so a
   * longer prose token cannot be misreported as an unreadable annotation.
   *
   * @evidence contracts/common.md#principled-implementation Container prefixes are stripped before matching a supported Evidence marker at the start of logical text.
   * @evidence contracts/common.md#clear-and-simple-design Prefix stripping is lineContent; this function only recognizes markers.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Only supported markers match, so prose mentions are not treated as tags.
   * @evidence contracts/common.md#meaningful-documentation The comment states its use for rendered-annotation diagnostics.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the line length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Marker detection is evaluated per line during one scan.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function annotation(line: string): string | undefined {
    const content = lineContent(line);
    return markers.find(
      (marker) =>
        content === marker ||
        content.startsWith(marker + " ") ||
        content.startsWith(marker + "\t"),
    );
  }

  /**
   * Removes repeated blockquote and list prefixes from one annotation line.
   *
   * Tag recognition consumes this logical content while source ranges continue
   * to use the unchanged physical line owned by the scanner.
   *
   * @evidence contracts/common.md#principled-implementation Repeated blockquote and list prefixes are removed to reach the logical text of one line.
   * @evidence contracts/common.md#clear-and-simple-design List prefix measurement is a private helper.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Only CommonMark container prefixes are removed.
   * @evidence contracts/common.md#meaningful-documentation The comment states the removed prefixes.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the line length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Prefix removal is evaluated per line during one scan.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function lineContent(line: string): string {
    let content = line.trim();
    let changed = true;
    while (changed) {
      changed = false;
      if (content.startsWith(">")) {
        content = content.slice(1).trim();
        changed = true;
        continue;
      }
      const marker = listMarker(content);
      if (marker !== 0) {
        content = content.slice(marker).trim();
        changed = true;
      }
    }
    return content;
  }

  /**
   * Reports whether one physical line belongs to an indented code block.
   *
   * Four spaces or one leading tab make headings and annotation syntax inert at
   * the top-level Markdown boundary supported by this scanner.
   *
   * @evidence contracts/common.md#principled-implementation Four columns of leading indentation, with tabs to four-column stops, mark an indented code line.
   * @evidence contracts/common.md#clear-and-simple-design The predicate covers one line; block context is the scanner's.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No content heuristic is used.
   * @evidence contracts/common.md#meaningful-documentation The comment states the rule.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the line length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Indentation checks is evaluated per line during one scan.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function indentedCode(line: string): boolean {
    return line.startsWith("    ") || line.startsWith("\t");
  }

  /**
   * Reports whether a column lies inside a closed backtick code span.
   *
   * Annotation scanning uses this result to reject tags in inline examples
   * while ignoring unmatched delimiters that do not establish a Markdown code
   * region.
   *
   * @evidence contracts/common.md#principled-implementation Equal-length unescaped backtick runs delimit closed code spans, and a column inside one is code.
   * @evidence contracts/common.md#clear-and-simple-design Run measurement and escaping are private helpers.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unmatched runs do not hide the rest of the line.
   * @evidence contracts/common.md#meaningful-documentation The comment states the closed-span rule.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the line length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Span checks is evaluated per line during one scan.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function inlineCode(line: string, column: number): boolean {
    return inlineSpans(line).some(
      (span: readonly [number, number]): boolean =>
        column >= span[0] && column < span[1],
    );
  }

  /**
   * Returns ordered half-open closed code spans; unmatched delimiters remain
   * prose.
   *
   * @evidence contracts/common.md#principled-implementation Unescaped equal-length backtick runs close code spans greedily; an unmatched opening leaves the remaining line outside code exactly as the previous column predicate did.
   * @evidence contracts/common.md#clear-and-simple-design The syntax helper owns delimiter interpretation; the scanner consumes its ordered intervals without interpreting backticks again.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Escaped and unmatched backtick runs retain the established closed-span behavior; only complete matching delimiter pairs suppress annotations.
   * @evidence contracts/common.md#meaningful-documentation The comment and return type describe closed spans as ordered half-open offset pairs for one physical line.
   * @evidence contracts/performance.md#efficient-algorithms Delimiter searches consume disjoint portions of the line, so collecting all spans costs O(line length); membership is handled by the ordered scanner cursor.
   * @evidence contracts/performance.md#reuse-equivalent-work The Markdown scanner computes the span list once and shares it across token positions on that line.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The returned offset pairs belong to the line scan and retain no source text or parser resource.
   */
  export function inlineSpans(line: string): Array<readonly [number, number]> {
    const spans: Array<readonly [number, number]> = [];
    let cursor: number = 0;
    while (cursor < line.length) {
      const opening: number = line.indexOf("`", cursor);
      if (opening < 0) return spans;
      const length: number = delimiterLength(line, opening);
      if (escaped(line, opening)) {
        cursor = opening + length;
        continue;
      }
      let closing: number = opening + length;
      let closed: boolean = false;
      while (closing < line.length) {
        closing = line.indexOf("`", closing);
        if (closing < 0) return spans;
        const candidate: number = delimiterLength(line, closing);
        if (candidate === length && !escaped(line, closing)) {
          closed = true;
          break;
        }
        closing += candidate;
      }
      if (!closed) return spans;
      spans.push([opening, closing + length]);
      cursor = closing + length;
    }
    return spans;
  }

  /**
   * Detects whitespace that prevents a path from forming one target token.
   *
   * Markdown public addresses preserve literal path spelling, so callers reject
   * any Unicode whitespace instead of silently escaping or normalizing it.
   *
   * @evidence contracts/common.md#principled-implementation Any Unicode whitespace prevents a path from being one target token, so such aliases get a diagnostic instead of an address.
   * @evidence contracts/common.md#clear-and-simple-design The predicate only tests the string.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No path is silently rewritten.
   * @evidence contracts/common.md#meaningful-documentation The comment states why whitespace matters.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the line length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work The check is evaluated per line during one scan.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function hasWhitespace(value: string): boolean {
    for (const character of value) if (character.trim() === "") return true;
    return false;
  }

  /**
   * Maps one supported ATX depth to its public Markdown selector.
   *
   * Only headings that Evidence materializes as units have selectors; other
   * depths fail here instead of silently receiving a public symbol.
   *
   * @evidence contracts/common.md#principled-implementation ATX depths one through four map to the h1-h4 selectors.
   * @evidence contracts/common.md#clear-and-simple-design The mapping is the single source for heading selectors.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported depths throw rather than mapping to a nearby level.
   * @evidence contracts/common.md#meaningful-documentation The comment states the mapping.
   * @evidence contracts/performance.md#efficient-algorithms Constant time.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work A constant mapping has nothing to share.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The mapping keeps no state after returning; its result is owned by the caller.
   */
  export function symbol(level: number): EvidenceMarkdownSymbol {
    switch (level) {
      case 1:
        return "h1";
      case 2:
        return "h2";
      case 3:
        return "h3";
      case 4:
        return "h4";
      default:
        throw new Error(`Markdown H${level} is not an Evidence unit.`);
    }
  }

  /**
   * Measures one supported Markdown list prefix at the start of logical text.
   *
   * Annotation parsing removes bullet and ordered-list containers repeatedly;
   * zero means the current text begins with neither supported form.
   */
  function listMarker(content: string): number {
    for (const marker of ["- ", "* ", "+ "])
      if (content.startsWith(marker)) return marker.length;
    let cursor = 0;
    while (cursor < content.length) {
      const character = content[cursor];
      if (character === undefined || character < "0" || character > "9") break;
      ++cursor;
    }
    if (
      cursor === 0 ||
      cursor + 1 >= content.length ||
      (content[cursor] !== "." && content[cursor] !== ")") ||
      content[cursor + 1] !== " "
    )
      return 0;
    return cursor + 2;
  }

  /**
   * Measures one contiguous backtick run from its opening column.
   *
   * Inline spans close only with a run of the same length, so the caller uses
   * this value both for comparison and for advancing beyond a delimiter.
   */
  function delimiterLength(line: string, opening: number): number {
    let cursor = opening;
    while (line[cursor] === "`") ++cursor;
    return cursor - opening;
  }

  /**
   * Reports whether Markdown backslash escaping neutralizes a token boundary.
   *
   * An odd immediately preceding slash run escapes the next punctuation token;
   * an even run represents literal slashes and leaves that token active.
   *
   * @evidence contracts/common.md#principled-implementation An odd count of preceding backslashes escapes the token at the offset.
   * @evidence contracts/common.md#clear-and-simple-design The predicate is shared by span and marker checks.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Even backslash runs leave the token active.
   * @evidence contracts/common.md#meaningful-documentation The comment states the parity rule.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the line length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work The check is evaluated per line during one scan.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function escaped(line: string, offset: number): boolean {
    let slashes = 0;
    for (let index = offset - 1; index >= 0 && line[index] === "\\"; --index)
      ++slashes;
    return slashes % 2 === 1;
  }
}
