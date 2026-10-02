import path from "node:path";

import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidencePublicAddress } from "../../structures/IEvidencePublicAddress";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { IEvidenceRustDeclaration } from "./IEvidenceRustDeclaration";
import type { IEvidenceRustExportRecord } from "./IEvidenceRustExportRecord";
import type { IEvidenceRustFileAnalysis } from "./IEvidenceRustFileAnalysis";
import type { IEvidenceRustFilePlacement } from "./IEvidenceRustFilePlacement";
import type { IEvidenceRustImplementation } from "./IEvidenceRustImplementation";
import type { IEvidenceRustLocatedDeclaration } from "./IEvidenceRustLocatedDeclaration";
import type { IEvidenceRustModuleRecord } from "./IEvidenceRustModuleRecord";
import type { IEvidenceRustPublicOccurrence } from "./IEvidenceRustPublicOccurrence";
import type { IEvidenceRustResolvedMember } from "./IEvidenceRustResolvedMember";
import { EvidenceSourcePath } from "../../internal/EvidenceSourcePath";

/**
 * Resolves selected Rust file analyses into crate modules, public aliases, and
 * impl ownership.
 *
 * The resolver joins node-free scan results, then materializes semantic units
 * and every supported public address in the supplied Evidence inventory.
 */
export class EvidenceRustModuleResolver {
  private readonly declarations = new Map<
    string,
    IEvidenceRustLocatedDeclaration
  >();
  private readonly childModules = new Map<string, IEvidenceRustModuleRecord>();
  private readonly exports = new Map<
    string,
    Map<string, IEvidenceRustExportRecord[]>
  >();
  /**
   * Forwarded dependency names known without enrolling dependency declarations.
   *
   * The export fixed point propagates these names through selected local
   * barrels independently of local semantic identities.
   */
  private readonly foreignExports: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();

  /**
   * Local modules that forward unknown dependency names through wildcard uses.
   *
   * This permits transitive dependency forwarding while unresolved names in
   * ordinary local modules remain extraction failures.
   */
  private readonly foreignStars: Set<string> = new Set<string>();
  private readonly externalTargets = new Map<
    string,
    IEvidenceRustFileAnalysis
  >();
  private readonly identities = new Map<string, string>();
  private readonly implMembers = new Map<
    string,
    IEvidenceRustResolvedMember[]
  >();
  private readonly modules = new Map<string, IEvidenceRustModuleRecord>();
  private readonly placements = new Map<string, IEvidenceRustFilePlacement>();
  private readonly published = new Map<string, string>();
  private readonly reported = new Set<string>();
  private readonly unitDeclarations = new Map<string, Set<string>>();
  private readonly units = new Map<string, IEvidenceUnit>();
  private readonly addresses = new Set<string>();

  /**
   * Creates a resolver that publishes into one inventory.
   *
   * The analyses remain read-only inputs; this instance owns all intermediate
   * module, export, identity, and diagnostic state for the resolution pass.
   */
  public constructor(
    private readonly analyses: IEvidenceRustFileAnalysis[],
    private readonly inventory: IEvidenceInventory,
  ) {}

  /**
   * Resolves all selected Rust analyses and publishes their public units.
   *
   * Resolution runs in dependency order: file-backed modules establish crate
   * scope before exports and impl members can receive public addresses. The
   * returned map links scanner declaration IDs to their published unit IDs.
   */
  public publish(): Map<string, string> {
    this.resolveExternalTargets();
    this.placeFiles();
    this.attachExternalInnerDocumentation();
    this.buildModules();
    this.buildExports();
    this.resolveImplementations();
    const occurrences = this.collectOccurrences();
    this.materialize(occurrences);
    this.inventory.units.push(...this.units.values());
    return this.published;
  }

