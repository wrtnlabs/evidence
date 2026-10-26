import type { IEvidenceGraphEdge } from "../structures/IEvidenceGraphEdge";
import type { IEvidenceQueryResolution } from "../internal/IEvidenceQueryResolution";
import type { IEvidenceTargetResolution } from "../structures/IEvidenceTargetResolution";
import path from "node:path";

import { EvidenceFileTarget } from "../targets/EvidenceFileTarget";

import { EvidenceAnalysisIndexes } from "../internal/EvidenceAnalysisIndexes";
import { EvidenceQueryInventoryIndex } from "../internal/EvidenceQueryInventoryIndex";

import { EvidenceLanguageRegistry } from "../parsers/EvidenceLanguageRegistry";

import { EvidenceInventoryMerge } from "../internal/EvidenceInventoryMerge";
import type { IEvidenceQueryPopulation } from "../internal/IEvidenceQueryPopulation";
import { EvidenceQueryPopulationContext } from "../contexts/EvidenceQueryPopulationContext";
import type { IEvidenceQueryContext } from "../contexts/IEvidenceQueryContext";
import { EvidenceMarkdownTarget } from "../adapters/markdown/EvidenceMarkdownTarget";
import type { IEvidenceCheckAnalysis } from "../structures/IEvidenceCheckAnalysis";
import type { IEvidenceDeclaration } from "../structures/IEvidenceDeclaration";
import type { IEvidenceDiagnostic } from "../structures/IEvidenceDiagnostic";
import type { IEvidenceGraphBoundary } from "../structures/IEvidenceGraphBoundary";
import type { IEvidenceGraphExportEdge } from "../structures/IEvidenceGraphExportEdge";
import type { IEvidenceGraphExportReview } from "../structures/IEvidenceGraphExportReview";
import type { IEvidenceGraphHostNode } from "../structures/IEvidenceGraphHostNode";
import type { IEvidenceGraphNode } from "../structures/IEvidenceGraphNode";
import type { IEvidenceGraphPolicy } from "../structures/IEvidenceGraphPolicy";
import type { IEvidenceGraphReference } from "../structures/IEvidenceGraphReference";
import type { IEvidenceGraphReport } from "../structures/IEvidenceGraphReport";
import type { IEvidenceHost } from "../structures/IEvidenceHost";
import type { IEvidenceInspection } from "../structures/IEvidenceInspection";
import type { IEvidenceInspectReport } from "../structures/IEvidenceInspectReport";
import type { IEvidenceInspectedAcknowledgement } from "../structures/IEvidenceInspectedAcknowledgement";
import type { IEvidenceInspectedObligation } from "../structures/IEvidenceInspectedObligation";
import type { IEvidenceInspectedReview } from "../structures/IEvidenceInspectedReview";
import type { IEvidenceInspectedUnit } from "../structures/IEvidenceInspectedUnit";
import type { IEvidenceLanguagesReport } from "../structures/IEvidenceLanguagesReport";
import type { IEvidenceListItem } from "../structures/IEvidenceListItem";
import type { IEvidenceListReport } from "../structures/IEvidenceListReport";
import type { IEvidenceQueryScope } from "../structures/IEvidenceQueryScope";
import type { IEvidenceReview } from "../structures/IEvidenceReview";
import type { IEvidenceSourceLocation } from "../structures/IEvidenceSourceLocation";
import type { IEvidenceTargetStatement } from "../structures/IEvidenceTargetStatement";
import type { IEvidenceUnit } from "../structures/IEvidenceUnit";
import type { EvidenceArtifactType } from "../typings/EvidenceArtifactType";
import type { EvidenceCommandExitCode } from "../typings/EvidenceCommandExitCode";
import type { EvidenceGraphNode } from "../typings/EvidenceGraphNode";
import type { EvidenceSymbol } from "../typings/EvidenceSymbol";
import type { EvidenceUnitSelection } from "../typings/EvidenceUnitSelection";

