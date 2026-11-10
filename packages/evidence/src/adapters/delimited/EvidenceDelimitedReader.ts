import type { EvidenceDelimitedType } from "../../typings/EvidenceDelimitedType";
import type { IEvidenceDelimitedField } from "./IEvidenceDelimitedField";
import type { IEvidenceDelimitedProblem } from "./IEvidenceDelimitedProblem";
import type { IEvidenceDelimitedRecord } from "./IEvidenceDelimitedRecord";

/**
 * Reads CSV or TSV records one at a time from captured source text.
 *
 * Records end at LF or CRLF; a lone CR is field data. Lines with no characters
 * are skipped, which also ignores a final line break, and a leading UTF-8 byte
 * order mark is not part of the first field. Grammar follows the dialect:
 *
 * - `csv` (RFC 4180): fields are separated by commas. A field that starts with a
 *   double quote ends at the next undoubled quote and may contain commas, line
 *   breaks, and `""`. A quote anywhere else, text after a closing quote, or a
 *   missing closing quote is a syntax problem.
 * - `tsv` (IANA): fields are separated by tabs and have no quoting, so every
 *   other character is literal data.
 *
 * Problems are collected rather than thrown so one pass reports every syntax
 * error in a file.
 *
 * @example
 *   const reader = new EvidenceDelimitedReader('id,note\nP1,"a, ""b"""\n', "csv");
 *   reader.next(); // header: id, note
 *   reader.next(); // P1 and a, "b"
 *
 * @evidence contracts/common.md#principled-implementation A single forward cursor implements the RFC 4180 field grammar for CSV and the IANA tab-separated grammar for TSV, decoding quoted fields while keeping their raw spans.
 * @evidence contracts/common.md#clear-and-simple-design The reader only tokenizes records; header roles, keys and inventory records belong to the scanner.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Malformed quoting is reported instead of guessed, and TSV never applies CSV quoting to literal quotes.
 * @evidence contracts/common.md#meaningful-documentation The comment states terminators, skipped lines, BOM handling, both grammars and gives an example; every member is documented.
 * @evidence contracts/performance.md#efficient-algorithms Every character is visited a constant number of times: unquoted fields use a character loop and quoted fields jump between quotes with indexOf, so a file reads in linear time even with one column.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each file is read once by its scanner; there is no repeated work to share.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The reader retains only its cursor and problems; each returned record belongs to the caller.
 */
export class EvidenceDelimitedReader {
  /**
   * Syntax problems found so far, in source order.
   *
   * Any entry means the file cannot supply a trustworthy row population.
   */
  public readonly problems: IEvidenceDelimitedProblem[] = [];

  /** Offset of the next unread character. */
  private cursor: number;

  /** Field separator: comma for CSV, tab for TSV. */
  private readonly delimiter: string;

  /** Whether RFC 4180 quoting applies. */
  private readonly quoting: boolean;

  /**
   * Prepares to read records from one file's complete content.
   *
   * A leading byte order mark is skipped so it never becomes part of the first
   * header name, while offsets keep referring to the original content.
   */
  public constructor(
    private readonly content: string,
    type: EvidenceDelimitedType,
  ) {
    this.cursor = content.startsWith("﻿") ? 1 : 0;
    this.delimiter = type === "csv" ? "," : "\t";
    this.quoting = type === "csv";
  }

