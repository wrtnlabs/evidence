import { createHash } from "node:crypto";

import { EvidenceSourceText } from "../../internal/EvidenceSourceText";
import { EvidenceTagParser } from "../../parsers/EvidenceTagParser";
import type { IEvidenceDelimitedOptions } from "../../structures/IEvidenceDelimitedOptions";
import type { IEvidenceDocumentation } from "../../structures/IEvidenceDocumentation";
import type { IEvidenceHost } from "../../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidenceSourceAddress } from "../../structures/IEvidenceSourceAddress";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceTagParseResult } from "../../structures/IEvidenceTagParseResult";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { EvidenceDelimitedType } from "../../typings/EvidenceDelimitedType";
import { EvidenceDelimitedReader } from "./EvidenceDelimitedReader";
import { EvidenceDelimitedSyntax } from "./EvidenceDelimitedSyntax";
import type { IEvidenceDelimitedField } from "./IEvidenceDelimitedField";
import type { IEvidenceDelimitedRecord } from "./IEvidenceDelimitedRecord";

/**
 * Materializes one CSV or TSV source as a file unit and its keyed row units.
 *
 * The first record is the header. Every later record must have the header's
 * width and a valid, unique key; a row failing either rule is reported at its
 * line and leaves the inventory incomplete instead of disappearing from the
 * population. Valid rows become units addressed by their key under each
 * whitespace-free logical path of the file. With an evidence column, each row
 * also gets one annotation host on that cell, tagged or not.
 *
 * Row content digests hash the header-to-value pairs of every column except the
 * evidence column, sorted by header and with CRLF inside values read as LF.
 * Value or header edits therefore expire reviews, while reordering columns,
 * changing CSV quoting style, or editing annotations does not.
 *
 * @evidence contracts/common.md#principled-implementation One reader pass yields the header and records; width, key and duplicate rules gate materialization; each unique row becomes a unit with an adapter digest over sorted header-to-value pairs and, when configured, an evidence-cell host parsed by the shared tag parser.
 * @evidence contracts/common.md#clear-and-simple-design The scanner owns one file's header roles, keys and inventory records; tokenizing belongs to EvidenceDelimitedReader, lexical rules to EvidenceDelimitedSyntax and tag grammar to EvidenceTagParser.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Ragged rows, invalid keys, duplicate keys, missing columns and syntax errors make the inventory incomplete, and duplicate keys materialize no row, so no row is silently dropped or chosen.
 * @evidence contracts/common.md#meaningful-documentation The class comment states the row rules, host creation and digest content; every member is documented.
 * @evidence contracts/performance.md#efficient-algorithms Linear in file size: one reader pass, one key map for duplicate detection, and per row one digest over its cells; annotation mapping runs only for nonempty evidence cells.
 * @evidence contracts/performance.md#reuse-equivalent-work The sorted fingerprint column order and the logical origins are computed once per file and shared by every row.
 * @evidence contracts/performance.md#bound-retention-and-release-resources The key map retains the valid records of one file until materialization; the scanner is discarded after scan, leaving only inventory records.
 */
export class EvidenceDelimitedScanner {
  /** Maps UTF-16 offsets of the original content to Evidence ranges. */
  private readonly text: EvidenceSourceText;

  /** Logical addresses whose relative path can form one target token. */
  private readonly targetable: IEvidenceSourceAddress[];

  /** Unit identity of the file aggregate once materialized. */
  private fileId: string | undefined;

  /**
   * Binds one destination inventory, one captured source, its dialect, and the
   * configured column roles.
   *
   * Scan mutates only the supplied inventory.
   */
  public constructor(
    private readonly inventory: IEvidenceInventory,
    private readonly source: IEvidenceSourceFile,
    private readonly type: EvidenceDelimitedType,
    private readonly options: IEvidenceDelimitedOptions,
  ) {
    this.text = EvidenceSourceText.of(source.content);
    this.targetable = source.addresses.filter(
      (address: IEvidenceSourceAddress): boolean => !/\s/u.test(address.relative),
    );
  }