/**
 * Projects one completed checker analysis into query-command reports.
 *
 * Query operations never re-evaluate graph policy or mutate inventories. They
 * retain the claim/reference coordinates established during checking, so a
 * list, target inspection, and exported graph all describe the same independent
 * obligation boundaries and diagnostic set.
 *
 * @example
 *   const report = EvidenceQueryProgrammer.list(queryContext, "typescript");
 *   const inspection = await EvidenceQueryProgrammer.inspect(
 *     queryContext,
 *     "src/user.ts#UserService",
 *   );
 *
 * @evidence contracts/common.md#principled-implementation Query reports are projections of one completed analysis built from shared population contexts; nothing re-evaluates policy or mutates inventories.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns list, inspect, graph and languages projections; formatting and population indexing are helpers.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Claim and reference coordinates from the check are kept so every query describes the same obligation boundaries.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains the projection rule with an example; private helpers are documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceQueryProgrammer {
  /**
   * Lists configured identities and the structural ancestors needed to address
   * them.
   *
   * Language and symbol filters apply after each population is projected, so
   * they do not change configured selection or graph coverage. Rows are sorted
   * by stable query identity, and checker diagnostics are passed through
   * unchanged because a list command is an observation of the existing
   * analysis.
   *
   * @evidence contracts/common.md#principled-implementation Each population is projected to rows, filtered by language and kind, and sorted by stable query identity, passing checker diagnostics through unchanged.
   * @evidence contracts/common.md#clear-and-simple-design Row projection is a private helper per population.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Filters do not change configured selection or coverage.
   * @evidence contracts/common.md#meaningful-documentation The comment explains filtering, ordering and diagnostic pass-through.
   * @evidence contracts/performance.md#efficient-algorithms O(n log n) in listed rows.
   * @evidence contracts/performance.md#reuse-equivalent-work It reuses the context's population indexes.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function list(
    context: IEvidenceQueryContext,
    language?: EvidenceArtifactType,
    kind?: EvidenceSymbol,
  ): IEvidenceListReport {
    const { analysis } = context;
    const root = context.cwd;
    const items = context.populations
      .flatMap((population) => listPopulation(population, root))
      .filter(
        (item) =>
          (language === undefined || item.scope.type === language) &&
          (kind === undefined || item.symbol === kind),
      )
      .sort((left, right) => compare(left.id, right.id));
    return {
      schemaVersion: 1,
      command: "list",
      configFile: analysis.report.configFile,
      status: analysis.report.status,
      success: analysis.report.success,
      exitCode: analysis.report.exitCode,
      ...(language === undefined ? {} : { language }),
      ...(kind === undefined ? {} : { kind }),
      total: items.length,
      items,
      diagnostics: analysis.report.diagnostics,
    };
  }

  /**
   * Inspects one CLI-relative target across the populations that can interpret
   * it.
   *
   * Exact indexed spellings take precedence over grammar inference, preventing
   * a target alias from being hidden by a broad file-extension match.
   * Resolution is isolated per population; the report is resolved only when
   * every selected boundary resolves, and preserves incomplete checker state as
   * exit code 2.
   *
   * @evidence contracts/common.md#principled-implementation Populations exposing the exact target spelling are authoritative; otherwise grammar applicability chooses them, and each is inspected independently before statuses combine with incompleteness taking priority.
   * @evidence contracts/common.md#clear-and-simple-design Per-population inspection and applicability are private helpers.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts An alias cannot be hidden by a broad extension match, and incomplete analysis yields exit code 2.
   * @evidence contracts/common.md#meaningful-documentation The comment explains precedence and the combined status; the inline comment explains authority of indexed spellings.
   * @evidence contracts/performance.md#efficient-algorithms Linear in populations plus each inspection's candidates; inspections run concurrently.
   * @evidence contracts/performance.md#reuse-equivalent-work It reuses the context's population indexes.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export async function inspect(
    context: IEvidenceQueryContext,
    target: string,
  ): Promise<IEvidenceInspectReport> {
    const { analysis } = context;
    const root = context.cwd;
    const inspections: IEvidenceInspection[] = (await resolve(context, target))
      .map((entry: IEvidenceQueryResolution): IEvidenceInspection =>
        inspectPopulation(analysis, entry, root),
      )
      .sort((left, right) =>
        compare(scopeId(left.scope), scopeId(right.scope)),
      );
    const diagnostics = uniqueDiagnostics([
      ...analysis.report.diagnostics,
      ...inspections.flatMap((inspection) => inspection.diagnostics),
    ]);
    const resolved =
      inspections.length !== 0 &&
      inspections.every((inspection) => inspection.status === "resolved");
    const incomplete =
      analysis.report.status === "incomplete" ||
      inspections.some((inspection) => inspection.status === "incomplete");
    const exitCode: EvidenceCommandExitCode = incomplete
      ? 2
      : !resolved
        ? 1
        : analysis.report.exitCode;
    return {
      schemaVersion: 1,
      command: "inspect",
      configFile: analysis.report.configFile,
      status: incomplete ? "incomplete" : "complete",
      success: resolved && exitCode === 0,
      exitCode,
      target,
      inspections,
      diagnostics,
    };
  }

  /**
   * Resolves a query target across applicable populations without projecting
   * inspection details.
   *
   * @evidence contracts/common.md#principled-implementation Exact configured spellings take precedence over grammar inference; every selected population resolves independently through its retained resolver.
   * @evidence contracts/common.md#clear-and-simple-design Focused resolution reuses the existing population and inventory indexes; fingerprint and inspection payload construction remains in the inspection path.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Resolving a focused target retains all candidate populations and incomplete outcomes; only unused inspection details are omitted.
   * @evidence contracts/common.md#meaningful-documentation The resolve comment states focused-query ownership and its omission of unused inspection materialization.
   * @evidence contracts/performance.md#efficient-algorithms After one exact-target index construction, matching is linear in population count plus actual resolver candidates.
   * @evidence contracts/performance.md#reuse-equivalent-work Focused selection and detailed inspection share address indexes and avoid unrelated fingerprint, child and diagnostic projection work.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Returned records borrow the query session and retain no filesystem handle.
   */
  export async function resolve(
    context: IEvidenceQueryContext,
    target: string,
  ): Promise<IEvidenceQueryResolution[]> {
    const root: string = context.cwd;
    const all: EvidenceQueryPopulationContext[] = context.populations;
    const exact: Set<string> = new Set(
      all.flatMap((population: EvidenceQueryPopulationContext): string[] =>
        populationHasTarget(population, target, root)
          ? [scopeId(population.scope)]
          : [],
      ),
    );
    // An indexed spelling is authoritative: grammar inference is only a fallback
    // when no configured identity exposes this exact public target.
    const selected: EvidenceQueryPopulationContext[] =
      exact.size === 0
        ? applicablePopulations(all, target)
        : all.filter((population: EvidenceQueryPopulationContext): boolean =>
            exact.has(scopeId(population.scope)),
          );

    return Promise.all(
      selected.map(
        async (
          population: EvidenceQueryPopulationContext,
        ): Promise<IEvidenceQueryResolution> => {
          const host: IEvidenceHost = commandHost(root);
          const statement: IEvidenceTargetStatement = {
            target,
            hostId: host.id,
            location: { file: host.file, range: host.range },
          };
          const resolution: IEvidenceTargetResolution =
            await population.resolver.resolve(
              statement,
              host,
              population.unitIds,
            );
          return { population, resolution };
        },
      ),
    );
  }

  /**
   * Exports the evaluated graph as boundaries, nodes, acknowledgement edges,
   * and reviews.
   *
   * Each claim/reference pair receives its own boundary even when it reuses an
   * inventory. Nodes are keyed by boundary and role so coverage cannot visually
   * leak between obligations, while documentation-host nodes represent evidence
   * attached outside any selected claim unit.
   *
   * @evidence contracts/common.md#principled-implementation Each claim/reference pair becomes a boundary with boundary-qualified nodes, acknowledgement edges and separate review relations, plus host nodes for carriers outside selected claim units.
   * @evidence contracts/common.md#clear-and-simple-design Export composes population contexts with the graph result.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Coverage never leaks between obligations because node identity includes the boundary.
   * @evidence contracts/common.md#meaningful-documentation The comment explains boundaries and host nodes.
   * @evidence contracts/performance.md#efficient-algorithms Linear in obligations, nodes, edges and reviews with map deduplication.
   * @evidence contracts/performance.md#reuse-equivalent-work It reuses the context's population indexes.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function graph(context: IEvidenceQueryContext): IEvidenceGraphReport {
    const { analysis } = context;
    const root = context.cwd;
    const configured = context.populations;
    const nodes = new Map<string, EvidenceGraphNode>();
    const boundaries: IEvidenceGraphBoundary[] = [];
    const edges: IEvidenceGraphExportEdge[] = [];
    const reviews: IEvidenceGraphExportReview[] = [];

    // Join inputs, results, and report labels by construction order. A positional
    // mismatch violates analysis invariants and is rejected by the require helpers.
    analysis.graphInput.claims.forEach((claim, claimPosition) => {
      const reportClaim = requireReportClaim(analysis, claimPosition);
      const claimPopulation = requirePopulation(
        configured,
        "claim",
        reportClaim.claim,
      );
      claim.references.forEach((reference, referencePosition) => {
        const reportObligation = requireReportObligation(
          analysis,
          claimPosition,
          referencePosition,
        );
        const obligation = requireResultObligation(
          analysis,
          claimPosition,
          referencePosition,
        );
        const referencePopulation = requirePopulation(
          configured,
          "reference",
          reportClaim.claim,
          reportObligation.reference,
        );
        const boundaryId = boundary(
          reportClaim.claim,
          reportObligation.reference,
        );
        boundaries.push({
          id: boundaryId,
          claim: claimPopulation.scope,
          reference: referencePopulation.scope,
          policy: graphPolicy(reference),
          active: obligation.active,
          complete: obligation.complete,
          unitIds: obligation.unitIds,
          coveredUnitIds: obligation.coveredUnitIds,
          missingUnitIds: obligation.missingUnitIds,
          hostCoverage: obligation.hostCoverage,
        });

        const usedHosts: Set<string> = new Set(
          obligation.edges.flatMap(
            (edge: IEvidenceGraphEdge): string[] => edge.hostUnitIds,
          ),
        );
        for (const item of listPopulation(claimPopulation, root))
          if (item.selection === "selected")
            nodes.set(
              graphUnitNodeId(boundaryId, "claim", item.unitId),
              graphUnitNode(
                boundaryId,
                "claim",
                item,
                usedHosts.has(item.unitId),
                false,
              ),
            );
        for (const item of listPopulation(referencePopulation, root))
          nodes.set(
            graphUnitNodeId(boundaryId, "reference", item.unitId),
            graphUnitNode(
              boundaryId,
              "reference",
              item,
              covered(referencePopulation, item.unitId),
              missing(referencePopulation, item.unitId),
            ),
          );

        for (const edge of obligation.edges) {
          const declaration = requireDeclaration(
            claimPopulation.records,
            edge.declarationId,
          );
          const sourceNodeIds = graphSourceNodes(
            nodes,
            boundaryId,
            claimPopulation,
            declaration.hostId,
            edge.hostUnitIds,
            root,
          );
          const targetNodeId = graphUnitNodeId(
            boundaryId,
            "reference",
            edge.targetUnitId,
          );
          ensureUnitNode(
            nodes,
            boundaryId,
            "reference",
            referencePopulation,
            edge.targetUnitId,
            root,
          );
          edges.push({
            id: `${boundaryId}:edge:${edge.declarationId}:${edge.targetUnitId}`,
            boundaryId,
            kind: edge.kind,
            declaration,
            sourceNodeIds,
            hostUnitIds: edge.hostUnitIds,
            targetNodeId,
            targetUnitId: edge.targetUnitId,
            unitIds: edge.unitIds,
            fingerprint: edge.fingerprint,
          });
        }
        for (const resolution of reference.reviewResolutions ?? []) {
          const review: IEvidenceReview = requireReview(
            claimPopulation.records,
            resolution.reviewId,
          );
          const sourceNodeIds = graphSourceNodes(
            nodes,
            boundaryId,
            claimPopulation,
            review.hostId,
            requireHost(claimPopulation.records, review.hostId).unitIds,
            root,
          );
          const targetNodeIds = resolution.resolution.units.map((unit) => {
            ensureUnitNode(
              nodes,
              boundaryId,
              "reference",
              referencePopulation,
              unit.id,
              root,
            );
            return graphUnitNodeId(boundaryId, "reference", unit.id);
          });
          reviews.push({
            id: `${boundaryId}:review:${review.id}`,
            boundaryId,
            reviews: review.reviews,
            review,
            status: resolution.resolution.status,
            sourceNodeIds,
            targetNodeIds,
          });
        }
      });
    });
    return {
      schemaVersion: 1,
      command: "graph",
      configFile: analysis.report.configFile,
      status: analysis.report.status,
      success: analysis.report.success,
      exitCode: analysis.report.exitCode,
      boundaries,
      nodes: Array.from(nodes.values()).sort((left, right) =>
        compare(left.id, right.id),
      ),
      edges: edges.sort((left, right) => compare(left.id, right.id)),
      reviews: reviews.sort((left, right) => compare(left.id, right.id)),
      diagnostics: analysis.report.diagnostics,
    };
  }

  /**
   * Lists artifact adapters that the installed runtime can actually analyze.
   *
   * Registry entries without an adapter remain parser metadata and are omitted.
   * Language and database entries are combined then ordered by type, providing
   * a stable capability report without depending on registry declaration
   * order.
   *
   * @evidence contracts/common.md#principled-implementation Registry entries with adapters are combined across programming and database catalogs and sorted by type.
   * @evidence contracts/common.md#clear-and-simple-design It reads the registry only.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Entries without adapters are omitted as parser metadata.
   * @evidence contracts/common.md#meaningful-documentation The comment explains omission and ordering.
   * @evidence contracts/performance.md#efficient-algorithms O(n log n) in catalog size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Metadata is read per call.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function languages(): IEvidenceLanguagesReport {
    const languages = [
      ...EvidenceLanguageRegistry.list().flatMap((language) =>
        language.adapter === undefined
          ? []
          : [
              {
                type: language.type,
                name: language.name,
                grammars: language.grammars,
                adapter: language.adapter,
              },
            ],
      ),
      ...EvidenceLanguageRegistry.databases().flatMap((language) =>
        language.adapter === undefined
          ? []
          : [
              {
                type: language.type,
                name: language.name,
                grammars: language.grammars,
                adapter: language.adapter,
              },
            ],
      ),
    ].sort((left, right) => compare(left.type, right.type));
    return {
      schemaVersion: 1,
      command: "languages",
      total: languages.length,
      languages,
    };
  }

  /**
   * Builds a query context for every configured claim and reference entry.
   *
   * The context list preserves graph-input order and gives each reference its
   * own wrapper, even when several entries share the same inventory. This
   * preserves obligation-specific selection, policies, and coverage during
   * later queries.
   *
   * @evidence contracts/common.md#principled-implementation One context is built per claim and per reference entry in graph-input order, each wrapping its own selection and obligation.
   * @evidence contracts/common.md#clear-and-simple-design Context construction is delegated to EvidenceQueryPopulationContext.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Shared inventories still get separate wrappers so obligation-specific selection is kept.
   * @evidence contracts/common.md#meaningful-documentation The comment explains why wrappers are not shared.
   * @evidence contracts/performance.md#efficient-algorithms Linear in populations plus each context's index building.
   * @evidence contracts/performance.md#reuse-equivalent-work The returned contexts are built once and reused by all later queries on the facade.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Contexts borrow the analysis owned by the facade and are released with it.
   */
  export function populations(
    analysis: IEvidenceCheckAnalysis,
  ): EvidenceQueryPopulationContext[] {
    const indexes: EvidenceAnalysisIndexes = new EvidenceAnalysisIndexes();
    const output: IEvidenceQueryPopulation[] = [];
    analysis.graphInput.claims.forEach((claim, claimPosition) => {
      const reportClaim = requireReportClaim(analysis, claimPosition);
      output.push({
        scope: {
          role: "claim",
          claim: reportClaim.claim,
          ...(reportClaim.name === undefined ? {} : { name: reportClaim.name }),
          type: reportClaim.type,
        },
        inventory: indexes.inventory(claim.inventory, true).snapshot(),
        unitIds: claim.unitIds,
      });
      claim.references.forEach((reference, referencePosition) => {
        const reportObligation = requireReportObligation(
          analysis,
          claimPosition,
          referencePosition,
        );
        output.push({
          scope: {
            role: "reference",
            claim: reportClaim.claim,
            reference: reportObligation.reference,
            type: reportObligation.type,
          },
          inventory: indexes.inventory(reference.inventory, true).snapshot(),
          unitIds: reference.unitIds,
          reference,
          obligation: requireResultObligation(
            analysis,
            claimPosition,
            referencePosition,
          ),
        });
      });
    });
    return output.map(
      (
        population: IEvidenceQueryPopulation,
      ): EvidenceQueryPopulationContext => {
        return new EvidenceQueryPopulationContext(
          population,
          EvidenceQueryInventoryIndex.borrow(population.inventory),
          indexes,
        );
      },
    );
  }

  /**
   * Lists one population's selected identities and visible structural
   * ancestors.
   *
   * Visibility is owned by {@link EvidenceQueryPopulationContext}; this helper
   * only turns visible units into public rows. Units without a public address
   * are excluded because list output must contain targets that inspect can
   * accept.
   */
  function listPopulation(
    population: EvidenceQueryPopulationContext,
    cwd: string,
  ): IEvidenceListItem[] {
    const visible = population.visible;
    return population.inventory.units.flatMap((unit) => {
      if (!visible.has(unit.id)) return [];
      const item = listItem(population, unit, cwd);
      return item === undefined ? [] : [item];
    });
  }

  /**
   * Creates one public list row for an addressable inventory unit.
   *
   * The first sorted alias becomes the canonical target, while every alias is
   * retained for callers that need an exact spelling. Returning `undefined` for
   * an unaddressable unit lets list operations omit internal identities without
   * manufacturing a target that the resolver cannot round-trip.
   */
  function listItem(
    population: EvidenceQueryPopulationContext,
    unit: IEvidenceUnit,
    cwd: string,
  ): IEvidenceListItem | undefined {
    const aliases = targets(population, unit.id, cwd);
    const target = aliases[0];
    if (target === undefined) return undefined;
    return {
      id: `${scopeId(population.scope)}:unit:${unit.id}`,
      scope: population.scope,
      unitId: unit.id,
      symbol: unit.symbol,
      name: unit.name,
      selection: selection(population, unit.id),
      target,
      aliases,
      locations: unit.sites.map((site) => ({
        file: site.file,
        range: site.range,
      })),
    };
  }

  /**
   * Resolves a target and gathers its query evidence within one population
   * boundary.
   *
   * A synthetic attached host gives the shared resolver a CLI-relative source
   * context without pretending that the query came from a real documentation
   * comment. The returned units, coverage, acknowledgements, reviews, and
   * diagnostics all remain scoped to this one claim or reference context.
   */
  function inspectPopulation(
    analysis: IEvidenceCheckAnalysis,
    entry: IEvidenceQueryResolution,
    cwd: string,
  ): IEvidenceInspection {
    const { population, resolution }: IEvidenceQueryResolution = entry;
    const units = resolution.units.map((unit) =>
      inspectedUnit(population, unit, cwd),
    );
    const unitIds = new Set(units.map((unit) => unit.item.unitId));
    return {
      scope: population.scope,
      status: resolution.status,
      addresses: EvidenceInventoryMerge.unique(
        resolution.addresses.flatMap((address) =>
          formatAddress(population, address.file, address.segments, cwd),
        ),
        (address) => address,
      ).sort(compare),
      units,
      withdrawals: resolution.withdrawals,
      obligations: inspectedObligations(population, unitIds),
      acknowledgements: inspectedAcknowledgements(
        analysis,
        population,
        unitIds,
      ),
      reviews: inspectedReviews(analysis, population, unitIds),
      diagnostics: resolution.diagnostics.map((diagnostic) =>
        scopedDiagnostic(diagnostic, population.scope),
      ),
    };
  }

  /**
   * Builds the detailed inspection record for one resolved unit.
   *
   * Only direct children are included so recursive client views can choose
   * their own expansion. A fingerprint is exposed only from a complete
   * inventory: an incomplete parse cannot safely provide a stable review
   * identity.
   */
  function inspectedUnit(
    population: EvidenceQueryPopulationContext,
    unit: IEvidenceUnit,
    cwd: string,
  ): IEvidenceInspectedUnit {
    const item = listItem(population, unit, cwd);
    if (item === undefined)
      throw new Error(`Evidence identity '${unit.id}' has no public address.`);
    const children: IEvidenceListItem[] = (
      population.records.children.get(unit.id) ?? []
    ).flatMap((candidate: IEvidenceUnit): IEvidenceListItem[] => {
      const child: IEvidenceListItem | undefined = listItem(
        population,
        candidate,
        cwd,
      );
      return child === undefined ? [] : [child];
    });
    return {
      item,
      children,
      hosts: [...(population.records.hosts.get(unit.id) ?? [])].sort(
        (left, right) => compare(left.id, right.id),
      ),
      ...(population.inventory.complete
        ? {
            fingerprint: population.fingerprints.inspect(unit.id),
          }
        : {}),
    };
  }

  /**
   * Reports the reference obligations that govern inspected selected
   * identities.
   *
   * Claim populations own no coverage obligation, and unselected resolved units
   * must not imply coverage. Missing graph policy data returns no rows so an
   * inconsistent query context cannot be presented as a passing obligation.
   */
  function inspectedObligations(
    population: EvidenceQueryPopulationContext,
    unitIds: Set<string>,
  ): IEvidenceInspectedObligation[] {
    if (population.scope.role !== "reference") return [];
    const obligation = population.obligation;
    const reference = population.scope.reference;
    if (obligation === undefined || reference === undefined) return [];
    return Array.from(unitIds).flatMap((unitId) => {
      const unit = population.inventory.units.find(
        (candidate) => candidate.id === unitId,
      );
      if (unit === undefined) return [];
      const state = selection(population, unitId);
      if (state === "unselected") return [];
      return [
        {
          claim: population.scope.claim,
          reference,
          policy: graphPolicy(requirePopulationReference(population)),
          active: obligation.active,
          complete: obligation.complete,
          selection: state,
          covered: covered(population, unitId),
          missing: missing(population, unitId),
        },
      ];
    });
  }

  /**
   * Collects acknowledgement edges relevant to inspected reference identities.
   *
   * The search joins graph results to the matching claim input by configured
   * coordinates, preserving duplicate reference obligations. Broken graph links
   * are omitted here because checker construction already owns their
   * diagnostics.
   */
  function inspectedAcknowledgements(
    analysis: IEvidenceCheckAnalysis,
    population: EvidenceQueryPopulationContext,
    unitIds: Set<string>,
  ): IEvidenceInspectedAcknowledgement[] {
    if (
      population.scope.role !== "reference" ||
      population.scope.reference === undefined
    )
      return [];
    return analysis.graph.claims.flatMap((claim, claimPosition) => {
      if (claim.claim !== population.scope.claim) return [];
      const input = analysis.graphInput.claims[claimPosition];
      if (input === undefined) return [];
      return claim.obligations.flatMap((obligation) => {
        if (obligation.reference !== population.scope.reference) return [];
        return obligation.edges.flatMap((edge) => {
          if (
            !unitIds.has(edge.targetUnitId) &&
            !edge.unitIds.some((unitId) => unitIds.has(unitId))
          )
            return [];
          const records: EvidenceQueryInventoryIndex | undefined =
            EvidenceQueryInventoryIndex.borrow(input.inventory);
          const declaration: IEvidenceDeclaration | undefined =
            records?.declarations.get(edge.declarationId);
          if (declaration === undefined) return [];
          const host: IEvidenceHost | undefined = records?.hostIds.get(
            declaration.hostId,
          );
          if (host === undefined) return [];
          return [
            {
              claim: obligation.claim,
              reference: obligation.reference,
              declaration,
              host,
              hostUnitIds: edge.hostUnitIds,
              targetUnitId: edge.targetUnitId,
              unitIds: edge.unitIds,
              fingerprint: edge.fingerprint,
            },
          ];
        });
      });
    });
  }

  /**
   * Collects review resolutions whose target contains an inspected identity.
   *
   * Descendant matching lets an inspection of a child expose a review on its
   * selected ancestor. The report retains the reference coordinates so review
   * status cannot be attributed to a different population with the same units.
   */
  function inspectedReviews(
    analysis: IEvidenceCheckAnalysis,
    population: EvidenceQueryPopulationContext,
    unitIds: Set<string>,
  ): IEvidenceInspectedReview[] {
    if (
      population.scope.role !== "reference" ||
      population.scope.reference === undefined
    )
      return [];
    return analysis.graphInput.claims.flatMap((claim, claimPosition) =>
      claim.references.flatMap((reference, referencePosition) => {
        const reportClaim = requireReportClaim(analysis, claimPosition);
        const reportReference = requireReportObligation(
          analysis,
          claimPosition,
          referencePosition,
        );
        if (
          reportClaim.claim !== population.scope.claim ||
          reportReference.reference !== population.scope.reference
        )
          return [];
        return (reference.reviewResolutions ?? []).flatMap((entry) => {
          if (
            !entry.resolution.units.some((target) =>
              Array.from(unitIds).some((unitId) =>
                population.descends(unitId, target.id),
              ),
            )
          )
            return [];
          const records: EvidenceQueryInventoryIndex | undefined =
            EvidenceQueryInventoryIndex.borrow(claim.inventory);
          const review: IEvidenceReview | undefined = records?.reviews.get(
            entry.reviewId,
          );
          if (review === undefined) return [];
          const host: IEvidenceHost | undefined = records?.hostIds.get(
            review.hostId,
          );
          if (host === undefined) return [];
          return [
            {
              claim: reportClaim.claim,
              reference: reportReference.reference,
              review,
              host,
              status: entry.resolution.status,
              unitIds: entry.resolution.units.map((unit) => unit.id),
            },
          ];
        });
      }),
    );
  }

  /**
   * Narrows target inspection to populations whose artifact grammar can accept
   * it.
   *
   * Prisma and Swagger have unmistakable target forms; file targets consult the
   * installed registry. When inference finds no type, every population remains
   * eligible so the resolver can return its own actionable diagnostics.
   */
  function applicablePopulations(
    populations: EvidenceQueryPopulationContext[],
    target: string,
  ): EvidenceQueryPopulationContext[] {
    if (target.startsWith("prisma:"))
      return populations.filter(
        (population) => population.scope.type === "prisma",
      );
    if (swaggerLike(target))
      return populations.filter(
        (population) => population.scope.type === "swagger",
      );
    const file = targetFile(target);
    const types = new Set<EvidenceArtifactType>();
    if (/\.(?:md|markdown|mdx)$/iu.test(file)) types.add("markdown");
    for (const language of [
      ...EvidenceLanguageRegistry.list(),
      ...EvidenceLanguageRegistry.databases(),
    ])
      try {
        EvidenceLanguageRegistry.select(language.type, file);
        types.add(language.type);
      } catch {
        continue;
      }
    const selected = populations.filter((population) =>
      types.has(population.scope.type),
    );
    return selected.length === 0 ? populations : selected;
  }

  /**
   * Classifies an identity by its configured and query-visible membership.
   *
   * Selection is owned by the population context: ancestors exist only to make
   * selected descendants addressable, while unselected identities must not gain
   * coverage semantics merely because they share an inventory.
   */
  function selection(
    population: EvidenceQueryPopulationContext,
    unitId: string,
  ): EvidenceUnitSelection {
    if (population.selected.has(unitId)) return "selected";
    return population.visible.has(unitId) ? "ancestor" : "unselected";
  }

  /**
   * Formats the public aliases for one semantic identity in deterministic
   * order.
   *
   * Inventory aliases may render to the same artifact target, so deduplication
   * occurs after formatting. The sorted result supplies the canonical list
   * target and makes exact-target matching stable across adapter traversal
   * order.
   */
  function targets(
    population: EvidenceQueryPopulationContext,
    unitId: string,
    cwd: string,
  ): string[] {
    return EvidenceInventoryMerge.unique(
      (population.addresses.get(unitId) ?? []).flatMap((address) =>
        formatAddress(population, address.file, address.segments, cwd),
      ),
      (target) => target,
    ).sort(compare);
  }

  /**
   * Tests whether a configured identity exposes the exact requested target
   * spelling.
   *
   * Only configured addresses participate because an ancestor's visible address
   * must not override grammar inference for a target that names no obligation.
   * A match is used solely to choose populations; resolution remains
   * authoritative.
   */
  function populationHasTarget(
    population: EvidenceQueryPopulationContext,
    target: string,
    cwd: string,
  ): boolean {
    let exact: Set<string> | undefined = population.exactTargets.get(cwd);
    if (exact === undefined) {
      exact = new Set<string>();
      for (const address of population.inventory.addresses)
        if (population.configured.has(address.unitId))
          for (const spelling of formatAddress(
            population,
            address.file,
            address.segments,
            cwd,
          ))
            exact.add(spelling);
      population.exactTargets.set(cwd, exact);
    }
    return exact.has(target);
  }

  /**
   * Renders one indexed address with the target grammar of its population.
   *
   * Prisma and Swagger do not use file-qualified accessors, while Markdown must
   * preserve selected logical aliases for a physical file. Other artifacts are
   * made CLI-relative; an unrenderable Swagger address is omitted from query
   * output.
   */
  function formatAddress(
    population: EvidenceQueryPopulationContext,
    file: string,
    segments: string[],
    cwd: string,
  ): string[] {
    if (population.scope.type === "prisma")
      return [`prisma:${segments.join(".")}`];
    if (population.scope.type === "swagger")
      return segments.length === 1 && segments[0] !== undefined
        ? [segments[0]]
        : [];
    if (population.scope.type === "markdown") {
      const logical: string[] =
        population.records.logicalFiles.get(
          EvidenceFileTarget.normalize(file),
        ) ?? [];
      const files = logical.length === 0 ? [file] : logical;
      return files.map((candidate) =>
        segments.length === 0
          ? EvidenceMarkdownTarget.normalize(candidate)
          : `${EvidenceMarkdownTarget.normalize(candidate)}#${segments.join("#")}`,
      );
    }
    return [
      EvidenceFileTarget.format({
        file: path.relative(cwd, file),
        segments,
      }),
    ];
  }

  /**
   * Creates the attached synthetic host used for command-line target
   * resolution.
   *
   * Its file anchors relative paths at the query working directory without
   * adding a document to any inventory. The fixed identity prevents command
   * hosts from being confused with authored annotation hosts in resolver
   * diagnostics.
   */
  function commandHost(cwd: string): IEvidenceHost {
    const file = path.join(cwd, ".evidence-inspect");
    return {
      id: "evidence:inspect:host",
      file,
      origins: [file],
      range: zeroLocation(file).range,
      unitIds: [],
      attachment: "attached",
    };
  }

  /**
   * Creates the zero-width coordinate assigned to a synthetic command host.
   *
   * Query input has no authored source span, but downstream diagnostics require
   * a complete location. Line and column one with offset zero provides that
   * boundary without claiming a real character exists in the synthetic file.
   */
  function zeroLocation(file: string): Required<IEvidenceSourceLocation> {
    return {
      file,
      range: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 1, offset: 0 },
      },
    };
  }

  /**
   * Projects an addressable query row into a boundary-specific graph unit node.
   *
   * The caller supplies coverage state because it differs by reference
   * obligation even when the underlying inventory unit is shared. The generated
   * node carries the public target and source locations needed by graph
   * consumers.
   */
  function graphUnitNode(
    boundaryId: string,
    role: "claim" | "reference",
    item: IEvidenceListItem,
    isCovered: boolean,
    isMissing: boolean,
  ): IEvidenceGraphNode {
    return {
      id: graphUnitNodeId(boundaryId, role, item.unitId),
      boundaryId,
      role,
      unitId: item.unitId,
      symbol: item.symbol,
      name: item.name,
      target: item.target,
      selection: item.selection,
      covered: isCovered,
      missing: isMissing,
      locations: item.locations,
    };
  }

  /**
   * Returns graph source nodes for an annotation host within one boundary.
   *
   * Hosts attached to units reuse claim nodes, preserving unit-level edges. A
   * detached-from-selection host becomes a dedicated node so evidence remains
   * visible without inventing a claim unit; absent hosts fail the graph
   * invariant.
   */
  function graphSourceNodes(
    nodes: Map<string, EvidenceGraphNode>,
    boundaryId: string,
    population: EvidenceQueryPopulationContext,
    hostId: string,
    unitIds: string[],
    cwd: string,
  ): string[] {
    if (unitIds.length !== 0) {
      for (const unitId of unitIds)
        ensureUnitNode(nodes, boundaryId, "claim", population, unitId, cwd);
      return unitIds.map((unitId) =>
        graphUnitNodeId(boundaryId, "claim", unitId),
      );
    }
    const host: IEvidenceHost = requireHost(population.records, hostId);
    const id = `${boundaryId}:host:${host.id}`;
    const node: IEvidenceGraphHostNode = {
      id,
      boundaryId,
      role: "host",
      hostId: host.id,
      name: host.id,
      location: { file: host.file, range: host.range },
    };
    nodes.set(id, node);
    return [id];
  }

  /**
   * Ensures a boundary-specific graph node exists for a referenced identity.
   *
   * Existing nodes are retained to preserve their coverage state. An absent
   * unit or missing public address is an invalid graph projection, so this
   * throws instead of exporting an edge that a consumer cannot inspect.
   */
  function ensureUnitNode(
    nodes: Map<string, EvidenceGraphNode>,
    boundaryId: string,
    role: "claim" | "reference",
    population: EvidenceQueryPopulationContext,
    unitId: string,
    cwd: string,
  ): void {
    const id = graphUnitNodeId(boundaryId, role, unitId);
    if (nodes.has(id)) return;
    const unit: IEvidenceUnit | undefined = population.units.get(unitId);
    if (unit === undefined)
      throw new Error(
        `Graph identity '${unitId}' is absent from its inventory.`,
      );
    const item = listItem(population, unit, cwd);
    if (item === undefined)
      throw new Error(`Graph identity '${unitId}' has no public address.`);
    nodes.set(id, graphUnitNode(boundaryId, role, item, false, false));
  }

  /**
   * Tests whether a reference unit is covered in its obligation.
   *
   * Directly selected units use graph coverage. A visible ancestor is covered
   * only when it has selected descendants and all are covered, preventing an
   * empty structural container from appearing complete.
   */
  function covered(
    population: EvidenceQueryPopulationContext,
    unitId: string,
  ): boolean {
    return (
      population.covered.has(unitId) ||
      (selection(population, unitId) === "ancestor" &&
        population.subtreeCovered.has(unitId))
    );
  }

  /**
   * Tests whether a reference unit exposes missing coverage in its obligation.
   *
   * Direct missing identities and ancestors with any missing selected
   * descendant are both marked missing. Without an obligation, the population
   * owns no coverage state and therefore returns false.
   */
  function missing(
    population: EvidenceQueryPopulationContext,
    unitId: string,
  ): boolean {
    return (
      population.missing.has(unitId) || population.subtreeMissing.has(unitId)
    );
  }

  /**
   * Coordinates retained only while their immutable query population array
   * lives.
   */
  const populationCoordinates: WeakMap<
    EvidenceQueryPopulationContext[],
    Map<string, EvidenceQueryPopulationContext>
  > = new WeakMap();

  /**
   * Retrieves the query population at an exact claim/reference coordinate.
   *
   * Role is part of the key because one inventory can serve both sides of an
   * obligation. A missing entry means analysis and query context lost
   * positional alignment, so graph export throws rather than relabelling its
   * data.
   */
  function requirePopulation(
    entries: EvidenceQueryPopulationContext[],
    role: "claim" | "reference",
    claim: number,
    reference?: number,
  ): EvidenceQueryPopulationContext {
    let index: Map<string, EvidenceQueryPopulationContext> | undefined =
      populationCoordinates.get(entries);
    if (index === undefined) {
      index = new Map();
      for (const entry of entries) {
        const key: string = JSON.stringify([
          entry.scope.role,
          entry.scope.claim,
          entry.scope.reference,
        ]);
        if (!index.has(key)) index.set(key, entry);
      }
      populationCoordinates.set(entries, index);
    }
    const population: EvidenceQueryPopulationContext | undefined = index.get(
      JSON.stringify([role, claim, reference]),
    );
    if (population === undefined)
      throw new Error(
        `Missing query population '${role}:${claim}:${reference ?? -1}'.`,
      );
    return population;
  }

  /**
   * Retrieves graph reference policy input from a reference population.
   *
   * Only reference contexts own this data. Its absence signals a context
   * assembly invariant failure, and throwing prevents a graph report from
   * silently using fabricated defaults.
   */
  function requirePopulationReference(
    population: EvidenceQueryPopulationContext,
  ): IEvidenceGraphReference {
    if (population.reference === undefined)
      throw new Error("A reference query population has no graph input.");
    return population.reference;
  }

  /**
   * Projects effective reference policy flags into a public graph boundary.
   *
   * Optional graph-input flags become explicit booleans so report consumers
   * need not reproduce configuration defaults. Severity is retained unchanged
   * because it controls the consequence of coverage diagnostics.
   */
  function graphPolicy(
    reference: IEvidenceGraphReference,
  ): IEvidenceGraphPolicy {
    return {
      severity: reference.severity,
      noEvidenceExclude: reference.noEvidenceExclude === true,
      uniqueEvidence: reference.uniqueEvidence === true,
      singleEvidencePerSymbol: reference.singleEvidencePerSymbol === true,
      checklist: reference.checklist === true,
      requireReview: reference.requireReview === true,
    };
  }

  /**
   * Retrieves the checker report claim at a graph-input position.
   *
   * Graph export joins report labels by construction order. A missing row
   * exposes a broken checker-analysis invariant and throws before coordinates
   * can be assigned to a wrong boundary.
   */
  function requireReportClaim(
    analysis: IEvidenceCheckAnalysis,
    position: number,
  ): IEvidenceCheckAnalysis["report"]["claims"][number] {
    const claim = analysis.report.claims[position];
    if (claim === undefined)
      throw new Error(`Missing report claim at position ${position}.`);
    return claim;
  }

  /**
   * Retrieves the evaluated graph claim at a graph-input position.
   *
   * This preserves the checker?셲 positional join with its input and report. A
   * missing result is an internal invariant failure, not an empty claim
   * suitable for graph serialization.
   */
  function requireResultClaim(
    analysis: IEvidenceCheckAnalysis,
    position: number,
  ): IEvidenceCheckAnalysis["graph"]["claims"][number] {
    const claim = analysis.graph.claims[position];
    if (claim === undefined)
      throw new Error(`Missing graph claim at position ${position}.`);
    return claim;
  }

  /**
   * Retrieves the report obligation for exact claim and reference positions.
   *
   * The returned row supplies public coordinates for graph export. Throwing on
   * a missing position prevents edges and policies from being emitted under an
   * unrelated reference label.
   */
  function requireReportObligation(
    analysis: IEvidenceCheckAnalysis,
    claim: number,
    reference: number,
  ): IEvidenceCheckAnalysis["report"]["claims"][number]["obligations"][number] {
    const obligation = requireReportClaim(analysis, claim).obligations[
      reference
    ];
    if (obligation === undefined)
      throw new Error(
        `Missing report obligation at position ${claim}:${reference}.`,
      );
    return obligation;
  }

  /**
   * Retrieves the evaluated obligation for exact claim and reference positions.
   *
   * Graph export uses its coverage, edges, and completion state together with
   * the matching report row. Missing positional state is fatal because an empty
   * substitute could falsely make a boundary look complete.
   */
  function requireResultObligation(
    analysis: IEvidenceCheckAnalysis,
    claim: number,
    reference: number,
  ): IEvidenceCheckAnalysis["graph"]["claims"][number]["obligations"][number] {
    const obligation = requireResultClaim(analysis, claim).obligations[
      reference
    ];
    if (obligation === undefined)
      throw new Error(
        `Missing graph obligation at position ${claim}:${reference}.`,
      );
    return obligation;
  }

  /**
   * Retrieves an acknowledgement by its inventory-local identity.
   *
   * Graph edges retain only this identity, while export needs the authored
   * target, reason, and location. A missing record breaks that
   * graph-to-inventory link and throws instead of emitting an unverifiable
   * edge.
   */
  function requireDeclaration(
    inventory: EvidenceQueryInventoryIndex,
    id: string,
  ): IEvidenceDeclaration {
    const declaration: IEvidenceDeclaration | undefined =
      inventory.declarations.get(id);
    if (declaration === undefined)
      throw new Error(`Missing graph acknowledgement '${id}'.`);
    return declaration;
  }

  /**
   * Retrieves a review by its inventory-local identity.
   *
   * Review resolutions refer back to the authored annotation through this
   * value. A missing record indicates invalid graph input and is fatal because
   * the public report cannot accurately represent the review without it.
   */
  function requireReview(
    inventory: EvidenceQueryInventoryIndex,
    id: string,
  ): IEvidenceReview {
    const review: IEvidenceReview | undefined = inventory.reviews.get(id);
    if (review === undefined) throw new Error(`Missing graph review '${id}'.`);
    return review;
  }

  /**
   * Retrieves the documentation host identified by an annotation.
   *
   * Hosts supply source locations and attached claim units for graph nodes. An
   * absent host violates inventory ownership, so callers throw before exporting
   * a source edge with a fabricated or incomplete origin.
   */
  function requireHost(
    records: EvidenceQueryInventoryIndex,
    id: string,
  ): IEvidenceHost {
    const host: IEvidenceHost | undefined = records.hostIds.get(id);
    if (host === undefined) throw new Error(`Missing graph host '${id}'.`);
    return host;
  }

  /**
   * Adds the query population?셲 configured coordinates to a diagnostic.
   *
   * Resolver diagnostics are inventory-local; query output must identify the
   * independent claim and reference obligation that produced them. Claim scope
   * is always present, while reference scope remains absent for claim
   * populations.
   */
  function scopedDiagnostic(
    diagnostic: IEvidenceDiagnostic,
    scope: IEvidenceQueryScope,
  ): IEvidenceDiagnostic {
    return {
      ...diagnostic,
      claim: scope.claim,
      ...(scope.reference === undefined ? {} : { reference: scope.reference }),
    };
  }

  /**
   * Deduplicates diagnostics whose complete public content is identical.
   *
   * Inspection combines checker and per-population diagnostics, which can reach
   * the same error through several compatible populations. Serialization
   * includes coordinates and repair text, preserving distinct actionable
   * failures.
   */
  function uniqueDiagnostics(
    diagnostics: IEvidenceDiagnostic[],
  ): IEvidenceDiagnostic[] {
    return EvidenceInventoryMerge.unique(diagnostics, (diagnostic) =>
      JSON.stringify(diagnostic),
    );
  }

  /**
   * Formats the stable key for a claim scope or one of its reference scopes.
   *
   * The key is internal to query ordering and exact-population selection.
   * Omitting the reference segment for claims preserves the distinct coordinate
   * shape and prevents a claim from colliding with its first reference.
   */
  function scopeId(scope: IEvidenceQueryScope): string {
    return scope.reference === undefined
      ? `claim:${scope.claim}`
      : `claim:${scope.claim}:reference:${scope.reference}`;
  }

  /**
   * Formats the graph boundary identity for one claim/reference obligation.
   *
   * Boundary IDs are intentionally coordinate-based, even when populations
   * share an inventory, so exported nodes and edges cannot leak coverage across
   * policy boundaries.
   */
  function boundary(claim: number, reference: number): string {
    return `claim:${claim}:reference:${reference}`;
  }

  /**
   * Formats a graph node identity for one unit within a boundary and role.
   *
   * Claim and reference nodes need separate IDs because the same semantic unit
   * can appear on both sides of an obligation with different selection and
   * coverage state.
   */
  function graphUnitNodeId(
    boundaryId: string,
    role: "claim" | "reference",
    unitId: string,
  ): string {
    return `${boundaryId}:${role}:${unitId}`;
  }

  /**
   * Extracts the decoded file portion from a possibly qualified target.
   *
   * Type inference examines only the physical-looking file prefix, leaving
   * accessor syntax untouched. Invalid percent encoding is retained verbatim so
   * inference can fail normally and the resolver can report the authored
   * target.
   */
  function targetFile(target: string): string {
    const separator = target.indexOf("#");
    const encoded = separator < 0 ? target : target.slice(0, separator);
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  /**
   * Recognizes target spellings reserved for Swagger operation resolution.
   *
   * HTTP method prefixes and non-single-letter scheme-like prefixes distinguish
   * these targets from ordinary file paths. This early classification keeps a
   * Swagger target from being needlessly sent to unrelated language adapters.
   */
  function swaggerLike(target: string): boolean {
    const match = /^([^:\s/]+):\//u.exec(target);
    const method = match?.[1];
    return (
      (method !== undefined && !/^[A-Za-z]$/u.test(method)) ||
      /^(?:GET|PUT|POST|DELETE|OPTIONS|HEAD|PATCH|TRACE)(?::|\s)/iu.test(target)
    );
  }

  /**
   * Orders query identities and rendered targets by code-unit comparison.
   *
   * Avoiding locale collation makes list, inspection, and graph output
   * reproducible across operating systems and independent of the invoking
   * process locale.
   */
  function compare(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}
