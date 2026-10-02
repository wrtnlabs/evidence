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
import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";
import { EvidenceCppDocumentation } from "./EvidenceCppDocumentation";
import { EvidenceCppFileScanner } from "./EvidenceCppFileScanner";
import type { IEvidenceCppAlias } from "./IEvidenceCppAlias";
import type { IEvidenceCppDeclaration } from "./IEvidenceCppDeclaration";
import type { IEvidenceCppDeclarationGroup } from "./IEvidenceCppDeclarationGroup";
import type { IEvidenceCppDocumentation } from "./IEvidenceCppDocumentation";
import type { IEvidenceCppFileAnalysis } from "./IEvidenceCppFileAnalysis";
import type { IEvidenceCppResolvedAlias } from "./IEvidenceCppResolvedAlias";

/**
 * Reconciles C++ declaration families, public aliases, and documentation
 * ownership.
 *
 * The scanner records lexical declarations and qualified definitions before the
 * snapshot-wide materializer decides which occurrences belong to one unit.
 * Alias resolution can then project public paths without changing canonical
 * identity. Documentation is attached only after those relationships are
 * known.
 *
 * The pipeline carries conflicts and unsupported source forms into incomplete
 * output. It does not replace C++ lookup, preprocessing, or instantiation with
 * name-based guesses merely to produce a smaller public inventory.
 */
export class EvidenceCppAdapter implements IEvidenceAdapter<"cpp"> {
  /**
   * C++ artifact discriminator used by the public adapter.
   *
   * The configured type selects C++ grammar and ownership policy even for
   * header extensions also accepted by C; extension overlap does not choose
   * semantics.
   */
  public get type(): "cpp" {
    return "cpp";
  }

