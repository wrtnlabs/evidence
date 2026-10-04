import type { IEvidenceGraphClaimContext } from "../contexts/IEvidenceGraphClaimContext";
import type { IEvidenceGraphReferenceContext } from "../contexts/IEvidenceGraphReferenceContext";
import typia from "typia";

import { EvidenceFileTarget } from "../targets/EvidenceFileTarget";
import { EvidenceInventory } from "./EvidenceInventory";
import { EvidenceFingerprintIndex } from "../internal/EvidenceFingerprintIndex";
import type { IEvidenceResolvedAcknowledgement } from "../internal/IEvidenceResolvedAcknowledgement";
import { EvidenceInventoryMerge } from "../internal/EvidenceInventoryMerge";
import type { IEvidenceResolvedReview } from "../internal/IEvidenceResolvedReview";
import type { IEvidenceUnhostedChecklist } from "../internal/IEvidenceUnhostedChecklist";
import type { IEvidenceDeclaration } from "../structures/IEvidenceDeclaration";
import type { IEvidenceDiagnostic } from "../structures/IEvidenceDiagnostic";
import type { IEvidenceGraphClaim } from "../structures/IEvidenceGraphClaim";
import type { IEvidenceGraphClaimResult } from "../structures/IEvidenceGraphClaimResult";
import type { IEvidenceGraphEdge } from "../structures/IEvidenceGraphEdge";
import type { IEvidenceGraphHostCoverage } from "../structures/IEvidenceGraphHostCoverage";
import type { IEvidenceGraphInput } from "../structures/IEvidenceGraphInput";
import type { IEvidenceGraphObligation } from "../structures/IEvidenceGraphObligation";
import type { IEvidenceGraphReference } from "../structures/IEvidenceGraphReference";
import type { IEvidenceGraphReviewResolution } from "../structures/IEvidenceGraphReviewResolution";
import type { IEvidenceGraphResolution } from "../structures/IEvidenceGraphResolution";
import type { IEvidenceGraphResult } from "../structures/IEvidenceGraphResult";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
import type { IEvidencePopulation } from "../structures/IEvidencePopulation";
import type { IEvidenceTargetStatement } from "../structures/IEvidenceTargetStatement";
import type { IEvidenceUnit } from "../structures/IEvidenceUnit";
import type { EvidenceAcknowledgementKind } from "../typings/EvidenceAcknowledgementKind";
import type { EvidenceSeverity } from "../typings/EvidenceSeverity";

/**
 * Evaluates coverage and review policies over captured, materialized
 * populations.
 *
 * The checker supplies inventories, selected unit IDs, target resolutions, and
 * reference policies. This facade validates and captures that input; it does
 * not load files or infer declarations. Each call creates a fresh evaluator and
 * returns an owned result, isolating prior diagnostics and caller mutations.
 *
 * Evaluation preserves the following boundaries:
 *
 * 1. Each claim selects its own semantic hosts and exclusion carriers.
 * 2. Each reference independently judges coverage, exclusions, cardinality,
 *    checklist answers, and review freshness, even when populations overlap.
 * 3. Incomplete analysis remains a failure rather than a passing smaller graph.
 * 4. Findings requiring cross-reference participation are finalized after all
 *    applicable references have been examined.
 *
 * @example
 *   const graph: EvidenceGraph = new EvidenceGraph(materializedInput);
 *   const first: IEvidenceGraphResult = graph.evaluate();
 *   const second: IEvidenceGraphResult = graph.evaluate();
 *   // The results have independent storage and no accumulated evaluator state.
 */
export class EvidenceGraph {
  /**
   * Validated input snapshot owned by this facade.
   *
   * Evaluators read this captured policy and inventory data. Neither later
   * caller edits nor modifications to an earlier result can change the
   * snapshot.
   */
  private readonly input: IEvidenceGraphInput;

  /**
   * Validates the input shape and captures an independent graph snapshot.
   *
   * Semantic inventory and resolution checks occur during evaluation so their
   * findings can be reported in graph context. Construction performs no source
   * IO.
   */
  public constructor(input: IEvidenceGraphInput) {
    this.input = structuredClone(typia.assert(input));
  }

  /**
   * Evaluates every independent obligation in the captured input.
   *
   * A fresh evaluator prevents coverage sets and deferred diagnostics from
   * leaking across calls. The returned clone also prevents consumers from
   * mutating records retained by the facade.
   */
  public evaluate(): IEvidenceGraphResult {
    return structuredClone(new EvidenceGraphEvaluator(this.input).evaluate());
  }

  /**
   * Captures and evaluates input without retaining a graph facade.
   *
   * This convenience entry point has the same validation and result ownership
   * as construction followed by the instance `evaluate` method.
   */
  public static evaluate(input: IEvidenceGraphInput): IEvidenceGraphResult {
    return new EvidenceGraph(input).evaluate();
  }
}

/**
 * Owns coverage accumulation and deferred findings for one graph evaluation.
 *
 * Claim and reference contexts keep local populations and resolutions, while
 * this controller records whether acknowledgements participate within each
 * claim. That claim-local participation state avoids declaring an unhosted
 * checklist citation invalid before another applicable reference can explain
 * it, without allowing an independent claim to suppress the finding.
 *
 * The public facade creates a new controller for every evaluation. Its sets and
 * maps therefore describe one traversal only and must not become facade
 * caches.
 */
class EvidenceGraphEvaluator {
  /**
   * Acknowledgements handled by a complete applicable obligation.
   *
   * Final checklist reporting consults this set across one claim's references.
   * Keys include the claim occurrence because repeated populations remain
   * independent obligations even when they reuse declaration IDs.
   */
  private readonly answeredDeclarations = new Set<string>();

  /**
   * Findings accumulated during this single traversal.
   *
   * Finalization deduplicates equivalent findings after all claims are
   * evaluated. The array is never reused by a later facade invocation.
   */
  private readonly diagnostics: IEvidenceDiagnostic[] = [];

  /**
   * Acknowledgements whose participation is uncertain because analysis failed.
   *
   * Deferred reporting must not infer invalid ownership from a reference that
   * could not supply a complete population or resolution.
   */
  private readonly uncertainDeclarations = new Set<string>();

  /**
   * Checklist statements awaiting graph-wide participation finalization.
   *
   * Each record retains its diagnostic boundary and severity. Later references
   * can establish that the statement was handled or that its status is
   * uncertain.
   */
  private readonly unhostedChecklists = new Map<
    string,
    IEvidenceUnhostedChecklist
  >();

  /**
   * Captured facade input used to create this traversal's claim contexts.
   *
   * The controller relies on the facade's shape validation and copy ownership;
   * it adds evaluation state without replacing or reloading source
   * populations.
   */
  private readonly input: IEvidenceGraphInput;

