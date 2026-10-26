import { EvidenceSourceAcquisition } from "../internal/EvidenceSourceAcquisition";
import { EvidenceTargetFileIndex } from "../internal/EvidenceTargetFileIndex";
import { EvidenceGraphEvaluator } from "../internal/EvidenceGraphEvaluator";
import { EvidenceAnalysisIndexes } from "../internal/EvidenceAnalysisIndexes";
import { EvidenceSourceLoader } from "../loaders/EvidenceSourceLoader";
import { EvidenceInventoryIndex } from "../internal/EvidenceInventoryIndex";
import { EvidenceDetachedEvidence } from "../internal/EvidenceDetachedEvidence";
import { EvidenceSwaggerAdapter } from "../adapters/swagger/EvidenceSwaggerAdapter";
import type { EvidenceTargetResolverIndex } from "../internal/EvidenceTargetResolverIndex";
import { EvidenceAdapterFactory } from "../internal/EvidenceAdapterFactory";
import { EvidenceStatementOwnership } from "../internal/EvidenceStatementOwnership";
import { EvidenceTargetApplicability } from "../internal/EvidenceTargetApplicability";
import { EvidenceFileGlob } from "../internal/EvidenceFileGlob";
import type { IEvidenceMaterializedClaim } from "../internal/IEvidenceMaterializedClaim";
import type { IEvidenceMaterializedReference } from "../internal/IEvidenceMaterializedReference";
import type { IEvidenceCheckAnalysis } from "../structures/IEvidenceCheckAnalysis";
import type { IEvidenceCheckClaim } from "../structures/IEvidenceCheckClaim";
import type { IEvidenceCheckCounts } from "../structures/IEvidenceCheckCounts";
import type { IEvidenceCheckObligation } from "../structures/IEvidenceCheckObligation";
import type { IEvidenceCheckReport } from "../structures/IEvidenceCheckReport";
import type { IEvidenceClaim } from "../structures/IEvidenceClaim";
import type { IEvidenceConfigPlan } from "../structures/IEvidenceConfigPlan";
import type { IEvidenceConfigPlanClaim } from "../structures/IEvidenceConfigPlanClaim";
import type { IEvidenceDiagnostic } from "../structures/IEvidenceDiagnostic";
import type { IEvidenceGraphClaim } from "../structures/IEvidenceGraphClaim";
import type { IEvidenceGraphInput } from "../structures/IEvidenceGraphInput";
import type { IEvidenceGraphReference } from "../structures/IEvidenceGraphReference";
import type { IEvidenceGraphResolution } from "../structures/IEvidenceGraphResolution";
import type { IEvidenceGraphResult } from "../structures/IEvidenceGraphResult";
import type { IEvidenceGraphReviewResolution } from "../structures/IEvidenceGraphReviewResolution";
import type { IEvidenceHost } from "../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
import type { IEvidenceReference } from "../structures/IEvidenceReference";
import type { EvidenceSymbol } from "../typings/EvidenceSymbol";

import type { IEvidenceCheckContext } from "../contexts/IEvidenceCheckContext";
import type { IEvidenceClaimContext } from "../contexts/IEvidenceClaimContext";

