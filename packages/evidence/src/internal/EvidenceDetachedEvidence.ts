import path from "node:path";

import { EvidenceMarkdownTarget } from "../adapters/markdown/EvidenceMarkdownTarget";
import { EvidenceTargetResolver } from "../targets/EvidenceTargetResolver";
import { EvidenceFileTarget } from "../targets/EvidenceFileTarget";
import type { IEvidenceClaim } from "../structures/IEvidenceClaim";
import type { IEvidenceDetachedHostBinding } from "../structures/IEvidenceDetachedHostBinding";
import type { IEvidenceDiagnostic } from "../structures/IEvidenceDiagnostic";
import type { IEvidenceHost } from "../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
import type { IEvidenceSourceLocation } from "../structures/IEvidenceSourceLocation";
import type { IEvidenceTargetResolution } from "../structures/IEvidenceTargetResolution";
import type { IEvidenceTargetStatement } from "../structures/IEvidenceTargetStatement";
import type { IEvidenceUnit } from "../structures/IEvidenceUnit";
import type { IEvidenceDetachedSelection } from "./IEvidenceDetachedSelection";
import type { IEvidenceDetachedOwner } from "./IEvidenceDetachedOwner";

/**
 * Binds separate Markdown evidence sections to selected claim declarations.
 *
 * Markdown extraction retains its normal physical units and hosts. This
 * preparation resolves each H1 as an address of the original claim and records
 * how statements beneath it contribute to that claim without changing either
 * adapter's declaration ownership.
 *
 * @evidence contracts/common.md#principled-implementation H1 owners resolve through the claim's address resolver, and their annotation hosts receive separate semantic bindings while their original Markdown sites remain intact.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns detached owner binding only; adapters parse source and the graph evaluates obligations.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Invalid or absent owners mark the inventory incomplete instead of granting evidence to a guessed unit.
 * @evidence contracts/common.md#meaningful-documentation The comment describes physical and semantic ownership and the failure rule.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups functions with their own costs.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work It retains no result between checks.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources It owns no persistent resource.
 */
