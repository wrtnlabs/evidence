import { EvidenceArrays } from "../internal/EvidenceArrays";
import type { IEvidenceDocumentationFence } from "./IEvidenceDocumentationFence";

/**
 * One HTML or XML markup boundary in mapped documentation text.
 *
 * The tokenizer retains exact source offsets while distinguishing runtime HTML
 * slash behavior from C# XML self-closing elements.
 */
interface IEvidenceHtmlMarkupTag {
  /**
   * Start offset of the opening angle bracket.
   *
   * The inert-code map uses this exact coordinate before pairing the element.
   */
  start: number;

  /**
   * Exclusive offset after the quote-aware closing angle bracket.
   *
   * Masking includes the complete boundary without consuming adjacent prose.
   */
  end: number;

  /**
   * Lowercase element name used to pair nested boundaries.
   *
   * Source spelling is case-insensitive for the supported HTML-style syntax.
   */
  name: string;

  /**
   * Whether the source tag is an end tag.
   *
   * End tags can close only an earlier supported opening of the same name.
   */
  closing: boolean;

  /**
   * Whether slash syntax closes an XML opening at this boundary.
   *
   * HTML mode deliberately ignores this flag for supported non-void elements.
   */
  selfClosing: boolean;
}

/**
 * Coordinates example masking shared by programming-language documentation
 * readers.
 *
 * Several documentation syntaxes permit both Markdown code and HTML example
 * elements. Their precedence must be decided across the whole comment before an
 * adapter looks for Evidence Graph tags; otherwise a literal `<pre>` in one
 * fence can consume real prose and annotations after that fence.
 *
 * @evidence contracts/common.md#principled-implementation Markdown code (fenced, indented, inline) is mapped first across the whole comment, then HTML comments and selected example elements are masked with spaces, so precedence follows CommonMark and literal tags inside code stay inert.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns example masking shared by all documentation readers; tokenizing, marking and hiding are private helpers.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Masking replaces characters with spaces while keeping newlines, so source maps never shift.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains why precedence must be decided before tag scanning; every helper and the private markup record are documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceDocumentationExamples {
  /**
   * Finds the least indentation shared by nonempty documentation lines.
   *
   * Comment-prefix removal can leave one ordinary padding column. Fence and
   * indented-code decisions must measure from that baseline rather than from
   * the physical source column or fully trimmed text.
   *
   * @evidence contracts/common.md#principled-implementation The minimum visual indentation of nonempty lines, with tabs to four-column stops, is the baseline for fence and indented-code decisions.
   * @evidence contracts/common.md#clear-and-simple-design Indentation measurement is a shared private helper.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Blank lines are ignored so they cannot zero the baseline.
   * @evidence contracts/common.md#meaningful-documentation The comment explains why the baseline differs from physical columns.
   * @evidence contracts/performance.md#efficient-algorithms Linear in input length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each comment computes its baseline once per pass.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function baseline(input: string): number {
    const values: number[] = input
      .split("\n")
      .filter((line: string): boolean => line.trim() !== "")
      .map((line: string): number => indentation(line));
    return EvidenceArrays.min(values) ?? 0;
  }

  /**
   * Recognizes one Markdown fence within three columns of a document baseline.
   *
   * Four-column indentation denotes an indented code line and cannot open or
   * close a fence. Backtick info text containing another backtick is likewise
   * rejected by Markdown's fence grammar.
   *
   * @evidence contracts/common.md#principled-implementation A fence opens within three columns of the baseline with at least three backticks or tildes, and backtick info strings may not contain backticks, following CommonMark.
   * @evidence contracts/common.md#clear-and-simple-design The function recognizes one line; fence state is kept by callers.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Four-column indentation is indented code and cannot open a fence.
   * @evidence contracts/common.md#meaningful-documentation The comment states the column and info-string rules.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the line length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each line is classified once.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function fence(
    line: string,
    documentBaseline: number,
  ): IEvidenceDocumentationFence | undefined {
    let cursor: number = 0;
    let columns: number = 0;
    while (cursor < line.length) {
      if (line[cursor] === " ") ++columns;
      else if (line[cursor] === "\t") columns += 4 - (columns % 4);
      else break;
      ++cursor;
    }
    if (columns - documentBaseline < 0 || columns - documentBaseline > 3)
      return undefined;
    const marker: string | undefined = line[cursor];
    if (marker !== "`" && marker !== "~") return undefined;
    const start: number = cursor;
    while (line[cursor] === marker) ++cursor;
    const length: number = cursor - start;
    if (length < 3) return undefined;
    const remainder: string = line.slice(cursor);
    if (marker === "`" && remainder.includes("`")) return undefined;
    return { marker, length, remainder };
  }

  /**
   * Masks HTML example regions without changing source coordinates.
   *
   * Tags inside Markdown fences or closed inline-code spans are literals and do
   * not participate in pairing. In the default HTML mode, slash syntax does not
   * self-close supported non-void elements; C# selects XML mode so its true
   * self-closing elements mask only their tag. Matched regions and openings
   * that remain active through the host end become spaces while CR/LF bytes
   * remain intact, preserving the source map already owned by the adapter.
   *
   * @evidence contracts/common.md#principled-implementation Quote-aware tag tokens are paired by name outside Markdown code; matched and unclosed regions are masked, and XML mode lets true self-closing elements mask only their tag.
   * @evidence contracts/common.md#clear-and-simple-design Markdown mapping, comment hiding and tokenizing are reused private helpers.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts An ancestor close implicitly closes nested selected openings so none can claim the rest of the comment.
   * @evidence contracts/common.md#meaningful-documentation The comment explains precedence, HTML versus XML slash handling and coordinate preservation; inline comments explain implicit closing.
   * @evidence contracts/performance.md#efficient-algorithms Linear in comment length for mapping and tokenizing; pairing searches the open stack, which is shallow in practice.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Masks depend on each comment's text.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The inert map and opening stack are local and released after the call; the caller owns the masked buffer.
   */
  export function maskHtml(
    characters: string[],
    input: string,
    names: readonly string[],
    xmlSelfClosing: boolean = false,
  ): void {
    const inert: boolean[] = mapMarkdownCode(input);
    markExistingMasks(inert, characters, input);
    hideHtmlComments(characters, input, inert);
    const selected: ReadonlySet<string> = new Set(
      names.map((name: string): string => name.toLowerCase()),
    );
    const openings: Array<readonly [string, number]> = [];
    for (const tag of markupTags(input)) {
      if (!selected.has(tag.name) || inert[tag.start] === true) continue;
      const { closing, name, selfClosing } = tag;
      if (!closing && (!selfClosing || !xmlSelfClosing)) {
        openings.push([name, tag.start]);
        continue;
      }
      if (selfClosing && !closing) {
        hide(characters, tag.start, tag.end);
        continue;
      }
      const opening: number = openings.findLastIndex(
        ([candidate]: readonly [string, number]): boolean => candidate === name,
      );
      if (opening < 0) continue;
      hide(characters, openings[opening]?.[1] ?? tag.start, tag.end);
      // Closing an ancestor implicitly closes selected descendants in HTML.
      // Remove them together so none can claim the visible suffix through EOF.
      openings.splice(opening);
    }
    // The earliest unmatched opening owns every later nested or sibling opening
    // through EOF, so one range preserves their complete rendered boundary.
    const unclosed: readonly [string, number] | undefined = openings[0];
    if (unclosed !== undefined) hide(characters, unclosed[1], input.length);
  }

  /**
   * Masks HTML comments before Evidence Graph tag lines are classified.
   *
   * Comment delimiters inside Markdown code remain literal. Closed and unclosed
   * real comments retain their newline bytes and source length so every visible
   * annotation after a close keeps its original mapping.
   *
   * @evidence contracts/common.md#principled-implementation Real HTML comments outside Markdown code are masked before tag lines are classified, keeping newline bytes.
   * @evidence contracts/common.md#clear-and-simple-design It reuses the private comment-hiding helper with a fresh Markdown code map.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unclosed comments mask through the end instead of exposing their contents.
   * @evidence contracts/common.md#meaningful-documentation The comment explains literal delimiters inside code and mapping preservation.
   * @evidence contracts/performance.md#efficient-algorithms Linear in comment length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each comment is masked once.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The code map is local; the caller owns the masked buffer.
   */
  export function maskHtmlComments(characters: string[], input: string): void {
    hideHtmlComments(characters, input, mapMarkdownCode(input));
  }

  /**
   * Identifies Markdown fenced, indented, and closed inline code coordinates.
   *
   * Adapter-native documentation syntax consults this map before opening its
   * own example state, preventing literal native delimiters from spanning real
   * documentation outside a Markdown example.
   *
   * @evidence contracts/common.md#principled-implementation The shared Markdown code map is exposed so adapter-native example syntax can defer to Markdown code first.
   * @evidence contracts/common.md#clear-and-simple-design It delegates to the private mapper.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Native delimiters inside Markdown code cannot open native example state.
   * @evidence contracts/common.md#meaningful-documentation The comment explains how adapters use the map.
   * @evidence contracts/performance.md#efficient-algorithms Linear in comment length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each caller maps its own comment.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function markdownCode(input: string): readonly boolean[] {
    return mapMarkdownCode(input);
  }
}

/**
 * Adds adapter-native example ranges to the shared precedence map.
 *
 * Doxygen, Javadoc, and Scaladoc mask their own code syntax before HTML
 * pairing. Comparing the coordinate-preserving character buffer with the
 * original input prevents literal tags in those regions from crossing into
 * ordinary prose.
 */