  private resolveExternalTargets(): void {
    const sources = new Map<string, IEvidenceRustFileAnalysis[]>();
    for (const analysis of this.analyses)
      for (const location of this.sourceLocations(analysis)) {
        const records = sources.get(location) ?? [];
        records.push(analysis);
        sources.set(location, records);
      }
    const claims = new Map<string, string[]>();
    for (const analysis of this.analyses)
      for (const external of analysis.externalModules) {
        if (external.pathOverride) continue;
        const candidates = Array.from(
          new Map(
            this.sourceLocations(analysis)
              .flatMap((location) => {
                const directory = path.join(
                  this.moduleDirectory(location),
                  ...external.modulePath,
                );
                return [
                  EvidenceSourcePath.slash(
                    path.join(directory, `${external.name}.rs`),
                  ),
                  EvidenceSourcePath.slash(
                    path.join(directory, external.name, "mod.rs"),
                  ),
                ];
              })
              .flatMap((candidate) => sources.get(candidate) ?? [])
              .map((candidate) => [candidate.source.id, candidate]),
          ).values(),
        );
        if (candidates.length === 0) {
          this.problem(
            "rust-module-missing",
            analysis,
            `Module '${[...external.modulePath, external.name].join("::")}' has no selected default source file.`,
            "Select its .rs or mod.rs source under the configured root, or inline the module.",
            external.declarationId,
          );
          continue;
        }
        if (candidates.length > 1) {
          this.problem(
            "rust-module-ambiguous",
            analysis,
            `Module '${[...external.modulePath, external.name].join("::")}' matches both supported source layouts.`,
            "Select exactly one of name.rs and name/mod.rs for this module.",
            external.declarationId,
          );
          continue;
        }
        const target = candidates[0];
        if (target === undefined) continue;
        this.externalTargets.set(external.declarationId, target);
        const owners = claims.get(target.source.id) ?? [];
        owners.push(external.declarationId);
        claims.set(target.source.id, owners);
      }
    for (const [sourceId, owners] of claims)
      if (owners.length > 1) {
        const target = this.analyses.find(
          (analysis) => analysis.source.id === sourceId,
        );
        this.problem(
          "rust-module-ownership",
          target,
          "One selected Rust file is claimed by more than one module declaration.",
          "Give every file-backed module one unambiguous declaration and default source path.",
          JSON.stringify([sourceId, owners]),
        );
      }
  }

  private placeFiles(): void {
    const claimed = new Set(
      Array.from(this.externalTargets.values()).map(
        (analysis) => analysis.source.id,
      ),
    );
    const queue: IEvidenceRustFilePlacement[] = [];
    for (const analysis of this.analyses)
      if (!claimed.has(analysis.source.id))
        queue.push({
          analysis,
          rootKey: analysis.source.physicalPath,
          prefix: [],
        });
    if (queue.length === 0 && this.analyses.length !== 0) {
      this.problem(
        "rust-module-cycle",
        this.analyses[0],
        "Selected Rust module files form a declaration cycle with no crate root.",
        "Select a root file that is not owned by another mod declaration.",
        "root-cycle",
      );
      for (const analysis of this.analyses)
        queue.push({
          analysis,
          rootKey: analysis.source.physicalPath,
          prefix: [],
        });
    }
    for (let index = 0; index < queue.length; ++index) {
      const placement = queue[index];
      if (placement === undefined) continue;
      const previous = this.placements.get(placement.analysis.source.id);
      if (previous !== undefined) {
        if (
          previous.rootKey !== placement.rootKey ||
          JSON.stringify(previous.prefix) !== JSON.stringify(placement.prefix)
        )
          this.problem(
            "rust-module-ownership",
            placement.analysis,
            "One selected Rust file resolves to more than one crate/module identity.",
            "Select an acyclic module tree with one owner for each file.",
            placement.analysis.source.id,
          );
        continue;
      }
      this.placements.set(placement.analysis.source.id, placement);
      for (const external of placement.analysis.externalModules) {
        const target = this.externalTargets.get(external.declarationId);
        if (target === undefined) continue;
        queue.push({
          analysis: target,
          rootKey: placement.rootKey,
          prefix: [...placement.prefix, ...external.modulePath, external.name],
          moduleDeclarationId: external.declarationId,
        });
      }
    }
    for (const analysis of this.analyses)
      if (!this.placements.has(analysis.source.id)) {
        this.problem(
          "rust-module-cycle",
          analysis,
          "A selected Rust file belongs to a disconnected module cycle.",
          "Break the cycle or select the containing crate root.",
          `disconnected:${analysis.source.id}`,
        );
        this.placements.set(analysis.source.id, {
          analysis,
          rootKey: analysis.source.physicalPath,
          prefix: [],
        });
      }
  }

  private attachExternalInnerDocumentation(): void {
    const sourceDeclarations = new Map<string, IEvidenceRustDeclaration>();
    for (const analysis of this.analyses)
      for (const declaration of analysis.declarations)
        sourceDeclarations.set(declaration.id, declaration);
    for (const placement of this.placements.values()) {
      if (placement.moduleDeclarationId === undefined) continue;
      const owner = sourceDeclarations.get(placement.moduleDeclarationId);
      if (owner === undefined) continue;
      for (const documentation of placement.analysis.documentation) {
        if (
          documentation.innerModulePath === undefined ||
          documentation.innerModulePath.length !== 0
        )
          continue;
        if (
          !documentation.attachments.some(
            (attachment) =>
              attachment.declarationId === owner.id &&
              attachment.siteId === owner.site.id,
          )
        )
          documentation.attachments.push({
            declarationId: owner.id,
            siteId: owner.site.id,
          });
      }
    }
  }

