import type { IEvidenceSourceFile } from "../structures/IEvidenceSourceFile";
import type { IEvidenceSourceAddress } from "../structures/IEvidenceSourceAddress";
import { EvidenceGraphClaimIndex } from "./EvidenceGraphClaimIndex";
import { EvidenceGraphEdgeIndex } from "./EvidenceGraphEdgeIndex";
import { EvidenceGraphReviewIndex } from "./EvidenceGraphReviewIndex";
import type { IEvidenceGraphClaimContext } from "../contexts/IEvidenceGraphClaimContext";
import type { IEvidenceGraphReferenceContext } from "../contexts/IEvidenceGraphReferenceContext";
import typia from "typia";

import { EvidenceFileTarget } from "../targets/EvidenceFileTarget";
import { EvidenceAnalysisIndexes } from "./EvidenceAnalysisIndexes";
import type { EvidenceInventoryIndex } from "./EvidenceInventoryIndex";
import type { IEvidencePublicAddress } from "../structures/IEvidencePublicAddress";
import type { IEvidenceHost } from "../structures/IEvidenceHost";
import type { IEvidenceReview } from "../structures/IEvidenceReview";
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
 * Evaluates one immutable graph input with claim-local participation and
 * independent reference policies.
 *
 * @evidence contracts/common.md#principled-implementation Each traversal owns accumulators, reconciles borrowed records with structural copies, settles deferred participation and applies coverage and review policies without mutating input.
 * @evidence contracts/common.md#clear-and-simple-design The evaluator owns traversal state; inventory reconciliation, fingerprinting, conflict and review joins have dedicated indexes.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Reference policies remain independent and incomplete inventories still fail; indexed joins retain accepted-edge and original review order.
 * @evidence contracts/common.md#meaningful-documentation The evaluator comment explains claim and reference boundaries; field and method comments document local accumulators, deferred findings and result ownership.
 * @evidence contracts/performance.md#efficient-algorithms Views and diagnostic addresses are indexed once per inventory; selection ancestry and policy relations replace unrelated cross-product scans, while output-sized host checklist relations remain necessary.
 * @evidence contracts/performance.md#reuse-equivalent-work One cache serves equivalent inventories within this evaluation; no state is reused by later evaluations.
 * @evidence contracts/performance.md#bound-retention-and-release-resources All indexes and accumulators belong to this evaluation and are released with it; returned graph records are owned by the caller boundary.
 */
export class EvidenceGraphEvaluator {
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

  /** Reconciled views shared only within this evaluation. */
  private readonly indexes: EvidenceAnalysisIndexes =
    new EvidenceAnalysisIndexes();

  /** Preferred diagnostic addresses cached once per immutable inventory view. */
  /** Claim-wide statement and host indexes shared across its references. */
  private readonly claimIndexes: WeakMap<
    IEvidenceGraphClaimContext,
    EvidenceGraphClaimIndex
  > = new WeakMap();

