import { EvidenceDelimitedAdapter } from "@wrtnlabs/evidence";
import type { IEvidenceInventory, IEvidenceUnit } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Reads CSV and TSV records into keyed row units under a file aggregate.
 *
 * Row identity must come from the key alone and follow the published grammar of
 * each dialect: RFC 4180 quoting for CSV and IANA literal fields for TSV.
 *
 * 1. Analyze a CSV ledger with a BOM, CRLF endings, blank lines, quoted commas,
 *    doubled quotes, an embedded line break, and a trailing line break; require
 *    one file unit and one row unit per record, with decoded values reflected
 *    in the address keys and row sites starting on their own lines.
 * 2. Analyze a TSV ledger whose fields hold literal double quotes, including an
 *    unbalanced one; require it to parse cleanly with the quotes kept.
 * 3. Analyze a composite-key CSV; require `system:dashboard` addresses with
 *    trimmed key cells.
 * 4. Reorder, insert, and delete unrelated rows; require every surviving row to
 *    keep its unit ID and address.
 * 5. Analyze a header-only file; require a complete inventory with no rows.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs EvidenceDelimitedAdapter on CSV and TSV snapshots and asserts units, symbols, parents, addresses, site lines, completeness and identity stability across row edits.
 * @evidence contracts/testing.md#independent-expectations Expected fields follow RFC 4180 (quoted commas, doubled quotes, embedded CRLF) and the IANA TSV registration (no quoting); expected keys and lines are read off the authored fixtures.
 * @evidence contracts/testing.md#distinguishing-cases Covers BOM, CRLF, blank lines, trailing newline, quoted and unquoted CSV fields, literal TSV quotes, composite and trimmed keys, row reordering, insertion and deletion, and a header-only file; failure rules belong to test_delimited_failures.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers the exported test_delimited_units under test/src/features and it calls the adapter in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_delimited_units(): Promise<void> {
  const csv: IEvidenceInventory = await analyze(
    "csv",
    "data/projects.csv",
    "﻿id,name,note\r\n" +
      "P1,Alpha,plain\r\n" +
      "\r\n" +
      'P2,"Beta, Inc.","said ""yes"""\r\n' +
      'P3,Gamma,"first line\r\nsecond line"\r\n',
    "id",
  );
  TestValidator.equals("CSV is complete", csv.complete, true);
  TestValidator.equals("CSV has no diagnostics", csv.diagnostics, []);
  const file: IEvidenceUnit = requireUnit(csv, "file", "data/projects.csv");
  TestValidator.equals(
    "CSV rows",
    rows(csv).map((unit: IEvidenceUnit): string => unit.name),
    ["P1", "P2", "P3"],
  );
  TestValidator.predicate(
    "rows are children of the file",
    rows(csv).every(
      (unit: IEvidenceUnit): boolean => unit.parentId === file.id,
    ),
  );
  TestValidator.equals(
    "row addresses use the root-relative path and key",
    rows(csv).map((unit: IEvidenceUnit): string[] =>
      csv.addresses
        .filter((address) => address.unitId === unit.id)
        .map(
          (address): string => `${address.file}#${address.segments.join("")}`,
        ),
    ),
    [
      ["/project/data/projects.csv#P1"],
      ["/project/data/projects.csv#P2"],
      ["/project/data/projects.csv#P3"],
    ],
  );
  TestValidator.equals(
    "row sites start on their authored lines",
    rows(csv).map(
      (unit: IEvidenceUnit): number => unit.sites[0]?.range.start.line ?? 0,
    ),
    [2, 4, 5],
  );
  TestValidator.equals(
    "multi-line record ends on its second line",
    requireUnit(csv, "row", "P3").sites[0]?.range.end.line,
    6,
  );

  // Under CSV quoting the unbalanced quote would swallow the next record.
  const tsv: IEvidenceInventory = await analyze(
    "tsv",
    "data/links.tsv",
    'id\ttitle\nL1\t"unbalanced\nL2\tSays "hi" twice\n',
    "id",
  );
  TestValidator.equals("TSV is complete", tsv.complete, true);
  TestValidator.equals("TSV has no diagnostics", tsv.diagnostics, []);
  TestValidator.equals(
    "TSV quotes are literal data",
    rows(tsv).map((unit: IEvidenceUnit): string => unit.name),
    ["L1", "L2"],
  );

  const composite: IEvidenceInventory = await analyze(
    "csv",
    "data/dashboards.csv",
    "system,dashboard,owner\n crm , sales ,ann\ncrm,ops,bob\n",
    ["system", "dashboard"],
  );
  TestValidator.equals(
    "composite keys are trimmed and joined",
    rows(composite)
      .map((unit: IEvidenceUnit): string => unit.name)
      .sort((left: string, right: string): number => left.localeCompare(right)),
    ["crm:ops", "crm:sales"],
  );

  const before: IEvidenceInventory = await analyze(
    "tsv",
    "data/tasks.tsv",
    "id\ttitle\nT1\tOne\nT2\tTwo\nT3\tThree\n",
    "id",
  );
  const after: IEvidenceInventory = await analyze(
    "tsv",
    "data/tasks.tsv",
    "id\ttitle\nT0\tZero\nT3\tThree\nT1\tOne\n",
    "id",
  );
  for (const key of ["T1", "T3"]) {
    const original: IEvidenceUnit = requireUnit(before, "row", key);
    const moved: IEvidenceUnit = requireUnit(after, "row", key);
    TestValidator.equals(`stable identity of ${key}`, moved.id, original.id);
    TestValidator.equals(
      `stable address of ${key}`,
      after.addresses.filter((address) => address.unitId === moved.id),
      before.addresses.filter((address) => address.unitId === original.id),
    );
  }

  const empty: IEvidenceInventory = await analyze(
    "csv",
    "data/empty.csv",
    "id,name\n",
    "id",
  );
  TestValidator.equals("header-only file is complete", empty.complete, true);
  TestValidator.equals("header-only file has no rows", rows(empty), []);
}

/** Analyzes one in-memory ledger with the given dialect and key. */
async function analyze(
  type: "csv" | "tsv",
  path: string,
  content: string,
  key: string | string[],
): Promise<IEvidenceInventory> {
  return new EvidenceDelimitedAdapter(type, { key }).analyze(
    EvidenceTestSourceSnapshot.create(path, content),
  );
}

/** Returns the row units of an inventory in inventory order. */
function rows(inventory: IEvidenceInventory): IEvidenceUnit[] {
  return inventory.units.filter(
    (unit: IEvidenceUnit): boolean => unit.symbol === "row",
  );
}

/** Finds one unit by symbol and name or fails the test. */
function requireUnit(
  inventory: IEvidenceInventory,
  symbol: "file" | "row",
  name: string,
): IEvidenceUnit {
  const unit: IEvidenceUnit | undefined = inventory.units.find(
    (candidate: IEvidenceUnit): boolean =>
      candidate.symbol === symbol && candidate.name === name,
  );
  if (unit === undefined) throw new Error(`Missing ${symbol} unit: ${name}`);
  return unit;
}