export namespace EvidenceDetachedEvidence {
  /**
   * Resolves H1 addresses and selects positive statements from one Markdown
   * inventory for one original claim.
   *
   * The source inventory is not edited. Errors stay with the detached source
   * location and make its result incomplete, so graph evaluation cannot pass
   * over a partial or misbound set of statements.
   *
   * @evidence contracts/common.md#principled-implementation Every H1 is resolved against selected original units, and every detached statement follows its actual Markdown ancestor to that resolved owner.
   * @evidence contracts/common.md#clear-and-simple-design One pass builds owner and host maps; target lookup stays in EvidenceTargetResolver.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Missing, ambiguous, unselected and unsupported owners are diagnosed instead of mapped by short name or file basename.
   * @evidence contracts/common.md#meaningful-documentation The comment explains input ownership, output, and incomplete failures.
   * @evidence contracts/performance.md#efficient-algorithms Maps and statement binding are linear in Markdown units, hosts and statements; each H1 additionally uses the indexed target resolver.
   * @evidence contracts/performance.md#reuse-equivalent-work The resolver and unit/host maps are built once for every H1 and statement in this claim.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Maps are local to this call; the returned inventory and bindings are owned by the caller.
   */
  export async function bind(
    configFile: string,
    claim: IEvidenceClaim,
    source: IEvidenceInventory,
    selectedIds: string[],
    detached: IEvidenceInventory,
  ): Promise<IEvidenceDetachedSelection> {
    const inventory: IEvidenceInventory = structuredClone(detached);
    const bindings: IEvidenceDetachedHostBinding[] = [];
    const owners: IEvidenceDetachedOwner[] = [];
    const units: Map<string, IEvidenceUnit> = new Map<string, IEvidenceUnit>(
      inventory.units.map((unit: IEvidenceUnit): [string, IEvidenceUnit] => [
        unit.id,
        unit,
      ]),
    );
    const hosts: Map<string, IEvidenceHost> = new Map<string, IEvidenceHost>(
      inventory.hosts.map((host: IEvidenceHost): [string, IEvidenceHost] => [
        host.id,
        host,
      ]),
    );
    const ownerIds: Map<string, string> = new Map<string, string>();
    const boundHosts: Set<string> = new Set<string>();
    const selected: Set<string> = new Set<string>(selectedIds);
    const resolver: EvidenceTargetResolver = new EvidenceTargetResolver(
      [source],
      claim.type,
    );
    if (inventory.sources.length === 0 && inventory.complete) {
      problem(
        inventory,
        "evidence-files-empty",
        "evidenceFiles selected no Markdown files.",
        "Correct the patterns or add a matching evidence document.",
      );
    }
    const sourcePaths: Set<string> = new Set<string>(
      source.sources.map((file): string =>
        EvidenceFileTarget.normalize(file.physicalPath),
      ),
    );
    const markdownRootPaths: Map<string, string> = new Map<string, string>();
    if (claim.type === "markdown")
      for (const file of source.sources)
        for (const address of file.addresses) {
          const absolute: string = EvidenceFileTarget.normalize(
            address.absolute,
          );
          if (address.selected !== false && !markdownRootPaths.has(absolute))
            markdownRootPaths.set(absolute, address.relative);
        }
    const ownedFiles: Set<string> = new Set<string>(
      inventory.units
        .filter((unit): boolean => unit.symbol === "h1")
        .flatMap((unit): string[] =>
          unit.sites.map((site): string =>
            EvidenceFileTarget.normalize(site.file),
          ),
        ),
    );
    for (const file of inventory.sources) {
      if (sourcePaths.has(EvidenceFileTarget.normalize(file.physicalPath)))
        problem(
          inventory,
          "evidence-files-overlap",
          "An evidenceFiles document is also a claim source file.",
          "Keep detached evidence in a separate Markdown file.",
          { file: file.physicalPath },
        );
      if (!ownedFiles.has(EvidenceFileTarget.normalize(file.physicalPath)))
        problem(
          inventory,
          "evidence-files-missing-owner",
          "A detached evidence document has no H1 claim owner.",
          "Add an H1 with the file-qualified address of a selected claim unit.",
          { file: file.physicalPath },
        );
    }
    for (const unit of inventory.units) {
      if (unit.symbol !== "h1") continue;
      const site = unit.sites[0];
      if (site === undefined) continue;
      const location: IEvidenceSourceLocation = {
        file: site.file,
        range: site.range,
      };
      const ownerHost: IEvidenceHost = {
        id: unit.id,
        file: configFile,
        range: site.range,
        origins: [configFile],
        unitIds: [],
        attachment: "attached",
      };
      const statement: IEvidenceTargetStatement = {
        hostId: unit.id,
        target: ownerTarget(configFile, claim, markdownRootPaths, unit.name),
        location,
      };
      const result: IEvidenceTargetResolution = await resolver.resolve(
        statement,
        ownerHost,
        selectedIds,
      );
      const owner: IEvidenceUnit | undefined = result.units[0];
      const isSelected: boolean =
        result.status === "resolved" &&
        result.units.length === 1 &&
        owner !== undefined &&
        selected.has(owner.id);
      owners.push({
        key: JSON.stringify([location.file, site.range.start.offset]),
        target: unit.name,
        location,
        status: result.status,
        ...(isSelected && owner !== undefined ? { unitId: owner.id } : {}),
      });
      if (isSelected && owner !== undefined) ownerIds.set(unit.id, owner.id);
    }
    function bindHost(hostId: string): boolean {
      const host: IEvidenceHost | undefined = hosts.get(hostId);
      const unit: IEvidenceUnit | undefined =
        host === undefined ? undefined : units.get(host.unitIds[0] ?? "");
      let ancestor: IEvidenceUnit | undefined = unit;
      while (ancestor !== undefined && ancestor.symbol !== "h1")
        ancestor = units.get(ancestor.parentId ?? "");
      if (ancestor === undefined || host?.attachment !== "attached") {
        problem(
          inventory,
          "evidence-files-unowned-statement",
          "Detached evidence has no valid enclosing H1 claim owner.",
          "Place the annotation beneath an H1 naming a selected claim unit.",
          {
            file: host?.file ?? configFile,
            ...(host === undefined ? {} : { range: host.range }),
          },
        );
        return false;
      }
      const owner: string | undefined = ownerIds.get(ancestor.id);
      if (owner === undefined) return false;
      if (!boundHosts.has(hostId)) {
        bindings.push({ hostId, unitId: owner });
        boundHosts.add(hostId);
      }
      return true;
    }
    inventory.declarations = inventory.declarations.filter((declaration) => {
      if (declaration.kind !== "evidence") {
        problem(
          inventory,
          "evidence-files-exclusion",
          "Detached evidence files cannot carry @evidenceExclude.",
          "Keep an exclusion on an eligible original claim carrier.",
          declaration.location,
        );
        return false;
      }
      return bindHost(declaration.hostId);
    });
    inventory.reviews = inventory.reviews.filter((review) => {
      if (review.reviews !== "evidence") {
        problem(
          inventory,
          "evidence-files-exclusion-review",
          "Detached evidence files cannot carry @evidenceExcludeReview.",
          "Review the exclusion on its original claim carrier.",
          review.location,
        );
        return false;
      }
      return bindHost(review.hostId);
    });
    return { inventory, bindings, owners };
  }
}

/** Converts a config-relative Markdown H1 path to the claim's root spelling. */
function ownerTarget(
  configFile: string,
  claim: IEvidenceClaim,
  markdownRootPaths: ReadonlyMap<string, string>,
  target: string,
): string {
  if (claim.type !== "markdown") return target;
  try {
    const parsed = EvidenceMarkdownTarget.parse(target);
    const absolute: string = EvidenceFileTarget.normalize(
      path.resolve(path.dirname(configFile), parsed.file),
    );
    const relative: string | undefined = markdownRootPaths.get(absolute);
    if (relative !== undefined) {
      const hash: number = target.indexOf("#");
      return relative + (hash < 0 ? "" : target.slice(hash));
    }
  } catch {
    return target;
  }
  return target;
}

/** Records a detached input failure without shrinking coverage. */
function problem(
  inventory: IEvidenceInventory,
  code: string,
  message: string,
  repair: string,
  location?: IEvidenceSourceLocation,
): void {
  const diagnostic: IEvidenceDiagnostic = {
    code,
    severity: "error",
    message,
    repair,
    ...(location === undefined ? {} : { location }),
  };
  inventory.diagnostics.push(diagnostic);
  inventory.complete = false;
}
