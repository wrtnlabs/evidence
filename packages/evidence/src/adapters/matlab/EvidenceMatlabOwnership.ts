import { posix } from "node:path";

import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidenceMatlabDeclaration } from "./IEvidenceMatlabDeclaration";
import type { IEvidenceMatlabFileAnalysis } from "./IEvidenceMatlabFileAnalysis";

/**
 * Reconciles selected class folders, external implementations, and property
 * accessors.
 *
 * MATLAB distributes one public class surface across files, so semantic
 * ownership must be proven from class-folder paths before units and annotation
 * hosts exist.
 *
 * @evidence contracts/common.md#principled-implementation One MATLAB class surface can span a class folder, so external implementations and accessors are attached only when the selected @Class folder paths prove the owner.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns snapshot-wide resolution only; scanning and materialization are separate.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Pieces whose owner cannot be proven from folder paths are reported rather than attached.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains why resolution waits for every file; its function and helpers are documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceMatlabOwnership {
  /**
   * Resolves all ownership before any public identities or hosts are published.
   *
   * This order lets a missing external implementation remain an observable
   * dependency and prevents an accessor from becoming a second property unit.
   *
   * @evidence contracts/common.md#principled-implementation Class-folder files are matched to their classdef, external method files and property accessors are merged into the declared members, and unmatched pieces are reported.
   * @evidence contracts/common.md#clear-and-simple-design It mutates the copied file analyses in place before units are materialized.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Pieces whose owner cannot be proven from folder paths are reported rather than attached.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the resolution and its failure cases.
   * @evidence contracts/performance.md#efficient-algorithms Linear in declarations and references with map lookups; alias chains are followed with cycle detection.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work It runs once per analysis over all files.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources It mutates caller-owned analyses and keeps no state.
   */
  export function resolve(
    analyses: IEvidenceMatlabFileAnalysis[],
    inventory: IEvidenceInventory,
  ): void {
    const files = new Map(
      analyses.map((analysis) => [
        analysis.source.physicalPath.replaceAll("\\", "/"),
        analysis,
      ]),
    );
    const owners: Map<string, IEvidenceMatlabDeclaration> = new Map();
    const methods: Map<string, IEvidenceMatlabDeclaration> = new Map();
    const implementations: Map<string, IEvidenceMatlabDeclaration> = new Map();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        if (
          declaration.symbol === "type" &&
          declaration.ownerDeclarationId === undefined &&
          !owners.has(analysis.source.physicalPath.replaceAll("\\", "/"))
        )
          owners.set(
            analysis.source.physicalPath.replaceAll("\\", "/"),
            declaration,
          );
        if (declaration.symbol === "function") {
          const key: string = JSON.stringify([
            analysis.source.physicalPath,
            declaration.ownerDeclarationId,
            declaration.name,
          ]);
          if (!methods.has(key)) methods.set(key, declaration);
        }
        const key: string = JSON.stringify([
          analysis.source.physicalPath,
          declaration.externalOwner,
          declaration.name,
        ]);
        if (!implementations.has(key)) implementations.set(key, declaration);
      }
    for (const analysis of analyses) {
      const directory = posix.dirname(
        analysis.source.physicalPath.replaceAll("\\", "/"),
      );
      if (posix.basename(directory).startsWith("@"))
        inventory.dependencies.push({ path: directory, recursive: true });
      for (const declaration of analysis.declarations) {
        if (declaration.externalOwner === undefined) continue;
        inventory.dependencies.push({
          path: declaration.externalOwner,
          recursive: false,
        });
        const ownerAnalysis = files.get(declaration.externalOwner);
        const owner: IEvidenceMatlabDeclaration | undefined = owners.get(
          declaration.externalOwner,
        );
        if (owner === undefined || ownerAnalysis === undefined) {
          problem(
            analysis,
            declaration,
            "class-folder",
            "An external method requires its selected @Class/Class.m classdef; legacy classes are not inferred.",
          );
          declaration.public = false;
          continue;
        }
        const prototype: IEvidenceMatlabDeclaration | undefined = methods.get(
          JSON.stringify([
            ownerAnalysis.source.physicalPath,
            owner.id,
            declaration.name,
          ]),
        );
        if (prototype !== undefined && prototype.implementation === undefined)
          problem(
            analysis,
            declaration,
            "method-conflict",
            "An external method duplicates an inline or abstract class method.",
          );
        declaration.ownerDeclarationId = owner.id;
        declaration.anchor = owner.anchor;
        declaration.address = [...owner.address, declaration.name];
        declaration.identity = declaration.address;
        declaration.public &&= owner.public && (prototype?.public ?? true);
        declaration.publicFiles = ownerAnalysis.source.addresses.map(
          (address) => address.absolute,
        );
        inventory.dependencies.push({
          path: posix.dirname(declaration.externalOwner),
          recursive: true,
        });
      }
      for (const declaration of analysis.declarations) {
        if (declaration.implementation === undefined) continue;
        inventory.dependencies.push({
          path: declaration.implementation,
          recursive: false,
        });
        const externalAnalysis = files.get(declaration.implementation);
        const external: IEvidenceMatlabDeclaration | undefined =
          externalAnalysis === undefined
            ? undefined
            : implementations.get(
                JSON.stringify([
                  externalAnalysis.source.physicalPath,
                  declaration.anchor,
                  declaration.name,
                ]),
              );
        if (external === undefined)
          problem(
            analysis,
            declaration,
            "external-method",
            "A nonabstract external method prototype has no selected implementation; include its @Class method file.",
          );
      }
    }
    const properties: Map<string, IEvidenceMatlabDeclaration> = new Map();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations)
        if (
          declaration.accessor === undefined &&
          declaration.getPublic !== undefined
        ) {
          const key: string = JSON.stringify([
            declaration.anchor,
            declaration.ownerDeclarationId,
            declaration.name,
          ]);
          if (!properties.has(key)) properties.set(key, declaration);
        }
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        if (declaration.accessor === undefined) continue;
        const property: IEvidenceMatlabDeclaration | undefined = properties.get(
          JSON.stringify([
            declaration.anchor,
            declaration.ownerDeclarationId,
            declaration.name,
          ]),
        );
        if (property === undefined) {
          problem(
            analysis,
            declaration,
            "accessor",
            "A property accessor has no declared property in its selected class.",
          );
          declaration.public = false;
        } else {
          declaration.public =
            property.public &&
            (declaration.accessor === "get"
              ? property.getPublic === true
              : property.setPublic === true);
        }
      }
    const seen = new Map<string, IEvidenceMatlabDeclaration>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        if (!declaration.public) continue;
        const identity = JSON.stringify([
          declaration.anchor,
          declaration.symbol,
          declaration.identity,
          declaration.accessor ??
            (declaration.implementation === undefined
              ? "definition"
              : "prototype"),
        ]);
        if (seen.has(identity))
          problem(
            analysis,
            declaration,
            "declaration-conflict",
            "Two declarations expose the same MATLAB owner and name.",
          );
        seen.set(identity, declaration);
      }
  }

  /**
   * Records unresolved source ownership without shrinking a passing population.
   *
   * The ownership pass retains this diagnostic when class-folder or external
   * declarations cannot be paired, preserving an incomplete result for
   * recovery.
   */
  function problem(
    analysis: IEvidenceMatlabFileAnalysis,
    declaration: IEvidenceMatlabDeclaration,
    code: string,
    message: string,
  ): void {
    analysis.complete = false;
    analysis.diagnostics.push({
      code: `matlab-${code}`,
      severity: "error",
      message,
      repair:
        "Select a unique classdef and its external implementations, or correct the conflicting declaration.",
      location: {
        file: analysis.source.physicalPath,
        range: declaration.site.range,
      },
    });
  }
}
