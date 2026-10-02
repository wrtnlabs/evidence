import typia from "typia";

import { EvidenceInventory } from "../../graph/EvidenceInventory";
import { EvidenceParser } from "../../parsers/EvidenceParser";
import { EvidenceParserError } from "../../parsers/EvidenceParserError";
import { EvidenceTagParser } from "../../parsers/EvidenceTagParser";
import type { IEvidenceAdapter } from "../../structures/IEvidenceAdapter";
import type { IEvidenceHost } from "../../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidencePublicAddress } from "../../structures/IEvidencePublicAddress";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceSnapshot } from "../../structures/IEvidenceSourceSnapshot";
import type { IEvidenceTagParseResult } from "../../structures/IEvidenceTagParseResult";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { IEvidenceCSharpDeclaration } from "./IEvidenceCSharpDeclaration";
import type { IEvidenceCSharpDeclarationGroup } from "./IEvidenceCSharpDeclarationGroup";
import type { IEvidenceCSharpDocumentation } from "./IEvidenceCSharpDocumentation";
import type { IEvidenceCSharpFileAnalysis } from "./IEvidenceCSharpFileAnalysis";
import { EvidenceCSharpDocumentation } from "./EvidenceCSharpDocumentation";
import { EvidenceCSharpFileScanner } from "./EvidenceCSharpFileScanner";

/**
 * Reconciles C# public declaration families and XML documentation within a
 * snapshot.
 *
 * File analysis records accessibility, partial declarations, and physical
 * sites. Materialization uses the configured root boundary to merge compatible
 * parts without combining equal names from unrelated source populations. XML
 * comments then attach to the reconciled units while retaining their original
 * positions.
 *
 * Inventory completeness includes discovery and syntax findings. A partial or
 * unsupported declaration is not discarded as though the remaining source were
 * the complete public surface.
 */
export class EvidenceCSharpAdapter implements IEvidenceAdapter<"csharp"> {
  /**
   * C# artifact discriminator selecting source-public extraction rules.
   *
   * The inherited public entry point exposes this value to the adapter
   * contract; claim and reference roles use the same C# extraction semantics.
   */
  public get type(): "csharp" {
    return "csharp";
  }

