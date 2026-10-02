import path from "node:path";

import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidencePublicAddress } from "../../structures/IEvidencePublicAddress";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceRoot } from "../../structures/IEvidenceSourceRoot";
import type { IEvidencePythonBinding } from "./IEvidencePythonBinding";
import type { IEvidencePythonFileAnalysis } from "./IEvidencePythonFileAnalysis";
import type { IEvidencePythonModule } from "./IEvidencePythonModule";
import type { IEvidencePythonResolution } from "./IEvidencePythonResolution";
import type { IEvidencePythonResolvedBinding } from "./IEvidencePythonResolvedBinding";
import type { EvidencePythonResolutionMode } from "./EvidencePythonResolutionMode";
import { EvidenceSourcePath } from "../../internal/EvidenceSourcePath";

/**
 * Resolves Python module exports across a complete source snapshot.
 *
 * The Python adapter records file-local declarations first, then this resolver
 * follows imports and `__all__` so the inventory exposes the public addresses
 * through which callers can reach each owned unit.
 */
export class EvidencePythonExportResolver {
  /**
   * Modules indexed by their source identities.
   *
   * Each record combines the scanner's local bindings with the names currently
   * considered public while star imports are expanded.
   */
  private readonly modules = new Map<string, IEvidencePythonModule>();

  /**
   * Source identities grouped by normalized physical and public locations.
   *
   * Import resolution uses this index to reject missing and ambiguous module
   * targets without depending on the host filesystem.
   */
  private readonly locations = new Map<string, Set<string>>();

  /**
   * Memoized module targets for import specifiers, including unresolved ones.
   *
   * Caching `undefined` prevents duplicate diagnostics while the same import is
   * encountered through multiple reexports.
   */
  private readonly targets = new Map<string, string | undefined>();

  /**
   * Memoized binding resolutions keyed by source, name, and visibility mode.
   *
   * Declared and public lookup differ for star imports, so both modes form part
   * of the cache key.
   */
  private readonly resolutions = new Map<string, IEvidencePythonResolution>();

  /**
   * Diagnostic keys already emitted for this snapshot.
   *
   * A single unsupported import may be reached through several exports but must
   * make the inventory incomplete only once.
   */
  private readonly reported = new Set<string>();

  /**
   * Initializes the resolver from file-local Python analyses.
   *
   * The constructor derives each module's initial public names before expanding
   * transitive star imports, because that fixed point defines later lookups.
   */
  public constructor(
    analyses: IEvidencePythonFileAnalysis[],
    private readonly inventory: IEvidenceInventory,
    private readonly root: IEvidenceSourceRoot,
  ) {
    for (const analysis of analyses) {
      const names = new Set<string>();
      if (analysis.all.state !== "static")
        for (const binding of analysis.bindings)
          if (
            binding.localName !== undefined &&
            !binding.localName.startsWith("_")
          )
            names.add(binding.localName);
      for (const name of analysis.all.names) names.add(name);
      this.modules.set(analysis.source.id, {
        source: analysis.source,
        all: analysis.all,
        bindings: analysis.bindings,
        units: analysis.units,
        names,
      });
      for (const location of this.sourceLocations(analysis.source)) {
        let ids = this.locations.get(location);
        if (ids === undefined) {
          ids = new Set<string>();
          this.locations.set(location, ids);
        }
        ids.add(analysis.source.id);
      }
    }
    this.expandStars();
  }

  /**
   * Materializes public addresses for every resolved exported binding.
   *
   * Returns semantic unit IDs that received at least one address. Unresolvable
   * public names record diagnostics instead of silently shrinking coverage.
   */
  public publish(): Set<string> {
    const published = new Set<string>();
    for (const module of this.modules.values())
      for (const name of Array.from(module.names).sort((left, right) =>
        left.localeCompare(right, "en"),
      )) {
        const resolution = this.resolve(module.source.id, name, "public");
        let materialized = false;
        for (const binding of resolution.bindings)
          materialized =
            this.publishBinding(
              module.source,
              binding,
              [name],
              new Set<string>(),
              published,
            ) || materialized;
        if (
          resolution.foreign !== true &&
          (resolution.bindings.length === 0 || !materialized)
        ) {
          const explicit = module.all.names.includes(name);
          this.problem(
            module.source,
            resolution.cyclic
              ? `Python export '${name}' resolves only through a declaration-free import cycle.`
              : resolution.bindings.length !== 0
                ? `Python export '${name}' resolves to no supported type, function, or property unit.`
                : explicit
                  ? `Python __all__ names '${name}', but no supported declaration or local import supplies it.`
                  : `Public Python binding '${name}' has no supported declaration inside the source snapshot.`,
            resolution.cyclic
              ? "Break the cycle with a supported declaration or remove the cyclic reexport."
              : resolution.bindings.length !== 0
                ? "Export a supported declaration from the namespace or remove this binding from the public surface."
                : explicit
                  ? "Correct __all__, add the declaration, or include the local imported module in this population."
                  : "Hide the import with a leading underscore, define __all__, or include its local source module.",
            JSON.stringify([module.source.id, name, "unresolved"]),
          );
        }
      }
    return published;
  }

