import { EvidenceUnitSites } from "../../internal/EvidenceUnitSites";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidencePublicAddress } from "../../structures/IEvidencePublicAddress";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { IEvidenceGoDeclaration } from "./IEvidenceGoDeclaration";
import type { IEvidenceGoFileAnalysis } from "./IEvidenceGoFileAnalysis";
import type { IEvidenceGoMaterializedDeclaration } from "./IEvidenceGoMaterializedDeclaration";

/**
 * Reconciles selected Go files into package-wide Evidence units and addresses.
 *
 * EvidenceGoAdapter supplies one analysis per source file because receiver
 * methods may depend on types in another file; this resolver restores Go's
 * package boundary before the shared inventory is published.
 *
 * @evidence contracts/common.md#principled-implementation File analyses are grouped by directory and package clause, receiver methods resolve to a selected local defined type, and each declaration publishes addresses through its own file and, for methods, every file declaring the owner.
 * @evidence contracts/common.md#clear-and-simple-design The resolver owns package-wide identity and addresses; scanning and documentation are elsewhere.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Incompatible package clauses, missing receiver types and duplicate selected identities mark the inventory incomplete.
 * @evidence contracts/common.md#meaningful-documentation The class comment explains why ownership waits for all files; every member is documented.
 * @evidence contracts/performance.md#efficient-algorithms Linear in declarations with map lookups by package and type.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work Publication runs once per analysis.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The resolver writes into the shared inventory and keeps only per-call maps.
 */
export class EvidenceGoPackageResolver {
  /**
   * Published units indexed by their package-wide semantic IDs.
   *
   * Materialization adds physical declaration sites to these units before they
   * are appended to the caller-owned inventory.
   */
  private readonly units = new Map<string, IEvidenceUnit>();

  /**
   * Unit IDs already associated with each package-local public identity.
   *
   * The resolver uses this map to report incompatible symbol kinds that would
   * otherwise make one identity ambiguous.
   */
  private readonly identities = new Map<string, string>();

  /**
   * Serialized addresses that have already been emitted for a unit.
   *
   * Several owner and member sources can contribute the same public address.
   */
  private readonly addresses = new Set<string>();

  /**
   * Diagnostic fingerprints reported during this package reconciliation.
   *
   * Suppressing repeats keeps one input defect from producing redundant errors.
   */
  private readonly reported = new Set<string>();

  /**
   * Creates a resolver for the selected Go file analyses and destination
   * inventory.
   *
   * The analyses remain immutable input; published units, addresses, and
   * diagnostics are added to the provided inventory during {@link publish}.
   */
  public constructor(
    /**
     * File-local extractions selected for this adapter pass.
     *
     * Their directory and package names establish the package groups to
     * resolve.
     */
    private readonly analyses: IEvidenceGoFileAnalysis[],

    /**
     * Shared inventory that receives resolved units and reconciliation
     * diagnostics.
     *
     * Its completeness flag is cleared whenever package resolution finds an
     * error.
     */
    private readonly inventory: IEvidenceInventory,
  ) {}

  /**
   * Resolves all selected declarations and publishes their package-wide units.
   *
   * The returned map lets EvidenceGoAdapter associate scanner-local
   * documentation with the unit ID that survived receiver and package-boundary
   * reconciliation.
   *
   * @returns Scanner-local declaration IDs mapped to their published unit IDs.
   * @evidence contracts/common.md#principled-implementation Package boundaries, including ordinary and external test packages, are validated, then every declaration is added to its unit and its public addresses emitted; the returned map links scanner IDs to unit IDs.
   * @evidence contracts/common.md#clear-and-simple-design Unit IDs and addresses come from private helpers.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unresolvable receivers and conflicts are reported rather than dropped.
   * @evidence contracts/common.md#meaningful-documentation The comment states the returned map's purpose.
   * @evidence contracts/performance.md#efficient-algorithms Linear in declarations and their address files.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work It runs once per analysis.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The returned map is owned by the caller; units are written into the bound inventory.
   */
  public publish(): Map<string, string> {
    this.validatePackages();
    const entries = this.analyses.flatMap((analysis) =>
      analysis.packageName === undefined
        ? []
        : analysis.declarations.map((declaration) =>
            this.entry(analysis, declaration),
          ),
    );
    const types = new Map<string, IEvidenceGoMaterializedDeclaration[]>();
    for (const entry of entries) {
      if (entry.declaration.symbol !== "type") continue;
      const key = this.ownerKey(entry.analysis, entry.declaration.name);
      const declarations = types.get(key) ?? [];
      declarations.push(entry);
      types.set(key, declarations);
    }

    const published = new Map<string, string>();
    for (const entry of entries) {
      const owner = entry.declaration.owner;
      const owners =
        owner === undefined
          ? []
          : (types.get(this.ownerKey(entry.analysis, owner)) ?? []);
      if (owner !== undefined) {
        const eligible =
          entry.declaration.form === "method"
            ? owners.filter(
                (candidate) => candidate.declaration.form === "defined-type",
              )
            : owners;
        if (eligible.length === 0) {
          const method = entry.declaration.form === "method";
          this.problem(
            method ? "go-receiver" : "go-owner",
            entry.analysis,
            method
              ? `Exported Go method '${owner}.${entry.declaration.name}' has no selected local defined receiver type.`
              : `Exported Go member '${owner}.${entry.declaration.name}' has no selected local owner type.`,
            method
              ? "Include the receiver's defined type in this package population or remove the method from the selected files."
              : "Include the owning type declaration in this package population.",
            JSON.stringify([entry.declaration.id, "owner"]),
          );
          continue;
        }
      }
      this.materialize(entry, owners);
      published.set(entry.declaration.id, entry.unitId);
    }
    this.inventory.units.push(...this.units.values());
    return published;
  }

