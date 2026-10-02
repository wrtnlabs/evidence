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
import type { IEvidenceKotlinDeclaration } from "./IEvidenceKotlinDeclaration";
import type { IEvidenceKotlinDocumentation } from "./IEvidenceKotlinDocumentation";
import type { IEvidenceKotlinFileAnalysis } from "./IEvidenceKotlinFileAnalysis";
import { EvidenceKotlinDocumentation } from "./EvidenceKotlinDocumentation";
import { EvidenceKotlinFileScanner } from "./EvidenceKotlinFileScanner";
import { EvidenceKotlinReceivers } from "./EvidenceKotlinReceivers";

/**
 * Resolves Kotlin nominal receivers before publishing declaration and KDoc
 * hosts.
 *
 * File analysis retains aliases, type parameters, and receiver candidates until
 * the selected snapshot is available for lookup. Receiver resolution then
 * updates ownership or records uncertainty before unit materialization. KDoc
 * attachments join the resulting units through physical declaration sites,
 * preserving the distinction between a receiver-qualified public path and its
 * original source.
 */
export class EvidenceKotlinAdapter implements IEvidenceAdapter<"kotlin"> {
  /**
   * Kotlin discriminator selecting KDoc and receiver-aware declaration rules.
   *
   * This fixes the language of inventory records; it does not widen selection
   * to scripts or compiler-generated declarations absent from the snapshot.
   */
  public get type(): "kotlin" {
    return "kotlin";
  }

