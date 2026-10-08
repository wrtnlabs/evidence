import type { EvidenceQueryPopulationContext } from "../contexts/EvidenceQueryPopulationContext";
import type { IEvidenceQueryContext } from "../contexts/IEvidenceQueryContext";
import { EvidenceInventoryMerge } from "../internal/EvidenceInventoryMerge";
import type { IEvidenceUnitCheckSelection } from "../internal/IEvidenceUnitCheckSelection";
import type { IEvidenceCheckAnalysis } from "../structures/IEvidenceCheckAnalysis";
import type { IEvidenceCheckClaim } from "../structures/IEvidenceCheckClaim";
import type { IEvidenceCheckCounts } from "../structures/IEvidenceCheckCounts";
import type { IEvidenceCheckObligation } from "../structures/IEvidenceCheckObligation";
import type { IEvidenceCheckReport } from "../structures/IEvidenceCheckReport";
import type { IEvidenceDiagnostic } from "../structures/IEvidenceDiagnostic";
import type { IEvidenceDeclaration } from "../structures/IEvidenceDeclaration";
import type { IEvidenceReview } from "../structures/IEvidenceReview";
import type { IEvidenceGraphClaimResult } from "../structures/IEvidenceGraphClaimResult";
import type { IEvidenceGraphClaim } from "../structures/IEvidenceGraphClaim";
import type { IEvidenceGraphHostCoverage } from "../structures/IEvidenceGraphHostCoverage";
import type { IEvidenceGraphObligation } from "../structures/IEvidenceGraphObligation";
import type { IEvidenceInspection } from "../structures/IEvidenceInspection";
import type { IEvidenceInspectReport } from "../structures/IEvidenceInspectReport";
import type { IEvidenceInspectedUnit } from "../structures/IEvidenceInspectedUnit";
import type { IEvidenceUnit } from "../structures/IEvidenceUnit";
import { EvidenceQueryProgrammer } from "./EvidenceQueryProgrammer";
import { EvidenceCheckProgrammer } from "./EvidenceCheckProgrammer";

/**
 * Focuses check outcomes on CLI-selected semantic units.
 *
 * Full evaluation precedes projection so narrowing cannot conceal duplicate
 * evidence, change fingerprints, or make a multi-target host satisfy
 * singleEvidencePerSymbol. Extraction retains complete configured inputs.
 */