  /**
   * Adds one declaration to its resolved unit and publishes its public
   * addresses.
   *
   * Compatible physical declarations contribute sites to one unit; conflicting
   * declarations remain visible through diagnostics instead of being
   * discarded.
   */
  private materialize(
    entry: IEvidenceGoMaterializedDeclaration,
    owners: IEvidenceGoMaterializedDeclaration[],
  ): void {
    const declaration = entry.declaration;
    const identity =
      declaration.owner === undefined
        ? [declaration.name]
        : [declaration.owner, declaration.name];
    const identityKey = JSON.stringify([
      this.packageKey(entry.analysis),
      identity,
    ]);
    const previousIdentity = this.identities.get(identityKey);
    if (previousIdentity !== undefined && previousIdentity !== entry.unitId)
      this.problem(
        "go-identity-conflict",
        entry.analysis,
        `Go public identity '${identity.join(".")}' is declared with conflicting symbol kinds.`,
        "Rename one declaration or select a source set with one compatible public identity.",
        `${identityKey}:kind`,
      );
    else this.identities.set(identityKey, entry.unitId);

    let unit = this.units.get(entry.unitId);
    if (unit === undefined) {
      unit = {
        id: entry.unitId,
        type: "go",
        symbol: declaration.symbol,
        identity,
        name: declaration.name,
        sites: structuredClone(declaration.sites),
        withdrawals: [],
        ...(declaration.owner === undefined
          ? {}
          : {
              parentId: this.unitId(entry.analysis, "type", [
                declaration.owner,
              ]),
            }),
      };
      this.units.set(entry.unitId, unit);
    } else {
      this.problem(
        "go-declaration-conflict",
        entry.analysis,
        `Go public identity '${identity.join(".")}' has more than one selected declaration.`,
        "Narrow the configured source set or remove declarations duplicated across build-constrained files.",
        `${identityKey}:duplicate`,
      );
      for (const site of declaration.sites)
        EvidenceUnitSites.append(unit, site);
    }
    this.publishAddresses(entry, owners);
  }

  /**
   * Emits each configured source address that can publicly name a resolved
   * unit.
   *
   * Member addresses inherit paths from both their own file and selected owner
   * files, because either file may be the configured public entry point.
   */
  private publishAddresses(
    entry: IEvidenceGoMaterializedDeclaration,
    owners: IEvidenceGoMaterializedDeclaration[],
  ): void {
    const identity =
      entry.declaration.owner === undefined
        ? [entry.declaration.name]
        : [entry.declaration.owner, entry.declaration.name];
    const sources = [
      entry.analysis.source,
      ...owners.map((owner) => owner.analysis.source),
    ];
    for (const source of sources)
      for (const location of source.addresses) {
        const address: IEvidencePublicAddress = {
          unitId: entry.unitId,
          file: location.absolute,
          segments: identity,
        };
        const key = JSON.stringify(address);
        if (this.addresses.has(key)) continue;
        this.addresses.add(key);
        this.inventory.addresses.push(address);
      }
  }