function markExistingMasks(
  inert: boolean[],
  characters: string[],
  input: string,
): void {
  for (let index: number = 0; index < input.length; ++index)
    if (characters[index] !== input[index]) inert[index] = true;
}

/**
 * Makes real HTML comment regions inert for later documentation passes.
 *
 * The caller-provided precedence map already identifies Markdown code. Once an
 * HTML comment opens, its first close wins even if the enclosed text resembles
 * another Markdown construct.
 */
function hideHtmlComments(
  characters: string[],
  input: string,
  inert: boolean[],
): void {
  const markupInert: boolean[] = [...inert];
  for (const tag of markupTags(input)) mark(markupInert, tag.start, tag.end);
  let opening: number | undefined;
  for (const match of input.matchAll(/<!--|-->/gu)) {
    const index: number | undefined = match.index;
    if (index === undefined) continue;
    if (opening === undefined) {
      if (match[0] === "<!--" && markupInert[index] !== true) opening = index;
      continue;
    }
    if (match[0] !== "-->") continue;
    const end: number = index + match[0].length;
    hide(characters, opening, end);
    mark(inert, opening, end);
    opening = undefined;
  }
  if (opening !== undefined) {
    hide(characters, opening, input.length);
    mark(inert, opening, input.length);
  }
}

/**
 * Builds the precedence map used before any HTML tag pairing occurs.
 *
 * Fence closing rules retain marker kind and minimum delimiter length. Prose
 * lines are then scanned for closed inline-code spans, leaving unmatched
 * backticks available as ordinary text instead of hiding the rest of a
 * comment.
 */
