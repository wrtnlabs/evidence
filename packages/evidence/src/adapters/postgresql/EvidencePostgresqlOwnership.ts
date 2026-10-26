import { groupEvidenceRecords } from "../../internal/groupEvidenceRecords";
import type { IEvidenceSqlDeclaration } from "../sql/IEvidenceSqlDeclaration";
import typia from "typia";

import type { IEvidenceSqlFileAnalysis } from "../sql/IEvidenceSqlFileAnalysis";
import type { IEvidencePostgresqlFileAnalysis } from "./IEvidencePostgresqlFileAnalysis";

/**
 * Reconciles ALTER and COMMENT sites independently of selected file ordering.
 *
 * PostgreSQL permits extension statements in other files, so publication waits
 * until a unique selected declaration can establish their semantic ownership.
 *
 * @evidence contracts/common.md#principled-implementation Deferred ALTER and COMMENT sites are attached only to a unique selected declaration with the same identity, independent of file order.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns cross-file ownership only.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Ambiguity marks analysis incomplete instead of attaching to an arbitrary table.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains the ordering problem.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidencePostgresqlOwnership {
  /**
   * Resolves every deferred extension against exactly one declaration.
   *
   * Ambiguity makes analysis incomplete rather than allowing an ALTER or
   * COMMENT to silently attach to an arbitrary same-named table.
   *
   * @evidence contracts/common.md#principled-implementation Declarations are indexed by identity across files and each deferred reference is merged into exactly one owner.
   * @evidence contracts/common.md#clear-and-simple-design Resolution mutates the copied analyses in place.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Missing or multiple owners produce diagnostics and incompleteness.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the ambiguity rule.
   * @evidence contracts/performance.md#efficient-algorithms Linear in declarations and deferred references with map lookups.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work It runs once per analysis.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources It mutates caller-owned analyses and keeps no state.
   */
  export function resolve(input: IEvidenceSqlFileAnalysis[]): void {
    const analyses = typia.assert<IEvidencePostgresqlFileAnalysis[]>(input);
    const declarations = analyses.flatMap((analysis) => analysis.declarations);
    const introducing: Map<string, IEvidenceSqlDeclaration[]> =
      groupEvidenceRecords(
        declarations.filter(
          (entry: IEvidenceSqlDeclaration): boolean => entry.merge !== true,
        ),
        (entry: IEvidenceSqlDeclaration): string =>
          JSON.stringify([entry.symbol, entry.identity]),
      );
    const comments: Map<string, number> = new Map();
    for (const analysis of analyses)
      for (const reference of analysis.references ?? [])
        if (reference.comment) {
          const key: string = JSON.stringify(reference.identity);
          comments.set(key, (comments.get(key) ?? 0) + 1);
        }
    for (const analysis of analyses) {
      const local: Map<string, IEvidenceSqlDeclaration> = new Map(
        analysis.declarations.map(
          (
            entry: IEvidenceSqlDeclaration,
          ): [string, IEvidenceSqlDeclaration] => [entry.id, entry],
        ),
      );
      for (const reference of analysis.references ?? []) {
        const declaration: IEvidenceSqlDeclaration | undefined = local.get(
          reference.declarationId,
        );
        if (declaration === undefined) continue;
        const matches: IEvidenceSqlDeclaration[] =
          introducing.get(
            JSON.stringify([declaration.symbol, reference.identity]),
          ) ?? [];
        const original: IEvidenceSqlDeclaration | undefined = matches[0];
        if (
          matches.length !== 1 ||
          original === undefined ||
          (reference.comment &&
            comments.get(JSON.stringify(reference.identity)) !== 1)
        ) {
          analysis.complete = false;
          analysis.diagnostics.push({
            code: "postgresql-unresolved-owner",
            severity: "error",
            message: `PostgreSQL ${reference.comment ? "COMMENT" : "ALTER"} target '${reference.identity.join(".")}' needs exactly one selected declaration and at most one COMMENT assignment.`,
            repair:
              "Select the schema-qualified CREATE TABLE declaration and remove conflicting definitions.",
            location: {
              file: analysis.source.physicalPath,
              range: declaration.site.range,
            },
          });
          declaration.public = false;
          continue;
        }
        if (original.ownerDeclarationId !== undefined)
          declaration.ownerDeclarationId = original.ownerDeclarationId;
      }
    }
    const unavailable = new Set(
      declarations
        .filter((declaration) => !declaration.public)
        .map((declaration) => declaration.id),
    );
    for (const declaration of declarations)
      if (
        declaration.ownerDeclarationId !== undefined &&
        unavailable.has(declaration.ownerDeclarationId)
      )
        declaration.public = false;
  }
}
