import { EvidenceFingerprint } from "@wrtnlabs/evidence";
import type {
  IEvidenceInventory,
  IEvidenceUnit,
  IEvidenceHost,
  IEvidenceDeclaration,
  IEvidenceWithdrawal,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { EvidenceTestSourceSnapshot } from "./EvidenceTestSourceSnapshot";
import type { IEvidenceLiteralFixture } from "./IEvidenceLiteralFixture";

/**
 * Keeps every annotation spelling inert in expression strings across adapters.
 *
 * Ordinary data must neither create unsupported-host errors nor alter evidence,
 * reviews, withdrawals or fingerprint exclusions. Real documentation is tested
 * independently so ignoring strings cannot hide an attachment regression.
 *
 * 1. Analyze each carrier with ordinary data and preserve its public inventory.
 * 2. Replace data with every evidence, exclusion, review, link and withdrawal
 *    spelling and malformed tags, alone and after multiline prefixes including
 *    CRLF.
 * 3. Require complete inventories with no annotations, reviews, diagnostics or
 *    additional annotation ranges, and unchanged hosts, addresses and
 *    withdrawals.
 * 4. Add a real documentation acknowledgement and require exactly that target.
 * 5. Change data independently for every tag category and require a changed
 *    declaration fingerprint, including edits to a tag-shaped reason.
 */
export async function assertEvidenceLiteralData(
  fixtures: IEvidenceLiteralFixture[],
): Promise<void> {
  const tags: string[] = [
    "@evidence requirements.md#rule Literal reason.",
    "@link requirements.md#rule Literal reason.",
    "@evidenceExclude requirements.md#rule Literal reason.",
    "@evidenceReview requirements.md#rule #1234567 Literal review.",
    "@evidenceExcludeReview requirements.md#rule #1234567 Literal review.",
    "@internal Literal withdrawal.",
    "@hidden Literal withdrawal.",
    "@ignore Literal withdrawal.",
    "@evidence",
    "@evidenceReview requirements.md#rule Missing fingerprint.",
    "@evidenceExclude Missing target fragment.",
  ];
  const prefixes: string[] = ["", 'quoted "data"\n', "prefix\r\n"];
  const failures: unknown[] = [];
  for (const fixture of fixtures) {
    try {
      const baseline: IEvidenceInventory = await analyze(
        fixture,
        "ordinary data",
        "",
      );
      TestValidator.equals(
        `${fixture.file} baseline`,
        baseline.diagnostics,
        [],
      );
      TestValidator.predicate(
        `${fixture.file} public denominator`,
        baseline.units.length > 0,
      );
      const owner: IEvidenceUnit | undefined = baseline.units.find(
        (candidate: IEvidenceUnit): boolean => candidate.name === "Value",
      );
      if (owner === undefined)
        throw new Error(`Missing Value in ${fixture.file}`);
      for (const tag of tags)
        for (const prefix of prefixes) {
          const data: string = prefix + tag;
          const inventory: IEvidenceInventory = await analyze(
            fixture,
            data,
            "",
          );
          const label: string = `${fixture.file} ${JSON.stringify(data)}`;
          TestValidator.equals(`${label} complete`, inventory.complete, true);
          TestValidator.equals(
            `${label} diagnostics`,
            inventory.diagnostics,
            [],
          );
          TestValidator.equals(
            `${label} acknowledgements`,
            inventory.declarations,
            [],
          );
          TestValidator.equals(`${label} reviews`, inventory.reviews, []);
          TestValidator.equals(
            `${label} accepted spans`,
            inventory.annotationRanges,
            baseline.annotationRanges,
          );
          TestValidator.equals(
            `${label} identities`,
            inventory.units.map((unit: IEvidenceUnit): string => unit.id),
            baseline.units.map((unit: IEvidenceUnit): string => unit.id),
          );
          TestValidator.equals(
            `${label} withdrawals`,
            inventory.units.map(
              (unit: IEvidenceUnit): IEvidenceWithdrawal[] => unit.withdrawals,
            ),
            baseline.units.map(
              (unit: IEvidenceUnit): IEvidenceWithdrawal[] => unit.withdrawals,
            ),
          );
          TestValidator.equals(
            `${label} addresses`,
            inventory.addresses,
            baseline.addresses,
          );
          TestValidator.equals(
            `${label} host denominator`,
            inventory.hosts.map(
              (host: IEvidenceHost): string[] => host.unitIds,
            ),
            baseline.hosts.map((host: IEvidenceHost): string[] => host.unitIds),
          );
          if (prefix === "") {
            const changed: IEvidenceInventory = await analyze(
              fixture,
              `${data} Changed runtime text.`,
              "",
            );
            TestValidator.notEquals(
              `${label} semantic fingerprint`,
              EvidenceFingerprint.inspect(inventory, owner.id).fingerprint,
              EvidenceFingerprint.inspect(changed, owner.id).fingerprint,
            );
          }
        }
      const documented: IEvidenceInventory = await analyze(
        fixture,
        tags.join("\n"),
        "@evidence requirements.md#real Real documentation.",
      );
      TestValidator.equals(
        `${fixture.file} real documentation`,
        documented.declarations.map(
          (declaration: IEvidenceDeclaration): string => declaration.target,
        ),
        ["requirements.md#real"],
      );
      TestValidator.equals(
        `${fixture.file} documented diagnostics`,
        documented.diagnostics,
        [],
      );
      const first: IEvidenceInventory = await analyze(
        fixture,
        "@evidence requirements.md#rule Literal reason.",
        "",
      );
      const second: IEvidenceInventory = await analyze(
        fixture,
        "@evidence requirements.md#rule Changed literal reason.",
        "",
      );
      const unit: IEvidenceUnit | undefined = first.units.find(
        (candidate: IEvidenceUnit): boolean => candidate.name === "Value",
      );
      if (unit === undefined)
        throw new Error(`Missing Value in ${fixture.file}`);
      TestValidator.notEquals(
        `${fixture.file} literal fingerprint`,
        EvidenceFingerprint.inspect(first, unit.id).fingerprint,
        EvidenceFingerprint.inspect(second, unit.id).fingerprint,
      );
    } catch (cause: unknown) {
      failures.push(cause);
    }
  }
  if (failures.length !== 0)
    throw new AggregateError(failures, "Literal carrier regressions");
}

/**
 * Analyzes one carrier while retaining source identity across edits.
 *
 * Only literal contents and independently supplied documentation change.
 */
async function analyze(
  fixture: IEvidenceLiteralFixture,
  data: string,
  documentation: string,
): Promise<IEvidenceInventory> {
  return fixture.adapter.analyze(
    EvidenceTestSourceSnapshot.create(
      fixture.file,
      fixture.source(data, documentation),
    ),
  );
}
