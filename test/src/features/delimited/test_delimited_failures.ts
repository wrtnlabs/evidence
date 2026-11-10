import { EvidenceDelimitedAdapter } from "@wrtnlabs/evidence";
import type {
  IEvidenceDiagnostic,
  IEvidenceInventory,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Reports every structural ledger failure at its row and keeps the population
 * incomplete.
 *
 * A malformed file must never pass as a smaller population, so each failure
 * names its line and prevents a clean result.
 *
 * 1. Analyze files with duplicate keys, an empty key, keys holding whitespace,
 *    `#`, `"`, or a format character, a composite part holding `:`, a ragged
 *    row, and a missing key column; require each diagnostic code at the
 *    authored line and an incomplete inventory.
 *
 *    - Duplicate keys yield no unit for any duplicate, while a valid sibling row
 *         still has a unit.
 * 2. Analyze CSV syntax errors: an unterminated quote, a quote inside an unquoted
 *    field, and text after a closing quote; require their codes and lines.
 * 3. Analyze a file with no header, empty and repeated header names, and a missing
 *    evidence column; require their codes.
 * 4. Analyze a source whose only path contains whitespace and a source whose
 *    discovery failed; require incomplete inventories.
 * 5. Construct adapters with empty, repeated, or overlapping column options;
 *    require the constructor to throw.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs the delimited adapter on malformed ledgers and invalid options and asserts diagnostic codes, lines, surviving units, completeness and constructor failures.
 * @evidence contracts/testing.md#independent-expectations Each fixture violates exactly one written rule (RFC 4180 quoting, header width, key uniqueness and safety, configured headers), and the expected line is read off the fixture text.
 * @evidence contracts/testing.md#distinguishing-cases Covers duplicate, empty and unsafe keys, composite joiner, ragged rows, missing key and evidence columns, three CSV quote errors, missing, empty and repeated headers, a whitespace path, a failed discovery, and invalid options, beside valid sibling rows; valid parsing belongs to test_delimited_units.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers the exported test_delimited_failures under test/src/features and it calls the adapter in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_delimited_failures(): Promise<void> {
  const duplicate: IEvidenceInventory = await analyze(
    "csv",
    "id,name\nP1,One\nP2,Two\nP1,Again\n",
    "id",
  );
  expectFailure("duplicate key", duplicate, "delimited-duplicate-key", [2, 4]);
  TestValidator.equals(
    "duplicate keys yield no unit while siblings remain",
    rowNames(duplicate),
    ["P2"],
  );

  expectFailure(
    "empty key",
    await analyze("tsv", "id\tname\n  \tBlank\nP1\tOne\n", "id"),
    "delimited-empty-key",
    [2],
  );
  for (const [label, key] of [
    ["whitespace", "P 1"],
    ["hash", "P#1"],
    ["quote", 'P"1'],
    ["format character", "P​1"],
  ] satisfies Array<[string, string]>)
    expectFailure(
      `${label} in key`,
      await analyze("tsv", `id\tname\n${key}\tOne\nP2\tTwo\n`, "id"),
      "delimited-key",
      [2],
    );
  expectFailure(
    "joiner in composite part",
    await analyze("tsv", "a\tb\nx:y\tz\n", ["a", "b"]),
    "delimited-key",
    [2],
  );
  const single: IEvidenceInventory = await analyze("tsv", "id\nurn:x\n", "id");
  TestValidator.equals(
    "a single key may contain the joiner",
    rowNames(single),
    ["urn:x"],
  );
  expectFailure(
    "ragged row",
    await analyze("csv", "id,name\nP1,One,extra\nP2\nP3,Three\n", "id"),
    "delimited-ragged-row",
    [2, 3],
  );
  expectFailure(
    "missing key column",
    await analyze("csv", "code,name\nP1,One\n", "id"),
    "delimited-key-column",
    [1],
  );

  expectFailure(
    "unterminated quote",
    await analyze("csv", 'id,name\nP1,"open\nP2,Two\n', "id"),
    "csv-unterminated-quote",
    [2],
  );
  expectFailure(
    "quote inside unquoted field",
    await analyze("csv", 'id,name\nP1,5" screen\n', "id"),
    "csv-quote",
    [2],
  );
  expectFailure(
    "text after closing quote",
    await analyze("csv", 'id,name\nP1,"One"x\n', "id"),
    "csv-quote",
    [2],
  );

  expectFailure(
    "no header",
    await analyze("csv", "\n\n", "id"),
    "delimited-header",
    [1],
  );
  expectFailure(
    "empty and repeated headers",
    await analyze("csv", "id,,name,name\nP1,a,b,c\n", "id"),
    "delimited-header",
    [1, 1],
  );
  expectFailure(
    "missing evidence column",
    await new EvidenceDelimitedAdapter("csv", {
      key: "id",
      evidenceColumn: "evidence",
    }).analyze(EvidenceTestSourceSnapshot.create("data.csv", "id\nP1\n")),
    "delimited-evidence-column",
    [1],
  );

  const spaced: IEvidenceInventory = await new EvidenceDelimitedAdapter("tsv", {
    key: "id",
  }).analyze(EvidenceTestSourceSnapshot.create("my data.tsv", "id\nP1\n"));
  TestValidator.equals("whitespace path is incomplete", spaced.complete, false);
  TestValidator.equals("whitespace path yields no units", spaced.units, []);
  const failed: IEvidenceInventory = await new EvidenceDelimitedAdapter("tsv", {
    key: "id",
  }).analyze(
    EvidenceTestSourceSnapshot.fail(
      EvidenceTestSourceSnapshot.create("data.tsv", "id\nP1\n"),
      {
        code: "path-unreadable",
        path: "/project/missing.tsv",
        message: "EACCES",
      },
    ),
  );
  TestValidator.equals(
    "failed discovery is incomplete",
    failed.complete,
    false,
  );
  TestValidator.predicate(
    "failed discovery keeps its diagnostic",
    failed.diagnostics.some(
      (diagnostic: IEvidenceDiagnostic): boolean =>
        diagnostic.code === "source-path-unreadable",
    ),
  );

  for (const [label, key, evidenceColumn] of [
    ["empty key list", [], undefined],
    ["repeated key column", ["id", "id"], undefined],
    ["empty key name", "", undefined],
    ["evidence column is a key", "id", "id"],
    ["empty evidence column", "id", ""],
  ] satisfies Array<[string, string | string[], string | undefined]>)
    TestValidator.error(`constructor rejects ${label}`, () => {
      new EvidenceDelimitedAdapter("csv", {
        key,
        ...(evidenceColumn === undefined ? {} : { evidenceColumn }),
      });
    });
}

