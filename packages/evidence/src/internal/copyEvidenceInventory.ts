import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
import type { IEvidenceSourceFile } from "../structures/IEvidenceSourceFile";
import type { IEvidenceSourceAddress } from "../structures/IEvidenceSourceAddress";
import type { IEvidenceSourceLocation } from "../structures/IEvidenceSourceLocation";
import type { IEvidenceUnit } from "../structures/IEvidenceUnit";
import type { IEvidenceUnitSite } from "../structures/IEvidenceUnitSite";
import type { IEvidenceWithdrawal } from "../structures/IEvidenceWithdrawal";
import type { IEvidenceHost } from "../structures/IEvidenceHost";
import type { IEvidenceDeclaration } from "../structures/IEvidenceDeclaration";
import type { IEvidenceReview } from "../structures/IEvidenceReview";
import type { IEvidenceDiagnostic } from "../structures/IEvidenceDiagnostic";
/**
 * Copies the record shells mutated by inventory reconciliation while borrowing
 * immutable leaves.
 *
 * @evidence contracts/common.md#principled-implementation Merge, file scoping and normalization change record fields and arrays, so those shells and physical locations are copied; strings, coordinates, identities and dependency records stay borrowed and immutable.
 * @evidence contracts/common.md#clear-and-simple-design One structural-copy function lists the exact shells reconciliation may mutate and borrows the remaining immutable leaves.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Only reconciliation-owned shells and mutable arrays are copied; this internal helper is never used to expose caller-mutable public snapshots.
 * @evidence contracts/common.md#meaningful-documentation The comment distinguishes copied reconciliation shells from immutable borrowed leaves and states the internal-only ownership boundary.
 * @evidence contracts/performance.md#efficient-algorithms Linear in record count without traversing immutable ranges, content strings or identity arrays.
 * @evidence contracts/performance.md#reuse-equivalent-work Internal callers reuse immutable leaves within one owned analysis; this is not a public snapshot.
 * @evidence contracts/performance.md#bound-retention-and-release-resources All new shells belong to the returned inventory; no state is retained.
 */
export function copyEvidenceInventory(
  input: IEvidenceInventory,
): IEvidenceInventory {
  return {
    ...input,
    sources: input.sources.map(
      (source: IEvidenceSourceFile): IEvidenceSourceFile => ({
        ...source,
        addresses: source.addresses.map(
          (address: IEvidenceSourceAddress): IEvidenceSourceAddress => ({
            ...address,
          }),
        ),
      }),
    ),
    annotationRanges: input.annotationRanges.map(
      (location: IEvidenceSourceLocation): IEvidenceSourceLocation => ({
        ...location,
      }),
    ),
    units: input.units.map((unit: IEvidenceUnit): IEvidenceUnit => ({
      ...unit,
      sites: unit.sites.map((site: IEvidenceUnitSite): IEvidenceUnitSite => ({
        ...site,
      })),
      withdrawals: unit.withdrawals.map(
        (withdrawal: IEvidenceWithdrawal): IEvidenceWithdrawal => ({
          ...withdrawal,
          location: { ...withdrawal.location },
        }),
      ),
    })),
    addresses: [...input.addresses],
    hosts: input.hosts.map((host: IEvidenceHost): IEvidenceHost => ({
      ...host,
      unitIds: [...host.unitIds],
      ...(host.origins === undefined ? {} : { origins: [...host.origins] }),
    })),
    declarations: input.declarations.map(
      (declaration: IEvidenceDeclaration): IEvidenceDeclaration => ({
        ...declaration,
        location: { ...declaration.location },
      }),
    ),
    reviews: input.reviews.map((review: IEvidenceReview): IEvidenceReview => ({
      ...review,
      location: { ...review.location },
    })),
    diagnostics: input.diagnostics.map(
      (diagnostic: IEvidenceDiagnostic): IEvidenceDiagnostic => ({
        ...diagnostic,
        ...(diagnostic.location === undefined
          ? {}
          : { location: { ...diagnostic.location } }),
      }),
    ),
    dependencies: [...input.dependencies],
  };
}