export namespace EvidenceUnitCheckProgrammer {
  /**
   * Resolves target subtrees and derives their report and exit status.
   *
   * Targets reuse inspect's grammars. Shallow selection omits descendants;
   * unresolved, ambiguous, and incomplete requests cannot silently pass.
   * Reference units select incoming coverage and claim units select outgoing
   * annotations and host policies. The supplied analysis remains unchanged.
   */
  export async function check(
    context: IEvidenceQueryContext,
    targets: readonly string[],
    shallow: boolean,
  ): Promise<IEvidenceCheckReport> {
    if (targets.length === 0)
      throw new Error("Focused checks require at least one target.");
    const { analysis, populations }: IEvidenceQueryContext = context;
    const selections: Map<string, IEvidenceUnitCheckSelection> = new Map();
    const failures: IEvidenceDiagnostic[] = [];
    let incomplete: boolean = false;

    // Resolve every request before deriving the outcome. A good target beside a
    // typo or an uncertain repeated boundary must not hide the failed request.
    for (const target of targets) {
      const inspected: IEvidenceInspectReport =
        await EvidenceQueryProgrammer.inspect(context, target);
      const resolved: IEvidenceInspection[] = inspected.inspections.filter(
        (inspection: IEvidenceInspection): boolean =>
          inspection.status === "resolved",
      );
      const uncertain: IEvidenceInspection[] = inspected.inspections.filter(
        (inspection: IEvidenceInspection): boolean =>
          inspection.status === "incomplete" ||
          inspection.status === "ambiguous",
      );
      let selected: boolean = false;
      for (const inspection of resolved) {
        const population: EvidenceQueryPopulationContext | undefined =
          populations.find(
            (candidate: EvidenceQueryPopulationContext): boolean =>
              key(candidate.scope.claim, candidate.scope.reference) ===
              key(inspection.scope.claim, inspection.scope.reference),
          );
        if (population === undefined)
          throw new Error("Inspected unit has no configured population.");
        const ids: string[] = inspection.units
          .flatMap((unit: IEvidenceInspectedUnit): string[] =>
            shallow
              ? population.selected.has(unit.item.unitId)
                ? [unit.item.unitId]
                : []
              : [...population.selectedDescendants(unit.item.unitId)],
          )
          .filter((id: string): boolean => population.visible.has(id));
        if (ids.length === 0) continue;
        selected = true;
        const boundary: string = key(
          population.scope.claim,
          population.scope.reference,
        );
        let selection: IEvidenceUnitCheckSelection | undefined =
          selections.get(boundary);
        if (selection === undefined) {
          selection = {
            population,
            unitIds: new Set(),
            scopeIds: new Set(),
            hostIds: new Set(),
            relatedUnitIds: new Set(),
            statements: new Set(),
          };
          selections.set(boundary, selection);
        }
        for (const id of ids) selection.unitIds.add(id);
      }
      if (!selected || uncertain.length !== 0) {
        incomplete ||= uncertain.some(
          (inspection: IEvidenceInspection): boolean =>
            inspection.status === "incomplete",
        );
        failures.push({
          code: "check-only-target",
          severity: "error",
          message: `Cannot establish a complete, unambiguous selection for '${target}'.`,
          repair:
            "Use evidence list or evidence inspect to find a visible configured unit. Shallow targets must themselves be selected by configuration.",
          target,
        });
        failures.push(
          ...inspected.inspections.flatMap(
            (inspection: IEvidenceInspection): IEvidenceDiagnostic[] =>
              inspection.diagnostics,
          ),
        );
      }
    }

    // Project the evaluated ledger rather than reevaluating reduced inputs:
    // cardinality and review freshness depend on context outside the focus.
    for (const selection of selections.values())
      indexSelection(analysis, selection);
    const claims: IEvidenceCheckClaim[] = analysis.report.claims.flatMap(
      (claim: IEvidenceCheckClaim): IEvidenceCheckClaim[] =>
        projectClaim(analysis, selections, claim),
    );
    const diagnostics: IEvidenceDiagnostic[] =
      EvidenceCheckProgrammer.orderDiagnostics(
        EvidenceInventoryMerge.unique(
          [
            ...analysis.report.diagnostics.flatMap(
              (diagnostic: IEvidenceDiagnostic): IEvidenceDiagnostic[] =>
                selectDiagnostic(analysis, selections, diagnostic),
            ),
            ...failures,
          ],
          (diagnostic: IEvidenceDiagnostic): string =>
            JSON.stringify(diagnostic),
        ),
      );
    const counts: IEvidenceCheckCounts = EvidenceCheckProgrammer.summarize(
      claims,
      diagnostics,
    );
    const complete: boolean =
      !incomplete &&
      claims.every(
        (claim: IEvidenceCheckClaim): boolean =>
          !claim.active ||
          (claim.complete &&
            claim.obligations.every(
              (obligation: IEvidenceCheckObligation): boolean =>
                !obligation.active || obligation.complete,
            )),
      );
    const success: boolean = complete && counts.errors === 0;
    return {
      ...analysis.report,
      only: [...targets],
      ...(shallow ? { shallow: true } : {}),
      claims,
      diagnostics,
      counts,
      status: complete ? "complete" : "incomplete",
      success,
      exitCode: !complete ? 2 : success ? 0 : 1,
    };
  }
}

/**
 * Builds semantic ancestry and incoming annotation indexes for one selection.
 *
 * Parent links preserve literal accessor segments. Prepared resolutions also
 * attribute refused acknowledgements that never became coverage edges.
 */