  /**
   * Reads the source and appends its units, addresses, hosts, annotations, and
   * diagnostics.
   *
   * A source with no whitespace-free path, no header, or a missing key column
   * yields no rows and an incomplete inventory, because its rows exist but
   * cannot be addressed.
   *
   * @evidence contracts/common.md#principled-implementation Paths are checked, the file unit is created, the header is validated and its roles resolved, records are grouped by key, reader problems are reported, and unique rows are materialized in file order.
   * @evidence contracts/common.md#clear-and-simple-design Each phase is a private method; scan only sequences them.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Every failure path marks the inventory incomplete before returning.
   * @evidence contracts/common.md#meaningful-documentation The comment states which failures stop row extraction and why.
   * @evidence contracts/performance.md#efficient-algorithms Linear in file size.
   * @evidence contracts/performance.md#reuse-equivalent-work Header roles and fingerprint order are resolved once and reused for every record.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Records are released after materialization; only inventory records remain.
   */
  public scan(): void {
    for (const address of this.source.addresses)
      if (!this.targetable.includes(address))
        this.inventory.diagnostics.push({
          code: "delimited-path",
          severity: "error",
          message: `${EvidenceDelimitedSyntax.label(this.type)} path '${address.relative}' cannot form one evidence target token.`,
          repair:
            "Rename the file so its population-relative path contains no whitespace.",
          location: { file: this.source.physicalPath },
        });
    if (this.targetable.length === 0) {
      this.inventory.complete = false;
      return;
    }
    const reader: EvidenceDelimitedReader = new EvidenceDelimitedReader(
      this.source.content,
      this.type,
    );
    const header: IEvidenceDelimitedRecord | undefined = reader.next();
    const names: string[] =
      header?.fields.map((field: IEvidenceDelimitedField): string => field.value) ??
      [];
    this.materializeFile(names);
    if (header === undefined) {
      this.problem(
        "delimited-header",
        `The ${EvidenceDelimitedSyntax.label(this.type)} file has no header record.`,
        "Add a first record naming every column, including the key column.",
        0,
        0,
      );
      return;
    }
    this.validateHeader(header);
    const keys: number[] | undefined = this.keyIndexes(header, names);
    const evidence: number | undefined = this.evidenceIndex(header, names);
    const rows: Map<string, IEvidenceDelimitedRecord[]> = new Map();
    for (
      let record: IEvidenceDelimitedRecord | undefined = reader.next();
      record !== undefined;
      record = reader.next()
    ) {
      if (record.fields.length !== names.length) {
        this.problem(
          "delimited-ragged-row",
          `The row has ${record.fields.length} field(s) but the header has ${names.length}.`,
          this.type === "csv"
            ? "Give the row one field per header column, quoting fields that contain commas or line breaks."
            : "Give the row one field per header column; TSV fields cannot contain tabs or line breaks.",
          record.start,
          record.end,
        );
        continue;
      }
      if (keys === undefined) continue;
      const key: string | undefined = this.key(record, keys);
      if (key === undefined) continue;
      const group: IEvidenceDelimitedRecord[] | undefined = rows.get(key);
      if (group === undefined) rows.set(key, [record]);
      else group.push(record);
    }
    for (const problem of reader.problems)
      this.problem(
        problem.code,
        problem.message,
        problem.repair,
        problem.start,
        problem.end,
      );
    const order: number[] = this.fingerprintOrder(names, evidence);
    for (const [key, records] of rows) {
      const first: IEvidenceDelimitedRecord | undefined = records[0];
      if (first === undefined) continue;
      if (records.length === 1) {
        this.materializeRow(key, first, names, order, evidence);
        continue;
      }
      for (const record of records)
        this.problem(
          "delimited-duplicate-key",
          `Key '${key}' identifies ${records.length} rows of this file.`,
          "Give every row a distinct key; rows are addressed by key alone.",
          record.start,
          record.end,
        );
    }
  }

  /**
   * Creates the file aggregate unit and its logical addresses.
   *
   * The file is never selectable; it stays addressable so a file target covers
   * every selected row. Its digest covers the fingerprinted header names, so a
   * column rename also expires a review of the whole file.
   */
  private materializeFile(names: string[]): void {
    const id: string = `${this.type}:${this.source.id}:file`;
    const site: IEvidenceUnitSite = {
      id: `${id}:site`,
      file: this.source.physicalPath,
      range: this.text.range(0, this.source.content.length),
      content: [],
    };
    const evidence: string | undefined = this.options.evidenceColumn;
    const unit: IEvidenceUnit = {
      id,
      type: this.type,
      symbol: "file",
      identity: [],
      name: this.targetable[0]?.relative ?? this.source.physicalPath,
      contentDigest: digest(
        names
          .filter((name: string): boolean => name !== evidence)
          .sort(compare),
      ),
      sites: [site],
      withdrawals: [],
    };
    this.inventory.units.push(unit);
    for (const address of this.targetable)
      this.inventory.addresses.push({
        unitId: id,
        file: address.absolute,
        segments: [],
      });
    this.fileId = id;
  }

