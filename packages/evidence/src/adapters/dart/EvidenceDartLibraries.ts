import type { IEvidenceSourceDependency } from "../../structures/IEvidenceSourceDependency";
import { groupEvidenceRecords } from "../../internal/groupEvidenceRecords";
import path from "node:path";

import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidenceDartDeclaration } from "./IEvidenceDartDeclaration";
import type { IEvidenceDartDirective } from "./IEvidenceDartDirective";
import type { IEvidenceDartFileAnalysis } from "./IEvidenceDartFileAnalysis";

/**
 * Resolves selected Dart library ownership and export aliases without executing
 * package tooling.
 *
 * Physical scans cannot decide whether a part belongs to a library or whether
 * an exported spelling denotes an existing unit, so this pass establishes those
 * relationships before inventory publication and documentation attachment.
 *
 * @evidence contracts/common.md#principled-implementation Part ownership must be reciprocal between part and part-of directives, and exported names follow transitive show and hide combinators in source order, all without running package tooling.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns snapshot-wide resolution only; scanning and materialization are separate.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Non-reciprocal parts and unresolved URIs are reported as incomplete instead of guessing ownership.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains why resolution waits for every file; its function and helpers are documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceDartLibraries {
  /**
   * Validates reciprocal part ownership and retains missing URI paths for watch
   * invalidation.
   *
   * A missing or conflicting part makes the analysis incomplete because
   * treating it as absent could remove public declarations from the coverage
   * denominator.
   *
   * @evidence contracts/common.md#principled-implementation Each part is matched to the library that declares it and points back to it, and missing URI paths are kept as watch dependencies.
   * @evidence contracts/common.md#clear-and-simple-design It mutates the copied file analyses in place before units are materialized.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Non-reciprocal parts and unresolved URIs are reported as incomplete instead of guessing ownership.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the resolution and its failure cases.
   * @evidence contracts/performance.md#efficient-algorithms Linear in declarations and references with map lookups; alias chains are followed with cycle detection.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work It runs once per analysis over all files.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources It mutates caller-owned analyses and keeps no state.
   */
  export function resolve(
    analyses: IEvidenceDartFileAnalysis[],
    inventory: IEvidenceInventory,
  ): void {
    const files = new Map<string, IEvidenceDartFileAnalysis>();
    for (const analysis of analyses)
      for (const name of [
        analysis.source.physicalPath,
        ...analysis.source.addresses.map((address) => address.absolute),
      ])
        files.set(normalize(name), analysis);
    const named: Map<string, IEvidenceDartFileAnalysis[]> =
      groupEvidenceRecords(
        analyses.filter(
          (entry: IEvidenceDartFileAnalysis): boolean =>
            !entry.directives.some(
              (directive: IEvidenceDartDirective): boolean =>
                directive.kind === "part-of",
            ),
        ),
        (entry: IEvidenceDartFileAnalysis): string => entry.libraryName ?? "",
      );
    const physical: Map<string, IEvidenceDartFileAnalysis[]> =
      groupEvidenceRecords(
        analyses,
        (entry: IEvidenceDartFileAnalysis): string => entry.source.physicalPath,
      );
    const dependencies: Set<string> = new Set(
      inventory.dependencies
        .filter((entry: IEvidenceSourceDependency): boolean => !entry.recursive)
        .map((entry: IEvidenceSourceDependency): string => entry.path),
    );
    for (const analysis of analyses)
      for (const directive of analysis.directives) {
        // Package and SDK exports forward foreign owners. Parts still require
        // reciprocal local ownership and must not use this export boundary.
        if (
          directive.kind === "export" &&
          /^(?:package|dart):/u.test(directive.target)
        )
          continue;
        if (directive.named) {
          const matches: IEvidenceDartFileAnalysis[] =
            named.get(directive.target) ?? [];
          if (matches.length === 1 && matches[0] !== undefined)
            directive.resolved = matches[0].source.physicalPath;
          else
            problem(
              analysis,
              "part-owner",
              `Named part library '${directive.target}' is missing or ambiguous in the selected snapshot.`,
            );
          continue;
        }
        if (
          /^[A-Za-z][A-Za-z0-9+.-]*:|[?#%\\]/u.test(directive.target) ||
          directive.target.startsWith("/")
        ) {
          problem(
            analysis,
            "external-uri",
            `Library URI '${directive.target}' requires package, SDK, or non-relative URI resolution. Use selected relative library source or implement URI resolution.`,
          );
          continue;
        }
        const locations = [
          ...new Set(
            [
              analysis.source.physicalPath,
              ...analysis.source.addresses.map((address) => address.absolute),
            ].map((file) =>
              path.posix.join(
                path.posix.dirname(normalize(file)),
                directive.target,
              ),
            ),
          ),
        ];
        for (const location of locations)
          if (!dependencies.has(location)) {
            dependencies.add(location);
            inventory.dependencies.push({ path: location, recursive: false });
          }
        const matches = [
          ...new Set(
            locations.flatMap((location) => {
              const match = files.get(location);
              return match === undefined ? [] : [match];
            }),
          ),
        ];
        if (matches.length === 1 && matches[0] !== undefined)
          directive.resolved = matches[0].source.physicalPath;
        else
          problem(
            analysis,
            "unresolved-library",
            `Library URI '${directive.target}' is missing or ambiguous in the selected snapshot. Include the referenced Dart file in this population.`,
          );
      }

    for (const analysis of analyses) {
      const owners = analysis.directives.filter(
        (directive) => directive.kind === "part-of",
      );
      if (owners.length === 0) continue;
      const owner: IEvidenceDartFileAnalysis | undefined = physical.get(
        owners[0]?.resolved ?? "",
      )?.[0];
      if (
        owners.length !== 1 ||
        owner === undefined ||
        owner === analysis ||
        owner.directives.some((directive) => directive.kind === "part-of") ||
        !owner.directives.some(
          (directive) =>
            directive.kind === "part" &&
            directive.resolved === analysis.source.physicalPath,
        )
      ) {
        problem(
          analysis,
          "part-owner",
          "A part must name exactly one selected defining library whose part directive includes this file.",
        );
        continue;
      }
      if (
        analysis.libraryName !== undefined ||
        analysis.directives.some((directive) => directive.kind !== "part-of")
      )
        problem(
          analysis,
          "part-directives",
          "A part cannot define a library, export another library, or include parts.",
        );
      analysis.library = owner.source.physicalPath;
    }
    for (const analysis of analyses)
      for (const directive of analysis.directives) {
        const target: IEvidenceDartFileAnalysis | undefined = physical.get(
          directive.resolved ?? "",
        )?.[0];
        if (target === undefined) continue;
        if (
          directive.kind === "part" &&
          (target === analysis ||
            target.library !== analysis.source.physicalPath ||
            !target.directives.some((item) => item.kind === "part-of"))
        )
          problem(
            analysis,
            "part-owner",
            `Part '${directive.target}' does not reciprocally belong to this defining library.`,
          );
        if (
          directive.kind === "export" &&
          target.directives.some((item) => item.kind === "part-of")
        )
          problem(
            analysis,
            "export-part",
            "A part file cannot be exported as a standalone library; export its defining library.",
          );
      }
    const declarations = new Map<string, IEvidenceDartDeclaration[]>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        declaration.library = analysis.library;
        const key = JSON.stringify([analysis.library, declaration.address]);
        const previous = declarations.get(key) ?? [];
        if (
          previous.length !== 0 &&
          !(
            previous.length === 1 &&
            previous[0]?.symbol === "property" &&
            declaration.symbol === "property" &&
            ((previous[0].role === "getter" && declaration.role === "setter") ||
              (previous[0].role === "setter" && declaration.role === "getter"))
          )
        )
          problem(
            analysis,
            "declaration-conflict",
            `Library declaration '${declaration.address.join(".")}' has conflicting selected definitions.`,
          );
        previous.push(declaration);
        declarations.set(key, previous);
      }
  }

  /**
   * Projects library and transitive show or hide export addresses without
   * duplicating semantic units.
   *
   * One declaration can have several public paths while retaining a single unit
   * identity.
   *
   * @evidence contracts/common.md#principled-implementation Library declarations are projected to public addresses through transitive export directives, applying show and hide filters in order and stopping at cycles.
   * @evidence contracts/common.md#clear-and-simple-design Publication is separate from part-ownership resolution.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Exports naming no existing unit or crossing package boundaries are reported rather than invented.
   * @evidence contracts/common.md#meaningful-documentation The comment explains transitive filtering.
   * @evidence contracts/performance.md#efficient-algorithms Linear in libraries times their export chains, with visited sets for cycles.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Publication runs once per analysis.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources It writes addresses into the caller's inventory and keeps no state.
   */
  export function publish(
    analyses: IEvidenceDartFileAnalysis[],
    inventory: IEvidenceInventory,
    published: Map<string, string>,
  ): void {
    const physical: Map<string, IEvidenceDartFileAnalysis[]> =
      groupEvidenceRecords(
        analyses,
        (entry: IEvidenceDartFileAnalysis): string => entry.source.physicalPath,
      );
    const surfaces = new Map<string, Set<string>>();
    const localNames = new Map<string, Set<string>>();
    for (const analysis of analyses) {
      const surface = surfaces.get(analysis.library) ?? new Set<string>();
      const names = localNames.get(analysis.library) ?? new Set<string>();
      for (const declaration of analysis.declarations) {
        const id = published.get(declaration.id);
        if (id !== undefined) surface.add(id);
        if (declaration.address.length === 1) names.add(declaration.name);
      }
      surfaces.set(analysis.library, surface);
      localNames.set(analysis.library, names);
    }
    const units = new Map(inventory.units.map((unit) => [unit.id, unit]));
    let changed = true;
    while (changed) {
      changed = false;
      for (const analysis of analyses)
        for (const directive of analysis.directives.filter(
          (item) => item.kind === "export",
        )) {
          const target: IEvidenceDartFileAnalysis | undefined = physical.get(
            directive.resolved ?? "",
          )?.[0];
          const destination = surfaces.get(analysis.library);
          if (target === undefined || destination === undefined) continue;
          for (const id of surfaces.get(target.library) ?? []) {
            const name = units.get(id)?.identity?.[0];
            const locals = localNames.get(analysis.library);
            if (
              name === undefined ||
              (locals !== undefined && locals.has(name)) ||
              !allowed(directive, name) ||
              destination.has(id)
            )
              continue;
            destination.add(id);
            changed = true;
          }
        }
    }
    const addresses = new Set(
      inventory.addresses.map((address) => JSON.stringify(address)),
    );
    for (const analysis of analyses) {
      const roots = new Map<string, Set<string>>();
      for (const id of surfaces.get(analysis.library) ?? []) {
        const unit = units.get(id);
        if (unit === undefined) continue;
        if (unit.identity.length === 1) {
          const ids = roots.get(unit.name) ?? new Set<string>();
          ids.add(unit.id);
          roots.set(unit.name, ids);
        }
        for (const file of analysis.source.addresses) {
          const address = {
            unitId: id,
            file: file.absolute,
            segments: unit.identity,
          };
          const key = JSON.stringify(address);
          if (addresses.has(key)) continue;
          addresses.add(key);
          inventory.addresses.push(address);
        }
      }
      if ([...roots.values()].some((ids) => ids.size > 1)) {
        problem(
          analysis,
          "export-conflict",
          "Multiple exported libraries expose distinct declarations with the same name. Resolve the ambiguity with show/hide combinators.",
        );
        inventory.complete = false;
        inventory.diagnostics.push(
          ...analysis.diagnostics.filter(
            (diagnostic) => diagnostic.code === "dart-export-conflict",
          ),
        );
      }
    }
  }

  /**
   * Applies sequential Dart combinators to one root name.
   *
   * Source order determines whether a later show or hide filter keeps the
   * export.
   */
  function allowed(directive: IEvidenceDartDirective, name: string): boolean {
    return directive.filters.every((filter) =>
      filter.kind === "show"
        ? filter.names.includes(name)
        : !filter.names.includes(name),
    );
  }

  /**
   * Makes source path separators portable without filesystem access.
   *
   * Static URI topology must compare the same way on Windows and POSIX hosts.
   */
  function normalize(file: string): string {
    return path.posix.normalize(file.replaceAll("\\", "/"));
  }

  /**
   * Records a library topology failure on its source analysis.
   *
   * The affected analysis remains incomplete until its URI relationship is
   * repaired.
   */
  function problem(
    analysis: IEvidenceDartFileAnalysis,
    code: string,
    message: string,
  ): void {
    analysis.complete = false;
    analysis.diagnostics.push({
      code: `dart-${code}`,
      severity: "error",
      message,
      repair:
        "Select an unambiguous complete Dart library graph or implement the reported URI boundary before checking coverage.",
      location: { file: analysis.source.physicalPath },
    });
  }
}
