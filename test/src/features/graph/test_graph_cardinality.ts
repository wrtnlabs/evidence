import { EvidenceGraph } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";

import { EvidenceTestGraph } from "../../internal/EvidenceTestGraph";
import { EvidenceTestInventory } from "../../internal/EvidenceTestInventory";

/**
 * Applies positive-evidence cardinality to semantic units and hosts.
 *
 * Physical documentation fragments and repeated citations must not inflate
 * cardinality. Aggregate scopes expand to selected descendants, while
 * exclusions can satisfy ordinary coverage without becoming positive evidence.
 *
 * 1. Check three claim subjects under singleEvidencePerSymbol:
 *
 *    - An uncited subject reports zero positive units.
 *    - Two comment fragments citing the same unit count once for their shared owner.
 *    - An aggregate citation covering two selected children reports two units.
 * 2. Supply only an exclusion and require ordinary coverage to pass, positive
 *    cardinality to remain zero, and no unique-positive-host finding.
 * 3. Have two semantic hosts cite one reference unit, with a repeated fragment on
 *    one host; compare ordinary and uniqueEvidence reference entries.
 * 4. Require exactly one uniqueness finding on the second reference, counting two
 *    semantic hosts rather than three physical citation positions.
 * 5. Require each cardinality finding to name the unit it is about, which is what
 *    lets a report window group findings by unit.
 */