  /**
   * Extracts and reconciles Kotlin declarations from an owned source snapshot.
   *
   * All files are scanned before receiver lookup. Resolution findings
   * contribute to completeness before units and documentation are published,
   * and the parser closes after both successful and failed materialization.
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
          "Restore access to the selected Kotlin source before evaluating coverage.",
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
      // Alias targets and nominal receivers can be declared in another file.
      // Resolve them before assigning extension units or accepting their tags.
      EvidenceKotlinReceivers.resolve(analyses);
      for (const analysis of analyses) {
        inventory.diagnostics.push(...analysis.diagnostics);
        inventory.complete &&= analysis.complete;
      }
      const published = this.materializeUnits(inventory, analyses);
      this.materializeDocumentation(inventory, analyses, published);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  /**
   * Converts parser failures into incomplete source analysis.
   *
   * Returning a per-file diagnostic preserves the selected source population so
   * one failed parse cannot silently remove its declarations from coverage.
   */
  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidenceKotlinFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: "kotlin", file, content: source.content },
        (session) => new EvidenceKotlinFileScanner(session, source).scan(),
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
            code: `kotlin-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `Kotlin parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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
   * Reconciles overload families and retains each physical declaration address.
   *
   * Functions sharing a Kotlin identity form one unit with multiple sites,
   * while other duplicate identities remain a completeness error rather than a
   * merge.
   */
  private materializeUnits(
    inventory: IEvidenceInventory,
    analyses: IEvidenceKotlinFileAnalysis[],
  ): Map<string, string> {
    const published = new Map<string, string>();
    const publicDeclarations = analyses.flatMap((analysis) =>
      analysis.declarations.filter((declaration) => declaration.public),
    );
    for (const declaration of publicDeclarations)
      published.set(declaration.id, this.unitId(declaration));

    const units = new Map<string, IEvidenceUnit>();
    const declarationIds = new Map<string, Set<string>>();
    const addresses = new Set<string>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        if (!declaration.public) continue;
        const id = this.unitId(declaration);
        const parentId =
          declaration.ownerDeclarationId === undefined
            ? undefined
            : published.get(declaration.ownerDeclarationId);
        const previousDeclarations =
          declarationIds.get(id) ?? new Set<string>();
        if (
          declaration.symbol !== "function" &&
          previousDeclarations.size !== 0 &&
          !previousDeclarations.has(declaration.id)
        )
          this.problem(
            inventory,
            analysis,
            "kotlin-declaration-conflict",
            `Kotlin public identity '${declaration.identity.join(".")}' has more than one selected declaration.`,
            "Select one source declaration for this package identity before checking coverage.",
          );
        previousDeclarations.add(declaration.id);
        declarationIds.set(id, previousDeclarations);

        let unit = units.get(id);
        if (unit === undefined) {
          unit = {
            id,
            type: "kotlin",
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
          const address: IEvidencePublicAddress = {
            unitId: id,
            file: sourceAddress.absolute,
            segments: declaration.address,
          };
          const key = JSON.stringify(address);
          if (addresses.has(key)) continue;
          addresses.add(key);
          inventory.addresses.push(address);
        }
      }
    inventory.units.push(...units.values());
    return published;
  }

  /**
   * Resolves withdrawals before publishing attached annotation hosts.
   *
   * Tags first populate unit withdrawals, then inherited hidden ownership
   * filters visible hosts so withdrawn declarations cannot receive
   * acknowledgements.
   */
  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidenceKotlinFileAnalysis[],
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

  /**
   * Retains public declaration sites even when they carry no documentation.
   *
   * Evidence needs a host for every visible unit so unhosted checklist results
   * can identify declarations that have no attached KDoc.
   */
  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analysis: IEvidenceKotlinFileAnalysis,
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
    const groups = new Map<string, IEvidenceKotlinDeclaration[]>();
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

  /**
   * Groups published semantic owners by their physical declaration site.
   *
   * One KDoc can attach to declarations that share a site, while duplicate unit
   * IDs within that group are removed before the tag parser creates a host.
   */
  private attachmentGroups(
    documentation: IEvidenceKotlinDocumentation,
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

  /**
   * Creates an attached or explicitly unsupported documentation carrier.
   *
   * Annotation parsing still receives an unsupported carrier so misplaced KDoc
   * produces an actionable diagnostic instead of disappearing from the graph.
   */
  private host(
    source: IEvidenceSourceFile,
    documentation: IEvidenceKotlinDocumentation,
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
              "Move the annotation into KDoc attached to a supported public Kotlin declaration.",
          }),
    };
  }

  /**
   * Parses Evidence tags only after the adapter establishes their host.
   *
   * Kotlin-specific documentation normalization runs before the shared parser
   * so source mappings and masked examples apply consistently to every host.
   */
  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidenceKotlinDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    return EvidenceTagParser.parse(
      source.content,
      host,
      EvidenceKotlinDocumentation.read(source, documentation, host.id),
    );
  }

  /**
   * Detects Evidence or withdrawal annotations outside masked examples.
   *
   * The broad pattern determines whether unowned KDoc needs an unsupported host
   * for acknowledgements, reviews, and declaration-withdrawal tags.
   */
  private annotation(
    analysis: IEvidenceKotlinFileAnalysis,
    documentation: IEvidenceKotlinDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceKotlinDocumentation.read(
        analysis.source,
        documentation,
        documentation.id,
      ).text,
      true,
    );
  }

  /**
   * Detects acknowledgements and reviews on withdrawn carriers.
   *
   * Withdrawal-only text does not keep a hidden declaration's host alive, but
   * evidence and review tags still need diagnostics or graph records.
   */
  private claimAnnotation(
    analysis: IEvidenceKotlinFileAnalysis,
    documentation: IEvidenceKotlinDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceKotlinDocumentation.read(
        analysis.source,
        documentation,
        documentation.id,
      ).text,
      false,
    );
  }

  /**
   * Recognizes supported annotation names at documentation line boundaries.
   *
   * Line anchoring prevents prose and masked examples containing tag-like text
   * from manufacturing an annotation carrier.
   */
  private annotationPattern(raw: string, withdrawal: boolean): boolean {
    return withdrawal
      ? /(?:^|[\r\n])[ \t]*@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link|internal|hidden|ignore)\b/u.test(
          raw,
        )
      : /(?:^|[\r\n])[ \t]*@(evidenceExcludeReview|evidenceReview|evidenceExclude|evidence|link)\b/u.test(
          raw,
        );
  }

  /**
   * Follows explicit parent ownership to propagate withdrawal.
   *
   * The visited set breaks malformed ownership cycles; a unit is hidden when it
   * or any reachable owner has a withdrawal record.
   */
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

  /**
   * Separates programming kinds while unifying package-scoped overload
   * identities.
   *
   * Kotlin function overloads intentionally share an identity, whereas symbol
   * kind remains part of the key to keep types and properties distinct.
   */
  private unitId(declaration: IEvidenceKotlinDeclaration): string {
    return `kotlin:${declaration.symbol}:${JSON.stringify(declaration.identity)}`;
  }

  /**
   * Marks a declaration conflict as incomplete analysis.
   *
   * The inventory keeps the diagnostic and source location, but cannot claim a
   * complete public surface while one identity has conflicting declarations.
   */
  private problem(
    inventory: IEvidenceInventory,
    analysis: IEvidenceKotlinFileAnalysis,
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