  /**
   * Binds captured input to empty per-evaluation state.
   *
   * The facade owns input validation and cloning. Keeping construction separate
   * from traversal lets every evaluation start with empty participation sets.
   */
  public constructor(input: IEvidenceGraphInput) {
    this.input = input;
  }

  /**
   * Evaluates claims, then finalizes findings that depend on reference
   * participation.
   *
   * Inactive obligations do not affect completeness. Every active claim and
   * reference must be complete, and the final diagnostic list must be empty,
   * before this graph result is successful.
   */
  public evaluate(): IEvidenceGraphResult {
    const claims = this.input.claims.map((claim, index) =>
      this.evaluateClaim(claim, index),
    );
    // A citation can participate in another reference. Decide deferred checklist
    // findings only after every claim has recorded accepted or uncertain usage.
    this.reportUnhostedChecklists();
    const diagnostics = EvidenceInventoryMerge.unique(
      this.diagnostics,
      (diagnostic) => typia.json.stringify(diagnostic),
    );
    const complete = claims.every(
      (claim) =>
        !claim.active ||
        (claim.complete &&
          claim.obligations.every(
            (obligation) => !obligation.active || obligation.complete,
          )),
    );
    return {
      success: complete && diagnostics.length === 0,
      claims,
      diagnostics,
    };
  }

  /**
   * Evaluates one claim and establishes its independent obligation boundaries.
   *
   * Disabled claims produce inactive reference records without touching their
   * inventories. A complete claim with no selected units is likewise inactive;
   * otherwise an incomplete claim remains active and marks every child
   * obligation incomplete so missing extraction cannot reduce required
   * coverage.
   */
  private evaluateClaim(
    claim: IEvidenceGraphClaim,
    claimIndex: number,
  ): IEvidenceGraphClaimResult {
    if (claim.severity === "off")
      return {
        claim: this.claimIndex(claimIndex),
        active: false,
        complete: true,
        obligations: claim.references.map((reference, referenceIndex) =>
          this.inactiveObligation(claimIndex, referenceIndex, reference),
        ),
      };
    const inventory = new EvidenceInventory([claim.inventory]);
    const snapshot = inventory.snapshot();
    const population = inventory.select(claim.unitIds);
    const context: IEvidenceGraphClaimContext = {
      claim,
      inventory: snapshot,
      population,
      index: claimIndex,
    };
    this.diagnostics.push(
      ...snapshot.diagnostics.map((diagnostic) =>
        this.context(diagnostic, claim.severity, claimIndex),
      ),
    );
    if (!snapshot.complete)
      for (const declaration of snapshot.declarations)
        this.uncertainDeclarations.add(
          this.declarationKey(claimIndex, declaration.id),
        );
    if (snapshot.complete && population.units.length === 0)
      return {
        claim: this.claimIndex(claimIndex),
        active: false,
        complete: true,
        obligations: claim.references.map((reference, referenceIndex) =>
          this.inactiveObligation(claimIndex, referenceIndex, reference),
        ),
      };
    const obligations = claim.references.map((reference, referenceIndex) =>
      snapshot.complete
        ? this.evaluateReference(context, reference, referenceIndex)
        : this.incompleteObligation(claimIndex, referenceIndex, reference),
    );
    return {
      claim: this.claimIndex(claimIndex),
      active: true,
      complete: snapshot.complete,
      obligations,
    };
  }

  /**
   * Prepares one reference obligation and stops before coverage when its inputs
   * are uncertain.
   *
   * Reference selection, acknowledgement resolution, and review resolution are
   * validated at this boundary because each reference owns them independently.
   * Any incomplete inventory or resolution records participation as uncertain
   * and returns an incomplete obligation instead of deriving coverage from a
   * potentially smaller population.
   */
  private evaluateReference(
    context: IEvidenceGraphClaimContext,
    reference: IEvidenceGraphReference,
    referenceIndex: number,
  ): IEvidenceGraphObligation {
    const { claim, inventory: claimInventory, index: claimIndex } = context;
    if (reference.severity === "off")
      return this.inactiveObligation(claimIndex, referenceIndex, reference);
    const inventory = new EvidenceInventory([reference.inventory]);
    const snapshot = inventory.snapshot();
    const population = inventory.select(reference.unitIds);
    this.validateReferencePolicy(
      claim,
      reference,
      population,
      claimIndex,
      referenceIndex,
    );
    this.diagnostics.push(
      ...snapshot.diagnostics.map((diagnostic) =>
        this.context(
          diagnostic,
          reference.severity,
          claimIndex,
          referenceIndex,
        ),
      ),
    );
    if (!snapshot.complete)
      for (const declaration of claimInventory.declarations)
        this.uncertainDeclarations.add(
          this.declarationKey(claimIndex, declaration.id),
        );
    const unitIds = population.units.map((unit) => unit.id);
    if (!snapshot.complete)
      return this.obligation(
        claimIndex,
        referenceIndex,
        true,
        false,
        unitIds,
        [],
        [],
      );
    if (unitIds.length === 0) {
      this.diagnostics.push(
        this.problem(
          "graph-empty-reference",
          reference.severity,
          "The reference contains no selected evidence units.",
          "Select symbol kinds present in the reference files or correct its source selection.",
          claimIndex,
          referenceIndex,
        ),
      );
      return this.obligation(
        claimIndex,
        referenceIndex,
        true,
        true,
        [],
        [],
        [],
      );
    }
    const resolutions = this.resolutions(
      claimInventory,
      reference,
      claimIndex,
      referenceIndex,
    );
    const reviewResolutions = this.reviewResolutions(
      claimInventory,
      reference,
      claimIndex,
      referenceIndex,
    );
    for (const entry of resolutions)
      this.diagnostics.push(
        ...entry.resolution.diagnostics.map((diagnostic) =>
          this.context(
            diagnostic,
            reference.severity,
            claimIndex,
            referenceIndex,
          ),
        ),
      );
    for (const entry of reviewResolutions)
      this.diagnostics.push(
        ...entry.resolution.diagnostics.map((diagnostic) =>
          this.context(
            diagnostic,
            reference.severity,
            claimIndex,
            referenceIndex,
          ),
        ),
      );
    const incomplete = [
      ...resolutions.map((entry) => entry.resolution.status),
      ...reviewResolutions.map((entry) => entry.resolution.status),
    ].includes("incomplete");
    if (incomplete) {
      for (const entry of resolutions)
        if (entry.resolution.status === "incomplete")
          this.uncertainDeclarations.add(
            this.declarationKey(claimIndex, entry.declarationId),
          );
      if (
        reviewResolutions.some(
          (entry) => entry.resolution.status === "incomplete",
        )
      )
        for (const declaration of claimInventory.declarations)
          this.uncertainDeclarations.add(
            this.declarationKey(claimIndex, declaration.id),
          );
      return this.obligation(
        claimIndex,
        referenceIndex,
        true,
        false,
        unitIds,
        [],
        [],
      );
    }
    return this.cover({
      claim: context,
      reference,
      inventory: snapshot,
      population,
      index: referenceIndex,
      resolutions,
      reviewResolutions,
    });
  }

