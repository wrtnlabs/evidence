import typia from "typia";

import { EvidenceDocumentation } from "../../parsers/EvidenceDocumentation";
import { EvidenceInventory } from "../../graph/EvidenceInventory";
import { EvidenceParser } from "../../parsers/EvidenceParser";
import { EvidenceParserError } from "../../parsers/EvidenceParserError";
import { EvidenceTagParser } from "../../parsers/EvidenceTagParser";
import type { IEvidenceAdapter } from "../../structures/IEvidenceAdapter";
import type { IEvidenceDocumentation } from "../../structures/IEvidenceDocumentation";
import type { IEvidenceHost } from "../../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceSnapshot } from "../../structures/IEvidenceSourceSnapshot";
import type { IEvidenceTagParseResult } from "../../structures/IEvidenceTagParseResult";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import type { IEvidenceRubyDeclaration } from "./IEvidenceRubyDeclaration";
import type { IEvidenceRubyDocumentation } from "./IEvidenceRubyDocumentation";
import type { IEvidenceRubyFileAnalysis } from "./IEvidenceRubyFileAnalysis";
import { EvidenceRubyFileScanner } from "./EvidenceRubyFileScanner";

/**
 * Extracts Ruby public declarations while merging reopened structural
 * identities.
 *
 * File scans retain visibility and owner paths for classes, modules, and
 * members. Materialization groups compatible declarations before attaching
 * documentation, so reopened sites share semantic identity while keeping their
 * physical origins and withdrawal causes. Unsupported analysis remains visible
 * as incompleteness.
 */
export class EvidenceRubyAdapter implements IEvidenceAdapter<"ruby"> {
  /**
   * Artifact discriminator selecting Ruby source and named-file rules.
   *
   * Configuration uses this value independently of the filename's extension.
   */
  public get type(): "ruby" {
    return "ruby";
  }