  private buildModules(): void {
    for (const placement of this.placements.values()) {
      const localPaths = new Map<string, string[]>();
      const remember = (value: string[]): void => {
        localPaths.set(JSON.stringify(value), value);
      };
      remember([]);
      for (const declaration of placement.analysis.declarations) {
        remember(declaration.modulePath);
        if (
          declaration.form === "module" &&
          !placement.analysis.externalModules.some(
            (external) => external.declarationId === declaration.id,
          )
        )
          remember([...declaration.modulePath, declaration.name]);
      }
      for (const use of placement.analysis.uses) remember(use.modulePath);
      for (const implementation of placement.analysis.implementations)
        remember(implementation.modulePath);
      for (const localPath of localPaths.values()) {
        const modulePath = [...placement.prefix, ...localPath];
        const key = this.moduleKey(placement.rootKey, modulePath);
        this.modules.set(key, {
          key,
          rootKey: placement.rootKey,
          path: modulePath,
          localPath,
          placement,
          bindings: new Map(),
          uses: placement.analysis.uses.filter(
            (use) =>
              JSON.stringify(use.modulePath) === JSON.stringify(localPath),
          ),
        });
      }
    }

    const rawDeclarations = new Map<string, IEvidenceRustDeclaration>();
    for (const analysis of this.analyses)
      for (const declaration of analysis.declarations)
        rawDeclarations.set(declaration.id, declaration);
    for (const module of this.modules.values()) {
      const declaration =
        module.localPath.length === 0
          ? module.placement.moduleDeclarationId === undefined
            ? undefined
            : rawDeclarations.get(module.placement.moduleDeclarationId)
          : this.findInlineModuleDeclaration(module);
      if (declaration !== undefined) module.declaration = declaration;
    }

    for (const placement of this.placements.values())
      for (const declaration of placement.analysis.declarations) {
        const module = this.modules.get(
          this.moduleKey(placement.rootKey, [
            ...placement.prefix,
            ...declaration.modulePath,
          ]),
        );
        if (module === undefined) continue;
        if (
          declaration.ownerDeclarationId === undefined &&
          declaration.implementationId === undefined
        ) {
          const located: IEvidenceRustLocatedDeclaration = {
            declaration,
            placement,
            module,
            identity: [...module.path, declaration.name],
          };
          this.declarations.set(declaration.id, located);
          const bindings = module.bindings.get(declaration.name) ?? [];
          bindings.push(declaration);
          module.bindings.set(declaration.name, bindings);
        }
      }
    for (const placement of this.placements.values())
      for (const declaration of placement.analysis.declarations) {
        if (this.declarations.has(declaration.id)) continue;
        const module = this.modules.get(
          this.moduleKey(placement.rootKey, [
            ...placement.prefix,
            ...declaration.modulePath,
          ]),
        );
        if (module === undefined) continue;
        const owner =
          declaration.ownerDeclarationId === undefined
            ? undefined
            : this.declarations.get(declaration.ownerDeclarationId);
        this.declarations.set(declaration.id, {
          declaration,
          placement,
          module,
          identity:
            owner === undefined
              ? [...module.path, declaration.name]
              : [...owner.identity, declaration.name],
        });
      }
    for (const located of this.declarations.values())
      if (located.declaration.form === "module") {
        const child = this.modules.get(
          this.moduleKey(located.module.rootKey, located.identity),
        );
        if (child !== undefined)
          this.childModules.set(located.declaration.id, child);
      }
  }