  /**
   * Evaluates acknowledgements against one independent reference context.
   *
   * Coverage, exclusion conflicts, reviews, and cardinality all use this same
   * claim/reference boundary. The method retains one edge per accepted
   * statement so reports can explain both the selected units it covers and the
   * host that accepted responsibility for them.
   */
  private cover(
    context: IEvidenceGraphReferenceContext,
  ): IEvidenceGraphObligation {
    const {
      claim: {
        claim,
        inventory: claimInventory,
        population: claimPopulation,
        index: claimIndex,
      },
      reference,
      index: referenceIndex,
      inventory: referenceInventory,
      population: referencePopulation,
      resolutions,
    } = context;
    const declarations = new Map(
      claimInventory.declarations.map((declaration) => [
        declaration.id,
        declaration,
      ]),
    );
    const selectedHosts = new Map(
      claimPopulation.hosts.map((host) => [host.id, host.unitIds]),
    );
    const attachedHosts = new Set(
      claimInventory.hosts
        .filter((host) => host.attachment === "attached")
        .map((host) => host.id),
    );
    const exclusionHosts = new Set(
      claim.exclusionHostIds === undefined
        ? attachedHosts
        : claim.exclusionHostIds.filter((id) => attachedHosts.has(id)),
    );
    const units = new Map(
      referenceInventory.units.map((unit) => [unit.id, unit]),
    );
    const selectedUnits = referencePopulation.units;
    const selectedUnitIds = new Set(selectedUnits.map((unit) => unit.id));
    const scopeIds = new Set(referencePopulation.scopes.map((unit) => unit.id));
    const fingerprints = new EvidenceFingerprintIndex(referenceInventory);
    const checklist = reference.checklist === true;
    const explainedByHost = new Map<string, Set<string>>();
    const covered = new Set<string>();
    const edges: IEvidenceGraphEdge[] = [];
    for (const entry of resolutions) {
      const declaration = declarations.get(entry.declarationId);
      if (declaration === undefined) {
        this.diagnostics.push(
          this.problem(
            "graph-resolution-declaration",
            reference.severity,
            `Resolution '${entry.declarationId}' has no claim acknowledgement.`,
            "Rebuild target resolutions from this claim inventory before evaluating the graph.",
            claimIndex,
            referenceIndex,
          ),
        );
        continue;
      }
      if (entry.resolution.status !== "resolved") continue;
      const target = entry.resolution.units[0];
      if (
        target === undefined ||
        entry.resolution.units.length !== 1 ||
        !scopeIds.has(target.id)
      ) {
        this.diagnostics.push(
          this.problem(
            "graph-resolution-scope",
            reference.severity,
            `Resolved target '${declaration.target}' is outside this reference's selected structural scopes.`,
            "Resolve the declaration with this reference's exact selected unit IDs.",
            claimIndex,
            referenceIndex,
            declaration,
          ),
        );
        continue;
      }
      let unitIds = selectedUnits
        .filter((unit) => this.descends(unit, target.id, units))
        .map((unit) => unit.id);
      if (unitIds.length === 0) continue;
      const hostUnitIds = selectedHosts.get(declaration.hostId) ?? [];
      if (
        declaration.kind === "evidence" &&
        hostUnitIds.length === 0 &&
        checklist
      ) {
        this.recordUnhostedChecklist(
          declaration,
          reference.severity,
          claimIndex,
          referenceIndex,
        );
        continue;
      }
      if (
        (declaration.kind === "evidence" && hostUnitIds.length === 0) ||
        (declaration.kind === "evidenceExclude" &&
          !exclusionHosts.has(declaration.hostId))
      ) {
        this.diagnostics.push(
          this.problem(
            "graph-out-of-scope-host",
            reference.severity,
            `@${declaration.kind} for '${declaration.target}' is outside its eligible claim hosts.`,
            declaration.kind === "evidence"
              ? "Move the acknowledgement to a host selected by the claim's symbol kinds."
              : "Move the exclusion to an eligible public carrier in the claim files.",
            claimIndex,
            referenceIndex,
            declaration,
          ),
        );
        continue;
      }
      if (
        declaration.kind === "evidenceExclude" &&
        reference.noEvidenceExclude === true
      ) {
        this.diagnostics.push(
          this.problem(
            "graph-forbidden-exclusion",
            reference.severity,
            `@evidenceExclude for '${declaration.target}' is forbidden by noEvidenceExclude.`,
            "Remove the exclusion and cite the implemented target with positive @evidence.",
            claimIndex,
            referenceIndex,
            declaration,
          ),
        );
        continue;
      }
      if (checklist && hostUnitIds.length === 0) {
        this.recordUnhostedChecklist(
          declaration,
          reference.severity,
          claimIndex,
          referenceIndex,
        );
        continue;
      }
      if (
        checklist &&
        declaration.kind === "evidence" &&
        !selectedUnitIds.has(target.id)
      ) {
        this.answeredDeclarations.add(
          this.declarationKey(claimIndex, declaration.id),
        );
        this.diagnostics.push(
          this.problem(
            "graph-checklist-aggregate",
            reference.severity,
            `Positive checklist target '${declaration.target}' names an unselected aggregate containing ${unitIds.length} selected item(s).`,
            "Cite each selected checklist item this host answers, or exclude the aggregate when none of it applies.",
            claimIndex,
            referenceIndex,
            declaration,
          ),
        );
        for (const hostUnitId of hostUnitIds) {
          let explained = explainedByHost.get(hostUnitId);
          if (explained === undefined) {
            explained = new Set<string>();
            explainedByHost.set(hostUnitId, explained);
          }
          for (const unitId of unitIds) explained.add(unitId);
        }
        continue;
      }
      if (checklist && declaration.kind === "evidence") unitIds = [target.id];
      this.conflicts(
        declaration,
        target.id,
        hostUnitIds,
        unitIds,
        edges,
        declarations,
        reference.severity,
        claimIndex,
        referenceIndex,
        checklist,
      );
      edges.push({
        declarationId: declaration.id,
        hostId: declaration.hostId,
        hostUnitIds,
        kind: declaration.kind,
        targetUnitId: target.id,
        unitIds,
        fingerprint: fingerprints.inspect(target.id).fingerprint,
      });
      this.answeredDeclarations.add(
        this.declarationKey(claimIndex, declaration.id),
      );
      if (!checklist) for (const id of unitIds) covered.add(id);
    }
    this.evaluateReviews(context, edges);
    if (checklist)
      return this.checklistObligation(context, edges, explainedByHost);
    this.cardinality(context, edges);
    const coveredUnitIds = selectedUnits
      .filter((unit) => covered.has(unit.id))
      .map((unit) => unit.id);
    const missingUnits = selectedUnits.filter((unit) => !covered.has(unit.id));
    for (const unit of missingUnits)
      this.diagnostics.push(
        this.problem(
          "graph-missing-acknowledgement",
          reference.severity,
          `Missing acknowledgement for '${this.display(referenceInventory, unit)}'.`,
          reference.noEvidenceExclude === true
            ? "Cite the claim artifact that implements this unit with positive @evidence."
            : "Cite the claim artifact that implements this unit with @evidence, or exclude it on an eligible carrier when it does not apply.",
          claimIndex,
          referenceIndex,
          undefined,
          unit,
        ),
      );
    return this.obligation(
      claimIndex,
      referenceIndex,
      true,
      true,
      selectedUnits.map((unit) => unit.id),
      coveredUnitIds,
      missingUnits.map((unit) => unit.id),
      edges,
    );
  }