function mapMarkdownCode(input: string): boolean[] {
  const output: boolean[] = new Array<boolean>(input.length).fill(false);
  const documentBaseline: number =
    EvidenceDocumentationExamples.baseline(input);
  let fenceMarker: string | undefined;
  let fenceLength: number = 0;
  let offset: number = 0;
  const lines: string[] = input.split("\n");
  for (const rawLine of lines) {
    const delimiter: IEvidenceDocumentationFence | undefined =
      EvidenceDocumentationExamples.fence(rawLine, documentBaseline);
    if (fenceMarker !== undefined) {
      mark(output, offset, offset + rawLine.length);
      if (
        delimiter !== undefined &&
        delimiter.marker === fenceMarker &&
        delimiter.length >= fenceLength &&
        delimiter.remainder.trim() === ""
      ) {
        fenceMarker = undefined;
        fenceLength = 0;
      }
    } else if (indentation(rawLine) >= documentBaseline + 4) {
      mark(output, offset, offset + rawLine.length);
    } else if (delimiter !== undefined) {
      fenceMarker = delimiter.marker;
      fenceLength = delimiter.length;
      mark(output, offset, offset + rawLine.length);
    } else markInlineCode(output, rawLine, offset);
    offset += rawLine.length + 1;
  }
  return output;
}

/**
 * Measures leading documentation padding in visual columns.
 *
 * Tabs advance to the next four-column stop so baseline-relative fence
 * classification agrees with the indented-code boundary used by the readers.
 */
function indentation(line: string): number {
  let columns: number = 0;
  for (const character of line) {
    if (character === " ") ++columns;
    else if (character === "\t") columns += 4 - (columns % 4);
    else break;
  }
  return columns;
}