  /** Units indexed only when diagnostic rendering needs reverse identity lookup. */
  private readonly displayUnits: WeakMap<
    IEvidenceInventory,
    Map<string, IEvidenceUnit>
  > = new WeakMap();
  private readonly displays: WeakMap<IEvidenceInventory, Map<string, string>> =
    new WeakMap();

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
   * Evaluates each independent claim before finalizing cross-reference
   * participation findings.
   *
   * @evidence contracts/common.md#principled-implementation Fresh accumulators collect claim results, finalize unhosted checklists and deduplicate diagnostics; every active population must be complete.
   * @evidence contracts/common.md#clear-and-simple-design The evaluator owns traversal state; inventory reconciliation, fingerprinting, conflict and review joins have dedicated indexes.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Reference policies remain independent and incomplete inventories still fail; indexed joins retain accepted-edge and original review order.
   * @evidence contracts/common.md#meaningful-documentation The evaluator comment explains claim and reference boundaries; field and method comments document local accumulators, deferred findings and result ownership.
   * @evidence contracts/performance.md#efficient-algorithms Traverses claims and their indexed policy relations plus result-sized diagnostics and coverage records.
   * @evidence contracts/performance.md#reuse-equivalent-work Inventory, address and fingerprint indexes are reused only within this evaluation.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The owning traversal releases its indexes after returning the result.
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
    const inventory: EvidenceInventoryIndex = this.indexes.inventory(
      claim.inventory,
    );
    const snapshot: IEvidenceInventory = {
      ...inventory.snapshot(),
      diagnostics: [...inventory.snapshot().diagnostics],
    };
    const population = inventory.select(claim.unitIds);
    const detachedHostUnits: ReadonlyMap<string, string> =
      this.detachedHostUnits(claim, snapshot, population);
    const context: IEvidenceGraphClaimContext = {
      claim,
      inventory: snapshot,
      population,
      detachedHostUnits,
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
   * Borrows the immutable statement and host relations shared by one claim's
   * references.
   */
  private claimRecords(
    context: IEvidenceGraphClaimContext,
  ): EvidenceGraphClaimIndex {
    let records: EvidenceGraphClaimIndex | undefined =
      this.claimIndexes.get(context);
    if (records === undefined) {
      records = new EvidenceGraphClaimIndex(context);
      this.claimIndexes.set(context, records);
    }
    return records;
  }

  /**
   * Validates physical Markdown bindings before allowing them to own evidence.
   *
   * A binding must name an attached Markdown carrier and a visible selected
   * original unit. Conflicting or fabricated relations make the claim
   * incomplete, preventing direct graph callers from projecting evidence onto
   * an arbitrary declaration.
   */
  private detachedHostUnits(
    claim: IEvidenceGraphClaim,
    inventory: IEvidenceInventory,
    population: IEvidencePopulation,
  ): ReadonlyMap<string, string> {
    const bindings: Map<string, string> = new Map<string, string>();
    if ((claim.detachedHostBindings?.length ?? 0) === 0) return bindings;
    const hosts = new Map(inventory.hosts.map((host) => [host.id, host]));
    const units = new Map(inventory.units.map((unit) => [unit.id, unit]));
    const selected: Set<string> = new Set<string>(
      population.units.map((unit) => unit.id),
    );
    for (const binding of claim.detachedHostBindings ?? []) {
      const host = hosts.get(binding.hostId);
      const previous = bindings.get(binding.hostId);
      if (
        host?.attachment === "attached" &&
        host.unitIds.length === 1 &&
        host.unitIds.every((id) => units.get(id)?.type === "markdown") &&
        selected.has(binding.unitId) &&
        (previous === undefined || previous === binding.unitId)
      ) {
        bindings.set(binding.hostId, binding.unitId);
        continue;
      }
      inventory.complete = false;
      inventory.diagnostics.push({
        code: "graph-detached-host-binding",
        severity: "error",
        message:
          "Detached evidence binding has no attached Markdown carrier and unique selected claim unit.",
        repair:
          "Rebuild detached host bindings from resolved H1 claim addresses.",
        ...(host === undefined
          ? {}
          : { location: { file: host.file, range: host.range } }),
        hostId: binding.hostId,
        unitId: binding.unitId,
      });
    }
    return bindings;
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
    const inventory: EvidenceInventoryIndex = this.indexes.inventory(
      reference.inventory,
      true,
    );
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
      this.claimRecords(context).declarations,
      reference,
      claimIndex,
      referenceIndex,
    );
    const reviewResolutions = this.reviewResolutions(
      this.claimRecords(context).reviews,
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
      claim: { index: claimIndex },
      reference,
      index: referenceIndex,
      inventory: referenceInventory,
      population: referencePopulation,
      resolutions,
    } = context;
    const records: EvidenceGraphClaimIndex = this.claimRecords(context.claim);
    const declarations: Map<string, IEvidenceDeclaration> =
      records.declarations;
    const selectedHosts: Map<string, string[]> = records.selectedHosts;
    const exclusionHosts: Set<string> = records.exclusionHosts;
    const units = new Map(
      referenceInventory.units.map((unit) => [unit.id, unit]),
    );
    const selectedUnits = referencePopulation.units;
    const selectedUnitIds = new Set(selectedUnits.map((unit) => unit.id));
    const scopeIds = new Set(referencePopulation.scopes.map((unit) => unit.id));
    const descendants: Map<string, string[]> = new Map();
    for (const unit of selectedUnits) {
      let current: IEvidenceUnit | undefined = unit;
      const visited: Set<string> = new Set();
      while (current !== undefined && !visited.has(current.id)) {
        visited.add(current.id);
        const entries: string[] = descendants.get(current.id) ?? [];
        entries.push(unit.id);
        descendants.set(current.id, entries);
        current =
          current.parentId === undefined
            ? undefined
            : units.get(current.parentId);
      }
    }
    const checklist = reference.checklist === true;
    const explainedByHost = new Map<string, Set<string>>();
    const covered = new Set<string>();
    const edges: IEvidenceGraphEdge[] = [];
    const edgeIndex: EvidenceGraphEdgeIndex = new EvidenceGraphEdgeIndex(
      edges,
      reference,
    );
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
      let unitIds: string[] = descendants.get(target.id) ?? [];
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
        edgeIndex,
        declarations,
        reference.severity,
        claimIndex,
        referenceIndex,
      );
      const edge: IEvidenceGraphEdge = {
        declarationId: declaration.id,
        hostId: declaration.hostId,
        hostUnitIds,
        kind: declaration.kind,
        targetUnitId: target.id,
        unitIds: [...unitIds],
        fingerprint: this.indexes
          .fingerprint(referenceInventory)
          .inspect(target.id).fingerprint,
      };
      edges.push(edge);
      edgeIndex.add(edge);
      this.answeredDeclarations.add(
        this.declarationKey(claimIndex, declaration.id),
      );
      if (!checklist) for (const id of unitIds) covered.add(id);
    }
    this.evaluateReviews(context, edges);
    if (checklist)
      return this.checklistObligation(context, edges, explainedByHost);
    this.cardinality(context, edgeIndex);
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
    const hostSets: Set<string>[] = [...coveredByHost.values()];
    const coveredUnitIds: string[] = selectedUnits
      .filter((unit: IEvidenceUnit): boolean =>
        hostSets.every((host: Set<string>): boolean => host.has(unit.id)),
      )
      .map((unit: IEvidenceUnit): string => unit.id);
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
    edgeIndex: EvidenceGraphEdgeIndex,
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
    if (reference.singleEvidencePerSymbol === true)
      for (const host of claimPopulation.units) {
        const cited: ReadonlySet<string> =
          edgeIndex.hostTargets.get(host.id) ?? new Set();
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
        const hosts: ReadonlySet<string> =
          edgeIndex.unitHosts.get(unit.id) ?? new Set();
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
    edgeIndex: EvidenceGraphEdgeIndex,
    declarations: Map<string, IEvidenceDeclaration>,
    severity: EvidenceSeverity,
    claimIndex: number,
    referenceIndex: number,
  ): void {
    if (declaration.kind === "evidence") {
      const duplicate: boolean = edgeIndex.duplicate(targetUnitId, hostUnitIds);
      if (duplicate)
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
    const opposite: IEvidenceGraphEdge | undefined = edgeIndex.first(
      declaration.kind === "evidence" ? "evidenceExclude" : "evidence",
      unitIds,
      hostUnitIds,
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
      const duplicate: IEvidenceGraphEdge | undefined = edgeIndex.first(
        "evidenceExclude",
        unitIds,
        hostUnitIds,
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
      claim: { index: claimIndex },
      reference,
      index: referenceIndex,
      inventory: referenceInventory,
      population: referencePopulation,
      resolutions: declarationResolutions,
      reviewResolutions,
    } = context;
    if (reviewResolutions.length === 0 && reference.requireReview !== true)
      return;
    const claimRecords: EvidenceGraphClaimIndex = this.claimRecords(
      context.claim,
    );
    const declarations: Map<string, IEvidenceDeclaration> =
      claimRecords.declarations;
    const reviews: Map<string, IEvidenceReview> = claimRecords.reviews;
    const hosts: Map<string, IEvidenceHost> = claimRecords.hosts;
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
      const detachedUnitId: string | undefined =
        context.claim.detachedHostUnits.get(declaration.hostId);
      acknowledgements.push({
        declaration,
        hostUnitIds:
          detachedUnitId !== undefined
            ? [detachedUnitId]
            : host?.attachment === "attached"
              ? host.unitIds
              : [],
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
      const detachedUnitId: string | undefined =
        context.claim.detachedHostUnits.get(review.hostId);
      const hostUnitIds =
        detachedUnitId !== undefined
          ? [detachedUnitId]
          : host?.attachment === "attached"
            ? host.unitIds
            : [];
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
    const pairs: EvidenceGraphReviewIndex = new EvidenceGraphReviewIndex(
      acknowledgements,
      records,
    );
    for (const record of records) {
      const matching: boolean =
        pairs.acknowledgement(record, record.review.reviews) !== undefined;
      if (matching) continue;
      const opposite: IEvidenceResolvedAcknowledgement | undefined =
        pairs.acknowledgement(
          record,
          record.review.reviews === "evidence" ? "evidenceExclude" : "evidence",
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
      const review: IEvidenceReview | undefined = pairs.review(
        edge.kind,
        edge.targetUnitId,
        edge.hostId,
        edge.hostUnitIds,
      )?.review;
      const marker = this.reviewMarker(edge.kind);
      const declaration: IEvidenceDeclaration | undefined = declarations.get(
        edge.declarationId,
      );
      if (review === undefined) {
        const wrongKind: boolean =
          pairs.review(
            edge.kind === "evidence" ? "evidenceExclude" : "evidence",
            edge.targetUnitId,
            edge.hostId,
            edge.hostUnitIds,
          ) !== undefined;
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
   * Selects the review marker required by an acknowledgement kind.
   *
   * Keeping this mapping in one place makes diagnostics and repair text agree
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
    let units: Map<string, IEvidenceUnit> | undefined =
      this.displayUnits.get(inventory);
    if (units === undefined) {
      units = new Map(
        inventory.units.map((entry: IEvidenceUnit): [string, IEvidenceUnit] => [
          entry.id,
          entry,
        ]),
      );
      this.displayUnits.set(inventory, units);
    }
    const unit: IEvidenceUnit | undefined = units.get(id);
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
    declarations: Map<string, IEvidenceDeclaration>,
    reference: IEvidenceGraphReference,
    claimIndex: number,
    referenceIndex: number,
  ): IEvidenceGraphResolution[] {
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
    reviews: Map<string, IEvidenceReview>,
    reference: IEvidenceGraphReference,
    claimIndex: number,
    referenceIndex: number,
  ): IEvidenceGraphReviewResolution[] {
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
   * Formats the preferred public address of a semantic unit for diagnostics.
   *
   * An address from a selected source is preferred so the repair text reflects
   * the configured population. If no public address exists, the semantic name
   * remains a useful fallback for invalid or partially extracted inventory
   * data.
   */
  private display(inventory: IEvidenceInventory, unit: IEvidenceUnit): string {
    let names: Map<string, string> | undefined = this.displays.get(inventory);
    if (names === undefined) {
      names = new Map<string, string>();
      const selectedFiles: Set<string> = new Set(
        inventory.sources.flatMap((source: IEvidenceSourceFile): string[] =>
          source.addresses.flatMap(
            (address: IEvidenceSourceAddress): string[] =>
              address.selected === false
                ? []
                : [EvidenceFileTarget.normalize(address.absolute)],
          ),
        ),
      );
      const preferred: Map<string, IEvidencePublicAddress> = new Map();
      const keys: Map<IEvidencePublicAddress, string> = new Map();
      for (const candidate of inventory.addresses) {
        const previous: IEvidencePublicAddress | undefined = preferred.get(
          candidate.unitId,
        );
        const key: string = JSON.stringify([
          candidate.file,
          candidate.segments,
        ]);
        keys.set(candidate, key);
        const selected: boolean = selectedFiles.has(
          EvidenceFileTarget.normalize(candidate.file),
        );
        const priorSelected: boolean =
          previous !== undefined &&
          selectedFiles.has(EvidenceFileTarget.normalize(previous.file));
        if (
          previous === undefined ||
          (selected && !priorSelected) ||
          (selected === priorSelected &&
            EvidenceInventoryMerge.compare(key, keys.get(previous) ?? "") < 0)
        )
          preferred.set(candidate.unitId, candidate);
      }
      for (const [id, address] of preferred)
        names.set(
          id,
          address.segments.length === 0
            ? address.file
            : EvidenceFileTarget.format(address),
        );
      this.displays.set(inventory, names);
    }
    return names.get(unit.id) ?? unit.name;
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
      [...input.unitIds],
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
      [...input.unitIds],
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