  /**
   * Computes checklist coverage separately for every selected claim host.
   *
   * A checklist does not permit one host's acknowledgement to answer another
   * host's obligation. Aggregate citations that were diagnosed earlier are kept
   * as explanations, allowing the result to distinguish an explicitly invalid
   * aggregate answer from an entirely absent answer.
   */
  private checklistObligation(
    context: IEvidenceGraphReferenceContext,
    edges: IEvidenceGraphEdge[],
    explainedByHost: Map<string, Set<string>>,
  ): IEvidenceGraphObligation {
    const {
      claim: {
        inventory: claimInventory,
        population: claimPopulation,
        index: claimIndex,
      },
      reference,
      index: referenceIndex,
      inventory: referenceInventory,
    } = context;
    const selectedUnits = context.population.units;
    const coveredByHost = new Map<string, Set<string>>(
      claimPopulation.units.map((unit) => [unit.id, new Set<string>()]),
    );
    for (const edge of edges)
      for (const hostUnitId of edge.hostUnitIds) {
        const covered = coveredByHost.get(hostUnitId);
        if (covered === undefined) continue;
        for (const unitId of edge.unitIds) covered.add(unitId);
      }
    const hostCoverage: IEvidenceGraphHostCoverage[] =
      claimPopulation.units.map((host) => {
        const covered = coveredByHost.get(host.id) ?? new Set<string>();
        const explained = explainedByHost.get(host.id) ?? new Set<string>();
        const coveredUnitIds = selectedUnits
          .filter((unit) => covered.has(unit.id))
          .map((unit) => unit.id);
        const missingUnits = selectedUnits.filter(
          (unit) => !covered.has(unit.id),
        );
        const explainedUnitIds = missingUnits
          .filter((unit) => explained.has(unit.id))
          .map((unit) => unit.id);
        const reportable = missingUnits.filter(
          (unit) => !explained.has(unit.id),
        );
        if (reportable.length !== 0)
          this.diagnostics.push(
            this.problem(
              "graph-checklist-missing",
              reference.severity,
              `Host '${this.display(claimInventory, host)}' has not acknowledged ${reportable.length} of ${selectedUnits.length} checklist item(s): ${reportable
                .map((unit) => `'${this.display(referenceInventory, unit)}'`)
                .join(", ")}.`,
              reference.noEvidenceExclude === true
                ? "Cite every missing checklist item from this host with positive @evidence."
                : "Cite every missing checklist item from this host, or exclude the scope that does not apply.",
              claimIndex,
              referenceIndex,
              undefined,
              host,
            ),
          );
        return {
          hostUnitId: host.id,
          coveredUnitIds,
          missingUnitIds: missingUnits.map((unit) => unit.id),
          explainedUnitIds,
        };
      });
    const coveredUnitIds = selectedUnits
      .filter((unit) =>
        hostCoverage.every((host) => host.coveredUnitIds.includes(unit.id)),
      )
      .map((unit) => unit.id);
    const covered = new Set(coveredUnitIds);
    return this.obligation(
      claimIndex,
      referenceIndex,
      true,
      true,
      selectedUnits.map((unit) => unit.id),
      coveredUnitIds,
      selectedUnits
        .filter((unit) => !covered.has(unit.id))
        .map((unit) => unit.id),
      edges,
      hostCoverage,
    );
  }

  /**
   * Enforces cardinality policies over positive coverage edges.
   *
   * Exclusions do not count as evidence, and aliases cannot inflate counts
   * because sets use semantic identities. This runs after edge creation so the
   * policy observes the same host and target scopes reported to callers.
   */
  private cardinality(
    context: IEvidenceGraphReferenceContext,
    edges: IEvidenceGraphEdge[],
  ): void {
    const {
      claim: {
        inventory: claimInventory,
        population: claimPopulation,
        index: claimIndex,
      },
      reference,
      index: referenceIndex,
      inventory: referenceInventory,
    } = context;
    const selectedUnits = context.population.units;
    const evidence = edges.filter((edge) => edge.kind === "evidence");
    if (reference.singleEvidencePerSymbol === true)
      for (const host of claimPopulation.units) {
        const cited = new Set(
          evidence
            .filter((edge) => edge.hostUnitIds.includes(host.id))
            .flatMap((edge) => edge.unitIds),
        );
        if (cited.size === 1) continue;
        this.diagnostics.push(
          this.problem(
            "graph-single-evidence-per-symbol",
            reference.severity,
            `Host '${this.display(claimInventory, host)}' cites ${cited.size} distinct selected evidence unit(s); singleEvidencePerSymbol requires exactly 1.`,
            "Keep positive @evidence on this semantic host to exactly one selected unit.",
            claimIndex,
            referenceIndex,
            undefined,
            host,
          ),
        );
      }
    if (reference.uniqueEvidence === true)
      for (const unit of selectedUnits) {
        const hosts = new Set(
          evidence
            .filter((edge) => edge.unitIds.includes(unit.id))
            .flatMap((edge) => edge.hostUnitIds),
        );
        if (hosts.size <= 1) continue;
        this.diagnostics.push(
          this.problem(
            "graph-unique-evidence",
            reference.severity,
            `Evidence unit '${this.display(referenceInventory, unit)}' has ${hosts.size} distinct positive evidence host(s); uniqueEvidence allows at most 1.`,
            "Keep one selected semantic host for this unit and remove the other positive citations.",
            claimIndex,
            referenceIndex,
            undefined,
            unit,
          ),
        );
      }
  }