  /**
   * Reports empty and repeated header names.
   *
   * Rows map values to header names, so either problem makes the mapping
   * ambiguous and the inventory incomplete.
   */
  private validateHeader(header: IEvidenceDelimitedRecord): void {
    const seen: Set<string> = new Set();
    for (const [index, field] of header.fields.entries()) {
      if (field.value.trim() === "")
        this.problem(
          "delimited-header",
          `Header column ${index + 1} has no name.`,
          "Name every header column; rows are read by header name.",
          field.start,
          field.end,
        );
      else if (seen.has(field.value))
        this.problem(
          "delimited-header",
          `Header '${field.value}' names more than one column.`,
          "Give every header column a distinct name.",
          field.start,
          field.end,
        );
      seen.add(field.value);
    }
  }

  /**
   * Resolves the configured key headers to column indexes.
   *
   * A missing header is reported at the header record and returns undefined,
   * which stops key extraction for the file.
   */
  private keyIndexes(
    header: IEvidenceDelimitedRecord,
    names: string[],
  ): number[] | undefined {
    const indexes: number[] = [];
    for (const key of EvidenceDelimitedSyntax.keyColumns(this.options)) {
      const index: number = names.indexOf(key);
      if (index < 0) {
        this.problem(
          "delimited-key-column",
          `Key column '${key}' is not a header of this file.`,
          "Add the column or correct the configured key; header names are case-sensitive.",
          header.start,
          header.end,
        );
        return undefined;
      }
      indexes.push(index);
    }
    return indexes;
  }

  /**
   * Resolves the configured evidence column, reporting a missing header.
   *
   * Without a configured column the result is undefined and rows host no
   * in-file annotations.
   */
  private evidenceIndex(
    header: IEvidenceDelimitedRecord,
    names: string[],
  ): number | undefined {
    const column: string | undefined = this.options.evidenceColumn;
    if (column === undefined) return undefined;
    const index: number = names.indexOf(column);
    if (index >= 0) return index;
    this.problem(
      "delimited-evidence-column",
      `Evidence column '${column}' is not a header of this file.`,
      "Add the column or correct the configured evidenceColumn; header names are case-sensitive.",
      header.start,
      header.end,
    );
    return undefined;
  }

  /**
   * Builds the address key of one row, or reports why it has none.
   *
   * Key cells are trimmed; each part must satisfy the shared key rule, and
   * composite parts are joined in configured order.
   */
  private key(
    record: IEvidenceDelimitedRecord,
    indexes: number[],
  ): string | undefined {
    const parts: string[] = [];
    for (const index of indexes) {
      const field: IEvidenceDelimitedField | undefined = record.fields[index];
      if (field === undefined) return undefined;
      const part: string = field.value.trim();
      const problem: string | undefined = EvidenceDelimitedSyntax.keyProblem(
        part,
        indexes.length > 1,
      );
      if (problem !== undefined) {
        this.problem(
          part === "" ? "delimited-empty-key" : "delimited-key",
          part === ""
            ? "The row has an empty key."
            : `Key value '${part}' cannot form a row address.`,
          problem,
          field.start,
          field.end,
        );
        return undefined;
      }
      parts.push(part);
    }
    return parts.join(EvidenceDelimitedSyntax.JOINER);
  }

  /**
   * Lists the fingerprinted column indexes sorted by header name.
   *
   * Sorting makes a pure column reorder leave every digest unchanged, while
   * the header names inside the digest keep renames significant.
   */
  private fingerprintOrder(
    names: string[],
    evidence: number | undefined,
  ): number[] {
    return names
      .map((_name: string, index: number): number => index)
      .filter((index: number): boolean => index !== evidence)
      .sort((left: number, right: number): number =>
        compare(names[left] ?? "", names[right] ?? ""),
      );
  }

  /**
   * Creates one row unit with its site, addresses, digest, and evidence host.
   *
   * The site spans the whole record so diagnostics point at the row's first
   * line and the evidence cell lies inside it.
   */
  private materializeRow(
    key: string,
    record: IEvidenceDelimitedRecord,
    names: string[],
    order: number[],
    evidence: number | undefined,
  ): void {
    const id: string = `${this.type}:${this.source.id}:row:${JSON.stringify(key)}`;
    const site: IEvidenceUnitSite = {
      id: `${id}:site`,
      file: this.source.physicalPath,
      range: this.text.range(record.start, record.end),
      content: [],
    };
    const unit: IEvidenceUnit = {
      id,
      ...(this.fileId === undefined ? {} : { parentId: this.fileId }),
      type: this.type,
      symbol: "row",
      identity: [key],
      name: key,
      contentDigest: digest(
        order.map((index: number): string[] => [
          names[index] ?? "",
          (record.fields[index]?.value ?? "").replaceAll("\r\n", "\n"),
        ]),
      ),
      sites: [site],
      withdrawals: [],
    };
    this.inventory.units.push(unit);
    for (const address of this.targetable)
      this.inventory.addresses.push({
        unitId: id,
        file: address.absolute,
        segments: [key],
      });
    const cell: IEvidenceDelimitedField | undefined =
      evidence === undefined ? undefined : record.fields[evidence];
    if (cell !== undefined) this.materializeHost(id, site, cell);
  }