export async function test_graph_cardinality(): Promise<void> {
  const reference = EvidenceTestInventory.create();
  const parent = EvidenceTestInventory.unit(
    reference,
    "parent",
    ["Parent"],
    "type",
    "export class Box { value = 1; }",
  );
  const first = EvidenceTestInventory.unit(
    reference,
    "first",
    ["Parent", "first"],
    "property",
    "value = 1",
    parent.id,
  );
  const second = EvidenceTestInventory.unit(
    reference,
    "second",
    ["Parent", "second"],
    "property",
    "extra: string",
    parent.id,
  );

  const claim = EvidenceTestInventory.create();
  const empty = EvidenceTestInventory.unit(
    claim,
    "empty",
    ["Empty"],
    "property",
    "export const unrelated = 3;",
  );
  const duplicate = EvidenceTestInventory.unit(
    claim,
    "duplicate",
    ["Duplicate"],
    "type",
    "export const first = 1, second = 2;",
  );
  const broad = EvidenceTestInventory.unit(
    claim,
    "broad",
    ["Broad"],
    "type",
    "export class Box { value = 1; }",
  );
  EvidenceTestInventory.host(
    claim,
    "empty-host",
    empty.sites[0]?.id ?? "",
    [empty.id],
    "export const unrelated = 3;",
  );
  const duplicateHost = EvidenceTestInventory.host(
    claim,
    "duplicate-host",
    duplicate.sites[0]?.id ?? "",
    [duplicate.id],
    "/** Shared documentation. */",
  );
  const duplicateFragment = EvidenceTestInventory.host(
    claim,
    "duplicate-fragment",
    duplicate.sites[0]?.id ?? "",
    [duplicate.id],
    "/** Class documentation. */",
  );
  const broadHost = EvidenceTestInventory.host(
    claim,
    "broad-host",
    broad.sites[0]?.id ?? "",
    [broad.id],
    "/** Class documentation. */",
  );
  const firstCitation = EvidenceTestGraph.declaration(
    claim,
    "first-citation",
    duplicateHost,
    "evidence",
    "first",
  );
  const repeatedCitation = EvidenceTestGraph.declaration(
    claim,
    "repeated-citation",
    duplicateFragment,
    "evidence",
    "first",
  );
  const broadCitation = EvidenceTestGraph.declaration(
    claim,
    "broad-citation",
    broadHost,
    "evidence",
    "parent",
  );
  const single = EvidenceGraph.evaluate({
    claims: [
      {
        severity: "error",
        inventory: claim,
        unitIds: [empty.id, duplicate.id, broad.id],
        references: [
          {
            severity: "error",
            inventory: reference,
            unitIds: [first.id, second.id],
            resolutions: [
              EvidenceTestGraph.resolved(firstCitation, first),
              EvidenceTestGraph.resolved(repeatedCitation, first),
              EvidenceTestGraph.resolved(broadCitation, parent),
            ],
            singleEvidencePerSymbol: true,
          },
        ],
      },
    ],
  });

  const singleFindings = single.diagnostics.filter(
    (diagnostic) => diagnostic.code === "graph-single-evidence-per-symbol",
  );
  TestValidator.equals(
    "zero and aggregate host cardinality",
    singleFindings.length,
    2,
  );
  TestValidator.predicate(
    "zero host included",
    singleFindings.some((diagnostic) => diagnostic.message.includes("Empty")),
  );
  TestValidator.predicate(
    "aggregate expands to both descendants",
    singleFindings.some(
      (diagnostic) =>
        diagnostic.message.includes("Broad") &&
        diagnostic.message.includes("cites 2 distinct"),
    ),
  );
  TestValidator.equals(
    "cardinality findings name their subject unit",
    singleFindings
      .map((diagnostic) => diagnostic.unitId)
      .sort((x, y) => String(x).localeCompare(String(y))),
    [broad.id, empty.id].sort((x, y) => x.localeCompare(y)),
  );
  TestValidator.predicate(
    "duplicate positions remain one semantic host",
    singleFindings.every(
      (diagnostic) => !diagnostic.message.includes("Duplicate"),
    ),
  );

  // Exclusions can satisfy ordinary coverage but never contribute a positive cardinality.
  const exclusionClaim = EvidenceTestInventory.create();
  const exclusionOwner = EvidenceTestInventory.unit(
    exclusionClaim,
    "exclusion-owner",
    ["ExclusionOwner"],
    "function",
    "export const unrelated = 3;",
  );
  const exclusionHost = EvidenceTestInventory.host(
    exclusionClaim,
    "exclusion-host",
    exclusionOwner.sites[0]?.id ?? "",
    [exclusionOwner.id],
    "export const unrelated = 3;",
  );
  const exclusion = EvidenceTestGraph.declaration(
    exclusionClaim,
    "exclusion",
    exclusionHost,
    "evidenceExclude",
    "first",
  );
  const exclusionOnly = EvidenceGraph.evaluate({
    claims: [
      {
        severity: "error",
        inventory: exclusionClaim,
        unitIds: [exclusionOwner.id],
        references: [
          {
            severity: "error",
            inventory: reference,
            unitIds: [first.id],
            resolutions: [EvidenceTestGraph.resolved(exclusion, first)],
            uniqueEvidence: true,
            singleEvidencePerSymbol: true,
          },
        ],
      },
    ],
  });

  TestValidator.equals(
    "exclusion supplies ordinary coverage",
    EvidenceTestGraph.obligation(exclusionOnly, 0, 0).missingUnitIds,
    [],
  );
  TestValidator.predicate(
    "exclusion counts as zero positive units",
    exclusionOnly.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "graph-single-evidence-per-symbol" &&
        diagnostic.message.includes("cites 0 distinct"),
    ),
  );
  TestValidator.equals(
    "exclusion creates no unique host",
    exclusionOnly.diagnostics.filter(
      (diagnostic) => diagnostic.code === "graph-unique-evidence",
    ),
    [],
  );

  // Two different semantic hosts violate only the reference that enables uniqueEvidence.
  const uniqueClaim = EvidenceTestInventory.create();
  const owner = EvidenceTestInventory.unit(
    uniqueClaim,
    "owner",
    ["Owner"],
    "type",
    "export const first = 1, second = 2;",
  );
  const otherOwner = EvidenceTestInventory.unit(
    uniqueClaim,
    "other-owner",
    ["OtherOwner"],
    "property",
    "export const unrelated = 3;",
  );
  const ownerHost = EvidenceTestInventory.host(
    uniqueClaim,
    "owner-host",
    owner.sites[0]?.id ?? "",
    [owner.id],
    "/** Shared documentation. */",
  );
  const ownerFragment = EvidenceTestInventory.host(
    uniqueClaim,
    "owner-fragment",
    owner.sites[0]?.id ?? "",
    [owner.id],
    "/** Class documentation. */",
  );
  const otherOwnerHost = EvidenceTestInventory.host(
    uniqueClaim,
    "other-owner-host",
    otherOwner.sites[0]?.id ?? "",
    [otherOwner.id],
    "export const unrelated = 3;",
  );
  const ownerCitation = EvidenceTestGraph.declaration(
    uniqueClaim,
    "owner-citation",
    ownerHost,
    "evidence",
    "first",
  );
  const ownerRepeated = EvidenceTestGraph.declaration(
    uniqueClaim,
    "owner-repeated",
    ownerFragment,
    "evidence",
    "first",
  );
  const otherCitation = EvidenceTestGraph.declaration(
    uniqueClaim,
    "other-citation",
    otherOwnerHost,
    "evidence",
    "first",
  );
  const resolutions = [
    EvidenceTestGraph.resolved(ownerCitation, first),
    EvidenceTestGraph.resolved(ownerRepeated, first),
    EvidenceTestGraph.resolved(otherCitation, first),
  ];
  const unique = EvidenceGraph.evaluate({
    claims: [
      {
        severity: "error",
        inventory: uniqueClaim,
        unitIds: [owner.id, otherOwner.id],
        references: [
          {
            severity: "error",
            inventory: reference,
            unitIds: [first.id],
            resolutions,
          },
          {
            severity: "error",
            inventory: reference,
            unitIds: [first.id],
            resolutions,
            uniqueEvidence: true,
          },
        ],
      },
    ],
  });

  const uniqueFindings = unique.diagnostics.filter(
    (diagnostic) => diagnostic.code === "graph-unique-evidence",
  );
  TestValidator.equals("one unique host finding", uniqueFindings.length, 1);
  const uniqueFinding = uniqueFindings[0];
  if (uniqueFinding === undefined)
    throw new Error("Missing unique evidence finding.");
  TestValidator.equals(
    "unique policy belongs to second reference",
    uniqueFinding.reference,
    1,
  );
  TestValidator.equals(
    "unique finding names the contested reference unit",
    uniqueFinding.unitId,
    first.id,
  );
  TestValidator.predicate(
    "unique count uses semantic hosts",
    uniqueFinding.message.includes("2 distinct positive evidence host(s)"),
  );
}