  /**
   * Builds a normalized Ruby inventory from an owned copy of the snapshot.
   *
   * Public identity groups are established before comment hosts are
   * materialized. Source and scan diagnostics are retained, and parser cleanup
   * runs on every exit.
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
          "Restore access to the selected Ruby source before evaluating coverage.",
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
      // Reopened declarations must agree on semantic ownership before their
      // individual comment sites can contribute to the shared public identity.
      const published = this.materializeUnits(inventory, analyses);
      this.materializeDocumentation(inventory, analyses, published);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  /**
   * Copies one Ruby file's declaration and comment records out of its parse
   * session.
   *
   * Syntax or acquisition failure yields an incomplete analysis with a concrete
   * source diagnostic rather than a successful empty declaration list.
   */
  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidenceRubyFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: "ruby", file, content: source.content },
        (session) => new EvidenceRubyFileScanner(session, source).scan(),
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
            code: `ruby-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `Ruby parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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

  /**
   * Merges Ruby declaration groups and publishes their public owner hierarchy.
   *
   * Type groups are considered from outer to inner ownership before members,
   * preventing a child of an unpublished owner from becoming a free-standing
   * API.
   */
  private materializeUnits(
    inventory: IEvidenceInventory,
    analyses: IEvidenceRubyFileAnalysis[],
  ): Map<string, string> {
    const declarationAnalysis = new Map<string, IEvidenceRubyFileAnalysis>();
    const groups = new Map<string, IEvidenceRubyDeclaration[]>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        declarationAnalysis.set(declaration.id, analysis);
        const id = this.unitId(declaration);
        const group = groups.get(id) ?? [];
        group.push(declaration);
        groups.set(id, group);
      }

    const publicGroups = new Set<string>();
    const typeGroups = Array.from(groups.entries())
      .filter(([, declarations]) => declarations[0]?.symbol === "type")
      .sort(
        ([, left], [, right]) =>
          (left[0]?.identity?.length ?? 0) - (right[0]?.identity?.length ?? 0),
      );
    for (const [id, declarations] of typeGroups) {
      this.checkGroup(inventory, declarations, declarationAnalysis);
      if (
        declarations.some((declaration) => declaration.visibility !== "public")
      )
        continue;
      const owner = declarations[0]?.ownerIdentity;
      if (owner !== undefined && owner.length !== 0) {
        const parentId = this.typeId(owner);
        if (!groups.has(parentId)) {
          const first = declarations[0];
          if (first !== undefined)
            this.problem(
              inventory,
              declarationAnalysis.get(first.id),
              first,
              "ruby-container-owner",
              `Ruby container '${first.identity.join("::")}' has no selected declared owner '${owner.join("::")}'.`,
              "Select the owner declaration or use a lexically nested class or module declaration.",
            );
          continue;
        }
        if (!publicGroups.has(parentId)) continue;
      }
      publicGroups.add(id);
    }

    for (const [id, declarations] of groups) {
      if (declarations[0]?.symbol === "type") continue;
      this.checkGroup(inventory, declarations, declarationAnalysis);
      const publicDeclarations = declarations.filter(
        (declaration) => declaration.visibility === "public",
      );
      if (publicDeclarations.length === 0) continue;
      const owner = publicDeclarations[0]?.ownerIdentity;
      if (owner !== undefined && owner.length !== 0) {
        const parentId = this.typeId(owner);
        if (!groups.has(parentId)) {
          const first = publicDeclarations[0];
          if (first !== undefined)
            this.problem(
              inventory,
              declarationAnalysis.get(first.id),
              first,
              "ruby-declaration-owner",
              `Ruby declaration '${first.identity.join("::")}' has no selected class or module owner '${owner.join("::")}'.`,
              "Select the owner declaration or move the declaration into a selected class or module body.",
            );
          continue;
        }
        if (!publicGroups.has(parentId)) continue;
      }
      if (
        declarations[0]?.form === "constant" &&
        declarations.some((declaration) => declaration.visibility !== "public")
      )
        continue;
      publicGroups.add(id);
    }

    const published = new Map<string, string>();
    for (const [id, declarations] of groups)
      if (publicGroups.has(id))
        for (const declaration of declarations)
          if (declaration.visibility === "public")
            published.set(declaration.id, id);

    const units = new Map<string, IEvidenceUnit>();
    for (const [id, declarations] of groups) {
      if (!publicGroups.has(id)) continue;
      const visible = declarations.filter(
        (declaration) => declaration.visibility === "public",
      );
      const first = visible[0];
      if (first === undefined) continue;
      const parentId =
        first.ownerIdentity === undefined || first.ownerIdentity.length === 0
          ? undefined
          : this.typeId(first.ownerIdentity);
      const unit: IEvidenceUnit = {
        id,
        type: "ruby",
        symbol: first.symbol,
        identity: first.identity,
        name: first.name,
        sites: [],
        withdrawals: [],
        ...(parentId === undefined ? {} : { parentId }),
      };
      for (const declaration of visible) this.addSite(unit, declaration.site);
      units.set(id, unit);
    }
    inventory.units.push(...units.values());

    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        const unitId = published.get(declaration.id);
        if (unitId === undefined) continue;
        for (const sourceAddress of analysis.source.addresses)
          inventory.addresses.push({
            file: sourceAddress.absolute,
            segments: declaration.address,
            unitId,
          });
      }
    this.checkAddressCollisions(inventory, analyses, published);
    return published;
  }

  private checkGroup(
    inventory: IEvidenceInventory,
    declarations: IEvidenceRubyDeclaration[],
    declarationAnalysis: Map<string, IEvidenceRubyFileAnalysis>,
  ): void {
    const first = declarations[0];
    if (first === undefined) return;
    const analysis = declarationAnalysis.get(first.id);
    const visibility = new Set(
      declarations.map((declaration) => declaration.visibility),
    );
    if (
      (first.symbol === "type" || first.form === "constant") &&
      visibility.size > 1
    )
      this.problem(
        inventory,
        analysis,
        first,
        "ruby-constant-visibility",
        `Ruby constant '${first.identity.join("::")}' has conflicting selected visibility states.`,
        "Keep the declaration and its private_constant or public_constant transition in one unambiguous source order.",
      );
    if (first.symbol === "type") {
      const kinds = new Set(
        declarations.map((declaration) => declaration.containerKind),
      );
      if (kinds.size > 1)
        this.problem(
          inventory,
          analysis,
          first,
          "ruby-container-kind",
          `Ruby constant '${first.identity.join("::")}' is declared as both a class and a module.`,
          "Use one compatible container kind for every reopening.",
        );
      const superclasses = new Set(
        declarations.flatMap((declaration) =>
          declaration.superclass === undefined ? [] : [declaration.superclass],
        ),
      );
      if (superclasses.size > 1)
        this.problem(
          inventory,
          analysis,
          first,
          "ruby-superclass-conflict",
          `Ruby class '${first.identity.join("::")}' names conflicting superclasses across reopenings.`,
          "Keep one explicit superclass and omit it from compatible reopenings.",
        );
      return;
    }
    if (first.form === "constant") {
      if (
        declarations.filter((declaration) => declaration.definition).length > 1
      )
        this.problem(
          inventory,
          analysis,
          first,
          "ruby-constant-redefinition",
          `Ruby constant '${first.identity.join("::")}' has more than one selected assignment.`,
          "Keep one assignment or add explicit runtime load-order analysis.",
        );
      return;
    }
    if (first.symbol === "function") {
      if (
        declarations.filter((declaration) => declaration.definition).length > 1
      )
        this.problem(
          inventory,
          analysis,
          first,
          "ruby-method-redefinition",
          `Ruby method '${first.identity.join(".")}' has competing selected definitions.`,
          "Keep one definition or add explicit runtime load-order analysis; Ruby methods are replaced rather than overloaded.",
        );
      return;
    }
    if (first.form === "attribute")
      for (const mode of ["read", "write"])
        if (
          declarations.filter(
            (declaration) => declaration.attributeMode === mode,
          ).length > 1
        )
          this.problem(
            inventory,
            analysis,
            first,
            "ruby-attribute-redefinition",
            `Ruby attribute '${first.identity.join(".")}' declares its ${mode} access more than once.`,
            "Keep one literal declaration for each reader or writer capability.",
          );
  }

  private checkAddressCollisions(
    inventory: IEvidenceInventory,
    analyses: IEvidenceRubyFileAnalysis[],
    published: Map<string, string>,
  ): void {
    const owners = new Map<string, Set<string>>();
    const firstDeclarations = new Map<string, IEvidenceRubyDeclaration>();
    const declarationAnalysis = new Map<string, IEvidenceRubyFileAnalysis>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        const unitId = published.get(declaration.id);
        if (unitId === undefined) continue;
        declarationAnalysis.set(declaration.id, analysis);
        for (const sourceAddress of analysis.source.addresses) {
          const key = JSON.stringify([
            sourceAddress.absolute,
            declaration.address,
          ]);
          const values = owners.get(key) ?? new Set<string>();
          values.add(unitId);
          owners.set(key, values);
          if (!firstDeclarations.has(key))
            firstDeclarations.set(key, declaration);
        }
      }
    for (const [key, unitIds] of owners) {
      if (unitIds.size < 2) continue;
      const first = firstDeclarations.get(key);
      if (first === undefined) continue;
      this.problem(
        inventory,
        declarationAnalysis.get(first.id),
        first,
        "ruby-address-conflict",
        `Ruby public address '${first.address.join(".")}' identifies more than one declared contract.`,
        "Rename the colliding constant, method, or attribute, or add a distinct canonical address rule.",
      );
    }
  }

  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidenceRubyFileAnalysis[],
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
    for (const analysis of analyses)
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
    this.materializeUndocumentedHosts(inventory, analyses, published, hidden);
  }

  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analyses: IEvidenceRubyFileAnalysis[],
    published: Map<string, string>,
    hidden: Set<string>,
  ): void {
    for (const analysis of analyses) {
      const documented = new Set(
        analysis.documentation.flatMap((documentation) =>
          documentation.attachments.flatMap((attachment) => {
            const unitId = published.get(attachment.declarationId);
            return unitId !== undefined && !hidden.has(unitId)
              ? [attachment.siteId]
              : [];
          }),
        ),
      );
      const sites = new Map<string, IEvidenceRubyDeclaration[]>();
      for (const declaration of analysis.declarations) {
        const unitId = published.get(declaration.id);
        if (
          unitId === undefined ||
          hidden.has(unitId) ||
          documented.has(declaration.site.id)
        )
          continue;
        const declarations = sites.get(declaration.site.id) ?? [];
        declarations.push(declaration);
        sites.set(declaration.site.id, declarations);
      }
      for (const declarations of sites.values()) {
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
  }

  private attachmentGroups(
    documentation: IEvidenceRubyDocumentation,
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
    documentation: IEvidenceRubyDocumentation,
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
              "Move the annotation into an adjacent Ruby comment on a supported public class, module, method, constant, alias, or literal attribute declaration.",
          }),
    };
  }

  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidenceRubyDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    const mapping = this.mapping(source, documentation);
    return EvidenceTagParser.parse(source.content, host, {
      ...mapping,
      hostId: host.id,
    });
  }

  private annotation(
    analysis: IEvidenceRubyFileAnalysis,
    documentation: IEvidenceRubyDocumentation,
  ): boolean {
    return this.annotationPattern(
      this.mapping(analysis.source, documentation).text,
      true,
    );
  }

  private claimAnnotation(
    analysis: IEvidenceRubyFileAnalysis,
    documentation: IEvidenceRubyDocumentation,
  ): boolean {
    return this.annotationPattern(
      this.mapping(analysis.source, documentation).text,
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

  private mapping(
    source: IEvidenceSourceFile,
    documentation: IEvidenceRubyDocumentation,
  ): IEvidenceDocumentation {
    if (documentation.mapping !== undefined)
      return structuredClone(documentation.mapping);
    if (documentation.syntax === undefined)
      throw new Error("Ruby documentation has no source mapping.");
    return EvidenceDocumentation.read(
      source.content,
      documentation.id,
      documentation.range,
      documentation.syntax,
    );
  }

  private addSite(unit: IEvidenceUnit, candidate: IEvidenceUnitSite): void {
    const site = unit.sites.find((entry) => entry.id === candidate.id);
    if (site === undefined) {
      unit.sites.push(structuredClone(candidate));
      return;
    }
    for (const content of candidate.content)
      if (
        !site.content.some(
          (range) =>
            range.start.offset === content.start.offset &&
            range.end.offset === content.end.offset,
        )
      )
        site.content.push(structuredClone(content));
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

  private unitId(declaration: IEvidenceRubyDeclaration): string {
    if (declaration.symbol === "type") return this.typeId(declaration.identity);
    if (declaration.form === "constant")
      return `ruby:property:constant:${JSON.stringify(declaration.identity)}`;
    if (declaration.form === "attribute")
      return `ruby:property:attribute:${declaration.side ?? "instance"}:${JSON.stringify(declaration.identity)}`;
    return `ruby:function:${declaration.side ?? "instance"}:${JSON.stringify(declaration.identity)}`;
  }

  private typeId(identity: string[]): string {
    return `ruby:type:container:${JSON.stringify(identity)}`;
  }

  private problem(
    inventory: IEvidenceInventory,
    analysis: IEvidenceRubyFileAnalysis | undefined,
    declaration: IEvidenceRubyDeclaration,
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
      location: {
        file: analysis?.source?.physicalPath ?? declaration.site.file,
        range: declaration.site.range,
      },
    });
  }
}