  private buildExports(): void {
    for (const module of this.modules.values()) {
      const entries = new Map<string, IEvidenceRustExportRecord[]>();
      this.exports.set(module.key, entries);
      for (const declarations of module.bindings.values())
        for (const declaration of declarations)
          if (declaration.visibility === "public")
            this.addExport(entries, {
              name: declaration.name,
              declaration,
              carrier: module.placement,
            });
    }
    const limit = Math.max(
      1,
      this.modules.size +
        this.analyses.reduce(
          (total, analysis) => total + analysis.uses.length,
          0,
        ),
    );
    for (let pass = 0; pass < limit; ++pass) {
      let changed = false;
      for (const module of this.modules.values()) {
        const entries = this.exports.get(module.key);
        if (entries === undefined) continue;
        for (const use of module.uses)
          for (const binding of use.bindings)
            if (binding.wildcard) {
              if (
                this.foreignUse(module, binding.path, true) &&
                !this.foreignStars.has(module.key)
              ) {
                this.foreignStars.add(module.key);
                changed = true;
              }
              const target = this.resolveModulePath(module, binding.path);
              const exported =
                target === undefined ? undefined : this.exports.get(target.key);
              const foreign: Set<string> | undefined =
                target === undefined
                  ? undefined
                  : this.foreignExports.get(target.key);
              if (foreign !== undefined) {
                const names: Set<string> =
                  this.foreignExports.get(module.key) ?? new Set<string>();
                for (const name of foreign)
                  if (!names.has(name)) {
                    names.add(name);
                    changed = true;
                  }
                this.foreignExports.set(module.key, names);
              }
              for (const records of exported === undefined
                ? []
                : exported.values())
                for (const record of records)
                  changed =
                    this.addExport(entries, {
                      name: record.name,
                      declaration: record.declaration,
                      carrier: module.placement,
                    }) || changed;
            } else {
              const records = this.resolveNamedPath(module, binding.path);
              const name = binding.alias ?? binding.path.at(-1);
              if (name === undefined) continue;
              if (this.foreignUse(module, binding.path, false)) {
                const names: Set<string> =
                  this.foreignExports.get(module.key) ?? new Set<string>();
                if (!names.has(name)) {
                  names.add(name);
                  this.foreignExports.set(module.key, names);
                  changed = true;
                }
              }
              for (const record of records)
                changed =
                  this.addExport(entries, {
                    name,
                    declaration: record.declaration,
                    carrier: module.placement,
                  }) || changed;
            }
      }
      if (!changed) break;
    }
    for (const module of this.modules.values()) {
      for (const use of module.uses)
        for (const binding of use.bindings) {
          const resolved = binding.wildcard
            ? this.resolveModulePath(module, binding.path) !== undefined
            : this.resolveNamedPath(module, binding.path).length !== 0;
          if (
            !resolved &&
            !this.foreignUse(module, binding.path, binding.wildcard)
          )
            this.problem(
              "rust-use-resolution",
              module.placement.analysis,
              `Public use target '${binding.path.join("::")}' cannot be resolved in the selected module graph.`,
              "Select its module sources or rewrite the reexport with a supported static local path.",
              `${use.id}:${JSON.stringify(binding)}`,
            );
        }
      const exported = this.exports.get(module.key);
      for (const [name, records] of exported ?? []) {
        const identities = new Set(
          records.map((record) => record.declaration.id),
        );
        if (identities.size > 1)
          this.problem(
            "rust-export-ambiguity",
            module.placement.analysis,
            `Rust public name '${[...module.path, name].join("::")}' resolves to more than one selected declaration.`,
            "Replace competing reexports or declarations with one unambiguous public binding.",
            `${module.key}:${name}:ambiguity`,
          );
      }
    }
  }

  /**
   * Recognizes dependency use paths that cannot introduce a local owner.
   *
   * Known foreign provenance follows local paths without enrolling dependency
   * declarations. Unresolved crate/self/super paths and known local names
   * retain resolution failures; absent bare crate names belong to the
   * dependency boundary.
   */
  private foreignUse(
    module: IEvidenceRustModuleRecord,
    sourcePath: string[],
    wildcard: boolean,
  ): boolean {
    const first: string | undefined = sourcePath[0];
    if (first === undefined) return false;
    const target: IEvidenceRustModuleRecord | undefined =
      this.resolveModulePath(
        module,
        wildcard ? sourcePath : sourcePath.slice(0, -1),
      );
    if (target !== undefined) {
      const name: string | undefined = sourcePath.at(-1);
      if (!wildcard && name !== undefined && target.bindings.has(name))
        return false;
      if (this.foreignStars.has(target.key)) return true;
      const names: Set<string> | undefined = this.foreignExports.get(
        target.key,
      );
      if (
        !wildcard &&
        name !== undefined &&
        names !== undefined &&
        names.has(name)
      )
        return true;
    }
    if (["crate", "self", "super"].includes(first)) return false;
    const root: IEvidenceRustModuleRecord | undefined = this.modules.get(
      this.moduleKey(module.rootKey, []),
    );
    if (root === undefined) return false;
    const exported: Map<string, IEvidenceRustExportRecord[]> | undefined =
      this.exports.get(root.key);
    return (
      !root.bindings.has(first) &&
      (exported === undefined || !exported.has(first)) &&
      !module.bindings.has(first)
    );
  }