function indexSelection(
  analysis: IEvidenceCheckAnalysis,
  selection: IEvidenceUnitCheckSelection,
): void {
  const population: EvidenceQueryPopulationContext = selection.population;
  for (const id of selection.unitIds) {
    let current: IEvidenceUnit | undefined = population.units.get(id);
    const visited: Set<string> = new Set();
    while (current !== undefined && !visited.has(current.id)) {
      selection.scopeIds.add(current.id);
      visited.add(current.id);
      current =
        current.parentId === undefined
          ? undefined
          : population.units.get(current.parentId);
    }
  }
  if (population.scope.role === "claim") {
    for (const host of population.inventory.hosts)
      if (host.unitIds.some((id: string): boolean => selection.unitIds.has(id)))
        selection.hostIds.add(host.id);
    return;
  }
  const claim: IEvidenceGraphClaim | undefined =
    analysis.graphInput.claims.find(
      (candidate: IEvidenceGraphClaim): boolean =>
        candidate.index === population.scope.claim,
    );
  if (claim === undefined || population.reference === undefined)
    throw new Error("Selected reference has no owning graph input.");
  for (const entry of population.reference.resolutions) {
    const statement: IEvidenceDeclaration | undefined =
      claim.inventory.declarations.find(
        (candidate: IEvidenceDeclaration): boolean =>
          candidate.id === entry.declarationId,
      );
    if (
      statement === undefined ||
      !entry.resolution.units.some((unit: IEvidenceUnit): boolean =>
        touches(selection, unit.id, statement.kind === "evidence"),
      )
    )
      continue;
    selection.statements.add(statementKey(statement.hostId, statement.target));
    for (const host of claim.inventory.hosts)
      if (host.id === statement.hostId)
        for (const id of host.unitIds) selection.relatedUnitIds.add(id);
  }
  for (const entry of population.reference.reviewResolutions ?? []) {
    const statement: IEvidenceReview | undefined = claim.inventory.reviews.find(
      (candidate: IEvidenceReview): boolean => candidate.id === entry.reviewId,
    );
    if (
      statement === undefined ||
      !entry.resolution.units.some((unit: IEvidenceUnit): boolean =>
        touches(selection, unit.id, statement.reviews === "evidence"),
      )
    )
      continue;
    selection.statements.add(statementKey(statement.hostId, statement.target));
  }
}

/**
 * Tests whether an annotation can affect a focused reference identity.
 *
 * A positive checklist answer covers only its selected named item. Exclusions
 * cascade, while an invalid unselected aggregate remains relevant to its
 * attempted descendant answers and must retain its diagnostic.
 */
function touches(
  selection: IEvidenceUnitCheckSelection,
  unitId: string,
  positive: boolean,
): boolean {
  const population: EvidenceQueryPopulationContext = selection.population;
  if (
    population.reference !== undefined &&
    population.reference.checklist === true &&
    positive &&
    population.selected.has(unitId)
  )
    return selection.unitIds.has(unitId);
  return selection.scopeIds.has(unitId);
}

/**
 * Retains selected boundaries and narrows reference coverage totals.
 *
 * Claim selections retain outgoing policies with zero incoming reference units.
 * Independent ledgers keep their original completeness and configured indices.
 */
function projectClaim(
  analysis: IEvidenceCheckAnalysis,
  selections: Map<string, IEvidenceUnitCheckSelection>,
  claim: IEvidenceCheckClaim,
): IEvidenceCheckClaim[] {
  const own: IEvidenceUnitCheckSelection | undefined = selections.get(
    key(claim.claim),
  );
  const obligations: IEvidenceCheckObligation[] = claim.obligations.flatMap(
    (obligation: IEvidenceCheckObligation): IEvidenceCheckObligation[] => {
      const selection: IEvidenceUnitCheckSelection | undefined = selections.get(
        key(claim.claim, obligation.reference),
      );
      if (selection === undefined && own === undefined) return [];
      const result: IEvidenceGraphClaimResult | undefined =
        analysis.graph.claims.find(
          (candidate: IEvidenceGraphClaimResult): boolean =>
            candidate.claim === claim.claim,
        );
      const ledger: IEvidenceGraphObligation | undefined =
        result === undefined
          ? undefined
          : result.obligations.find(
              (candidate: IEvidenceGraphObligation): boolean =>
                candidate.reference === obligation.reference,
            );
      if (ledger === undefined)
        throw new Error("Selected obligation has no coverage ledger.");
      return [
        {
          ...obligation,
          units: ledger.unitIds.filter(
            (id: string): boolean =>
              selection !== undefined && selection.unitIds.has(id),
          ).length,
          coveredUnits: ledger.coveredUnitIds.filter(
            (id: string): boolean =>
              selection !== undefined && selection.unitIds.has(id),
          ).length,
          missingUnits: ledger.missingUnitIds.filter(
            (id: string): boolean =>
              selection !== undefined && selection.unitIds.has(id),
          ).length,
        },
      ];
    },
  );
  return own === undefined && obligations.length === 0
    ? []
    : [{ ...claim, obligations }];
}