  /**
   * Reports duplicate and contradictory acknowledgement scopes before adding an
   * edge.
   *
   * Normal coverage permits one aggregate target to cover several selected
   * units, while checklist coverage also requires the same host to overlap.
   * Comparing the appropriate scopes prevents an exclusion or repeated
   * annotation from silently changing the meaning of an earlier
   * acknowledgement.
   */
  private conflicts(
    declaration: IEvidenceDeclaration,
    targetUnitId: string,
    hostUnitIds: string[],
    unitIds: string[],
    edges: IEvidenceGraphEdge[],
    declarations: Map<string, IEvidenceDeclaration>,
    severity: EvidenceSeverity,
    claimIndex: number,
    referenceIndex: number,
    checklist: boolean,
  ): void {
    if (declaration.kind === "evidence") {
      const duplicate = edges.find(
        (edge) =>
          edge.kind === "evidence" &&
          this.overlaps(edge.hostUnitIds, hostUnitIds) &&
          edge.targetUnitId === targetUnitId,
      );
      if (duplicate !== undefined)
        this.diagnostics.push(
          this.problem(
            "graph-duplicate-evidence",
            severity,
            `The same host repeats @evidence for '${declaration.target}'.`,
            "Keep one acknowledgement for this target on the semantic host.",
            claimIndex,
            referenceIndex,
            declaration,
          ),
        );
    }
    const opposite = edges.find(
      (edge) =>
        edge.kind !== declaration.kind &&
        this.overlaps(edge.unitIds, unitIds) &&
        (!checklist || this.overlaps(edge.hostUnitIds, hostUnitIds)),
    );
    if (opposite !== undefined) {
      const previous = declarations.get(opposite.declarationId);
      this.diagnostics.push(
        this.problem(
          "graph-conflicting-acknowledgements",
          severity,
          `@evidence and @evidenceExclude overlap at '${declaration.target}'.`,
          previous === undefined
            ? "Delete whichever acknowledgement states the wrong intent."
            : `Delete whichever acknowledgement states the wrong intent; the earlier declaration is '${previous.target}'.`,
          claimIndex,
          referenceIndex,
          declaration,
        ),
      );
    }
    if (declaration.kind === "evidenceExclude") {
      const duplicate = edges.find(
        (edge) =>
          edge.kind === "evidenceExclude" &&
          this.overlaps(edge.unitIds, unitIds) &&
          (!checklist || this.overlaps(edge.hostUnitIds, hostUnitIds)),
      );
      if (duplicate !== undefined)
        this.diagnostics.push(
          this.problem(
            "graph-duplicate-exclusion",
            severity,
            `@evidenceExclude for '${declaration.target}' overlaps an earlier exclusion.`,
            "Keep one exclusion at the widest truthful scope.",
            claimIndex,
            referenceIndex,
            declaration,
          ),
        );
    }
  }

  /**
   * Pairs reviews with acknowledgements by kind, host, and resolved target.
   *
   * Reviews validate fingerprints but never discharge missing coverage. This
   * phase first validates review statements against resolved acknowledgements,
   * then enforces required-review freshness only for accepted coverage edges. A
   * malformed review therefore remains diagnostic evidence without becoming a
   * substitute for the positive or exclusion statement it names.
   */
  private evaluateReviews(
    context: IEvidenceGraphReferenceContext,
    edges: IEvidenceGraphEdge[],
  ): void {
    const {
      claim: { inventory: claimInventory, index: claimIndex },
      reference,
      index: referenceIndex,
      inventory: referenceInventory,
      population: referencePopulation,
      resolutions: declarationResolutions,
      reviewResolutions,
    } = context;
    const declarations = new Map(
      claimInventory.declarations.map((declaration) => [
        declaration.id,
        declaration,
      ]),
    );
    const reviews = new Map(
      claimInventory.reviews.map((review) => [review.id, review]),
    );
    const hosts = new Map(claimInventory.hosts.map((host) => [host.id, host]));
    const scopeIds = new Set(referencePopulation.scopes.map((unit) => unit.id));
    const acknowledgements: IEvidenceResolvedAcknowledgement[] = [];
    for (const entry of declarationResolutions) {
      const declaration = declarations.get(entry.declarationId);
      const target = entry.resolution.units[0];
      if (
        declaration === undefined ||
        entry.resolution.status !== "resolved" ||
        target === undefined ||
        entry.resolution.units.length !== 1 ||
        !scopeIds.has(target.id)
      )
        continue;
      const host = hosts.get(declaration.hostId);
      acknowledgements.push({
        declaration,
        hostUnitIds: host?.attachment === "attached" ? host.unitIds : [],
        targetUnitId: target.id,
      });
    }
    const records: IEvidenceResolvedReview[] = [];
    const duplicateKeys = new Set<string>();
    for (const entry of reviewResolutions) {
      const review = reviews.get(entry.reviewId);
      if (review === undefined) {
        this.diagnostics.push(
          this.problem(
            "graph-review-resolution-review",
            reference.severity,
            `Review resolution '${entry.reviewId}' has no claim review statement.`,
            "Rebuild review target resolutions from this claim inventory before evaluating the graph.",
            claimIndex,
            referenceIndex,
          ),
        );
        continue;
      }
      if (entry.resolution.status !== "resolved") continue;
      const target = entry.resolution.units[0];
      if (
        target === undefined ||
        entry.resolution.units.length !== 1 ||
        !scopeIds.has(target.id)
      ) {
        this.diagnostics.push(
          this.problem(
            "graph-review-resolution-scope",
            reference.severity,
            `Resolved review target '${review.target}' is outside this reference's selected structural scopes.`,
            "Resolve the review with this reference's exact selected unit IDs.",
            claimIndex,
            referenceIndex,
            review,
          ),
        );
        continue;
      }
      const host = hosts.get(review.hostId);
      const hostUnitIds = host?.attachment === "attached" ? host.unitIds : [];
      const key = JSON.stringify([review.hostId, review.reviews, target.id]);
      if (duplicateKeys.has(key)) {
        this.diagnostics.push(
          this.problem(
            "graph-duplicate-review",
            reference.severity,
            `The same documentation position repeats ${this.reviewMarker(review.reviews)} for '${review.target}'.`,
            "Keep the review that states what was checked and remove the other.",
            claimIndex,
            referenceIndex,
            review,
          ),
        );
        continue;
      }
      duplicateKeys.add(key);
      records.push({ review, hostUnitIds, targetUnitId: target.id });
    }
    for (const record of records) {
      const matching = acknowledgements.some(
        (acknowledgement) =>
          acknowledgement.declaration.kind === record.review.reviews &&
          acknowledgement.targetUnitId === record.targetUnitId &&
          this.reviewHostMatches(
            record,
            acknowledgement.declaration.hostId,
            acknowledgement.hostUnitIds,
          ),
      );
      if (matching) continue;
      const opposite = acknowledgements.find(
        (acknowledgement) =>
          acknowledgement.declaration.kind !== record.review.reviews &&
          acknowledgement.targetUnitId === record.targetUnitId &&
          this.reviewHostMatches(
            record,
            acknowledgement.declaration.hostId,
            acknowledgement.hostUnitIds,
          ),
      );
      this.diagnostics.push(
        opposite === undefined
          ? this.problem(
              "graph-orphan-review",
              reference.severity,
              `${this.reviewMarker(record.review.reviews)} for '${record.review.target}' has no matching acknowledgement on its semantic host.`,
              `Correct the target, add @${record.review.reviews} when this host answers it, or remove the review.`,
              claimIndex,
              referenceIndex,
              record.review,
            )
          : this.problem(
              "graph-review-kind",
              reference.severity,
              `${this.reviewMarker(record.review.reviews)} for '${record.review.target}' cannot review @${opposite.declaration.kind}.`,
              `Rewrite it as ${this.reviewMarker(opposite.declaration.kind)}, or correct the acknowledgement kind.`,
              claimIndex,
              referenceIndex,
              record.review,
            ),
      );
    }
    if (reference.requireReview !== true) return;
    for (const edge of edges) {
      const candidates = records.filter(
        (record) =>
          record.review.reviews === edge.kind &&
          record.targetUnitId === edge.targetUnitId &&
          this.reviewHostMatches(record, edge.hostId, edge.hostUnitIds),
      );
      const review = candidates[0]?.review;
      const marker = this.reviewMarker(edge.kind);
      const declaration = claimInventory.declarations.find(
        (candidate) => candidate.id === edge.declarationId,
      );
      if (review === undefined) {
        const wrongKind = records.some(
          (record) =>
            record.review.reviews !== edge.kind &&
            record.targetUnitId === edge.targetUnitId &&
            this.reviewHostMatches(record, edge.hostId, edge.hostUnitIds),
        );
        if (wrongKind) continue;
        this.diagnostics.push(
          this.problem(
            "graph-missing-review",
            reference.severity,
            `@${edge.kind} for '${declaration?.target ?? this.displayUnit(referenceInventory, edge.targetUnitId)}' has no matching ${marker}; the current scope fingerprint is '#${edge.fingerprint}'.`,
            `Add '${marker} ${declaration?.target ?? "<target>"} #${edge.fingerprint} <what you checked>' on the same semantic host.`,
            claimIndex,
            referenceIndex,
            declaration,
          ),
        );
        continue;
      }
      if (review.fingerprint === undefined) {
        this.diagnostics.push(
          this.problem(
            "graph-missing-review-fingerprint",
            reference.severity,
            `${marker} for '${review.target}' has no fingerprint; the current scope fingerprint is '#${edge.fingerprint}'.`,
            `Write '#${edge.fingerprint}' after the review target so later content changes can expire it.`,
            claimIndex,
            referenceIndex,
            review,
          ),
        );
        continue;
      }
      if (review.fingerprint !== edge.fingerprint)
        this.diagnostics.push(
          this.problem(
            "graph-stale-review",
            reference.severity,
            `${marker} for '${review.target}' names '#${review.fingerprint}', but the current scope fingerprint is '#${edge.fingerprint}'.`,
            `Review the cited content again and replace the fingerprint with '#${edge.fingerprint}', or correct the acknowledgement if it no longer applies.`,
            claimIndex,
            referenceIndex,
            review,
          ),
        );
    }
  }