  /**
   * Adds names introduced by transitive star imports until none remain.
   *
   * A fixed-point pass is necessary because one imported module can itself
   * obtain public names from another star import.
   */
  private expandStars(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const module of this.modules.values()) {
        if (module.all.state === "static") continue;
        for (const binding of module.bindings) {
          if (binding.kind !== "star" || binding.specifier === undefined)
            continue;
          const target = this.target(module.source, binding.specifier);
          const dependency =
            target === undefined ? undefined : this.modules.get(target);
          if (dependency === undefined) continue;
          for (const name of dependency.names)
            if (!name.startsWith("_") && !module.names.has(name)) {
              module.names.add(name);
              changed = true;
            }
        }
      }
    }
  }

  /**
   * Resolves one name from a source module with memoization.
   *
   * Resolution mode distinguishes a module's declared bindings from the names
   * it publicly reexports through `__all__` or star imports.
   */
  private resolve(
    sourceId: string,
    name: string,
    mode: EvidencePythonResolutionMode,
  ): IEvidencePythonResolution {
    const key = JSON.stringify([sourceId, name, mode]);
    const cached = this.resolutions.get(key);
    if (cached !== undefined) return cached;
    const resolution = this.resolveFrom(
      sourceId,
      name,
      mode,
      new Set<string>(),
    );
    this.resolutions.set(key, resolution);
    return resolution;
  }

  /**
   * Resolves a name recursively while detecting declaration-free import cycles.
   *
   * Later bindings win in Python. Star bindings participate only when no later
   * explicit binding shadows the requested name.
   */
  private resolveFrom(
    sourceId: string,
    name: string,
    mode: EvidencePythonResolutionMode,
    visited: Set<string>,
  ): IEvidencePythonResolution {
    const key = JSON.stringify([sourceId, name, mode]);
    if (visited.has(key)) return { bindings: [], cyclic: true };
    const module = this.modules.get(sourceId);
    if (module === undefined) return { bindings: [], cyclic: false };
    if (mode === "public" && !module.names.has(name))
      return { bindings: [], cyclic: false };

    visited.add(key);
    let winner = module.bindings
      .filter((binding) => binding.localName === name)
      .sort((left, right) => right.order - left.order)[0];
    for (const binding of module.bindings) {
      if (
        binding.kind !== "star" ||
        binding.specifier === undefined ||
        (winner !== undefined && winner.order > binding.order)
      )
        continue;
      const target = this.target(module.source, binding.specifier);
      const dependency =
        target === undefined ? undefined : this.modules.get(target);
      if (target === undefined && this.foreign(binding.specifier)) {
        // Unknown dependency stars cannot prove that a known local owner was
        // replaced. They supply provenance only for otherwise unowned names.
        if (winner === undefined) winner = binding;
        continue;
      }
      if (dependency !== undefined && dependency.names.has(name))
        winner = binding;
    }
    const output =
      winner === undefined
        ? { bindings: [], cyclic: false }
        : this.resolveBinding(module, winner, name, visited);
    visited.delete(key);
    return output;
  }

  /**
   * Converts a selected binding into local units or a recursive import lookup.
   *
   * Namespace imports intentionally preserve only the target module so address
   * publication can append its reachable member paths.
   */
  private resolveBinding(
    module: IEvidencePythonModule,
    binding: IEvidencePythonBinding,
    name: string,
    visited: Set<string>,
  ): IEvidencePythonResolution {
    if (binding.kind === "local")
      return binding.root === undefined
        ? { bindings: [], cyclic: false }
        : {
            bindings: [{ sourceId: module.source.id, root: binding.root }],
            cyclic: false,
          };
    if (binding.specifier === undefined) return { bindings: [], cyclic: false };
    const target = this.target(module.source, binding.specifier);
    if (target === undefined)
      return {
        bindings: [],
        cyclic: false,
        foreign: this.foreign(binding.specifier),
      };
    if (binding.kind === "namespace") {
      const dependency: IEvidencePythonModule | undefined =
        this.modules.get(target);
      const names: string[] =
        dependency === undefined ? [] : Array.from(dependency.names);
      const foreign: boolean =
        names.length !== 0
          ? names.every(
              (entry: string): boolean =>
                this.resolveFrom(target, entry, "public", visited).foreign ===
                true,
            )
          : dependency !== undefined &&
            dependency.bindings.some(
              (entry: IEvidencePythonBinding): boolean =>
                entry.kind === "star" &&
                entry.specifier !== undefined &&
                this.foreign(entry.specifier),
            );
      return foreign
        ? { bindings: [], cyclic: false, foreign: true }
        : { bindings: [{ sourceId: target }], cyclic: false };
    }
    const importedName = binding.kind === "named" ? binding.importedName : name;
    if (importedName === undefined) return { bindings: [], cyclic: false };
    return this.resolveFrom(
      target,
      importedName,
      binding.kind === "star" ? "public" : "declared",
      visited,
    );
  }

  /**
   * Publishes addresses reachable through one resolved binding.
   *
   * Namespace bindings recurse through their public members; root bindings map
   * matching owned units onto every public address of the entry source.
   */
  private publishBinding(
    entry: IEvidenceSourceFile,
    binding: IEvidencePythonResolvedBinding,
    prefix: string[],
    visited: Set<string>,
    published: Set<string>,
  ): boolean {
    const module = this.modules.get(binding.sourceId);
    if (module === undefined) return false;
    if (binding.root === undefined) {
      if (visited.has(binding.sourceId)) return false;
      const nested = new Set(visited);
      nested.add(binding.sourceId);
      let materialized = false;
      for (const name of Array.from(module.names).sort((left, right) =>
        left.localeCompare(right, "en"),
      ))
        for (const child of this.resolve(binding.sourceId, name, "public")
          .bindings)
          materialized =
            this.publishBinding(
              entry,
              child,
              [...prefix, name],
              nested,
              published,
            ) || materialized;
      return materialized;
    }
    let materialized = false;
    for (const owned of module.units) {
      if (!owned.roots.includes(binding.root)) continue;
      const address: IEvidencePublicAddress = {
        unitId: owned.unit.id,
        file: "",
        segments: [...prefix, ...owned.suffix],
      };
      for (const source of entry.addresses) {
        address.file = source.absolute;
        this.inventory.addresses.push({ ...address });
      }
      published.add(owned.unit.id);
      materialized = true;
    }
    return materialized;
  }

  /**
   * Finds the unique in-snapshot module selected by an import specifier.
   *
   * Imports leaving the configured root, missing snapshot files, and physical
   * aliases are reported because each would make export coverage unreliable.
   */
  private target(
    source: IEvidenceSourceFile,
    specifier: string,
  ): string | undefined {
    const key = JSON.stringify([source.id, specifier]);
    if (this.targets.has(key)) return this.targets.get(key);
    const found = new Set<string>();
    let outside = false;
    for (const location of this.sourceLocations(source)) {
      const base = this.importBase(source, location, specifier);
      if (base === undefined) continue;
      for (const candidate of this.candidates(base)) {
        if (
          !EvidenceSourcePath.contains(
            this.locationKey(this.root.absolute),
            candidate,
          )
        ) {
          outside = true;
          continue;
        }
        for (const id of this.locations.get(candidate) ?? []) {
          const dependency = this.modules.get(id)?.source;
          if (dependency !== undefined && !this.insidePhysicalRoot(dependency))
            outside = true;
          else found.add(id);
        }
      }
    }
    const target = found.size === 1 ? Array.from(found)[0] : undefined;
    if (
      target === undefined &&
      !(found.size === 0 && !outside && this.foreign(specifier))
    )
      this.problem(
        source,
        outside && found.size === 0
          ? `Python import '${specifier}' leaves the declared source root.`
          : found.size === 0
            ? `Python import '${specifier}' is absent from the complete source snapshot.`
            : `Python import '${specifier}' resolves to more than one physical source.`,
        outside && found.size === 0
          ? "Move the dependency inside the configured root or use a population rooted at its package tree."
          : found.size === 0
            ? "Include the local .py/.pyi dependency or hide the binding from the public module surface."
            : "Remove ambiguous aliases or retain one unambiguous module source.",
        key,
      );
    this.targets.set(key, target);
    return target;
  }

  /**
   * Distinguishes absent dependency packages from missing local Python modules.
   *
   * Absolute imports whose top-level package exists in the selected snapshot
   * remain local, even when the requested submodule is missing. Relative
   * imports always require local resolution.
   */
  private foreign(specifier: string): boolean {
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/u.test(specifier)) return false;
    const first: string = specifier.split(".")[0] ?? specifier;
    const base: string = this.locationKey(
      path.posix.join(this.root.absolute, first),
    );
    return !Array.from(this.locations.keys()).some(
      (location: string): boolean =>
        location === `${base}.py` ||
        location === `${base}.pyi` ||
        location.startsWith(`${base}/`),
    );
  }

  /**
   * Computes the normalized filesystem base named by a Python import.
   *
   * Relative dot depth is resolved from the importing location; absolute names
   * are rooted at the configured source root.
   */
  private importBase(
    source: IEvidenceSourceFile,
    location: string,
    specifier: string,
  ): string | undefined {
    const normalized = specifier.replaceAll("\\", "/");
    if (normalized.startsWith(".")) {
      const prefix = /^\.+/u.exec(normalized)?.[0] ?? "";
      let base = path.posix.dirname(location);
      for (let level = 1; level < prefix.length; ++level)
        base = path.posix.dirname(base);
      const remainder = normalized.slice(prefix.length).replaceAll(".", "/");
      return this.locationKey(
        remainder === "" ? base : path.posix.join(base, remainder),
      );
    }
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/u.test(normalized)) {
      this.problem(
        source,
        `Python import '${specifier}' has an unsupported static module spelling.`,
        "Use a dotted absolute module name or a leading-dot relative module name.",
        JSON.stringify([location, specifier, "spelling"]),
      );
      return undefined;
    }
    return this.locationKey(
      path.posix.join(
        this.locationKey(this.root.absolute),
        normalized.replaceAll(".", "/"),
      ),
    );
  }

  /**
   * Lists source-file spellings that can implement one module base.
   *
   * Python permits both implementation and stub files, plus package
   * initializers.
   */
  private candidates(base: string): string[] {
    return [
      `${base}.py`,
      `${base}.pyi`,
      path.posix.join(base, "__init__.py"),
      path.posix.join(base, "__init__.pyi"),
    ].map((candidate) => this.locationKey(candidate));
  }

  /**
   * Checks whether a resolved source remains within the optional physical root.
   *
   * Public addresses can alias a source, but its physical path still defines
   * the boundary that imports may not escape.
   */
  private insidePhysicalRoot(source: IEvidenceSourceFile): boolean {
    return (
      this.root.physical === undefined ||
      EvidenceSourcePath.contains(this.root.physical, source.physicalPath)
    );
  }

  /**
   * Returns normalized physical and public locations for one source file.
   *
   * De-duplication preserves valid aliases while preventing one source from
   * making an import appear ambiguous by itself.
   */
  private sourceLocations(source: IEvidenceSourceFile): string[] {
    return Array.from(
      new Set([
        this.locationKey(source.physicalPath),
        ...source.addresses.map((address) =>
          this.locationKey(address.absolute),
        ),
      ]),
    );
  }

  /**
   * Normalizes a location for platform-independent module matching.
   *
   * Drive and UNC locations are case-insensitive, while other paths retain case
   * so the resolver does not invent Windows behavior on POSIX snapshots.
   */
  private locationKey(location: string): string {
    const slash = location.replaceAll("\\", "/");
    const unc = slash.startsWith("//");
    const normalized = path.posix.normalize(slash);
    const restored = unc ? `/${normalized}` : normalized;
    return unc || /^[A-Za-z]:\//u.test(restored)
      ? restored.toLowerCase()
      : restored;
  }

  /**
   * Records one export-resolution failure and marks the inventory incomplete.
   *
   * The supplied key suppresses repeated reports from reexport paths that reach
   * the same underlying import or binding failure.
   */
  private problem(
    source: IEvidenceSourceFile | undefined,
    message: string,
    repair: string,
    key: string,
  ): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.inventory.complete = false;
    this.inventory.diagnostics.push({
      code: "python-export",
      severity: "error",
      message,
      repair,
      ...(source === undefined
        ? {}
        : { location: { file: source.physicalPath } }),
    });
  }
}
