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
import type { IEvidenceMatlabDeclaration } from "./IEvidenceMatlabDeclaration";
import type { IEvidenceMatlabDocumentation } from "./IEvidenceMatlabDocumentation";
import type { IEvidenceMatlabFileAnalysis } from "./IEvidenceMatlabFileAnalysis";
import { EvidenceMatlabDocumentation } from "./EvidenceMatlabDocumentation";
import { EvidenceMatlabFileScanner } from "./EvidenceMatlabFileScanner";
import { EvidenceMatlabOwnership } from "./EvidenceMatlabOwnership";

/**
 * Extracts MATLAB public units after resolving file and class-folder ownership.
 *
 * Snapshot-wide ownership connects declarations that lexical scanning alone
 * cannot place under their final public owner. Unit materialization then
 * precedes documentation attachment, preserving shared identities, physical
 * sites, and incomplete-analysis diagnostics across the selected source
 * population.
 */
export class EvidenceMatlabAdapter implements IEvidenceAdapter<"matlab"> {
  /**
   * Artifact discriminator selecting MATLAB source interpretation.
   *
   * It disambiguates .m sources from other languages that accept the same
   * suffix.
   */
  public get type(): "matlab" {
    return "matlab";
  }

  /**
   * Builds an owned MATLAB inventory and closes the bounded parser runtime.
   *
   * Ownership resolution runs across file analyses before publishing units and
   * comment hosts. Failed source discovery or parsing remains an incomplete
   * result.
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
          "Restore access to the selected MATLAB source before evaluating coverage.",
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
      // Class-folder and external member ownership crosses file boundaries;
      // resolve it before groups receive public addresses or documentation hosts.
      EvidenceMatlabOwnership.resolve(analyses, inventory);
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
   * Scans one MATLAB file without retaining borrowed syntax nodes.
   *
   * Parser failures become source-located diagnostics with incomplete state, so
   * failed extraction cannot be mistaken for a file containing no public
   * declarations.
   */
  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidenceMatlabFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: "matlab", file, content: source.content },
        (session) => new EvidenceMatlabFileScanner(session, source).scan(),
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
            code: `matlab-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `MATLAB parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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
   * Reconciles class member sites and retains each physical declaration
   * address.
   *
   * Materialization joins scanner declarations under their resolved class owner
   * while preserving each physical implementation site for fingerprints and
   * tags.
   */
  private materializeUnits(
    inventory: IEvidenceInventory,
    analyses: IEvidenceMatlabFileAnalysis[],
  ): Map<string, string> {
    const published = new Map<string, string>();
    const publicDeclarations = analyses.flatMap((analysis) =>
      analysis.declarations.filter((declaration) => declaration.public),
    );
    for (const declaration of publicDeclarations)
      published.set(declaration.id, this.unitId(declaration));

    const units = new Map<string, IEvidenceUnit>();
    const addresses = new Set<string>();
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        if (!declaration.public) continue;
        const id = this.unitId(declaration);
        const parentId =
          declaration.ownerDeclarationId === undefined
            ? undefined
            : published.get(declaration.ownerDeclarationId);
        let unit = units.get(id);
        if (unit === undefined) {
          unit = {
            id,
            type: "matlab",
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

        for (const sourceAddress of [
          ...analysis.source.addresses.map((address) => address.absolute),
          ...(declaration.publicFiles ?? []),
        ]) {
          const address: IEvidencePublicAddress = {
            unitId: id,
            file: sourceAddress,
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
   * A withdrawn declaration must not expose a host that could satisfy coverage,
   * so this phase establishes effective withdrawal before tag parsing
   * proceeds.
   */
  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidenceMatlabFileAnalysis[],
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
   * Site preservation keeps the complete public population and its fingerprint
   * boundary independent of whether a declaration currently has a tag carrier.
   */
  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analysis: IEvidenceMatlabFileAnalysis,
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
    const groups = new Map<string, IEvidenceMatlabDeclaration[]>();
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
   * One site can represent several owners through MATLAB accessors and external
   * implementations, so later annotation attachment needs this retained
   * grouping.
   */
  private attachmentGroups(
    documentation: IEvidenceMatlabDocumentation,
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
   * This preserves valid MATLAB help for parsing and reports annotation-looking
   * text whose placement cannot legally document the surrounding declaration.
   */
  private host(
    source: IEvidenceSourceFile,
    documentation: IEvidenceMatlabDocumentation,
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
              "Move the annotation into MATLAB help attached to a supported public MATLAB declaration.",
          }),
    };
  }

  /**
   * Parses Evidence tags only after the adapter establishes their host.
   *
   * Host-first parsing prevents a comment from gaining coverage semantics until
   * its declaration scope, physical site, and withdrawal state are known.
   */
  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidenceMatlabDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    return EvidenceTagParser.parse(
      source.content,
      host,
      EvidenceMatlabDocumentation.read(source, documentation, host.id),
    );
  }

  /**
   * Detects Evidence or withdrawal annotations outside masked examples.
   *
   * The adapter uses this precheck to distinguish an unsupported carrier from
   * ordinary prose before it produces a placement diagnostic.
   */
  private annotation(
    analysis: IEvidenceMatlabFileAnalysis,
    documentation: IEvidenceMatlabDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceMatlabDocumentation.read(
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
   * Withdrawal may coexist with prose, but acknowledgement and review tags on
   * that carrier are rejected because a withdrawn host cannot provide
   * evidence.
   */
  private claimAnnotation(
    analysis: IEvidenceMatlabFileAnalysis,
    documentation: IEvidenceMatlabDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidenceMatlabDocumentation.read(
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
   * Boundary-aware matching avoids treating ordinary prose containing a marker
   * substring as an Evidence declaration or a withdrawal instruction.
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
   * A child inherits a withdrawn semantic owner only through the resolved
   * parent chain, keeping unrelated sites from losing their eligible annotation
   * hosts.
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
   * Separates programming kinds while unifying class-folder implementation
   * identities.
   *
   * This mapping gives MATLAB declarations stable public identities while class
   * folders and external method files continue to represent the same semantic
   * owner.
   */
  private unitId(declaration: IEvidenceMatlabDeclaration): string {
    return `matlab:${declaration.anchor}:${declaration.symbol}:${JSON.stringify(declaration.identity)}`;
  }
}