  private resolveImplementations(): void {
    for (const placement of this.placements.values())
      for (const implementation of placement.analysis.implementations) {
        const module = this.modules.get(
          this.moduleKey(placement.rootKey, [
            ...placement.prefix,
            ...implementation.modulePath,
          ]),
        );
        if (module === undefined) continue;
        const members = placement.analysis.declarations.filter(
          (declaration) => declaration.implementationId === implementation.id,
        );
        if (
          implementation.ownerPath.length === 1 &&
          implementation.typeParameters.includes(
            implementation.ownerPath[0] ?? "",
          )
        ) {
          this.implProblem(
            implementation,
            placement.analysis,
            "A generic blanket impl has no single selected nominal owner.",
            "Limit Evidence ownership to an impl for one selected local struct or enum.",
          );
          continue;
        }
        const owners = this.resolveTypePath(
          module,
          implementation.ownerPath,
          new Set(["struct", "enum"]),
        );
        if (owners.length !== 1) {
          this.implProblem(
            implementation,
            placement.analysis,
            `Impl owner '${implementation.ownerPath.join("::")}' does not resolve to one selected local nominal type.`,
            "Select the owner's module source and use one unambiguous local struct or enum path.",
          );
          continue;
        }
        const owner = owners[0];
        if (owner === undefined) continue;
        const trait =
          implementation.traitPath === undefined
            ? []
            : this.resolveTypePath(
                module,
                implementation.traitPath,
                new Set(["trait"]),
              );
        const explicitlyLocalTrait =
          implementation.traitPath?.[0] === "crate" ||
          implementation.traitPath?.[0] === "self" ||
          implementation.traitPath?.[0] === "super";
        if (
          explicitlyLocalTrait &&
          implementation.traitPath !== undefined &&
          trait.length !== 1
        ) {
          this.implProblem(
            implementation,
            placement.analysis,
            `Trait path '${implementation.traitPath.join("::")}' does not resolve to one selected local trait.`,
            "Select the trait module or use one supported unambiguous path.",
          );
          continue;
        }
        const qualifier =
          implementation.traitPath === undefined
            ? undefined
            : `impl ${implementation.traitPath.join("::")}`;
        for (const member of members) {
          const located = this.declarations.get(member.id);
          if (located === undefined) continue;
          located.identity = [
            ...owner.identity,
            ...(qualifier === undefined ? [] : [qualifier]),
            member.memberSegment ?? member.name,
          ];
          const resolved: IEvidenceRustResolvedMember = {
            declaration: located,
            owner,
            ...(qualifier === undefined ? {} : { qualifier }),
            ...(trait[0] === undefined
              ? {}
              : { localTraitId: trait[0].declaration.id }),
          };
          const records = this.implMembers.get(owner.declaration.id) ?? [];
          records.push(resolved);
          this.implMembers.set(owner.declaration.id, records);
        }
      }
  }

  private collectOccurrences(): IEvidenceRustPublicOccurrence[] {
    const output: IEvidenceRustPublicOccurrence[] = [];
    const roots = Array.from(this.modules.values()).filter(
      (module) =>
        module.path.length === 0 && module.placement.prefix.length === 0,
    );
    for (const root of roots)
      this.collectModule(root, [], root.placement, new Set<string>(), output);
    return output;
  }

  private collectModule(
    module: IEvidenceRustModuleRecord,
    prefix: string[],
    namespaceCarrier: IEvidenceRustFilePlacement,
    ancestors: Set<string>,
    output: IEvidenceRustPublicOccurrence[],
  ): void {
    const entries = this.exports.get(module.key);
    for (const [name, records] of entries ?? [])
      for (const exported of records) {
        const located = this.declarations.get(exported.declaration.id);
        if (located === undefined) continue;
        const publicPath = [...prefix, name];
        output.push({ located, exported, namespaceCarrier, publicPath });
        if (located.declaration.form !== "module") continue;
        const child = this.childModules.get(located.declaration.id);
        if (child === undefined) continue;
        if (ancestors.has(located.declaration.id)) {
          this.problem(
            "rust-reexport-cycle",
            located.placement.analysis,
            `Public module alias '${publicPath.join("::")}' forms a recursive reexport path.`,
            "Break the module reexport cycle or expose finite named items directly.",
            `${located.declaration.id}:${JSON.stringify(publicPath)}`,
          );
          continue;
        }
        const nested = new Set(ancestors);
        nested.add(located.declaration.id);
        this.collectModule(child, publicPath, exported.carrier, nested, output);
      }
  }