/**
 * Turns a validated check plan into inventories, graph input, and a command
 * report.
 *
 * This namespace is the orchestration boundary between configuration and graph
 * evaluation. It keeps every configured reference independent, so the same
 * population can appear in several obligations without sharing a resolution or
 * silently discharging coverage in another claim.
 *
 * @example
 *   const claims = await EvidenceCheckProgrammer.materialize(plan);
 *   const analysis = await EvidenceCheckProgrammer.evaluate({
 *     plan,
 *     claims,
 *   });
 *
 * @evidence contracts/common.md#principled-implementation Orchestration materializes claim and reference inventories, prepares per-reference resolutions, settles statement ownership, evaluates the graph, and summarizes a report while keeping every reference independent.
 * @evidence contracts/common.md#clear-and-simple-design The namespace is the boundary between configuration and evaluation; loading, ownership, graph policy and reporting are delegated.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Repeated populations never share a resolution or discharge coverage in another claim.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains the orchestration with an example; private helpers are documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceCheckProgrammer {
  /**
   * Materializes every active claim and the reference populations it owns.
   *
   * The returned array retains the configuration-plan order because evaluation
   * and reporting use positions as stable claim coordinates. Loading is allowed
   * to run concurrently, but each materialized reference remains attached to
   * exactly the claim entry that declared it. Separate Markdown evidence is
   * bound to original claim units, and an H1 is orphaned only if no
   * participating claim selects it.
   *
   * @evidence contracts/common.md#principled-implementation Each active claim and its references are loaded concurrently through the owning adapter; detached Markdown is bound to selected claim units and shared H1 owners are checked after every claim loads.
   * @evidence contracts/common.md#clear-and-simple-design Per-claim loading and unit selection are private helpers.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Selection uses only configured symbol kinds, so structural ancestors never become extra obligations.
   * @evidence contracts/common.md#meaningful-documentation The comment explains ordering, concurrent loading and shared detached owner validation.
   * @evidence contracts/performance.md#efficient-algorithms Loads run concurrently; cross-claim orphan detection scans the resolved H1 records once per claim.
   * @evidence contracts/performance.md#reuse-equivalent-work Populations with the same type, root and file selection share one immutable load within a materialization; claim-local diagnostic arrays are copied before appending, so identical selections are scanned and parsed once.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Inventories are owned by the returned claims; adapters and collectors release their resources before returning. The shared-load map is local to one call and released when it returns.
   */
  export async function materialize(
    plan: IEvidenceConfigPlan,
  ): Promise<IEvidenceMaterializedClaim[]> {
    if (EvidenceSourceAcquisition.current() === undefined)
      return EvidenceSourceAcquisition.run(
        (): Promise<IEvidenceMaterializedClaim[]> => materialize(plan),
      );
    // Several claims and references often select the same files. Load each
    // distinct selection once. Claim-local findings use a separate diagnostic
    // array so source, unit and annotation records stay immutable.
    const loads: Map<string, Promise<IEvidenceInventory>> = new Map();
    function loader(
      population: IEvidenceClaim | IEvidenceReference,
    ): Promise<IEvidenceInventory> {
      return shared(loads, plan.configFile, population);
    }
    const claims: IEvidenceMaterializedClaim[] = await Promise.all(
      plan.claims.map((claim) =>
        materializeClaim(loader, plan.configFile, claim),
      ),
    );
    const selectedOwners: Set<string> = new Set<string>(
      claims.flatMap((claim: IEvidenceMaterializedClaim): string[] =>
        (claim.detachedOwners ?? []).flatMap((owner): string[] =>
          owner.unitId === undefined ? [] : [owner.key],
        ),
      ),
    );
    const reportedOwners: Set<string> = new Set<string>();
    const completeClaims: Set<IEvidenceMaterializedClaim> = new Set(
      claims.filter(
        (claim: IEvidenceMaterializedClaim): boolean =>
          claim.inventory.complete,
      ),
    );
    for (const claim of claims)
      for (const owner of claim.detachedOwners ?? []) {
        if (
          owner.unitId !== undefined ||
          selectedOwners.has(owner.key) ||
          reportedOwners.has(owner.key) ||
          !completeClaims.has(claim)
        )
          continue;
        claim.inventory = {
          ...claim.inventory,
          diagnostics: [...claim.inventory.diagnostics],
        };
        claim.inventory.diagnostics.push({
          code: "evidence-files-owner",
          severity: "error",
          message: `H1 owner '${owner.target}' does not name one selected claim unit (${owner.status}).`,
          repair:
            "Use a file-qualified address of a unit selected by a claim using this evidence file.",
          location: owner.location,
        });
        claim.inventory.complete = false;
        reportedOwners.add(owner.key);
      }
    return claims;
  }

  /**
   * Prepares graph input and evaluates the checker result for one execution.
   *
   * Preparation resolves annotations against each independent reference
   * boundary before {@link EvidenceGraph.evaluate} applies coverage policy. The
   * returned analysis deliberately retains both graph input and graph output so
   * query commands can explain the result without rebuilding or reloading
   * inventories.
   *
   * @evidence contracts/common.md#principled-implementation Claims are opened and closed into graph claims with prepared resolutions, statement ownership is settled across claims, non-participating annotations are reported, and the graph is evaluated.
   * @evidence contracts/common.md#clear-and-simple-design Preparation helpers, ownership and graph evaluation are separate steps; evaluate sequences them.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Ownership is settled before participation so one claim cannot report another claim's citation as its own error.
   * @evidence contracts/common.md#meaningful-documentation The comment explains why input and output are both retained; the inline comment explains ownership ordering.
   * @evidence contracts/performance.md#efficient-algorithms Linear in statements and resolutions per claim, plus graph evaluation.
   * @evidence contracts/performance.md#reuse-equivalent-work Claim-local indexes are built once and shared by every reference of the claim.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Claim contexts are local; the returned analysis is owned by the caller.
   */
  export async function evaluate(
    context: IEvidenceCheckContext,
  ): Promise<IEvidenceCheckAnalysis> {
    const indexes: EvidenceAnalysisIndexes = new EvidenceAnalysisIndexes();
    const files: EvidenceTargetFileIndex = new EvidenceTargetFileIndex();
    const contexts: IEvidenceClaimContext[] = context.claims.map(
      (claim: IEvidenceMaterializedClaim): IEvidenceClaimContext =>
        openClaim(claim, files),
    );
    const claims: IEvidenceGraphClaim[] = await Promise.all(
      contexts.map(
        (claim: IEvidenceClaimContext): Promise<IEvidenceGraphClaim> =>
          closeClaim(claim, indexes),
      ),
    );
    // Claims that read the same host files see the same annotations. Settle
    // which claim answers for each before participation is judged, so one claim
    // does not report another claim's citation as its own error.
    EvidenceStatementOwnership.release(contexts, claims);
    for (const prepared of contexts)
      reportNonParticipating(
        prepared.inventory,
        prepared.declarations,
        prepared.reviews,
      );
    const graphInput: IEvidenceGraphInput = { claims };
    const graph: IEvidenceGraphResult = new EvidenceGraphEvaluator(
      graphInput,
    ).evaluate();
    return { graphInput, graph, report: report(context.plan, graph) };
  }

  /**
   * Summarizes retained report boundaries and findings.
   *
   * Full and focused checks share active-obligation and severity aggregation;
   * presentation windows are applied after these totals are established.
   *
   * @evidence contracts/common.md#principled-implementation Counts are aggregated from report claims and diagnostics with the same rules for full and focused checks.
   * @evidence contracts/common.md#clear-and-simple-design Summarizing delegates to the private count helper shared with report construction.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Totals are computed before any presentation window is applied.
   * @evidence contracts/common.md#meaningful-documentation The comment explains sharing between full and focused checks.
   * @evidence contracts/performance.md#efficient-algorithms Linear in obligations and diagnostics.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each report computes its own totals.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function summarize(
    claims: IEvidenceCheckClaim[],
    diagnostics: IEvidenceDiagnostic[],
  ): IEvidenceCheckCounts {
    return checkCounts(claims, diagnostics);
  }

  /**
   * Orders findings by configured boundary, source coordinate, and identity.
   *
   * Returns a new array so focused checks can merge resolution failures without
   * changing the original graph report's deterministic diagnostic order.
   *
   * @evidence contracts/common.md#principled-implementation Diagnostics are sorted by configured boundary, source coordinate and identity into a new array.
   * @evidence contracts/common.md#clear-and-simple-design Ordering reuses the private comparator used for full reports.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts The original report order is never mutated.
   * @evidence contracts/common.md#meaningful-documentation The comment explains returning a new array.
   * @evidence contracts/performance.md#efficient-algorithms O(n log n) for n diagnostics.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Ordering is per report.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function orderDiagnostics(
    diagnostics: IEvidenceDiagnostic[],
  ): IEvidenceDiagnostic[] {
    return [...diagnostics].sort(compareDiagnostics);
  }

  /**
   * Loads a claim inventory and every reference inventory declared beneath it.
   *
   * All paths are resolved from the single configuration file, even though the
   * loads run concurrently. This produces selected unit identifiers only; it
   * does not add visible structural ancestors, which are a query-layer
   * concern.
   */
  async function materializeClaim(
    loader: (
      population: IEvidenceClaim | IEvidenceReference,
    ) => Promise<IEvidenceInventory>,
    configFile: string,
    plan: IEvidenceConfigPlanClaim,
  ): Promise<IEvidenceMaterializedClaim> {
    const [inventory, references, detached] = await Promise.all([
      loader(plan.population),
      Promise.all(
        plan.references.map(async (reference) => {
          const referenceInventory = await loader(reference.population);
          return {
            plan: reference,
            inventory: referenceInventory,
            unitIds: selectUnitIds(referenceInventory, reference.symbols),
          } satisfies IEvidenceMaterializedReference;
        }),
      ),
      plan.population.evidenceFiles === undefined
        ? Promise.resolve(undefined)
        : loader({ type: "markdown", files: plan.population.evidenceFiles }),
    ]);
    const unitIds: string[] = selectUnitIds(inventory, plan.symbols);
    const separate =
      detached === undefined
        ? undefined
        : await EvidenceDetachedEvidence.bind(
            configFile,
            plan.population,
            inventory,
            unitIds,
            detached,
          );
    return {
      plan,
      inventory:
        separate === undefined
          ? inventory
          : new EvidenceInventoryIndex([
              inventory,
              separate.inventory,
            ]).snapshot(),
      unitIds,
      ...(separate === undefined
        ? {}
        : {
            detachedHostBindings: separate.bindings,
            detachedOwners: separate.owners,
          }),
      ...(plan.population.evidenceExcludeCarriers === undefined
        ? {}
        : {
            exclusionHostIds: selectExclusionHosts(
              inventory,
              plan.population.evidenceExcludeCarriers,
            ),
          }),
      references,
    };
  }

  /**
   * Loads a population once per distinct selection and borrows its immutable
   * records.
   *
   * The key is everything that decides adapter input: artifact type, root, and
   * the file globs or Swagger document. Equal keys within one materialization
   * share a single load, and consumers borrow records; claim preparation copies
   * its diagnostic array.
   */
  async function shared(
    loads: Map<string, Promise<IEvidenceInventory>>,
    configFile: string,
    population: IEvidenceClaim | IEvidenceReference,
  ): Promise<IEvidenceInventory> {
    const key: string = JSON.stringify([
      population.type,
      population.root ?? null,
      "files" in population ? population.files : null,
      "file" in population ? population.file : null,
    ]);
    let pending: Promise<IEvidenceInventory> | undefined = loads.get(key);
    if (pending === undefined) {
      pending = load(configFile, population);
      loads.set(key, pending);
    }
    return pending;
  }

  /**
   * Loads one configured population through the adapter that owns its artifact
   * grammar.
   *
   * File-backed Swagger is exceptional because its adapter owns direct document
   * loading. Every other population first expands source globs relative to the
   * configuration file, then transfers the resulting source snapshot to the
   * selected adapter for analysis.
   */
  async function load(
    configFile: string,
    population: IEvidenceClaim | IEvidenceReference,
  ): Promise<IEvidenceInventory> {
    if (population.type === "swagger" && "file" in population)
      return new EvidenceSwaggerAdapter().load(
        configFile,
        population.file,
        population.root,
      );
    const adapter = EvidenceAdapterFactory.create(population.type);
    return adapter.analyze(
      await EvidenceSourceLoader.glob(configFile, {
        ...(population.root === undefined ? {} : { root: population.root }),
        files: population.files,
      }),
    );
  }

  /**
   * Selects configured semantic identities from an inventory.
   *
   * The configuration's symbol kinds are the only selection criterion. Keeping
   * this result free of parent identities prevents graph coverage from treating
   * a structural ancestor as an independently configured obligation.
   */
  function selectUnitIds(
    inventory: IEvidenceInventory,
    symbols: EvidenceSymbol[],
  ): string[] {
    const selected = new Set(symbols);
    return inventory.units
      .filter((unit) => selected.has(unit.symbol))
      .map((unit) => unit.id);
  }

  /**
   * Selects documentation hosts whose source files match exclusion-carrier
   * globs.
   *
   * Matching starts from selected logical addresses, then maps their physical
   * files back to hosts. This lets aliases share one exclusion decision while
   * avoiding exclusions from an unselected logical source address.
   */
  function selectExclusionHosts(
    inventory: IEvidenceInventory,
    patterns: string[],
  ): string[] {
    const globs = new EvidenceFileGlob(patterns);
    const files = new Set(
      inventory.sources.flatMap((source) =>
        source.addresses.some(
          (address) =>
            address.selected !== false && globs.matches(address.relative),
        )
          ? [source.physicalPath]
          : [],
      ),
    );
    return inventory.hosts
      .filter((host) => files.has(host.file))
      .map((host) => host.id);
  }

  /**
   * Clones a claim inventory and records where each annotation can apply.
   *
   * The clone later receives preparation diagnostics so the materialized
   * inventory can still serve as the unmodified loading result. Declaration and
   * review indexes record eligible reference positions before any target is
   * resolved, ensuring an annotation is only evaluated where its grammar and
   * host can participate. Participation is judged afterward, because it depends
   * on the other claims that read the same annotation.
   */
  function openClaim(
    materialized: IEvidenceMaterializedClaim,
    files: EvidenceTargetFileIndex,
  ): IEvidenceClaimContext {
    const inventory: IEvidenceInventory = {
      ...materialized.inventory,
      diagnostics: [...materialized.inventory.diagnostics],
    };
    const context: IEvidenceClaimContext = {
      materialized,
      inventory,
      hosts: new Map(inventory.hosts.map((host) => [host.id, host])),
      declarations: new Map<string, Set<number>>(),
      reviews: new Map<string, Set<number>>(),
    };
    const { hosts, declarations, reviews } = context;

    // Record applicability before resolution so an incompatible target becomes
    // one useful diagnostic instead of one resolution failure per reference.
    for (const declaration of inventory.declarations)
      declarations.set(
        declaration.id,
        applicable(
          declaration,
          requireHost(hosts, declaration.hostId),
          materialized.references,
          files,
        ),
      );
    for (const review of inventory.reviews)
      reviews.set(
        review.id,
        applicable(
          review,
          requireHost(hosts, review.hostId),
          materialized.references,
          files,
        ),
      );
    return context;
  }

  /**
   * Builds the graph claim whose references resolve the opened annotations.
   *
   * Every reference resolves only the annotations eligible for its position, so
   * the result can still hold resolutions that another claim owns. The caller
   * withdraws those before evaluation.
   */
  async function closeClaim(
    context: IEvidenceClaimContext,
    indexes: EvidenceAnalysisIndexes,
  ): Promise<IEvidenceGraphClaim> {
    const { materialized, inventory } = context;
    return {
      index: materialized.plan.index,
      ...(materialized.plan.population.name === undefined
        ? {}
        : { name: materialized.plan.population.name }),
      severity: materialized.plan.severity,
      inventory,
      unitIds: materialized.unitIds,
      ...(materialized.detachedHostBindings === undefined
        ? {}
        : { detachedHostBindings: materialized.detachedHostBindings }),
      ...(materialized.exclusionHostIds === undefined
        ? {}
        : { exclusionHostIds: materialized.exclusionHostIds }),
      references: await Promise.all(
        materialized.references.map((reference, position) =>
          prepareReference(context, reference, position, indexes),
        ),
      ),
    };
  }

  /**
   * Maps one annotation to the reference positions whose target grammar accepts
   * it.
   *
   * Positions, rather than reference identities, preserve duplicate configured
   * references as separate obligations. The returned set is later consulted by
   * both acknowledgement and review preparation.
   */
  function applicable(
    statement: Parameters<typeof EvidenceTargetApplicability.select>[0],
    host: IEvidenceHost,
    references: IEvidenceMaterializedReference[],
    files: EvidenceTargetFileIndex,
  ): Set<number> {
    return new Set(
      EvidenceTargetApplicability.select(
        statement,
        host,
        references,
        files,
      ).map((selected: IEvidenceMaterializedReference): number =>
        references.indexOf(selected),
      ),
    );
  }

  /**
   * Builds one graph reference from the claim annotations eligible for this
   * position.
   *
   * A resolver sees only this reference inventory and its selected unit IDs.
   * That isolation is essential: the same textual target may resolve
   * differently in another reference population, and a review remains
   * independent of an acknowledgement that happens to cover the same identity.
   */
  async function prepareReference(
    context: IEvidenceClaimContext,
    materialized: IEvidenceMaterializedReference,
    position: number,
    indexes: EvidenceAnalysisIndexes,
  ): Promise<IEvidenceGraphReference> {
    const { inventory: claim, hosts, declarations, reviews } = context;
    const resolver: EvidenceTargetResolverIndex = indexes.resolver(
      materialized.inventory,
      materialized.plan.population.type,
    );
    const resolutions: IEvidenceGraphResolution[] = await Promise.all(
      claim.declarations.flatMap((declaration) =>
        selected(declarations, declaration.id, position)
          ? [
              resolveDeclaration(
                resolver,
                declaration,
                requireHost(hosts, declaration.hostId),
                materialized.unitIds,
              ),
            ]
          : [],
      ),
    );
    const reviewResolutions: IEvidenceGraphReviewResolution[] =
      await Promise.all(
        claim.reviews.flatMap((review) =>
          selected(reviews, review.id, position)
            ? [
                resolveReview(
                  resolver,
                  review,
                  requireHost(hosts, review.hostId),
                  materialized.unitIds,
                ),
              ]
            : [],
        ),
      );
    const population = materialized.plan.population;
    return {
      index: materialized.plan.index,
      severity: materialized.plan.severity,
      inventory: materialized.inventory,
      unitIds: materialized.unitIds,
      resolutions,
      reviewResolutions,
      ...(population.noEvidenceExclude === undefined
        ? {}
        : { noEvidenceExclude: population.noEvidenceExclude }),
      ...(population.uniqueEvidence === undefined
        ? {}
        : { uniqueEvidence: population.uniqueEvidence }),
      ...(population.singleEvidencePerSymbol === undefined
        ? {}
        : { singleEvidencePerSymbol: population.singleEvidencePerSymbol }),
      ...(population.requireReview === undefined
        ? {}
        : { requireReview: population.requireReview }),
      ...(population.type === "markdown" && population.checklist !== undefined
        ? { checklist: population.checklist }
        : {}),
    };
  }

  /**
   * Resolves one acknowledgement against a preselected reference population.
   *
   * The wrapper keeps the source declaration identity beside the resolver
   * output, allowing graph evaluation and inspection reports to trace every
   * edge back to the authored annotation.
   */
  async function resolveDeclaration(
    resolver: EvidenceTargetResolverIndex,
    declaration: IEvidenceInventory["declarations"][number],
    host: IEvidenceHost,
    unitIds: string[],
  ): Promise<IEvidenceGraphResolution> {
    return {
      declarationId: declaration.id,
      resolution: await resolver.resolve(declaration, host, unitIds),
    };
  }

  /**
   * Resolves one review against the same boundary used for acknowledgements.
   *
   * Reviews are returned in a separate collection because review policy
   * assesses their status independently; resolving one must never manufacture
   * an evidence edge or change coverage counts.
   */
  async function resolveReview(
    resolver: EvidenceTargetResolverIndex,
    review: IEvidenceInventory["reviews"][number],
    host: IEvidenceHost,
    unitIds: string[],
  ): Promise<IEvidenceGraphReviewResolution> {
    return {
      reviewId: review.id,
      resolution: await resolver.resolve(review, host, unitIds),
    };
  }

  /**
   * Retrieves an annotation host from the claim-local host index.
   *
   * A missing host means an inventory invariant was broken after parsing.
   * Throwing here prevents a later resolver error from losing the statement
   * identity that caused the invalid graph input.
   */
  function requireHost(
    hosts: Map<string, IEvidenceHost>,
    id: string,
  ): IEvidenceHost {
    const host = hosts.get(id);
    if (host === undefined)
      throw new Error(`Evidence statement '${id}' has no documentation host.`);
    return host;
  }

  /**
   * Tests whether an indexed annotation participates in one reference position.
   *
   * Missing records are treated as nonparticipating. This keeps the caller safe
   * when an inventory has no annotation of the requested identity while
   * retaining position-based separation for duplicated reference entries.
   */
  function selected(
    records: Map<string, Set<number>>,
    id: string,
    position: number,
  ): boolean {
    const positions = records.get(id);
    return positions !== undefined && positions.has(position);
  }

  /**
   * Appends diagnostics for annotations accepted by no configured reference.
   *
   * Both acknowledgement and review diagnostics retain the authored location,
   * host, and target so a caller can repair configuration or source text
   * without inferring which pre-resolution applicability decision failed.
   *
   * Only an empty position set is reported. An annotation that another claim
   * owns has no entry after ownership is settled, so it is not a participation
   * error of this claim.
   */
  function reportNonParticipating(
    inventory: IEvidenceInventory,
    declarations: Map<string, Set<number>>,
    reviews: Map<string, Set<number>>,
  ): void {
    for (const declaration of inventory.declarations)
      if (declarations.get(declaration.id)?.size === 0)
        inventory.diagnostics.push({
          code: "check-non-participating-acknowledgement",
          severity: "error",
          message: `@${declaration.kind} target '${declaration.target}' belongs to no active reference in this claim.`,
          repair:
            "Correct the target or add the reference population that this claim must acknowledge.",
          location: declaration.location,
          hostId: declaration.hostId,
          target: declaration.target,
        });
    for (const review of inventory.reviews)
      if (reviews.get(review.id)?.size === 0)
        inventory.diagnostics.push({
          code: "check-non-participating-review",
          severity: "error",
          message: `Review target '${review.target}' belongs to no active reference in this claim.`,
          repair:
            "Correct the review target or remove the review when no acknowledgement uses it.",
          location: review.location,
          hostId: review.hostId,
          target: review.target,
        });
  }

  /**
   * Converts evaluated graph state into the stable public check report.
   *
   * Completion is stricter than diagnostic success: inactive claims are
   * ignored, while every active claim and active obligation must be complete.
   * Exit code 2 denotes incomplete graph state, code 1 denotes a complete graph
   * with errors, and code 0 denotes a successful execution.
   */
  function report(
    plan: IEvidenceConfigPlan,
    graph: IEvidenceGraphResult,
  ): IEvidenceCheckReport {
    const claims = checkClaims(plan, graph);
    const diagnostics: IEvidenceDiagnostic[] = orderDiagnostics(
      graph.diagnostics,
    );
    const complete = graph.claims.every(
      (claim) =>
        !claim.active ||
        (claim.complete &&
          claim.obligations.every(
            (obligation) => !obligation.active || obligation.complete,
          )),
    );
    const counts: IEvidenceCheckCounts = summarize(claims, diagnostics);
    const success = complete && counts.errors === 0;
    return {
      schemaVersion: 1,
      command: "check",
      configFile: plan.configFile,
      status: complete ? "complete" : "incomplete",
      success,
      exitCode: !complete ? 2 : success ? 0 : 1,
      counts,
      claims,
      diagnostics,
      ...(plan.report === undefined ? {} : { bounds: plan.report }),
    };
  }

  /**
   * Projects graph claims into report rows using their configuration-plan
   * labels.
   *
   * Positional joins are intentional: graph input is constructed in plan order,
   * including duplicate populations. Missing plan entries are invariant
   * failures, not report omissions, because emitting a relabelled obligation
   * would mislead consumers about the policy that produced it.
   */
  function checkClaims(
    plan: IEvidenceConfigPlan,
    graph: IEvidenceGraphResult,
  ): IEvidenceCheckClaim[] {
    return graph.claims.map((result, position) => {
      const claim = plan.claims[position];
      if (claim === undefined)
        throw new Error(`Graph claim ${position} has no configuration plan.`);
      return {
        claim: claim.index,
        ...(claim.population.name === undefined
          ? {}
          : { name: claim.population.name }),
        type: claim.population.type,
        active: result.active,
        complete: result.complete,
        obligations: result.obligations.map((obligation, referencePosition) => {
          const reference = claim.references[referencePosition];
          if (reference === undefined)
            throw new Error(
              `Graph obligation ${position}:${referencePosition} has no configuration plan.`,
            );
          return {
            claim: claim.index,
            reference: reference.index,
            type: reference.population.type,
            severity: reference.severity,
            active: obligation.active,
            complete: obligation.complete,
            units: obligation.unitIds.length,
            coveredUnits: obligation.coveredUnitIds.length,
            missingUnits: obligation.missingUnitIds.length,
          } satisfies IEvidenceCheckObligation;
        }),
      } satisfies IEvidenceCheckClaim;
    });
  }

  /**
   * Summarizes claims, active obligations, coverage, and diagnostic severities.
   *
   * Coverage totals include only active obligations, matching the policy used
   * for completion. Overall claim and obligation counts remain unfiltered so
   * callers can distinguish disabled configuration from absent configuration.
   */
  function checkCounts(
    claims: IEvidenceCheckClaim[],
    diagnostics: IEvidenceDiagnostic[],
  ): IEvidenceCheckCounts {
    const obligations = claims.flatMap((claim) => claim.obligations);
    const active = obligations.filter((obligation) => obligation.active);
    return {
      claims: claims.length,
      activeClaims: claims.filter((claim) => claim.active).length,
      obligations: obligations.length,
      activeObligations: obligations.filter((obligation) => obligation.active)
        .length,
      incompleteObligations: obligations.filter(
        (obligation) => obligation.active && !obligation.complete,
      ).length,
      units: active.reduce((sum, obligation) => sum + obligation.units, 0),
      coveredUnits: active.reduce(
        (sum, obligation) => sum + obligation.coveredUnits,
        0,
      ),
      missingUnits: active.reduce(
        (sum, obligation) => sum + obligation.missingUnits,
        0,
      ),
      errors: diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ).length,
      warnings: diagnostics.filter(
        (diagnostic) => diagnostic.severity === "warning",
      ).length,
    };
  }

  /**
   * Compares diagnostics using the report's deterministic ordering contract.
   *
   * Claim and reference coordinates come first, followed by source location and
   * diagnostic identity. The final message comparison makes otherwise identical
   * diagnostics stable across adapter iteration order and operating systems.
   */
  function compareDiagnostics(
    left: IEvidenceDiagnostic,
    right: IEvidenceDiagnostic,
  ): number {
    const leftRange = left.location?.range;
    const rightRange = right.location?.range;
    return firstDifference([
      compareNumber(left.claim ?? -1, right.claim ?? -1),
      compareNumber(left.reference ?? -1, right.reference ?? -1),
      compare(left.location?.file ?? "", right.location?.file ?? ""),
      compareNumber(
        leftRange === undefined ? -1 : leftRange.start.offset,
        rightRange === undefined ? -1 : rightRange.start.offset,
      ),
      compare(left.code, right.code),
      compare(left.hostId ?? "", right.hostId ?? ""),
      compare(left.target ?? "", right.target ?? ""),
      compare(left.message, right.message),
    ]);
  }

  /**
   * Compares two report strings using code-unit order.
   *
   * This deliberately avoids locale-sensitive collation so serialized checker
   * output has the same order on every platform.
   */
  function compare(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  /**
   * Compares numeric report coordinates in ascending order.
   *
   * Callers pass only bounded graph indexes and source offsets, so subtraction
   * supplies a compact comparator while preserving exact coordinate priority.
   */
  function compareNumber(left: number, right: number): number {
    return left - right;
  }

  /**
   * Returns the first decisive comparison result in priority order.
   *
   * Comparator construction remains separate from execution so ordering rules
   * can be read as a single ordered list in {@link compareDiagnostics}.
   */
  function firstDifference(values: number[]): number {
    return values.find((value) => value !== 0) ?? 0;
  }
}
