import { EvidenceArrays } from "../../internal/EvidenceArrays";
import { EvidenceSourceText } from "../../internal/EvidenceSourceText";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidencePrismaCommentRun } from "./IEvidencePrismaCommentRun";
import type { IEvidencePrismaBlockHead } from "./IEvidencePrismaBlockHead";
import type { IEvidencePrismaFileAnalysis } from "./IEvidencePrismaFileAnalysis";
import type { IEvidencePrismaLineParts } from "./IEvidencePrismaLineParts";
import type { IEvidencePrismaLocation } from "./IEvidencePrismaLocation";
import type { IEvidencePrismaPendingComment } from "./IEvidencePrismaPendingComment";
import type { IEvidenceTrimmedMapping } from "./IEvidenceTrimmedMapping";
import type { EvidencePrismaCommentForm } from "./EvidencePrismaCommentForm";
import { EvidencePrismaSyntax } from "./EvidencePrismaSyntax";

const BLOCK_KEYWORDS = new Set([
  "model",
  "view",
  "type",
  "enum",
  "datasource",
  "generator",
]);
const MEMBER_BLOCKS = new Set(["model", "view", "type"]);

/**
 * Locates physical Prisma declarations and documentation without parsing
 * semantics.
 *
 * The whole-schema parser remains responsible for deciding which declarations
 * exist. This scanner supplies its source spans and comment-coordinate maps so
 * those semantic declarations can own accurate sites and documentation.
 *
 * @evidence contracts/common.md#principled-implementation A line scanner splits code from comments, tracks brace depth, recognizes block heads and member names, and groups comment runs with coordinate maps.
 * @evidence contracts/common.md#clear-and-simple-design The scanner locates positions only; the parser decides which declarations exist.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts It never decides semantic validity, so a scan miss cannot remove a unit.
 * @evidence contracts/common.md#meaningful-documentation The class comment explains the division with the parser; helpers are documented.
 * @evidence contracts/performance.md#efficient-algorithms One pass over lines, linear in file size.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each file is scanned once.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The scanner holds only its source reference and returns plain records.
 */
export class EvidencePrismaFileScanner {
  /**
   * Holds raw source lines in scan order, preserving a final empty line.
   *
   * Parallel coordinate arrays translate each line's local positions back to
   * the immutable source snapshot.
   */
  private readonly lines: string[];

  /**
   * Stores the UTF-16 offset at which each source line begins.
   *
   * Missing defensive entries fall back to the source boundary when malformed
   * line state is encountered.
   */
  private readonly lineStarts: number[] = [];

  /**
   * Stores the UTF-16 offset immediately after each line's content.
   *
   * Carriage returns are excluded because declaration ranges use content-only
   * line boundaries.
   */
  private readonly lineEnds: number[] = [];

  /**
   * Stores the offset of each line's newline character or line terminus.
   *
   * Comment-run maps use these positions for newlines introduced between
   * fragments on different source lines.
   */
  private readonly newlineOffsets: number[] = [];

  /**
   * Translates scanner offsets into Evidence source ranges.
   *
   * All locations and comment carriers use this one coordinate authority.
   */
  private readonly text: EvidenceSourceText;

  /**
   * Initializes line and coordinate indexes for one immutable source snapshot.
   *
   * The scanner borrows no parser session because it deliberately recognizes
   * only structural Prisma positions and comments.
   */
  public constructor(private readonly source: IEvidenceSourceFile) {
    this.text = new EvidenceSourceText(source.content);
    this.lines = source.content.split("\n");
    let offset = 0;
    for (const raw of this.lines) {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      this.lineStarts.push(offset);
      this.lineEnds.push(offset + line.length);
      this.newlineOffsets.push(offset + raw.length);
      offset += raw.length + 1;
    }
  }