  private materialize(occurrences: IEvidenceRustPublicOccurrence[]): void {
    const reachable = new Set(
      occurrences.map((occurrence) => occurrence.located.declaration.id),
    );
    const roots = new Map(
      Array.from(this.placements.values())
        .filter((placement) => placement.prefix.length === 0)
        .map((placement) => [placement.rootKey, placement]),
    );
    for (const occurrence of occurrences) {
      const located = occurrence.located;
      const parent = located.module.declaration;
      const parentDeclaration =
        parent !== undefined && reachable.has(parent.id)
          ? this.declarations.get(parent.id)
          : undefined;
      const parentId =
        parentDeclaration === undefined
          ? undefined
          : this.unitId(parentDeclaration);
      const unit = this.unit(located, parentId);
      this.publishOccurrenceAddresses(
        unit,
        occurrence,
        roots.get(located.module.rootKey),
      );
      if (located.declaration.symbol !== "type") continue;
      this.materializeOwnedMembers(occurrence, unit, reachable, roots);
    }
  }

  private materializeOwnedMembers(
    occurrence: IEvidenceRustPublicOccurrence,
    ownerUnit: IEvidenceUnit,
    reachable: Set<string>,
    roots: Map<string, IEvidenceRustFilePlacement>,
  ): void {
    const owner = occurrence.located;
    const direct = Array.from(this.declarations.values()).filter(
      (located) =>
        located.declaration.ownerDeclarationId === owner.declaration.id &&
        (located.declaration.visibility === "public" ||
          located.declaration.visibility === "implicit"),
    );
    for (const member of direct)
      this.materializeMember(
        occurrence,
        ownerUnit,
        member,
        [member.declaration.name],
        roots.get(owner.module.rootKey),
      );
    for (const resolved of this.implMembers.get(owner.declaration.id) ?? []) {
      if (
        resolved.declaration.declaration.visibility !== "public" &&
        resolved.declaration.declaration.visibility !== "implicit"
      )
        continue;
      if (
        resolved.localTraitId !== undefined &&
        !reachable.has(resolved.localTraitId)
      )
        continue;
      const suffix = [
        ...(resolved.qualifier === undefined ? [] : [resolved.qualifier]),
        resolved.declaration.declaration.name,
      ];
      this.materializeMember(
        occurrence,
        ownerUnit,
        resolved.declaration,
        suffix,
        roots.get(owner.module.rootKey),
      );
    }
  }

  private materializeMember(
    occurrence: IEvidenceRustPublicOccurrence,
    ownerUnit: IEvidenceUnit,
    member: IEvidenceRustLocatedDeclaration,
    suffix: string[],
    root: IEvidenceRustFilePlacement | undefined,
  ): void {
    const unit = this.unit(member, ownerUnit.id);
    const publicPath = [...occurrence.publicPath, ...suffix];
    if (root !== undefined) this.publishAddress(unit.id, root, publicPath);
    this.publishAddress(
      unit.id,
      occurrence.namespaceCarrier,
      this.relative(publicPath, occurrence.namespaceCarrier.prefix),
    );
    this.publishAddress(
      unit.id,
      occurrence.exported.carrier,
      this.relative(publicPath, occurrence.exported.carrier.prefix),
    );
    const origin = this.relative(member.identity, member.placement.prefix);
    this.publishAddress(
      unit.id,
      member.placement,
      origin.length === member.identity.length &&
        member.placement.prefix.length !== 0
        ? [occurrence.publicPath.at(-1) ?? ownerUnit.name, ...suffix]
        : origin,
    );
  }

  private publishOccurrenceAddresses(
    unit: IEvidenceUnit,
    occurrence: IEvidenceRustPublicOccurrence,
    root: IEvidenceRustFilePlacement | undefined,
  ): void {
    if (root !== undefined)
      this.publishAddress(unit.id, root, occurrence.publicPath);
    this.publishAddress(
      unit.id,
      occurrence.namespaceCarrier,
      this.relative(occurrence.publicPath, occurrence.namespaceCarrier.prefix),
    );
    this.publishAddress(
      unit.id,
      occurrence.exported.carrier,
      this.relative(occurrence.publicPath, occurrence.exported.carrier.prefix),
    );
    this.publishAddress(
      unit.id,
      occurrence.located.placement,
      this.relative(
        occurrence.located.identity,
        occurrence.located.placement.prefix,
      ),
    );
  }