  /**
   * Returns the next nonempty record, or undefined at the end of the content.
   *
   * The cursor is left after the record's line terminator. A missing closing
   * quote consumes the rest of the content and is recorded as a problem.
   *
   * @evidence contracts/common.md#principled-implementation Empty lines are skipped, fields are read until no delimiter follows, and the LF or CRLF terminator is consumed after the record span ends.
   * @evidence contracts/common.md#clear-and-simple-design Field grammar lives in the private field readers; next only joins fields into a record.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts A trailing delimiter yields a final empty field, so width checks see the authored record.
   * @evidence contracts/common.md#meaningful-documentation The comment states the cursor contract and unterminated-quote handling.
   * @evidence contracts/performance.md#efficient-algorithms Linear in the record's length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each record is read exactly once.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The returned record is owned by the caller; the reader keeps no reference to it.
   */
  public next(): IEvidenceDelimitedRecord | undefined {
    const content: string = this.content;
    while (this.cursor < content.length) {
      if (content[this.cursor] === "\n") ++this.cursor;
      else if (content.startsWith("\r\n", this.cursor)) this.cursor += 2;
      else break;
    }
    if (this.cursor >= content.length) return undefined;
    const start: number = this.cursor;
    const fields: IEvidenceDelimitedField[] = [];
    for (;;) {
      fields.push(
        this.quoting && content[this.cursor] === '"'
          ? this.quoted()
          : this.unquoted(),
      );
      if (content[this.cursor] !== this.delimiter) break;
      ++this.cursor;
    }
    const end: number = this.cursor;
    if (content.startsWith("\r\n", this.cursor)) this.cursor += 2;
    else if (content[this.cursor] === "\n") ++this.cursor;
    return { fields, start, end };
  }

  /**
   * Reads one field without enclosing quotes up to a delimiter or line end.
   *
   * In CSV, a double quote inside such a field is reported because RFC 4180
   * allows quotes only in quoted fields; the character stays in the value.
   */
  private unquoted(): IEvidenceDelimitedField {
    const content: string = this.content;
    const start: number = this.cursor;
    let quote: number = -1;
    while (this.cursor < content.length && !this.boundary(this.cursor)) {
      if (quote < 0 && this.quoting && content[this.cursor] === '"')
        quote = this.cursor;
      ++this.cursor;
    }
    if (quote >= 0)
      this.problems.push({
        code: "csv-quote",
        message: "A double quote appears inside a field that is not quoted.",
        repair:
          'Enclose the whole field in double quotes and double each quote inside it, such as "5"" screen".',
        start: quote,
        end: quote + 1,
      });
    return {
      value: content.slice(start, this.cursor),
      start,
      end: this.cursor,
      quoted: false,
    };
  }

  /**
   * Reads one RFC 4180 quoted field starting at its opening quote.
   *
   * Doubled quotes decode to one quote. Text between the closing quote and the
   * next delimiter or line end is reported and kept inside the field span.
   */
  private quoted(): IEvidenceDelimitedField {
    const content: string = this.content;
    const start: number = this.cursor;
    const parts: string[] = [];
    let segment: number = start + 1;
    for (;;) {
      const quote: number = content.indexOf('"', segment);
      if (quote < 0) {
        parts.push(content.slice(segment));
        this.cursor = content.length;
        this.problems.push({
          code: "csv-unterminated-quote",
          message: "A quoted field has no closing double quote.",
          repair:
            "Close the quoted field with a double quote, and double every quote inside it.",
          start,
          end: content.length,
        });
        return { value: parts.join(""), start, end: this.cursor, quoted: true };
      }
      if (content[quote + 1] === '"') {
        parts.push(content.slice(segment, quote + 1));
        segment = quote + 2;
        continue;
      }
      parts.push(content.slice(segment, quote));
      this.cursor = quote + 1;
      break;
    }
    if (this.cursor < content.length && !this.boundary(this.cursor)) {
      const junk: number = this.cursor;
      while (this.cursor < content.length && !this.boundary(this.cursor))
        ++this.cursor;
      this.problems.push({
        code: "csv-quote",
        message: "Text follows the closing double quote of a quoted field.",
        repair:
          "Move the text inside the quotes or put a comma after the closing quote.",
        start: junk,
        end: this.cursor,
      });
    }
    return { value: parts.join(""), start, end: this.cursor, quoted: true };
  }

  /**
   * Tests whether an offset starts a delimiter or a record terminator.
   *
   * Only LF and CRLF end a record, so a lone CR is ordinary field data.
   */
  private boundary(offset: number): boolean {
    const character: string | undefined = this.content[offset];
    return (
      character === this.delimiter ||
      character === "\n" ||
      (character === "\r" && this.content[offset + 1] === "\n")
    );
  }
}