  /**
   * Extracts and reconciles one captured C# source population.
   *
   * Each call copies its input, scans files, materializes root-scoped
   * identities, and maps documentation before common validation. The parser is
   * released in the failure path as well as after a successful inventory
   * snapshot.
   */
  public async analyze(
    snapshot: IEvidenceSourceSnapshot,
  ): Promise<IEvidenceInventory> {
    const input = structuredClone(typia.assert(snapshot));
    const inventory: IEvidenceInventory = {
      schemaVersion: 1,
      sources: input.files,
      annotationRanges: [],
      units: [],
      addresses: [],
      hosts: [],
      declarations: [],
      reviews: [],
      diagnostics: input.diagnostics.map((diagnostic) => ({
        code: `source-${diagnostic.code}`,
        severity: "error",
        message: diagnostic.message,
        repair:
          "Restore access to the selected C# source before evaluating coverage.",
        location: { file: diagnostic.path },
      })),
      dependencies: input.dependencies,
      complete: input.complete,
    };
    const parser = new EvidenceParser();
    try {
      const analyses = await Promise.all(
        input.files.map((source) => this.scan(parser, source)),
      );
      for (const analysis of analyses) {
        inventory.diagnostics.push(...analysis.diagnostics);
        inventory.complete &&= analysis.complete;
      }
      // Partial names are meaningful only within this configured source boundary.
      // Pass the root context before reconciling sites and their XML comments.
      const published = this.materializeUnits(
        inventory,
        analyses,
        input.root.display,
      );
      this.materializeDocumentation(inventory, analyses, published);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidenceCSharpFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: "csharp", file, content: source.content },
        (session) => new EvidenceCSharpFileScanner(session, source).scan(),
      );
    } catch (cause) {
      const parserError =
        cause instanceof EvidenceParserError ? cause : undefined;
      return {
        source,
        declarations: [],
        documentation: [],
        diagnostics: [
          {
            code: `csharp-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `C# parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            repair:
              "Ensure grammar and adapter support for the reported source construct before evaluating coverage.",
            location: {
              file: source.physicalPath,
              ...(parserError?.range === undefined
                ? {}
                : { range: parserError.range }),
            },
          },
        ],
        complete: false,
      };
    }
  }

  private materializeUnits(
    inventory: IEvidenceInventory,
    analyses: IEvidenceCSharpFileAnalysis[],
    boundary: string,
  ): Map<string, string> {
    const declarations = analyses.flatMap((analysis) => analysis.declarations);
    const declarationAnalysis = new Map<string, IEvidenceCSharpFileAnalysis>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations)
        declarationAnalysis.set(declaration.id, analysis);

    const declarationIds = new Map<string, string>();
    const groups = new Map<string, IEvidenceCSharpDeclarationGroup>();
    for (const declaration of declarations) {
      const id = this.unitId(declaration, boundary);
      declarationIds.set(declaration.id, id);
      let group = groups.get(id);
      if (group === undefined) {
        group = { id, declarations: [] };
        groups.set(id, group);
      }
      group.declarations.push(declaration);
    }

    const publicTypes = this.publicTypes(
      inventory,
      groups,
      declarationIds,
      declarationAnalysis,
    );
    const published = new Map<string, string>();
    for (const declaration of declarations) {
      const id = declarationIds.get(declaration.id);
      if (id === undefined) continue;
      const visible =
        declaration.symbol === "type"
          ? publicTypes.has(id)
          : !declaration.explicitInterface &&
            declaration.ownerDeclarationId !== undefined &&
            publicTypes.has(
              declarationIds.get(declaration.ownerDeclarationId) ?? "",
            ) &&
            (declaration.accessibility === "public" ||
              (declaration.accessibility === "default" &&
                declaration.implicitPublic));
      if (visible) published.set(declaration.id, id);
    }

    for (const group of groups.values()) {
      const visible = group.declarations.filter((declaration) =>
        published.has(declaration.id),
      );
      if (visible.length < 2 || visible[0]?.symbol === "type") continue;
      const forms = new Set(visible.map((declaration) => declaration.form));
      const mergeable =
        visible.every((declaration) => declaration.symbol === "function") ||
        visible.every((declaration) => declaration.form === "indexer") ||
        (forms.size === 1 &&
          visible.every(
            (declaration) =>
              declaration.form === "property" && declaration.partial,
          ));
      if (mergeable) continue;
      const first = visible[0];
      const analysis =
        first === undefined ? undefined : declarationAnalysis.get(first.id);
      if (first !== undefined && analysis !== undefined)
        this.problem(
          inventory,
          analysis,
          "csharp-declaration-conflict",
          `C# public identity '${first.identity.join(".")}' has incompatible selected declarations.`,
          "Keep one declaration, a valid partial property, or an overload-addressed method, indexer, or operator family.",
        );
    }

    const units = new Map<string, IEvidenceUnit>();
    const addresses = new Set<string>();
    const canonicalAddresses = new Set<string>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        if (!published.has(declaration.id)) continue;
        for (const sourceAddress of analysis.source.addresses)
          for (const address of declaration.addresses) {
            if (!address.canonical) continue;
            const key = this.addressKey(
              sourceAddress.absolute,
              address.segments,
            );
            canonicalAddresses.add(key);
          }
      }
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        const id = published.get(declaration.id);
        if (id === undefined) continue;
        const parentId =
          declaration.ownerDeclarationId === undefined
            ? undefined
            : published.get(declaration.ownerDeclarationId);

        let unit = units.get(id);
        if (unit === undefined) {
          unit = {
            id,
            type: "csharp",
            symbol: declaration.symbol,
            identity: declaration.identity,
            name: declaration.name,
            sites: [structuredClone(declaration.site)],
            withdrawals: [],
            ...(parentId === undefined ? {} : { parentId }),
          };
          units.set(id, unit);
        } else if (!unit.sites.some((site) => site.id === declaration.site.id))
          unit.sites.push(structuredClone(declaration.site));

        for (const sourceAddress of analysis.source.addresses) {
          for (const declarationAddress of declaration.addresses) {
            if (
              !declarationAddress.canonical &&
              declarationAddress.aliasPrefixes.some((prefix) =>
                canonicalAddresses.has(
                  this.addressKey(sourceAddress.absolute, prefix),
                ),
              )
            )
              continue;
            const address: IEvidencePublicAddress = {
              unitId: id,
              file: sourceAddress.absolute,
              segments: declarationAddress.segments,
            };
            const key = JSON.stringify(address);
            if (addresses.has(key)) continue;
            addresses.add(key);
            inventory.addresses.push(address);
          }
        }
      }
    inventory.units.push(...units.values());
    return published;
  }

  private publicTypes(
    inventory: IEvidenceInventory,
    groups: Map<string, IEvidenceCSharpDeclarationGroup>,
    declarationIds: Map<string, string>,
    declarationAnalysis: Map<string, IEvidenceCSharpFileAnalysis>,
  ): Set<string> {
    const typeGroups = new Map(
      Array.from(groups.entries()).filter(([, group]) =>
        group.declarations.some((declaration) => declaration.symbol === "type"),
      ),
    );
    const visibility = new Map<string, boolean>();
    const visiting = new Set<string>();
    const resolve = (id: string): boolean => {
      const known = visibility.get(id);
      if (known !== undefined) return known;
      const group = typeGroups.get(id);
      if (group === undefined || visiting.has(id)) return false;
      visiting.add(id);

      const declarations = group.declarations.filter(
        (declaration) => declaration.symbol === "type",
      );
      const explicit = new Set(
        declarations
          .map((declaration) => declaration.accessibility)
          .filter((accessibility) => accessibility !== "default"),
      );
      const parentIds = new Set(
        declarations.flatMap((declaration) => {
          const ownerId = declaration.ownerDeclarationId;
          const parentId =
            ownerId === undefined ? undefined : declarationIds.get(ownerId);
          return parentId === undefined ? [] : [parentId];
        }),
      );
      const selfPublic =
        explicit.size === 0
          ? declarations.some((declaration) => declaration.implicitPublic)
          : explicit.has("public");
      const parentPublic =
        parentIds.size === 0 ||
        (parentIds.size === 1 && resolve(Array.from(parentIds)[0] ?? ""));
      const result = selfPublic && parentPublic;
      visiting.delete(id);
      visibility.set(id, result);

      if (selfPublic) {
        const first = declarations[0];
        const analysis =
          first === undefined ? undefined : declarationAnalysis.get(first.id);
        if (first !== undefined && analysis !== undefined) {
          if (explicit.size > 1)
            this.problem(
              inventory,
              analysis,
              "csharp-partial-accessibility",
              `Partial C# type '${first.identity.join(".")}' has conflicting accessibility modifiers.`,
              "Use one compatible accessibility across every selected partial declaration.",
            );
          if (parentIds.size > 1)
            this.problem(
              inventory,
              analysis,
              "csharp-partial-owner",
              `Partial C# type '${first.identity.join(".")}' has conflicting containing types.`,
              "Keep every partial declaration under the same semantic owner.",
            );
          if (declarations.length > 1) {
            const forms = new Set(
              declarations.map((declaration) => declaration.form),
            );
            const partial = declarations.every(
              (declaration) =>
                declaration.partial &&
                (declaration.form === "class" ||
                  declaration.form === "struct" ||
                  declaration.form === "interface" ||
                  declaration.form === "record" ||
                  declaration.form === "record-struct"),
            );
            if (forms.size !== 1 || !partial)
              this.problem(
                inventory,
                analysis,
                "csharp-partial-conflict",
                `C# public type '${first.identity.join(".")}' has declarations that do not form one compatible partial type.`,
                "Use the same partial type form in every selected declaration or separate their compilation roots.",
              );
          }
        }
      }
      return result;
    };
    for (const id of typeGroups.keys()) resolve(id);
    return new Set(
      Array.from(visibility.entries()).flatMap(([id, visible]) =>
        visible ? [id] : [],
      ),
    );
  }

  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidenceCSharpFileAnalysis[],
    published: Map<string, string>,
  ): void {
    const units = new Map(inventory.units.map((unit) => [unit.id, unit]));
    for (const analysis of analyses)
      for (const documentation of analysis.documentation) {
        const groups = this.attachmentGroups(documentation, published);
        if (groups.size === 0 && !this.annotation(analysis, documentation))
          continue;
        inventory.annotationRanges.push({
          file: analysis.source.physicalPath,
          range: documentation.range,
        });
        for (const [siteId, unitIds] of groups) {
          const parsed = this.parse(
            analysis.source,
            documentation,
            this.host(analysis.source, documentation, siteId, unitIds),
          );
          for (const unitId of unitIds) {
            const unit = units.get(unitId);
            if (unit !== undefined)
              unit.withdrawals.push(...parsed.withdrawals);
          }
        }
      }

    const hidden = new Set<string>();
    for (const unit of inventory.units)
      if (this.withdrawn(unit.id, units, new Set<string>()))
        hidden.add(unit.id);
    for (const analysis of analyses) {
      for (const documentation of analysis.documentation) {
        const publishedGroups = this.attachmentGroups(documentation, published);
        const groups = new Map<string, string[]>();
        for (const [siteId, unitIds] of publishedGroups) {
          const visible = unitIds.filter((unitId) => !hidden.has(unitId));
          if (visible.length !== 0) groups.set(siteId, visible);
        }
        if (
          groups.size === 0 &&
          publishedGroups.size !== 0 &&
          !this.claimAnnotation(analysis, documentation)
        )
          continue;
        if (groups.size === 0) {
          if (!this.annotation(analysis, documentation)) continue;
          const host = this.host(analysis.source, documentation, undefined, []);
          inventory.hosts.push(host);
          const parsed = this.parse(analysis.source, documentation, host);
          inventory.declarations.push(...parsed.declarations);
          inventory.reviews.push(...parsed.reviews);
          inventory.diagnostics.push(...parsed.diagnostics);
          continue;
        }
        for (const [siteId, unitIds] of groups) {
          const host = this.host(
            analysis.source,
            documentation,
            siteId,
            unitIds,
          );
          inventory.hosts.push(host);
          const parsed = this.parse(analysis.source, documentation, host);
          inventory.declarations.push(...parsed.declarations);
          inventory.reviews.push(...parsed.reviews);
          inventory.diagnostics.push(...parsed.diagnostics);
        }
      }
      this.materializeUndocumentedHosts(inventory, analysis, published, hidden);
    }
  }

  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analysis: IEvidenceCSharpFileAnalysis,
    published: Map<string, string>,
    hidden: Set<string>,
  ): void {
    const documented = new Set(
      analysis.documentation.flatMap((documentation) =>
        documentation.attachments.flatMap((attachment) => {
          const unitId = published.get(attachment.declarationId);
          return unitId !== undefined && !hidden.has(unitId)
            ? [attachment.declarationId]
            : [];
        }),
      ),
    );
    const groups = new Map<string, IEvidenceCSharpDeclaration[]>();
    for (const declaration of analysis.declarations) {
      const unitId = published.get(declaration.id);
      if (
        unitId === undefined ||
        hidden.has(unitId) ||
        documented.has(declaration.id)
      )
        continue;
      const declarations = groups.get(declaration.site.id) ?? [];
      declarations.push(declaration);
      groups.set(declaration.site.id, declarations);
    }
    for (const declarations of groups.values()) {
      const first = declarations[0];
      if (first === undefined) continue;
      const unitIds = Array.from(
        new Set(
          declarations.flatMap((declaration) => {
            const unitId = published.get(declaration.id);
            return unitId === undefined ? [] : [unitId];
          }),
        ),
      );
      inventory.hosts.push({
        id: `${first.site.id}:host`,
        file: analysis.source.physicalPath,
        range: first.site.range,
        origins: analysis.source.addresses.map((address) => address.absolute),
        siteId: first.site.id,
        unitIds,
        attachment: "attached",
      });
    }
  }

  private attachmentGroups(
    documentation: IEvidenceCSharpDocumentation,
    published: Map<string, string>,
  ): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const attachment of documentation.attachments) {
      const unitId = published.get(attachment.declarationId);
      if (unitId === undefined) continue;
      const unitIds = groups.get(attachment.siteId) ?? [];
      if (!unitIds.includes(unitId)) unitIds.push(unitId);
      groups.set(attachment.siteId, unitIds);
    }
    return groups;
  }

  private host(
    source: IEvidenceSourceFile,
    documentation: IEvidenceCSharpDocumentation,
    siteId: string | undefined,
    unitIds: string[],
  ): IEvidenceHost {
    const attached = siteId !== undefined && unitIds.length !== 0;
    return {
      id: `${documentation.id}:host:${siteId ?? "unsupported"}`,
      file: source.physicalPath,
      range: documentation.range,
      origins: source.addresses.map((address) => address.absolute),
      unitIds,
      attachment: attached ? "attached" : "unsupported",
      ...(attached ? { siteId } : {}),
      ...(attached
        ? {}
        : {
            problem:
              "Move the annotation into XML documentation attached to a supported public C# declaration.",
          }),
    };
  }

  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidenceCSharpDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    return EvidenceTagParser.parse(
      source.content,
      host,
      EvidenceCSharpDocumentation.read(source, documentation, host.id),
    );
  }

  private annotation(
    analysis: IEvidenceCSharpFileAnalysis,
    documentation: IEvidenceCSharpDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceCSharpDocumentation.read(
        analysis.source,
        documentation,
        documentation.id,
      ).text,
      true,
    );
  }

  private claimAnnotation(
    analysis: IEvidenceCSharpFileAnalysis,
    documentation: IEvidenceCSharpDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceCSharpDocumentation.read(
        analysis.source,
        documentation,
        documentation.id,
      ).text,
      false,
    );
  }

  private annotationPattern(raw: string, withdrawal: boolean): boolean {
    return withdrawal
      ? /(?:^|[\r\n])[ \t]*@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link|internal|hidden|ignore)\b/u.test(
          raw,
        )
      : /(?:^|[\r\n])[ \t]*@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link)\b/u.test(
          raw,
        );
  }

  private withdrawn(
    id: string,
    units: Map<string, IEvidenceUnit>,
    visited: Set<string>,
  ): boolean {
    if (visited.has(id)) return false;
    visited.add(id);
    const unit = units.get(id);
    if (unit === undefined) return false;
    if (unit.withdrawals.length !== 0) return true;
    return unit.parentId === undefined
      ? false
      : this.withdrawn(unit.parentId, units, visited);
  }

  private unitId(
    declaration: IEvidenceCSharpDeclaration,
    boundary: string,
  ): string {
    return `csharp:${JSON.stringify(boundary)}:${declaration.symbol}:${JSON.stringify(declaration.identity)}`;
  }

  private addressKey(file: string, segments: string[]): string {
    return JSON.stringify([file, segments]);
  }

  private problem(
    inventory: IEvidenceInventory,
    analysis: IEvidenceCSharpFileAnalysis,
    code: string,
    message: string,
    repair: string,
  ): void {
    inventory.complete = false;
    inventory.diagnostics.push({
      code,
      severity: "error",
      message,
      repair,
      location: { file: analysis.source.physicalPath },
    });
  }
}