  private unit(
    located: IEvidenceRustLocatedDeclaration,
    parentId: string | undefined,
  ): IEvidenceUnit {
    const id = this.unitId(located);
    const declarationIds = this.unitDeclarations.get(id) ?? new Set<string>();
    if (
      declarationIds.size !== 0 &&
      !declarationIds.has(located.declaration.id)
    )
      this.problem(
        "rust-declaration-conflict",
        located.placement.analysis,
        `Rust public identity '${located.identity.join("::")}' has more than one selected declaration.`,
        "Select one declaration for this crate identity or resolve conditional alternatives before checking coverage.",
        `${id}:${located.declaration.id}:declaration`,
      );
    declarationIds.add(located.declaration.id);
    this.unitDeclarations.set(id, declarationIds);
    const identityKey = JSON.stringify([
      located.module.rootKey,
      located.identity,
    ]);
    const previousIdentity = this.identities.get(identityKey);
    if (previousIdentity !== undefined && previousIdentity !== id)
      this.problem(
        "rust-identity-conflict",
        located.placement.analysis,
        `Rust public identity '${located.identity.join("::")}' has conflicting symbol kinds.`,
        "Rename one associated item or expose it through an unambiguous path.",
        `${identityKey}:kind`,
      );
    else this.identities.set(identityKey, id);
    let unit = this.units.get(id);
    if (unit === undefined) {
      unit = {
        id,
        type: "rust",
        symbol: located.declaration.symbol,
        identity: located.identity,
        name: located.declaration.name,
        sites: [structuredClone(located.declaration.site)],
        withdrawals: [],
        ...(parentId === undefined ? {} : { parentId }),
      };
      this.units.set(id, unit);
    } else if (
      !unit.sites.some((site) => site.id === located.declaration.site.id)
    )
      unit.sites.push(structuredClone(located.declaration.site));
    this.published.set(located.declaration.id, id);
    return unit;
  }

  private unitId(located: IEvidenceRustLocatedDeclaration): string {
    return `rust:${located.module.rootKey}:${located.declaration.symbol}:${JSON.stringify(located.identity)}`;
  }

  private resolveTypePath(
    module: IEvidenceRustModuleRecord,
    sourcePath: string[],
    forms: Set<string>,
  ): IEvidenceRustLocatedDeclaration[] {
    const candidates = this.resolvePathCandidates(module, sourcePath, true);
    return this.uniqueLocated(
      candidates.flatMap((record) => {
        const located = this.declarations.get(record.declaration.id);
        return located !== undefined && forms.has(located.declaration.form)
          ? [located]
          : [];
      }),
    );
  }

  private resolveNamedPath(
    module: IEvidenceRustModuleRecord,
    sourcePath: string[],
  ): IEvidenceRustExportRecord[] {
    return this.resolvePathCandidates(module, sourcePath, false).filter(
      (record) => record.declaration.visibility === "public",
    );
  }

  private resolvePathCandidates(
    module: IEvidenceRustModuleRecord,
    sourcePath: string[],
    currentForBare: boolean,
  ): IEvidenceRustExportRecord[] {
    if (sourcePath.length === 0) return [];
    const name = sourcePath.at(-1);
    if (name === undefined) return [];
    const target = this.resolveModuleSegments(
      module,
      sourcePath.slice(0, -1),
      currentForBare,
    );
    if (target === undefined) return [];
    const direct = (target.bindings.get(name) ?? []).map((declaration) => ({
      name,
      declaration,
      carrier: target.placement,
    }));
    const targetExports = this.exports.get(target.key);
    const exported =
      targetExports === undefined ? [] : (targetExports.get(name) ?? []);
    return this.uniqueExports([...direct, ...exported]);
  }

  private resolveModulePath(
    module: IEvidenceRustModuleRecord,
    sourcePath: string[],
  ): IEvidenceRustModuleRecord | undefined {
    return this.resolveModuleSegments(module, sourcePath, false);
  }