  /**
   * Scans declaration positions and contiguous comment runs for the source.
   *
   * It flushes pending comments whenever syntax breaks adjacency, preserving
   * detached carriers instead of attaching them to a later declaration.
   *
   * @evidence contracts/common.md#principled-implementation Lines are processed once to record block and member locations and comment runs with mapped text.
   * @evidence contracts/common.md#clear-and-simple-design Line splitting and trimming are helpers.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Comments cannot change depth because braces are counted in code only.
   * @evidence contracts/common.md#meaningful-documentation The comment states the returned analysis.
   * @evidence contracts/performance.md#efficient-algorithms Linear in file size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each file is scanned once.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The method keeps no state after returning; its result is owned by the caller.
   */
  public scan(): IEvidencePrismaFileAnalysis {
    const locations = new Map<string, IEvidencePrismaLocation>();
    const comments: IEvidencePrismaCommentRun[] = [];
    let pending: IEvidencePrismaPendingComment[] = [];
    let depth = 0;
    let block = "";
    let addressable = false;
    let commented = false;

    // A run is attached only at the next recognized location; all other syntax
    // flushes it so a detached comment cannot document a later declaration.
    const flush = (key: string): void => {
      EvidenceArrays.append(comments, this.runs(pending, key));
      pending = [];
    };
    const record = (key: string, line: number): void => {
      if (key === "" || locations.has(key)) return;
      locations.set(key, {
        key,
        range: this.text.range(
          this.lineStarts[line] ?? 0,
          this.lineEnds[line] ?? this.source.content.length,
        ),
      });
    };

    for (let index = 0; index < this.lines.length; ++index) {
      const parts = this.parts(index, commented);
      commented = parts.commented;
      const trimmed = parts.code.trim();
      if (parts.comment !== undefined) {
        parts.comment.topLevel = depth === 0;
        parts.comment.trailing = trimmed !== "";
        pending.push(parts.comment);
      }
      if (trimmed === "") {
        if (parts.comment === undefined && depth === 0) flush("");
        continue;
      }
      const opens = count(parts.code, "{");
      const closes = count(parts.code, "}");
      if (depth === 0 && opens !== 0) {
        const head = blockHead(trimmed);
        block = "";
        addressable = false;
        if (head === undefined) flush("");
        else {
          block = head.name;
          addressable = MEMBER_BLOCKS.has(head.keyword);
          if (addressable) record(head.name, index);
          flush(head.name);
        }
      } else if (depth === 1 && block !== "") {
        const member = memberName(trimmed);
        if (member === undefined) flush("");
        else {
          if (addressable) record(`${block}.${member}`, index);
          flush(`${block}.${member}`);
        }
      } else flush("");
      depth += opens - closes;
      if (depth <= 0) {
        depth = 0;
        block = "";
        addressable = false;
      }
    }
    flush("");
    return {
      source: this.source,
      locations: Array.from(locations.values()),
      comments,
    };
  }

  /**
   * Separates code from a line comment while carrying block-comment state.
   *
   * Quotes suppress comment delimiters so URL-like and escaped string content
   * cannot alter declaration scanning or comment attachment.
   */
  private parts(
    line: number,
    initiallyCommented: boolean,
  ): IEvidencePrismaLineParts {
    const raw = this.lines[line] ?? "";
    const content = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const start = this.lineStarts[line] ?? 0;
    let code = "";
    let form: EvidencePrismaCommentForm | undefined = initiallyCommented
      ? "block"
      : undefined;
    let commented = initiallyCommented;
    let quoted = false;
    let commentStart = -1;
    let commentEnd = -1;
    let comment = "";
    const offsets: number[] = [];
    const ends: number[] = [];

    for (let index = 0; index < content.length; ++index) {
      const character = content[index] ?? "";
      if (commented) {
        if (commentStart < 0) commentStart = index;
        if (character === "*" && content[index + 1] === "/") {
          commented = false;
          commentEnd = index + 2;
          ++index;
        } else {
          comment += character;
          offsets.push(start + index);
          ends.push(start + index + 1);
        }
        continue;
      }
      if (quoted) {
        if (character === "\\") ++index;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') {
        quoted = true;
        continue;
      }
      if (character === "/" && content[index + 1] === "/") {
        commentStart = commentStart < 0 ? index : commentStart;
        const documented = content[index + 2] === "/";
        form ??= documented ? "doc" : "line";
        index += documented ? 2 : 1;
        for (++index; index < content.length; ++index) {
          comment += content[index] ?? "";
          offsets.push(start + index);
          ends.push(start + index + 1);
        }
        commentEnd = content.length;
        break;
      }
      if (character === "/" && content[index + 1] === "*") {
        commentStart = commentStart < 0 ? index : commentStart;
        form ??= "block";
        commented = true;
        ++index;
        continue;
      }
      code += character;
    }
    if (form === undefined)
      return {
        code,
        commented,
      };
    if (commentEnd < 0) commentEnd = content.length;
    let trimmed = trimMapped(comment, offsets, ends);
    if (form === "block" && trimmed.text.startsWith("*"))
      trimmed = trimMapped(
        trimmed.text.slice(1),
        trimmed.offsets.slice(1),
        trimmed.ends.slice(1),
      );
    return {
      code,
      commented,
      comment: {
        form,
        line,
        text: trimmed.text,
        offsets: trimmed.offsets,
        ends: trimmed.ends,
        range: this.text.range(
          start + Math.max(0, commentStart),
          start + commentEnd,
        ),
        trailing: false,
        topLevel: false,
      },
    };
  }