/**
 * Keeps findings attributable to selected identities or their annotations.
 *
 * Boundary-wide findings preserve extraction and policy failures. Checklist
 * aggregates use answer ledgers to omit unrelated missing items.
 */
function selectDiagnostic(
  analysis: IEvidenceCheckAnalysis,
  selections: Map<string, IEvidenceUnitCheckSelection>,
  diagnostic: IEvidenceDiagnostic,
): IEvidenceDiagnostic[] {
  if (diagnostic.claim === undefined) return [diagnostic];
  const own: IEvidenceUnitCheckSelection | undefined = selections.get(
    key(diagnostic.claim),
  );
  const selected: IEvidenceUnitCheckSelection | undefined =
    diagnostic.reference === undefined
      ? undefined
      : selections.get(key(diagnostic.claim, diagnostic.reference));
  const participating: boolean =
    own !== undefined ||
    selected !== undefined ||
    (diagnostic.reference === undefined &&
      [...selections.values()].some(
        (selection: IEvidenceUnitCheckSelection): boolean =>
          selection.population.scope.claim === diagnostic.claim,
      ));
  if (!participating) return [];
  if (
    own !== undefined &&
    ((diagnostic.unitId !== undefined && own.unitIds.has(diagnostic.unitId)) ||
      (diagnostic.hostId !== undefined && own.hostIds.has(diagnostic.hostId)))
  )
    return [diagnostic];
  if (diagnostic.code === "graph-checklist-missing" && selected !== undefined) {
    const obligation: IEvidenceGraphObligation | undefined =
      selected.population.obligation;
    const ledger: IEvidenceGraphHostCoverage | undefined =
      obligation === undefined
        ? undefined
        : obligation.hostCoverage.find(
            (host: IEvidenceGraphHostCoverage): boolean =>
              host.hostUnitId === diagnostic.unitId,
          );
    const missing: string[] =
      ledger === undefined
        ? []
        : ledger.missingUnitIds.filter(
            (id: string): boolean =>
              selected.unitIds.has(id) && !ledger.explainedUnitIds.includes(id),
          );
    if (missing.length === 0) return [];
    const claim: IEvidenceGraphClaim | undefined =
      analysis.graphInput.claims.find(
        (candidate: IEvidenceGraphClaim): boolean =>
          candidate.index === diagnostic.claim,
      );
    const host: IEvidenceUnit | undefined =
      claim === undefined
        ? undefined
        : claim.inventory.units.find(
            (unit: IEvidenceUnit): boolean => unit.id === diagnostic.unitId,
          );
    const names: string[] = missing.map(
      (id: string): string => selected.population.units.get(id)?.name ?? id,
    );
    return [
      {
        ...diagnostic,
        message: `Claim ${diagnostic.claim + 1} reference ${(diagnostic.reference ?? 0) + 1}: Host '${host?.name ?? diagnostic.unitId ?? "unknown"}' has not acknowledged ${missing.length} selected checklist item(s): ${names.join(", ")}.`,
      },
    ];
  }
  if (
    diagnostic.target !== undefined &&
    diagnostic.hostId !== undefined &&
    selected !== undefined &&
    selected.statements.has(statementKey(diagnostic.hostId, diagnostic.target))
  )
    return [diagnostic];
  if (diagnostic.unitId !== undefined)
    return selected !== undefined &&
      (selected.unitIds.has(diagnostic.unitId) ||
        (diagnostic.code === "graph-single-evidence-per-symbol" &&
          selected.relatedUnitIds.has(diagnostic.unitId)))
      ? [diagnostic]
      : [];
  return diagnostic.target === undefined && diagnostic.hostId === undefined
    ? [diagnostic]
    : [];
}

/**
 * Encodes authored coordinates while separating claim and reference roles.
 *
 * An omitted reference identifies the claim's own population.
 */
function key(claim: number, reference?: number): string {
  return `${claim}:${reference ?? "claim"}`;
}

/**
 * Encodes a statement's carrier and authored target without delimiter
 * collisions.
 *
 * Matching both values distinguishes annotations sharing one documentation
 * host.
 */
function statementKey(hostId: string, target: string): string {
  return JSON.stringify([hostId, target]);
}