  /**
   * Tests whether a review belongs to an acknowledgement's semantic host
   * population.
   *
   * Unattached reviews can match only their exact documentation host. Attached
   * reviews instead match any shared semantic owner, which preserves alias and
   * multi-owner attachment semantics without matching a different claim host.
   */
  private reviewHostMatches(
    review: IEvidenceResolvedReview,
    hostId: string,
    hostUnitIds: string[],
  ): boolean {
    return review.hostUnitIds.length === 0
      ? review.review.hostId === hostId
      : this.overlaps(review.hostUnitIds, hostUnitIds);
  }

  /**
   * Selects the review marker required by an acknowledgement kind.
   *
   * Keeping this mapping in one place makes diagnostics and repair text agree
   * about whether a positive citation needs @evidenceReview or an exclusion
   * needs @evidenceExcludeReview.
   */
  private reviewMarker(kind: EvidenceAcknowledgementKind): string {
    return kind === "evidence" ? "@evidenceReview" : "@evidenceExcludeReview";
  }

  /**
   * Formats a known semantic identity for a diagnostic.
   *
   * Resolution records can be stale or invalid, so an unknown identity remains
   * visible verbatim rather than causing diagnostic construction to fail.
   */
  private displayUnit(inventory: IEvidenceInventory, id: string): string {
    const unit = inventory.units.find((candidate) => candidate.id === id);
    return unit === undefined ? id : this.display(inventory, unit);
  }

  /**
   * Validates and orders acknowledgement resolutions within one reference
   * obligation.
   *
   * Repeated identical entries collapse to one statement. Conflicting entries
   * are removed and diagnosed because selecting either outcome would let source
   * order decide coverage; source-coordinate ordering then stabilizes all valid
   * edge and diagnostic processing.
   */
  private resolutions(
    inventory: IEvidenceInventory,
    reference: IEvidenceGraphReference,
    claimIndex: number,
    referenceIndex: number,
  ): IEvidenceGraphResolution[] {
    const declarations = new Map(
      inventory.declarations.map((declaration) => [
        declaration.id,
        declaration,
      ]),
    );
    const records = new Map<string, IEvidenceGraphResolution>();
    const conflicts = new Set<string>();
    for (const entry of reference.resolutions) {
      if (conflicts.has(entry.declarationId)) continue;
      const previous = records.get(entry.declarationId);
      if (
        previous !== undefined &&
        typia.json.stringify(previous.resolution) !==
          typia.json.stringify(entry.resolution)
      ) {
        this.diagnostics.push(
          this.problem(
            "graph-conflicting-resolution",
            reference.severity,
            `Acknowledgement '${entry.declarationId}' has conflicting target resolutions.`,
            "Resolve each acknowledgement once per reference population.",
            claimIndex,
            referenceIndex,
            declarations.get(entry.declarationId),
          ),
        );
        records.delete(entry.declarationId);
        conflicts.add(entry.declarationId);
      } else records.set(entry.declarationId, entry);
    }
    return Array.from(records.values()).sort((x, y) =>
      this.compareStatements(
        declarations.get(x.declarationId),
        declarations.get(y.declarationId),
        x.declarationId,
        y.declarationId,
      ),
    );
  }