  /**
   * Builds a C++ inventory from an owned copy of the source snapshot.
   *
   * Parsing precedes declaration and alias reconciliation, followed by
   * annotation materialization and common inventory validation. Failures retain
   * diagnostics, and the invocation's parser closes regardless of the
   * extraction outcome.
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
          "Restore access to the selected C++ source before evaluating coverage.",
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
      // Qualified definitions and aliases need the complete selected declaration
      // set before a documentation position can be assigned its semantic owners.
      const published = this.materializeUnits(inventory, analyses);
      this.materializeDocumentation(inventory, analyses, published);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidenceCppFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: "cpp", file, content: source.content },
        (session) => new EvidenceCppFileScanner(session, source).scan(),
      );
    } catch (cause) {
      const parserError =
        cause instanceof EvidenceParserError ? cause : undefined;
      return {
        source,
        declarations: [],
        aliases: [],
        documentation: [],
        diagnostics: [
          {
            code: `cpp-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `C++ parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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
    analyses: IEvidenceCppFileAnalysis[],
  ): Map<string, string> {
    const declarationAnalysis = new Map<string, IEvidenceCppFileAnalysis>();
    const groups = new Map<string, IEvidenceCppDeclarationGroup>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        declarationAnalysis.set(declaration.id, analysis);
        const id = this.unitId(declaration);
        let group = groups.get(id);
        if (group === undefined) {
          group = { id, declarations: [] };
          groups.set(id, group);
        }
        group.declarations.push(declaration);
      }

    const publicGroups = new Set<string>();
    for (const group of groups.values()) {
      if (
        group.declarations.some(
          (declaration) => declaration.visibility === "public",
        )
      )
        publicGroups.add(group.id);
    }
    for (const group of groups.values()) {
      const qualified = group.declarations.filter(
        (declaration) => declaration.visibility === "qualified",
      );
      if (qualified.length === 0 || publicGroups.has(group.id)) continue;
      if (
        group.declarations.some(
          (declaration) => declaration.visibility === "non-public",
        )
      )
        continue;
      const first = qualified[0];
      const analysis =
        first === undefined ? undefined : declarationAnalysis.get(first.id);
      const parent =
        first?.parentIdentity === undefined
          ? undefined
          : groups.get(this.typeId(first.parentIdentity));
      if (
        parent !== undefined &&
        parent.declarations.every(
          (declaration) => declaration.form === "namespace",
        ) &&
        publicGroups.has(parent.id)
      ) {
        publicGroups.add(group.id);
        continue;
      }
      if (first !== undefined && analysis !== undefined)
        this.problem(
          inventory,
          analysis,
          "cpp-qualified-owner",
          `C++ qualified declaration '${first.identity.join(".")}' has no selected public member declaration that establishes its owner and access.`,
          "Select the declaring class or namespace source, or add semantic owner resolution before evaluating this definition.",
        );
    }
    for (const group of groups.values())
      if (publicGroups.has(group.id))
        this.checkGroup(inventory, group, declarationAnalysis);

    const published = new Map<string, string>();
    for (const group of groups.values())
      if (publicGroups.has(group.id))
        for (const declaration of group.declarations)
          if (declaration.visibility !== "non-public")
            published.set(declaration.id, group.id);

    const units = new Map<string, IEvidenceUnit>();
    for (const group of groups.values()) {
      if (!publicGroups.has(group.id)) continue;
      const declarations = group.declarations.filter(
        (declaration) => declaration.visibility !== "non-public",
      );
      const first = declarations[0];
      if (first === undefined) continue;
      const parentId =
        first.parentIdentity === undefined
          ? undefined
          : publicGroups.has(this.typeId(first.parentIdentity))
            ? this.typeId(first.parentIdentity)
            : undefined;
      const unit: IEvidenceUnit = {
        id: group.id,
        type: "cpp",
        symbol: first.symbol,
        identity: first.identity,
        name: first.name,
        sites: [],
        withdrawals: [],
        ...(parentId === undefined ? {} : { parentId }),
      };
      for (const declaration of declarations)
        if (!unit.sites.some((site) => site.id === declaration.site.id))
          unit.sites.push(structuredClone(declaration.site));
      units.set(unit.id, unit);
    }
    inventory.units.push(...units.values());

    const addressOwners = new Map<string, string>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        const unitId = published.get(declaration.id);
        if (unitId === undefined) continue;
        for (const sourceAddress of analysis.source.addresses)
          for (const segments of declaration.addresses)
            this.addAddress(
              inventory,
              analysis,
              addressOwners,
              unitId,
              sourceAddress.absolute,
              segments,
            );
      }

    const resolvedAliases = this.resolveAliases(
      inventory,
      analyses,
      units,
      published,
    );
    for (const resolved of resolvedAliases) {
      const unit = units.get(resolved.target.id);
      if (
        unit !== undefined &&
        !unit.sites.some((site) => site.id === resolved.alias.site.id)
      )
        unit.sites.push(structuredClone(resolved.alias.site));
      for (const sourceAddress of resolved.analysis.source.addresses)
        for (const candidate of units.values()) {
          if (!prefix(candidate.identity, resolved.target.identity)) continue;
          this.addAddress(
            inventory,
            resolved.analysis,
            addressOwners,
            candidate.id,
            sourceAddress.absolute,
            [
              ...resolved.alias.scopeAddress,
              resolved.alias.name,
              ...candidate.identity.slice(resolved.target.identity.length),
            ],
          );
        }
    }
    return published;
  }

  private checkGroup(
    inventory: IEvidenceInventory,
    group: IEvidenceCppDeclarationGroup,
    analyses: Map<string, IEvidenceCppFileAnalysis>,
  ): void {
    const callableForms = new Set([
      "function",
      "constructor",
      "destructor",
      "operator",
      "conversion",
    ]);
    const declarations = group.declarations.filter(
      (declaration) => declaration.visibility !== "non-public",
    );
    const first = declarations[0];
    const analysis = first === undefined ? undefined : analyses.get(first.id);
    if (first === undefined || analysis === undefined) return;
    const forms = new Set(declarations.map((declaration) => declaration.form));
    const definitions = declarations.filter(
      (declaration) => declaration.definition,
    );
    const callable = declarations.every((declaration) =>
      callableForms.has(declaration.form),
    );
    const records = declarations.every((declaration) =>
      ["class", "struct"].includes(declaration.form),
    );
    const staticData = declarations.every((declaration) =>
      ["static-field", "variable"].includes(declaration.form),
    );
    const compatibleForms = forms.size === 1 || records || staticData;
    const repeatedDefinition =
      !callable &&
      first.form !== "namespace" &&
      first.form !== "field" &&
      first.form !== "enumerator" &&
      definitions.length > 1;
    const repeatedMember =
      (first.form === "field" || first.form === "enumerator") &&
      declarations.length > 1;
    const inaccessibleOverloads = group.declarations.some(
      (declaration) =>
        declaration.visibility === "non-public" &&
        callableForms.has(declaration.form),
    );
    const qualifiedDefinitions = group.declarations.some(
      (declaration) =>
        declaration.visibility === "qualified" &&
        callableForms.has(declaration.form),
    );
    if (!compatibleForms || repeatedDefinition || repeatedMember)
      this.problem(
        inventory,
        analysis,
        "cpp-declaration-conflict",
        `C++ identity '${first.identity.join(".")}' has incompatible selected declarations.`,
        "Keep one compatible type or property definition, or one name-only callable overload family.",
      );
    if (callable && inaccessibleOverloads && qualifiedDefinitions)
      this.problem(
        inventory,
        analysis,
        "cpp-overload-access",
        `C++ overload family '${first.identity.join(".")}' mixes public and inaccessible declarations with qualified definitions.`,
        "Keep access-specific definitions outside the selected snapshot or add signature-aware definition matching before evaluating this source.",
      );
  }

  private resolveAliases(
    inventory: IEvidenceInventory,
    analyses: IEvidenceCppFileAnalysis[],
    units: Map<string, IEvidenceUnit>,
    published: Map<string, string>,
  ): IEvidenceCppResolvedAlias[] {
    const output: IEvidenceCppResolvedAlias[] = [];
    const aliases = analyses.flatMap((analysis) =>
      analysis.aliases.map((alias) => ({ analysis, alias })),
    );
    for (const entry of aliases) {
      if (!entry.alias.public) continue;
      const candidates = this.aliasCandidates(entry.alias, units);
      if (candidates.length !== 1) {
        this.problem(
          inventory,
          entry.analysis,
          "cpp-alias-resolution",
          `C++ ${entry.alias.kind} alias '${entry.alias.name}' resolves to ${candidates.length} selected public units.`,
          "Select one explicit target or add semantic alias resolution before evaluating this source.",
        );
        continue;
      }
      const target = candidates[0];
      if (target === undefined) continue;
      published.set(entry.alias.id, target.id);
      output.push({ alias: entry.alias, analysis: entry.analysis, target });
    }
    return output;
  }

  private aliasCandidates(
    alias: IEvidenceCppAlias,
    units: Map<string, IEvidenceUnit>,
  ): IEvidenceUnit[] {
    const paths = [alias.target, [...alias.scopeIdentity, ...alias.target]];
    const keys = new Set(paths.map((path) => JSON.stringify(path)));
    let candidates = Array.from(units.values()).filter((unit) =>
      keys.has(JSON.stringify(unit.identity)),
    );
    if (candidates.length !== 0) return candidates;
    candidates = Array.from(units.values()).filter((unit) =>
      paths.some(
        (path) =>
          path.length === unit.identity.length &&
          path.every((part, index) => {
            const actual = unit.identity[index];
            return (
              actual !== undefined &&
              (part === actual || part === actual.replace(/`\d+$/u, ""))
            );
          }),
      ),
    );
    return candidates;
  }

  private addAddress(
    inventory: IEvidenceInventory,
    analysis: IEvidenceCppFileAnalysis,
    owners: Map<string, string>,
    unitId: string,
    file: string,
    segments: string[],
  ): void {
    const address: IEvidencePublicAddress = { unitId, file, segments };
    const addressKey = JSON.stringify([file, segments]);
    const owner = owners.get(addressKey);
    if (owner !== undefined && owner !== unitId) {
      this.problem(
        inventory,
        analysis,
        "cpp-address-conflict",
        `C++ address '${segments.join(".")}' selects more than one semantic unit.`,
        "Use distinct declarations or add an unambiguous address rule before evaluating this source.",
      );
      return;
    }
    owners.set(addressKey, unitId);
    if (
      !inventory.addresses.some(
        (candidate) => JSON.stringify(candidate) === JSON.stringify(address),
      )
    )
      inventory.addresses.push(address);
  }

  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidenceCppFileAnalysis[],
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
    analysis: IEvidenceCppFileAnalysis,
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
    const sites = new Map<string, IEvidenceUnitSite>();
    const unitIds = new Map<string, string[]>();
    for (const declaration of [...analysis.declarations, ...analysis.aliases]) {
      const unitId = published.get(declaration.id);
      if (
        unitId === undefined ||
        hidden.has(unitId) ||
        documented.has(declaration.id)
      )
        continue;
      sites.set(declaration.site.id, declaration.site);
      const ids = unitIds.get(declaration.site.id) ?? [];
      if (!ids.includes(unitId)) ids.push(unitId);
      unitIds.set(declaration.site.id, ids);
    }
    for (const [siteId, site] of sites) {
      inventory.hosts.push({
        id: `${siteId}:host`,
        file: analysis.source.physicalPath,
        range: site.range,
        origins: analysis.source.addresses.map((address) => address.absolute),
        siteId,
        unitIds: unitIds.get(siteId) ?? [],
        attachment: "attached",
      });
    }
  }

  private attachmentGroups(
    documentation: IEvidenceCppDocumentation,
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
    documentation: IEvidenceCppDocumentation,
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
              "Move the annotation into Doxygen attached to a supported public C++ declaration.",
          }),
    };
  }

  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidenceCppDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    return EvidenceTagParser.parse(
      source.content,
      host,
      EvidenceCppDocumentation.read(source, documentation, host.id),
    );
  }

  private annotation(
    analysis: IEvidenceCppFileAnalysis,
    documentation: IEvidenceCppDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceCppDocumentation.read(
        analysis.source,
        documentation,
        documentation.id,
      ).text,
      true,
    );
  }

  private claimAnnotation(
    analysis: IEvidenceCppFileAnalysis,
    documentation: IEvidenceCppDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceCppDocumentation.read(
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

  private unitId(declaration: IEvidenceCppDeclaration): string {
    return `cpp:${declaration.symbol}:${JSON.stringify(declaration.identity)}`;
  }

  private typeId(identity: string[]): string {
    return `cpp:type:${JSON.stringify(identity)}`;
  }

  private problem(
    inventory: IEvidenceInventory,
    analysis: IEvidenceCppFileAnalysis,
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

function prefix(identity: string[], parent: string[]): boolean {
  return (
    identity.length >= parent.length &&
    parent.every((part, index) => identity[index] === part)
  );
}
