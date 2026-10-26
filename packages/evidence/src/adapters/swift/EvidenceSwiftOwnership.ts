import { groupEvidenceRecords } from "../../internal/groupEvidenceRecords";
import type { IEvidenceSwiftDeclaration } from "./IEvidenceSwiftDeclaration";
import type { IEvidenceSwiftFileAnalysis } from "./IEvidenceSwiftFileAnalysis";

/**
 * Reconciles extensions against nominal declarations in one configured Swift
 * module.
 *
 * The pass resolves selected local aliases without importing compiler metadata,
 * then propagates visibility from the verified nominal owner to extension
 * members.
 *
 * @evidence contracts/common.md#principled-implementation Extensions are linked to a unique accessible nominal declaration in the module, resolving selected local aliases first, and visibility propagates from the verified owner to extension members.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns snapshot-wide resolution only; scanning and materialization are separate.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Ambiguous or missing owners are reported rather than attached arbitrarily.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains why resolution waits for every file; its function and helpers are documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceSwiftOwnership {
  /**
   * Resolves local aliases and extension-introduced types before propagating
   * visibility.
   *
   * Repeated passes handle declarations whose owner is another pending
   * extension; unresolved cycles remain incomplete instead of gaining an
   * invented owner.
   *
   * @evidence contracts/common.md#principled-implementation Local aliases and extension-introduced types are resolved through finite alias chains, then extension members take ownership and visibility from their nominal declaration.
   * @evidence contracts/common.md#clear-and-simple-design It mutates the copied file analyses in place before units are materialized.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Ambiguous or missing owners are reported rather than attached arbitrarily.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the resolution and its failure cases.
   * @evidence contracts/performance.md#efficient-algorithms Linear in declarations and references with map lookups; alias chains are followed with cycle detection.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work It runs once per analysis over all files.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources It mutates caller-owned analyses and keeps no state.
   */
  export function resolve(analyses: IEvidenceSwiftFileAnalysis[]): void {
    const declarations = analyses.flatMap((analysis) => analysis.declarations);
    const ids = new Map(
      declarations.map((declaration) => [declaration.id, declaration]),
    );
    const children: Map<string, IEvidenceSwiftDeclaration[]> =
      groupEvidenceRecords(
        declarations.filter(
          (entry: IEvidenceSwiftDeclaration): boolean =>
            entry.ownerDeclarationId !== undefined,
        ),
        (entry: IEvidenceSwiftDeclaration): string =>
          entry.ownerDeclarationId ?? "",
      );
    const files: Map<string, IEvidenceSwiftFileAnalysis[]> =
      groupEvidenceRecords(
        analyses,
        (entry: IEvidenceSwiftFileAnalysis): string =>
          entry.source.physicalPath,
      );
    const order: Map<string, number> = new Map(
      declarations.map(
        (entry: IEvidenceSwiftDeclaration, index: number): [string, number] => [
          entry.id,
          index,
        ],
      ),
    );
    const pending = new Set(
      declarations.filter((declaration) => declaration.extension),
    );
    let progress = true;
    while (progress && pending.size !== 0) {
      progress = false;
      const blocked: Set<string> = new Set();
      for (const extension of pending)
        for (const child of descendants(extension.id, children, order))
          blocked.add(child.id);
      const types = new Map<string, IEvidenceSwiftDeclaration[]>();
      for (const declaration of declarations)
        if (
          declaration.symbol === "type" &&
          !declaration.extension &&
          !blocked.has(declaration.id)
        ) {
          const key = JSON.stringify(declaration.identity);
          types.set(key, [...(types.get(key) ?? []), declaration]);
        }
      for (const declaration of pending) {
        const target = nominal(
          declaration.target ?? [],
          types,
          declaration.site.file,
          new Set<string>(),
        );
        if (target === undefined) continue;
        const old = declaration.address;
        const nested: IEvidenceSwiftDeclaration[] = descendants(
          declaration.id,
          children,
          order,
        );
        if (declaration.ownerDeclarationId !== undefined)
          children.set(
            declaration.ownerDeclarationId,
            (children.get(declaration.ownerDeclarationId) ?? []).filter(
              (entry: IEvidenceSwiftDeclaration): boolean =>
                entry !== declaration,
            ),
          );
        declaration.address = [...target.address];
        declaration.identity = [...target.identity];
        declaration.name = target.name;
        declaration.public = target.public;
        if (target.ownerDeclarationId === undefined)
          delete declaration.ownerDeclarationId;
        else declaration.ownerDeclarationId = target.ownerDeclarationId;
        if (declaration.ownerDeclarationId !== undefined) {
          const entries: IEvidenceSwiftDeclaration[] =
            children.get(declaration.ownerDeclarationId) ?? [];
          entries.push(declaration);
          children.set(declaration.ownerDeclarationId, entries);
        }
        for (const child of nested) {
          child.address = [
            ...target.address,
            ...child.address.slice(old.length),
          ];
          child.identity = [...child.address];
        }
        pending.delete(declaration);
        progress = true;
      }
    }
    for (const declaration of pending) {
      declaration.public = false;
      const analysis: IEvidenceSwiftFileAnalysis | undefined = files.get(
        declaration.site.file,
      )?.[0];
      if (analysis === undefined) continue;
      analysis.complete = false;
      analysis.diagnostics.push({
        code: "swift-extension-ownership",
        severity: "error",
        message: `Extension '${declaration.address.join(".")}' requires one accessible selected local nominal type; external, ambiguous, cyclic, and generic ownership is unavailable.`,
        repair:
          "Include the accessible local nominal owner in the configured Swift module or implement external type ownership before checking coverage.",
        location: {
          file: analysis.source.physicalPath,
          range: declaration.site.range,
        },
      });
    }
    const visibility: Map<string, boolean> = new Map();
    for (const declaration of declarations)
      declaration.public &&= visible(
        declaration,
        ids,
        new Set<string>(),
        visibility,
      );
  }

  /**
   * Resolves a unique accessible declaration and a finite chain of selected
   * type aliases.
   *
   * A visited path set rejects cycles before they can grant an extension an
   * invented owner.
   */
  function nominal(
    path: string[],
    types: Map<string, IEvidenceSwiftDeclaration[]>,
    file: string,
    visited: Set<string>,
  ): IEvidenceSwiftDeclaration | undefined {
    const key = JSON.stringify(path);
    if (visited.has(key)) return undefined;
    visited.add(key);
    const accessible = (types.get(key) ?? []).filter(
      (declaration) =>
        !declaration.filePrivate || declaration.site.file === file,
    );
    const local = accessible.filter(
      (declaration) =>
        declaration.filePrivate && declaration.site.file === file,
    );
    const matches = local.length !== 0 ? local : accessible;
    if (matches.length !== 1) return undefined;
    const declaration = matches[0];
    if (declaration === undefined) return undefined;
    if (!declaration.alias)
      return ["class", "struct", "actor", "enum", "protocol"].includes(
        declaration.form,
      )
        ? declaration
        : undefined;
    if (declaration.target === undefined) return undefined;
    const scope = declaration.identity.slice(0, -1);
    for (let length = scope.length; length >= 0; --length) {
      const resolved = nominal(
        [...scope.slice(0, length), ...declaration.target],
        types,
        declaration.site.file,
        new Set(visited),
      );
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  }

  /** Visits only explicit descendants and restores original declaration order. */
  function descendants(
    id: string,
    children: Map<string, IEvidenceSwiftDeclaration[]>,
    order: Map<string, number>,
  ): IEvidenceSwiftDeclaration[] {
    const result: IEvidenceSwiftDeclaration[] = [];
    const seen: Set<string> = new Set([id]);
    const pending: IEvidenceSwiftDeclaration[] = [...(children.get(id) ?? [])];
    while (pending.length !== 0) {
      const child: IEvidenceSwiftDeclaration | undefined = pending.pop();
      if (child === undefined || seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      pending.push(...(children.get(child.id) ?? []));
    }
    return result.sort(
      (
        left: IEvidenceSwiftDeclaration,
        right: IEvidenceSwiftDeclaration,
      ): number => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0),
    );
  }

  /**
   * Clamps descendant exposure to the effective public owner.
   *
   * Recursive ownership also rejects a malformed parent cycle from the
   * published surface.
   */
  function visible(
    declaration: IEvidenceSwiftDeclaration,
    ids: Map<string, IEvidenceSwiftDeclaration>,
    visited: Set<string>,
    cache: Map<string, boolean>,
  ): boolean {
    const remembered: boolean | undefined = cache.get(declaration.id);
    if (remembered !== undefined) return remembered;
    if (!declaration.public || visited.has(declaration.id)) return false;
    visited.add(declaration.id);
    const owner =
      declaration.ownerDeclarationId === undefined
        ? undefined
        : ids.get(declaration.ownerDeclarationId);
    const result: boolean =
      owner === undefined || visible(owner, ids, visited, cache);
    cache.set(declaration.id, result);
    return result;
  }
}