  /**
   * Verifies that selected files form compatible ordinary and external test
   * packages.
   *
   * Go permits one ordinary package and its matching `_test` package per
   * directory; other combinations make package-wide identity unreliable.
   */
  private validatePackages(): void {
    const directories = new Map<string, IEvidenceGoFileAnalysis[]>();
    for (const analysis of this.analyses) {
      if (analysis.packageName === undefined) continue;
      const files = directories.get(analysis.directory) ?? [];
      files.push(analysis);
      directories.set(analysis.directory, files);
    }
    for (const [directory, files] of directories) {
      const ordinary = new Set(
        files.flatMap((file) =>
          !file.testFile && file.packageName !== undefined
            ? [file.packageName]
            : [],
        ),
      );
      if (ordinary.size > 1) {
        this.packageProblem(directory, files);
        continue;
      }
      const base =
        Array.from(ordinary)[0] ??
        this.testPackageBase(files.map((file) => file.packageName));
      if (
        base === undefined ||
        files.some(
          (file) =>
            file.packageName !== base &&
            !(file.testFile && file.packageName === `${base}_test`),
        )
      )
        this.packageProblem(directory, files);
    }
  }

  /**
   * Finds the ordinary package name represented by a test-only file selection.
   *
   * A lone package is its own base, while a matching external test package
   * identifies the base through Go's required `_test` suffix.
   */
  private testPackageBase(
    names: Array<string | undefined>,
  ): string | undefined {
    const packages = Array.from(
      new Set(names.filter((name) => name !== undefined)),
    );
    if (packages.length === 1) return packages[0];
    return packages.find((name) => packages.includes(`${name}_test`));
  }

  /**
   * Records an incompatible-package diagnostic for every affected file group.
   *
   * The directory is the Go package boundary, so no unit from this group can be
   * trusted as a single semantic package population.
   */
  private packageProblem(
    directory: string,
    analyses: IEvidenceGoFileAnalysis[],
  ): void {
    const names = Array.from(
      new Set(analyses.map((analysis) => analysis.packageName)),
    )
      .filter((name) => name !== undefined)
      .sort((left, right) => left.localeCompare(right, "en"));
    this.problem(
      "go-package-boundary",
      analyses[0],
      `Selected Go directory '${directory}' contains incompatible packages: ${names.join(", ")}.`,
      "Select one ordinary package and, when needed, only its matching external _test package.",
      JSON.stringify([directory, names, "packages"]),
    );
  }

  /**
   * Wraps a physical declaration with the package-wide ID it would publish
   * under.
   *
   * This transient form keeps source context available while ownership checks
   * determine whether the declaration is eligible for materialization.
   */
  private entry(
    analysis: IEvidenceGoFileAnalysis,
    declaration: IEvidenceGoDeclaration,
  ): IEvidenceGoMaterializedDeclaration {
    const identity =
      declaration.owner === undefined
        ? [declaration.name]
        : [declaration.owner, declaration.name];
    return {
      analysis,
      declaration,
      unitId: this.unitId(analysis, declaration.symbol, identity),
    };
  }

  /**
   * Serializes a stable unit ID from the Go package boundary and semantic
   * identity.
   *
   * File paths are deliberately absent because declarations in several package
   * files may represent one public unit.
   */
  private unitId(
    analysis: IEvidenceGoFileAnalysis,
    symbol: string,
    identity: string[],
  ): string {
    return `go:${this.packageKey(analysis)}:${symbol}:${JSON.stringify(identity)}`;
  }

  /**
   * Produces a package-scoped lookup key for an exported owner type name.
   *
   * The package component prevents same-named types in different directories
   * from satisfying each other's methods.
   */
  private ownerKey(analysis: IEvidenceGoFileAnalysis, name: string): string {
    return JSON.stringify([this.packageKey(analysis), name]);
  }

  /**
   * Produces the normalized package identity shared by compatible file
   * analyses.
   *
   * Both directory and package clause are required because either alone can
   * collide across the selected source set.
   */
  private packageKey(analysis: IEvidenceGoFileAnalysis): string {
    return JSON.stringify([analysis.directory, analysis.packageName]);
  }

  /**
   * Adds one deduplicated package-resolution failure to the shared inventory.
   *
   * Reporting also marks the inventory incomplete, preventing a bad package
   * population from appearing as successful reduced coverage.
   */
  private problem(
    code: string,
    analysis: IEvidenceGoFileAnalysis | undefined,
    message: string,
    repair: string,
    key: string,
  ): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.inventory.complete = false;
    this.inventory.diagnostics.push({
      code,
      severity: "error",
      message,
      repair,
      ...(analysis === undefined
        ? {}
        : { location: { file: analysis.source.physicalPath } }),
    });
  }
}
