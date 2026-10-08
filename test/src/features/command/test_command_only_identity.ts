import { EvidenceQuery } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckAnalysis,
  IEvidenceCheckReport,
  IEvidenceGraphClaim,
  IEvidenceGraphReference,
  IEvidenceListItem,
  IEvidencePublicAddress,
  IEvidenceUnit,
  IEvidenceUnitSite,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";
import { EvidenceTestQueryAnalysis } from "../../internal/EvidenceTestQueryAnalysis";

/**
 * Preserves alias identity, literal accessors, and uncertain repeated
 * boundaries.
 *
 * Focused checks must deduplicate public aliases without combining independent
 * requirements, and cannot accept one good reference as proof for another
 * ambiguous or incomplete reference to the same target.
 *
 * 1. Select two aliases of a literal dotted property under repeated references;
 *    require one unit and stale review per obligation without input mutation.
 * 2. Select its type ancestor and require both configured properties per
 *    obligation, keeping literal dots out of the parent relation.
 * 3. Duplicate an identity under one address in one reference and require failure
 *    even though the other reference still resolves.
 * 4. Mark one reference incomplete and then withdraw the target in both; require
 *    incomplete exit 2 and hidden-target exit 1 respectively.
 */
export async function test_command_only_identity(): Promise<void> {
  await EvidenceTestFileSystem.experiment(
    "only identity",
    EvidenceTestQueryAnalysis.records(),
    async (directory: string): Promise<void> => {
      const analysis: IEvidenceCheckAnalysis =
        await EvidenceTestQueryAnalysis.analyze(directory, 2);
      const baseline: string = JSON.stringify(analysis);
      const item: IEvidenceListItem | undefined = EvidenceQuery.list(
        analysis,
        directory,
      ).items.find(
        (candidate: IEvidenceListItem): boolean =>
          candidate.scope.role === "reference" &&
          candidate.name === "member.with.dots" &&
          candidate.aliases.some((alias: string): boolean =>
            alias.includes("Renamed"),
          ),
      );
      if (item === undefined) throw new Error("Missing aliased property.");
      const focused: IEvidenceCheckReport = await EvidenceQuery.check(
        analysis,
        directory,
        item.aliases,
        false,
      );
      TestValidator.equals(
        "one identity per obligation",
        focused.counts.units,
        2,
      );
      TestValidator.equals(
        "repeated stale review",
        focused.diagnostics.length,
        2,
      );
      TestValidator.equals(
        "analysis unchanged",
        JSON.stringify(analysis),
        baseline,
      );
      const ancestor: IEvidenceCheckReport = await EvidenceQuery.check(
        analysis,
        directory,
        ["contracts/index.ts#Renamed"],
        false,
      );
      TestValidator.equals("real descendants", ancestor.counts.units, 4);

      const ambiguous: IEvidenceCheckAnalysis = structuredClone(analysis);
      const first: IEvidenceGraphReference = reference(ambiguous);
      const original: IEvidenceUnit | undefined = first.inventory.units.find(
        (unit: IEvidenceUnit): boolean => unit.id === item.unitId,
      );
      if (original === undefined) throw new Error("Missing original property.");
      const duplicate: IEvidenceUnit = structuredClone(original);
      duplicate.id += ":duplicate";
      duplicate.sites = duplicate.sites.map(
        (site: IEvidenceUnitSite): IEvidenceUnitSite => ({
          ...site,
          id: `${site.id}:duplicate`,
        }),
      );
      first.inventory.units.push(duplicate);
      first.inventory.addresses.push(
        ...first.inventory.addresses
          .filter(
            (address: IEvidencePublicAddress): boolean =>
              address.unitId === original.id,
          )
          .map((address: IEvidencePublicAddress): IEvidencePublicAddress => ({
            ...address,
            unitId: duplicate.id,
          })),
      );
      first.unitIds.push(duplicate.id);
      const collision: IEvidenceCheckReport = await EvidenceQuery.check(
        ambiguous,
        directory,
        [item.target],
        false,
      );
      TestValidator.equals(
        "one ambiguous boundary fails",
        collision.exitCode,
        1,
      );

      const interrupted: IEvidenceCheckAnalysis = structuredClone(analysis);
      reference(interrupted).inventory.complete = false;
      const incomplete: IEvidenceCheckReport = await EvidenceQuery.check(
        interrupted,
        directory,
        [item.target],
        false,
      );
      TestValidator.equals(
        "one incomplete boundary fails",
        incomplete.exitCode,
        2,
      );

      const hidden: IEvidenceCheckAnalysis = structuredClone(analysis);
      const claim: IEvidenceGraphClaim | undefined =
        hidden.graphInput.claims[0];
      if (claim === undefined) throw new Error("Missing hidden claim.");
      for (const population of claim.references) {
        const unit: IEvidenceUnit | undefined = population.inventory.units.find(
          (candidate: IEvidenceUnit): boolean => candidate.id === item.unitId,
        );
        const site: IEvidenceUnitSite | undefined =
          unit === undefined ? undefined : unit.sites[0];
        if (unit === undefined || site === undefined)
          throw new Error("Missing hidden property.");
        unit.withdrawals.push({
          tag: "hidden",
          location: { file: site.file, range: site.range },
        });
      }
      TestValidator.equals(
        "hidden selection fails",
        (await EvidenceQuery.check(hidden, directory, [item.target], false))
          .exitCode,
        1,
      );
    },
  );
}

/**
 * Retrieves the first independent reference used for state transitions.
 *
 * Missing fixture boundaries fail immediately instead of weakening the case.
 */
function reference(analysis: IEvidenceCheckAnalysis): IEvidenceGraphReference {
  const claim: IEvidenceGraphClaim | undefined = analysis.graphInput.claims[0];
  const result: IEvidenceGraphReference | undefined =
    claim === undefined ? undefined : claim.references[0];
  if (result === undefined) throw new Error("Missing reference fixture.");
  return result;
}