  /**
   * Validates and orders review resolutions without combining them with
   * acknowledgements.
   *
   * Reviews have their own target-resolution lifecycle. Conflicts therefore
   * invalidate only the review statement and cannot alter acknowledgement
   * coverage or mask a missing positive citation.
   */
  private reviewResolutions(
    inventory: IEvidenceInventory,
    reference: IEvidenceGraphReference,
    claimIndex: number,
    referenceIndex: number,
  ): IEvidenceGraphReviewResolution[] {
    const reviews = new Map(
      inventory.reviews.map((review) => [review.id, review]),
    );
    const records = new Map<string, IEvidenceGraphReviewResolution>();
    const conflicts = new Set<string>();
    for (const entry of reference.reviewResolutions ?? []) {
      if (conflicts.has(entry.reviewId)) continue;
      const previous = records.get(entry.reviewId);
      if (
        previous !== undefined &&
        typia.json.stringify(previous.resolution) !==
          typia.json.stringify(entry.resolution)
      ) {
        this.diagnostics.push(
          this.problem(
            "graph-conflicting-review-resolution",
            reference.severity,
            `Review '${entry.reviewId}' has conflicting target resolutions.`,
            "Resolve each review once per reference population.",
            claimIndex,
            referenceIndex,
            reviews.get(entry.reviewId),
          ),
        );
        records.delete(entry.reviewId);
        conflicts.add(entry.reviewId);
      } else records.set(entry.reviewId, entry);
    }
    return Array.from(records.values()).sort((x, y) =>
      this.compareStatements(
        reviews.get(x.reviewId),
        reviews.get(y.reviewId),
        x.reviewId,
        y.reviewId,
      ),
    );
  }

  /**
   * Orders statements by physical source position and stable identity.
   *
   * Missing locations sort before known offsets through an explicit key, making
   * invalid adapter records deterministic without inventing a source position.
   */
  private compareStatements(
    x: IEvidenceTargetStatement | undefined,
    y: IEvidenceTargetStatement | undefined,
    xId: string,
    yId: string,
  ): number {
    const xLocation = x === undefined ? undefined : x.location;
    const yLocation = y === undefined ? undefined : y.location;
    const xOffset =
      xLocation?.range === undefined ? -1 : xLocation.range.start.offset;
    const yOffset =
      yLocation?.range === undefined ? -1 : yLocation.range.start.offset;
    const xKey = JSON.stringify([xLocation?.file ?? "", xOffset, xId]);
    const yKey = JSON.stringify([yLocation?.file ?? "", yOffset, yId]);
    return EvidenceInventoryMerge.compare(xKey, yKey);
  }

  /**
   * Tests structural ancestry through explicit parent identities.
   *
   * Coverage scopes must not be inferred from display names or accessor text.
   * The visited set bounds malformed parent cycles so an invalid inventory can
   * still yield its diagnostic result without hanging graph evaluation.
   */
  private descends(
    unit: IEvidenceUnit,
    ancestorId: string,
    units: Map<string, IEvidenceUnit>,
  ): boolean {
    const visited = new Set<string>();
    let current: IEvidenceUnit | undefined = unit;
    while (current !== undefined && !visited.has(current.id)) {
      if (current.id === ancestorId) return true;
      visited.add(current.id);
      current =
        current.parentId === undefined
          ? undefined
          : units.get(current.parentId);
    }
    return false;
  }

  /**
   * Tests whether two semantic-identity collections share a member.
   *
   * Callers use this for host and target scope relations where duplicated
   * aliases must not change the boolean result.
   */
  private overlaps(x: string[], y: string[]): boolean {
    const right = new Set(y);
    return x.some((id) => right.has(id));
  }

  /**
   * Formats the preferred public address of a semantic unit for diagnostics.
   *
   * An address from a selected source is preferred so the repair text reflects
   * the configured population. If no public address exists, the semantic name
   * remains a useful fallback for invalid or partially extracted inventory
   * data.
   */
  private display(inventory: IEvidenceInventory, unit: IEvidenceUnit): string {
    const selectedFiles = new Set(
      inventory.sources.flatMap((source) =>
        source.addresses.flatMap((address) =>
          address.selected === false
            ? []
            : [EvidenceFileTarget.normalize(address.absolute)],
        ),
      ),
    );
    const addresses = inventory.addresses
      .filter((address) => address.unitId === unit.id)
      .sort((x, y) =>
        EvidenceInventoryMerge.compare(
          JSON.stringify([x.file, x.segments]),
          JSON.stringify([y.file, y.segments]),
        ),
      );
    const address =
      addresses.find((candidate) =>
        selectedFiles.has(EvidenceFileTarget.normalize(candidate.file)),
      ) ?? addresses[0];
    if (address === undefined) return unit.name;
    return address.segments.length === 0
      ? address.file
      : EvidenceFileTarget.format(address);
  }

  /**
   * Applies an obligation's severity and configured coordinates to an existing
   * diagnostic.
   *
   * Inventory diagnostics carry adapter facts but no graph boundary. This
   * wrapper preserves their repair data while adding the claim/reference
   * identity needed to distinguish repeated populations in one check result.
   */
  private context(
    diagnostic: IEvidenceDiagnostic,
    severity: EvidenceSeverity,
    claim: number,
    reference?: number,
  ): IEvidenceDiagnostic {
    if (severity === "off")
      throw new Error("Disabled graph state cannot emit a diagnostic.");
    return {
      ...diagnostic,
      severity,
      message: `${this.label(claim, reference)}: ${diagnostic.message}`,
      claim: this.claimIndex(claim),
      ...(reference === undefined
        ? {}
        : { reference: this.referenceIndex(claim, reference) }),
    };
  }

  /**
   * Creates a graph diagnostic with the most specific available repair
   * location.
   *
   * A statement location wins because its annotation should be edited;
   * otherwise a missing-coverage finding points at the selected unit's first
   * declaration site. Disabled obligations are forbidden from emitting
   * findings, protecting the inactive-result contract.
   */
  private problem(
    code: string,
    severity: EvidenceSeverity,
    message: string,
    repair: string,
    claim: number,
    reference: number,
    statement?: IEvidenceTargetStatement,
    unit?: IEvidenceUnit,
  ): IEvidenceDiagnostic {
    if (severity === "off")
      throw new Error("Disabled graph state cannot emit a diagnostic.");
    const site = unit === undefined ? undefined : unit.sites[0];
    return {
      code,
      severity,
      message: `${this.label(claim, reference)}: ${message}`,
      repair,
      claim: this.claimIndex(claim),
      reference: this.referenceIndex(claim, reference),
      ...(unit === undefined ? {} : { unitId: unit.id }),
      ...(statement === undefined
        ? site === undefined
          ? {}
          : { location: { file: site.file, range: site.range } }
        : {
            location: statement.location,
            hostId: statement.hostId,
            target: statement.target,
          }),
    };
  }