  /**
   * Adds the evidence-cell host of one row and parses its annotations.
   *
   * Every row receives a host so per-host policies see untagged rows. Text
   * before the first tag is reported because it would otherwise be neither an
   * annotation nor fingerprinted content.
   */
  private materializeHost(
    unitId: string,
    site: IEvidenceUnitSite,
    cell: IEvidenceDelimitedField,
  ): void {
    const host: IEvidenceHost = {
      id: `${unitId}:evidence`,
      file: this.source.physicalPath,
      range: this.text.range(cell.start, cell.end),
      origins: this.source.addresses.map(
        (address: IEvidenceSourceAddress): string => address.absolute,
      ),
      siteId: site.id,
      unitIds: [unitId],
      attachment: "attached",
    };
    this.inventory.hosts.push(host);
    if (cell.value.trim() === "") return;
    const documentation: IEvidenceDocumentation = this.documentation(
      host.id,
      cell,
    );
    const leading: string = documentation.text.slice(
      0,
      EvidenceDelimitedSyntax.firstTag(documentation.text),
    );
    if (leading.trim() !== "") {
      const from: number = leading.length - leading.trimStart().length;
      const until: number = leading.trimEnd().length;
      this.inventory.diagnostics.push({
        code: "delimited-evidence-text",
        severity: "error",
        message:
          "The evidence cell starts with text that is not an Evidence annotation.",
        repair:
          "Start the cell with @evidence, @evidenceExclude, @evidenceReview, or @evidenceExcludeReview, and keep other notes in another column.",
        location: {
          file: this.source.physicalPath,
          range: this.text.range(
            documentation.offsets[from] ?? cell.start,
            documentation.ends[until - 1] ?? cell.end,
          ),
        },
        hostId: host.id,
      });
    }
    const parsed: IEvidenceTagParseResult = EvidenceTagParser.parse(
      this.source.content,
      host,
      documentation,
    );
    this.inventory.declarations.push(...parsed.declarations);
    this.inventory.reviews.push(...parsed.reviews);
    this.inventory.diagnostics.push(...parsed.diagnostics);
    this.inventory.annotationRanges.push({
      file: host.file,
      range: host.range,
    });
  }

  /**
   * Maps one evidence cell to tag-parser documentation.
   *
   * Every text character keeps its source offset: CSV quotes are skipped, a
   * `""` pair maps to the one quote it decodes to, and a quoted CRLF reads as
   * LF. The whitespace before each later tag token becomes a line break so the
   * line-oriented tag parser starts a new annotation there.
   */
  private documentation(
    hostId: string,
    cell: IEvidenceDelimitedField,
  ): IEvidenceDocumentation {
    const content: string = this.source.content;
    const characters: string[] = [];
    const offsets: number[] = [];
    const ends: number[] = [];
    let cursor: number = cell.quoted ? cell.start + 1 : cell.start;
    while (cursor < cell.end) {
      const character: string = content.charAt(cursor);
      if (cell.quoted && character === '"') {
        if (cursor + 1 >= cell.end || content[cursor + 1] !== '"') break;
        characters.push('"');
        offsets.push(cursor);
        ends.push(cursor + 2);
        cursor += 2;
        continue;
      }
      if (character === "\r" && content[cursor + 1] === "\n") {
        ++cursor;
        continue;
      }
      characters.push(character);
      offsets.push(cursor);
      ends.push(cursor + 1);
      ++cursor;
    }
    offsets.push(cursor);
    for (const boundary of EvidenceDelimitedSyntax.tagBoundaries(
      characters.join(""),
    ))
      characters[boundary - 1] = "\n";
    return {
      hostId,
      text: characters.join(""),
      offsets,
      ends,
      tagBoundaries: false,
      allowWithdrawal: false,
    };
  }

  /**
   * Records one structural error at a source span and marks the inventory
   * incomplete.
   *
   * Every caller reports a failure that can lose or misidentify rows.
   */
  private problem(
    code: string,
    message: string,
    repair: string,
    start: number,
    end: number,
  ): void {
    this.inventory.complete = false;
    this.inventory.diagnostics.push({
      code,
      severity: "error",
      message,
      repair,
      location: {
        file: this.source.physicalPath,
        range: this.text.range(start, end),
      },
    });
  }
}

/** Hashes a JSON-serializable value into a hexadecimal content digest. */
function digest(value: string[] | string[][]): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Compares strings in code-unit order, independent of locale. */
function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