/**
 * Marks closed backtick spans on one prose line.
 *
 * Opening and closing runs must have equal length, and escaped runs cannot act
 * as delimiters. This keeps tag-shaped examples inert without suppressing HTML
 * after an unmatched or differently sized run.
 */
function markInlineCode(output: boolean[], line: string, offset: number): void {
  let cursor: number = 0;
  while (cursor < line.length) {
    const opening: number = line.indexOf("`", cursor);
    if (opening < 0) return;
    const length: number = delimiterLength(line, opening);
    if (escaped(line, opening)) {
      cursor = opening + length;
      continue;
    }
    let closing: number = opening + length;
    while (closing < line.length) {
      closing = line.indexOf("`", closing);
      if (closing < 0) return;
      const candidate: number = delimiterLength(line, closing);
      if (candidate === length && !escaped(line, closing)) {
        mark(output, offset + opening, offset + closing + length);
        cursor = closing + length;
        break;
      }
      closing += candidate;
    }
    if (closing < 0 || closing >= line.length) return;
  }
}

/**
 * Measures one contiguous backtick run from its opening offset.
 *
 * Inline-code pairing requires an exact delimiter length, so callers advance by
 * the whole run instead of reconsidering its interior characters.
 */
function delimiterLength(line: string, start: number): number {
  let end: number = start;
  while (line[end] === "`") ++end;
  return end - start;
}

/**
 * Reports whether a Markdown backslash run escapes one delimiter.
 *
 * Only an odd number of immediately preceding slashes neutralizes the backtick;
 * an even run represents literal slashes and leaves the delimiter active.
 */
function escaped(line: string, index: number): boolean {
  let slashes: number = 0;
  for (let cursor: number = index - 1; cursor >= 0; --cursor) {
    if (line[cursor] !== "\\") break;
    ++slashes;
  }
  return slashes % 2 === 1;
}

/**
 * Marks one half-open source interval as inert documentation.
 *
 * The boolean map shares exact offsets with the original text and is consumed
 * before HTML pairing, so this helper never changes its length.
 */
function mark(output: boolean[], start: number, end: number): void {
  for (let index: number = start; index < end; ++index) output[index] = true;
}

/**
 * Replaces a half-open example range while retaining newline bytes and length.
 *
 * EvidenceDocumentation has already mapped this text to physical source
 * offsets, so deleting content or normalizing line endings would corrupt every
 * subsequent diagnostic range.
 */
function hide(characters: string[], start: number, end: number): void {
  for (let index: number = start; index < end; ++index)
    if (characters[index] !== "\n" && characters[index] !== "\r")
      characters[index] = " ";
}

/**
 * Tokenizes markup elements with quote-aware tag boundaries.
 *
 * Scanning every element as one token prevents comment or example delimiters in
 * quoted attributes from entering later passes. End tags accept only whitespace
 * after their name, matching the deliberately bounded documentation syntax.
 */
function markupTags(input: string): IEvidenceHtmlMarkupTag[] {
  const output: IEvidenceHtmlMarkupTag[] = [];
  let cursor: number = 0;
  while (cursor < input.length) {
    const start: number = input.indexOf("<", cursor);
    if (start < 0) break;
    let nameStart: number = start + 1;
    const closing: boolean = input[nameStart] === "/";
    if (closing) ++nameStart;
    let nameEnd: number = nameStart;
    while (
      nameEnd < input.length &&
      /[A-Za-z0-9:-]/u.test(input[nameEnd] ?? "")
    )
      ++nameEnd;
    if (nameEnd === nameStart) {
      cursor = start + 1;
      continue;
    }
    let quote: "'" | '"' | undefined;
    let end: number = nameEnd;
    for (; end < input.length; ++end) {
      const character: string | undefined = input[end];
      if (quote !== undefined) {
        if (character === quote) quote = undefined;
      } else if (character === "'" || character === '"') quote = character;
      else if (character === ">") break;
    }
    if (end >= input.length) break;
    ++end;
    const name: string = input.slice(nameStart, nameEnd).toLowerCase();
    const remainder: string = input.slice(nameEnd, end - 1);
    if (
      (!closing || remainder.trim() === "") &&
      (remainder === "" || /^[\s/]/u.test(remainder))
    )
      output.push({
        start,
        end,
        name,
        closing,
        selfClosing: !closing && /\/\s*$/u.test(remainder),
      });
    cursor = end;
  }
  return output;
}
