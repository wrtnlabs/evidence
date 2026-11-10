import { EvidenceDelimitedAdapter } from "@wrtnlabs/evidence";
import type {
  IEvidenceDeclaration,
  IEvidenceDiagnostic,
  IEvidenceHost,
  IEvidenceInventory,
  IEvidenceReview,
  IEvidenceSourceLocation,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Parses evidence-column cells as annotation hosts of their rows.
 *
 * Each row owns one host on its evidence cell, a cell can carry several
 * annotations, and every annotation keeps exact source coordinates even when
 * CSV quoting changes the decoded text.
 *
 * 1. Analyze a TSV ledger whose cells hold one annotation, two annotations in one
 *    line, a review with a fingerprint, nothing, and prose before a tag;
 *    require one attached host per row, split declarations with their own
 *    reasons, the review, and a diagnostic for the leading prose only.
 * 2. Analyze a CSV ledger whose quoted cell contains a comma, a doubled quote, and
 *    a CRLF line break inside the reason; require the decoded reason and a
 *    location whose text in the source is the authored annotation.
 * 3. Analyze a cell with a malformed annotation; require the shared tag parser's
 *    diagnostic at the cell.
 * 4. Analyze the same ledger without an evidence column; require no hosts and no
 *    annotations.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs the delimited adapter with and without an evidence column and asserts hosts, declarations, reviews, reasons, source slices of locations and diagnostics.
 * @evidence contracts/testing.md#independent-expectations Expected targets and reasons are copied from the authored cells, and each location is checked by slicing the original source text rather than by recomputing offsets.
 * @evidence contracts/testing.md#distinguishing-cases Covers single, multiple, review, empty, prose-led and malformed cells, quoted CSV escapes and embedded CRLF, and the absence of an evidence column; graph policy belongs to test_delimited_graph.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers the exported test_delimited_hosts under test/src/features and it calls the adapter in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_delimited_hosts(): Promise<void> {
  const tsvSource: string = [
    "id\tevidence\ttitle",
    "P1\t@evidence goals.md#growth Drives paid growth.\tAlpha",
    "P2\t@evidence goals.md#growth Adds reach. @evidenceExclude goals.md#cost Funded elsewhere.\tBeta",
    "P3\t@evidenceReview goals.md#growth #abcdef0 Checked the goal text.\tGamma",
    "P4\t\tDelta",
    "P5\tsee notes @evidence goals.md#growth Late tag.\tEpsilon",
    "",
  ].join("\n");
  const tsv: IEvidenceInventory = await new EvidenceDelimitedAdapter("tsv", {
    key: "id",
    evidenceColumn: "evidence",
  }).analyze(EvidenceTestSourceSnapshot.create("data/projects.tsv", tsvSource));
  TestValidator.equals("TSV ledger stays complete", tsv.complete, true);
  TestValidator.equals(
    "one attached host per row",
    tsv.hosts.map((host: IEvidenceHost): string[] =>
      host.unitIds.map(name(tsv)),
    ),
    [["P1"], ["P2"], ["P3"], ["P4"], ["P5"]],
  );
  TestValidator.equals(
    "declarations split at tag tokens",
    bySource(tsv.declarations).map(
      (declaration: IEvidenceDeclaration): string[] => [
        hostRow(tsv, declaration.hostId),
        declaration.kind,
        declaration.target,
        declaration.reason,
      ],
    ),
    [
      ["P1", "evidence", "goals.md#growth", "Drives paid growth."],
      ["P2", "evidence", "goals.md#growth", "Adds reach."],
      ["P2", "evidenceExclude", "goals.md#cost", "Funded elsewhere."],
      ["P5", "evidence", "goals.md#growth", "Late tag."],
    ],
  );
  TestValidator.equals(
    "review keeps its fingerprint",
    tsv.reviews.map((review: IEvidenceReview): string[] => [
      hostRow(tsv, review.hostId),
      review.fingerprint ?? "",
      review.description,
    ]),
    [["P3", "abcdef0", "Checked the goal text."]],
  );
  TestValidator.equals(
    "every annotation location slices to its authored text",
    bySource(tsv.declarations).map(
      (declaration: IEvidenceDeclaration): string =>
        slice(tsvSource, declaration.location),
    ),
    [
      "@evidence goals.md#growth Drives paid growth.",
      "@evidence goals.md#growth Adds reach.",
      "@evidenceExclude goals.md#cost Funded elsewhere.",
      "@evidence goals.md#growth Late tag.",
    ],
  );
  const prose: IEvidenceDiagnostic[] = tsv.diagnostics.filter(
    (diagnostic: IEvidenceDiagnostic): boolean =>
      diagnostic.code === "delimited-evidence-text",
  );
  TestValidator.equals(
    "only leading prose is reported",
    prose.map((diagnostic: IEvidenceDiagnostic): string =>
      diagnostic.location === undefined
        ? ""
        : slice(tsvSource, diagnostic.location),
    ),
    ["see notes"],
  );

  const csvSource: string =
    'id,evidence\r\nP1,"@evidence goals.md#growth Uses ""paid"" search, then\r\nreferrals."\r\n';
  const csv: IEvidenceInventory = await new EvidenceDelimitedAdapter("csv", {
    key: "id",
    evidenceColumn: "evidence",
  }).analyze(EvidenceTestSourceSnapshot.create("data/projects.csv", csvSource));
  TestValidator.equals("CSV ledger stays complete", csv.complete, true);
  TestValidator.equals(
    "quoted reason is decoded",
    csv.declarations.map(
      (declaration: IEvidenceDeclaration): string => declaration.reason,
    ),
    ['Uses "paid" search, then\nreferrals.'],
  );
  TestValidator.equals(
    "quoted location keeps authored escapes",
    csv.declarations.map((declaration: IEvidenceDeclaration): string =>
      slice(csvSource, declaration.location),
    ),
    ['@evidence goals.md#growth Uses ""paid"" search, then\r\nreferrals.'],
  );

  const malformed: IEvidenceInventory = await new EvidenceDelimitedAdapter(
    "tsv",
    { key: "id", evidenceColumn: "evidence" },
  ).analyze(
    EvidenceTestSourceSnapshot.create(
      "data/projects.tsv",
      "id\tevidence\nP1\t@evidence goals.md#growth\n",
    ),
  );
  TestValidator.equals(
    "malformed annotation is reported by the tag parser",
    malformed.diagnostics.map(
      (diagnostic: IEvidenceDiagnostic): string => diagnostic.code,
    ),
    ["missing-evidence-reason"],
  );
  TestValidator.equals(
    "malformed annotation adds no declaration",
    malformed.declarations,
    [],
  );

  const plain: IEvidenceInventory = await new EvidenceDelimitedAdapter("tsv", {
    key: "id",
  }).analyze(EvidenceTestSourceSnapshot.create("data/projects.tsv", tsvSource));
  TestValidator.equals("no evidence column means no hosts", plain.hosts, []);
  TestValidator.equals(
    "no evidence column means no annotations",
    [plain.declarations.length, plain.reviews.length],
    [0, 0],
  );
}

/** Orders statements by their source offset, the authored order. */
function bySource(
  declarations: IEvidenceDeclaration[],
): IEvidenceDeclaration[] {
  return [...declarations].sort(
    (left: IEvidenceDeclaration, right: IEvidenceDeclaration): number =>
      (left.location.range?.start.offset ?? 0) -
      (right.location.range?.start.offset ?? 0),
  );
}

/** Returns a mapper from unit ID to unit name for one inventory. */
function name(inventory: IEvidenceInventory): (id: string) => string {
  return (id: string): string =>
    inventory.units.find((unit: IEvidenceUnit): boolean => unit.id === id)
      ?.name ?? id;
}

/** Names the row that owns a host. */
function hostRow(inventory: IEvidenceInventory, hostId: string): string {
  const host: IEvidenceHost | undefined = inventory.hosts.find(
    (candidate: IEvidenceHost): boolean => candidate.id === hostId,
  );
  return name(inventory)(host?.unitIds[0] ?? hostId);
}

/** Returns the source text covered by a location. */
function slice(source: string, location: IEvidenceSourceLocation): string {
  return location.range === undefined
    ? ""
    : source.slice(location.range.start.offset, location.range.end.offset);
}