  /**
   * Converts pending fragments into attached and detached documentation runs.
   *
   * Ordinary or trailing line comments remain separate carriers, while
   * non-trailing documentation forms are grouped for one eligible key.
   */
  private runs(
    pending: IEvidencePrismaPendingComment[],
    key: string,
  ): IEvidencePrismaCommentRun[] {
    if (pending.length === 0) return [];
    const output: IEvidencePrismaCommentRun[] = [];
    const documenting = pending.filter(
      (comment) => comment.form !== "line" && !comment.trailing,
    );
    for (const comment of pending)
      if (comment.form === "line" || comment.trailing)
        output.push(this.run([comment], "", false, comment.form));
    if (documenting.length !== 0)
      output.push(
        this.run(
          documenting,
          key,
          key === "" &&
            documenting.every(
              (comment) => comment.topLevel && comment.form === "doc",
            ),
          "doc",
        ),
      );
    return output;
  }

  /**
   * Builds one mapped run from source-order comment fragments.
   *
   * Explicit newline entries preserve a continuous documentation string even
   * when adjacent source comments occur on different lines.
   */
  private run(
    comments: IEvidencePrismaPendingComment[],
    key: string,
    fileLevel: boolean,
    form: EvidencePrismaCommentForm,
  ): IEvidencePrismaCommentRun {
    const first = comments[0];
    const last = comments.at(-1);
    if (first === undefined || last === undefined)
      throw new Error("A Prisma comment run cannot be empty.");
    const byLine = new Map(comments.map((comment) => [comment.line, comment]));
    let text = "";
    const offsets: number[] = [];
    const ends: number[] = [];
    for (let line = first.line; line <= last.line; ++line) {
      const comment = byLine.get(line);
      if (comment !== undefined) {
        text += comment.text;
        EvidenceArrays.append(offsets, comment.offsets);
        EvidenceArrays.append(ends, comment.ends);
      }
      if (line !== last.line) {
        const newline = this.newlineOffsets[line] ?? this.source.content.length;
        text += "\n";
        offsets.push(newline);
        ends.push(Math.min(newline + 1, this.source.content.length));
      }
    }
    offsets.push(ends.at(-1) ?? last.range.end.offset);
    return {
      form,
      key,
      fileLevel,
      text,
      offsets,
      ends,
      range: this.text.range(first.range.start.offset, last.range.end.offset),
      commentRanges: comments.map((comment) => comment.range),
    };
  }
}

/**
 * Recognizes a top-level Prisma block header from structural source text.
 *
 * It accepts only known block keywords and valid identifiers, leaving semantic
 * acceptance to Prisma's whole-schema parser.
 */
function blockHead(line: string): IEvidencePrismaBlockHead | undefined {
  const fields = line.split(/\s+/u);
  const keyword = fields[0];
  const second = fields[1];
  const name = second === undefined ? undefined : second.replace(/\{$/u, "");
  if (
    keyword === undefined ||
    name === undefined ||
    !BLOCK_KEYWORDS.has(keyword) ||
    !EvidencePrismaSyntax.identifier(name)
  )
    return undefined;
  return { keyword, name };
}

/**
 * Extracts an addressable member name from one nested block line.
 *
 * Attribute and closing-brace lines cannot introduce member locations.
 */
function memberName(line: string): string | undefined {
  if (line.startsWith("@") || line.startsWith("}")) return undefined;
  const name = line.split(/\s+/u)[0];
  return name !== undefined && EvidencePrismaSyntax.identifier(name)
    ? name
    : undefined;
}

/**
 * Counts occurrences of one structural character in code-only source text.
 *
 * Callers invoke this only after comment stripping, so braces inside comments
 * cannot change scanner depth.
 */
function count(value: string, character: string): number {
  return Array.from(value).filter((candidate) => candidate === character)
    .length;
}

/**
 * Trims surrounding whitespace while preserving retained source coordinates.
 *
 * The returned arrays stay aligned with the shortened text, allowing later
 * documentation mapping to identify every retained character precisely.
 */
function trimMapped(
  text: string,
  offsets: number[],
  ends: number[],
): IEvidenceTrimmedMapping {
  const start = text.search(/\S/u);
  if (start < 0) return { text: "", offsets: [], ends: [] };
  let end = text.length;
  while (end > start && /\s/u.test(text[end - 1] ?? "")) --end;
  return {
    text: text.slice(start, end),
    offsets: offsets.slice(start, end),
    ends: ends.slice(start, end),
  };
}