  /**
   * Formats a claim and optional reference boundary for a diagnostic message.
   *
   * Display numbering uses configured indexes rather than array positions, so
   * filtering or duplicated policies cannot make a report point at another
   * configuration entry.
   */
  private label(claim: number, reference?: number): string {
    const input = this.input.claims[claim];
    const name = input?.name;
    const configuredClaim = this.claimIndex(claim);
    const label =
      name === undefined || name.length === 0
        ? `Claim ${configuredClaim + 1}`
        : `Claim ${configuredClaim + 1} ('${name}')`;
    return reference === undefined
      ? label
      : `${label} reference ${this.referenceIndex(claim, reference) + 1}`;
  }

  /**
   * Maps an input claim position to its configured stable index.
   *
   * The positional fallback preserves a usable boundary for malformed or
   * partially constructed graph input that lacks an indexed claim record.
   */
  private claimIndex(position: number): number {
    return this.input.claims[position]?.index ?? position;
  }

  /**
   * Maps a reference position to its configured stable index within a claim.
   *
   * This fallback mirrors claim indexing so diagnostics remain attributable
   * even while reporting an invalid graph structure.
   */
  private referenceIndex(claim: number, position: number): number {
    const input = this.input.claims[claim];
    return input === undefined
      ? position
      : (input.references[position]?.index ?? position);
  }

  /**
   * Rejects policy combinations that have no coherent checklist interpretation.
   *
   * Checklist asks every selected host to answer every Markdown item, whereas
   * cardinality and gathered exclusions impose incompatible global rules. Fail
   * early rather than producing coverage findings whose denominator is
   * unclear.
   */
  private validateReferencePolicy(
    claim: IEvidenceGraphClaim,
    reference: IEvidenceGraphReference,
    population: IEvidencePopulation,
    claimIndex: number,
    referenceIndex: number,
  ): void {
    if (reference.checklist !== true) return;
    if (
      reference.uniqueEvidence === true ||
      reference.singleEvidencePerSymbol === true
    )
      throw new Error(
        `${this.label(claimIndex, referenceIndex)} combines checklist with an incompatible cardinality policy.`,
      );
    if (
      (claim.exclusionHostIds?.length ?? 0) !== 0 &&
      reference.noEvidenceExclude !== true
    )
      throw new Error(
        `${this.label(claimIndex, referenceIndex)} combines checklist with gathered exclusion carriers.`,
      );
    if (population.units.some((unit) => unit.type !== "markdown"))
      throw new Error(
        `${this.label(claimIndex, referenceIndex)} applies checklist to a non-Markdown reference population.`,
      );
  }

  /**
   * Defers an unhosted checklist finding until every claim reference
   * participates.
   *
   * The same declaration may be an eligible answer under another obligation.
   * For duplicate deferred records, the error severity is retained over warning
   * so final reporting cannot weaken the strongest applicable policy.
   */
  private recordUnhostedChecklist(
    declaration: IEvidenceDeclaration,
    severity: EvidenceSeverity,
    claim: number,
    reference: number,
  ): void {
    const key: string = this.declarationKey(claim, declaration.id);
    const previous: IEvidenceUnhostedChecklist | undefined =
      this.unhostedChecklists.get(key);
    if (
      previous === undefined ||
      (previous.severity === "warning" && severity === "error")
    )
      this.unhostedChecklists.set(key, {
        declaration,
        severity,
        claim,
        reference,
      });
  }

  /**
   * Reports claim-local checklist annotations that remain conclusively
   * unhosted.
   *
   * Accepted participation suppresses the finding, and uncertain participation
   * suppresses it as well because an incomplete reference cannot prove that the
   * declaration is ineligible throughout its claim.
   */
  private reportUnhostedChecklists(): void {
    for (const record of this.unhostedChecklists.values()) {
      if (
        this.answeredDeclarations.has(
          this.declarationKey(record.claim, record.declaration.id),
        ) ||
        this.uncertainDeclarations.has(
          this.declarationKey(record.claim, record.declaration.id),
        )
      )
        continue;
      this.diagnostics.push(
        this.problem(
          "graph-unhosted-checklist",
          record.severity,
          `@${record.declaration.kind} for '${record.declaration.target}' is not attached to a selected checklist host.`,
          "Move the acknowledgement onto a selected semantic host that owes this checklist item.",
          record.claim,
          record.reference,
          record.declaration,
        ),
      );
    }
  }

  /**
   * Names deferred declaration state within one configured claim occurrence.
   *
   * Source inventories can be reused verbatim by several claims, so a raw
   * declaration ID cannot distinguish their independent policy outcomes.
   */
  private declarationKey(claim: number, declarationId: string): string {
    return JSON.stringify([claim, declarationId]);
  }

  /**
   * Creates a successful inactive obligation without evaluating coverage.
   *
   * The configured unit IDs are retained for query reporting, but no selected,
   * covered, or missing population is claimed while its policy is disabled.
   */
  private inactiveObligation(
    claim: number,
    reference: number,
    input: IEvidenceGraphReference,
  ): IEvidenceGraphObligation {
    return this.obligation(
      claim,
      reference,
      false,
      true,
      input.unitIds,
      [],
      [],
    );
  }

  /**
   * Creates an active but incomplete obligation after analysis failure.
   *
   * It retains configured IDs for inspection while leaving coverage sets empty,
   * preventing callers from interpreting a partial traversal as an uncovered or
   * successfully covered population.
   */
  private incompleteObligation(
    claim: number,
    reference: number,
    input: IEvidenceGraphReference,
  ): IEvidenceGraphObligation {
    return this.obligation(
      claim,
      reference,
      input.severity !== "off",
      false,
      input.unitIds,
      [],
      [],
    );
  }

  /**
   * Builds the report record for one configured claim/reference obligation.
   *
   * All paths use this constructor so active and completeness flags, configured
   * coordinates, coverage sets, accepted acknowledgement edges, and optional
   * host-local checklist coverage remain aligned in exported graph results.
   */
  private obligation(
    claim: number,
    reference: number,
    active: boolean,
    complete: boolean,
    unitIds: string[],
    coveredUnitIds: string[],
    missingUnitIds: string[],
    edges: IEvidenceGraphEdge[] = [],
    hostCoverage: IEvidenceGraphHostCoverage[] = [],
  ): IEvidenceGraphObligation {
    return {
      claim: this.claimIndex(claim),
      reference: this.referenceIndex(claim, reference),
      active,
      complete,
      unitIds,
      coveredUnitIds,
      missingUnitIds,
      edges,
      hostCoverage,
    };
  }
}