  private resolveModuleSegments(
    module: IEvidenceRustModuleRecord,
    sourcePath: string[],
    currentForBare: boolean,
  ): IEvidenceRustModuleRecord | undefined {
    let current = module;
    let index = 0;
    const first = sourcePath[0];
    if (first === "crate") {
      const root = this.modules.get(this.moduleKey(module.rootKey, []));
      if (root === undefined) return undefined;
      current = root;
      index = 1;
    } else if (first === "self") index = 1;
    else if (first === "super") {
      while (sourcePath[index] === "super") {
        const parent = this.modules.get(
          this.moduleKey(module.rootKey, current.path.slice(0, -1)),
        );
        if (parent === undefined) return undefined;
        current = parent;
        ++index;
      }
    } else if (!currentForBare) {
      const root = this.modules.get(this.moduleKey(module.rootKey, []));
      if (root === undefined) return undefined;
      current = root;
    }
    for (; index < sourcePath.length; ++index) {
      const segment = sourcePath[index];
      if (segment === undefined) return undefined;
      const currentExports = this.exports.get(current.key);
      const records = [
        ...(current.bindings.get(segment) ?? []).map((declaration) => ({
          name: segment,
          declaration,
          carrier: current.placement,
        })),
        ...(currentExports === undefined
          ? []
          : (currentExports.get(segment) ?? [])),
      ].filter((record) => record.declaration.form === "module");
      const modules = Array.from(
        new Map(
          records.flatMap((record) => {
            const child = this.childModules.get(record.declaration.id);
            return child === undefined ? [] : [[child.key, child]];
          }),
        ).values(),
      );
      if (modules.length !== 1) return undefined;
      const child = modules[0];
      if (child === undefined) return undefined;
      current = child;
    }
    return current;
  }

  private addExport(
    entries: Map<string, IEvidenceRustExportRecord[]>,
    record: IEvidenceRustExportRecord,
  ): boolean {
    const values = entries.get(record.name) ?? [];
    const key = JSON.stringify([
      record.name,
      record.declaration.id,
      record.carrier.analysis.source.id,
    ]);
    if (
      values.some(
        (value) =>
          JSON.stringify([
            value.name,
            value.declaration.id,
            value.carrier.analysis.source.id,
          ]) === key,
      )
    )
      return false;
    values.push(record);
    entries.set(record.name, values);
    return true;
  }

  private uniqueExports(
    records: IEvidenceRustExportRecord[],
  ): IEvidenceRustExportRecord[] {
    return Array.from(
      new Map(
        records.map((record) => [record.declaration.id, record]),
      ).values(),
    );
  }

  private uniqueLocated(
    records: IEvidenceRustLocatedDeclaration[],
  ): IEvidenceRustLocatedDeclaration[] {
    return Array.from(
      new Map(
        records.map((record) => [record.declaration.id, record]),
      ).values(),
    );
  }

  private findInlineModuleDeclaration(
    module: IEvidenceRustModuleRecord,
  ): IEvidenceRustDeclaration | undefined {
    const name = module.localPath.at(-1);
    const parent = module.localPath.slice(0, -1);
    return module.placement.analysis.declarations.find(
      (declaration) =>
        declaration.form === "module" &&
        declaration.name === name &&
        JSON.stringify(declaration.modulePath) === JSON.stringify(parent),
    );
  }

  private moduleDirectory(filename: string): string {
    const basename = path.basename(filename);
    return basename === "lib.rs" ||
      basename === "main.rs" ||
      basename === "mod.rs"
      ? path.dirname(filename)
      : path.join(path.dirname(filename), basename.slice(0, -3));
  }

  private sourceLocations(analysis: IEvidenceRustFileAnalysis): string[] {
    return Array.from(
      new Set([
        EvidenceSourcePath.slash(analysis.source.physicalPath),
        ...analysis.source.addresses.map((address) =>
          EvidenceSourcePath.slash(address.absolute),
        ),
      ]),
    );
  }

  private moduleKey(rootKey: string, modulePath: string[]): string {
    return JSON.stringify([rootKey, modulePath]);
  }

  private relative(value: string[], prefix: string[]): string[] {
    return prefix.every((segment, index) => value[index] === segment)
      ? value.slice(prefix.length)
      : value;
  }

  private publishAddress(
    unitId: string,
    placement: IEvidenceRustFilePlacement,
    segments: string[],
  ): void {
    if (segments.length === 0) return;
    for (const location of placement.analysis.source.addresses) {
      const address: IEvidencePublicAddress = {
        unitId,
        file: location.absolute,
        segments,
      };
      const key = JSON.stringify(address);
      if (this.addresses.has(key)) continue;
      this.addresses.add(key);
      this.inventory.addresses.push(address);
    }
  }

  private implProblem(
    implementation: IEvidenceRustImplementation,
    analysis: IEvidenceRustFileAnalysis,
    message: string,
    repair: string,
  ): void {
    this.problem(
      "rust-impl-owner",
      analysis,
      message,
      repair,
      implementation.id,
    );
  }

  private problem(
    code: string,
    analysis: IEvidenceRustFileAnalysis | undefined,
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