/** Analyzes one in-memory ledger at a fixed path. */
async function analyze(
  type: "csv" | "tsv",
  content: string,
  key: string | string[],
): Promise<IEvidenceInventory> {
  return new EvidenceDelimitedAdapter(type, { key }).analyze(
    EvidenceTestSourceSnapshot.create(`data.${type}`, content),
  );
}

/** Requires an incomplete inventory whose diagnostics of one code sit on lines. */
function expectFailure(
  label: string,
  inventory: IEvidenceInventory,
  code: string,
  lines: number[],
): void {
  TestValidator.equals(`${label} is incomplete`, inventory.complete, false);
  TestValidator.equals(
    `${label} lines`,
    inventory.diagnostics
      .filter(
        (diagnostic: IEvidenceDiagnostic): boolean => diagnostic.code === code,
      )
      .map(
        (diagnostic: IEvidenceDiagnostic): number =>
          diagnostic.location?.range?.start.line ?? 0,
      )
      .sort((left: number, right: number): number => left - right),
    lines,
  );
}

/** Lists row unit names in inventory order. */
function rowNames(inventory: IEvidenceInventory): string[] {
  return inventory.units
    .filter((unit: IEvidenceUnit): boolean => unit.symbol === "row")
    .map((unit: IEvidenceUnit): string => unit.name);
}
