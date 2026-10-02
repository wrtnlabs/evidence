import { createHash } from "node:crypto";

import typia from "typia";

import { EvidenceFingerprintIndex } from "../../internal/EvidenceFingerprintIndex";
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
import type { IEvidencePhpDeclaration } from "./IEvidencePhpDeclaration";
import type { IEvidencePhpDocumentation } from "./IEvidencePhpDocumentation";
import type { IEvidencePhpFileAnalysis } from "./IEvidencePhpFileAnalysis";
import { EvidencePhpDocumentation } from "./EvidencePhpDocumentation";
import { EvidencePhpFileScanner } from "./EvidencePhpFileScanner";

/**
 * Extracts PHP public identities and documentation with file-context
 * fingerprints.
 *
 * Declaration groups and public addresses are materialized before annotations.
 * Local imports and directives can change declaration meaning without changing
 * its own source span, so complete inventories incorporate that context into
 * content digests after normalization.
 */
export class EvidencePhpAdapter implements IEvidenceAdapter<"php"> {
  /**
   * Artifact family selecting PHP parsing and source-public extraction.
   *
   * The value connects population configuration to this adapter's visibility
   * and documentation attachment rules.
   */
  public get type(): "php" {
    return "php";
  }

  /**
   * Builds a serializable PHP inventory while retaining source and parser
   * failures.
   *
   * Input is validated and cloned before scanning. Only a complete normalized
   * inventory receives context-sensitive digests, and parser resources close in
   * cleanup.
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
          "Restore access to the selected PHP source before evaluating coverage.",
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
      const published = this.materializeUnits(inventory, analyses);
      this.materializeDocumentation(inventory, analyses, published);
      const output = new EvidenceInventory([inventory]).snapshot();
      // Context hashes depend on valid declaration content ranges. Do not certify
      // them when normalization has already found an incomplete inventory.
      if (output.complete) this.contextDigests(output, analyses);
      return output;
    } finally {
      await parser.close();
    }
  }

  /**
   * Incorporates local imports and directives into declaration review content.
   *
   * Context is combined with the existing content digest without widening
   * physical declaration ranges. All new digests are computed before assignment
   * so iteration order cannot make later calculations observe partially updated
   * units.
   */
  private contextDigests(
    inventory: IEvidenceInventory,
    analyses: IEvidencePhpFileAnalysis[],
  ): void {
    const contexts = new Map(
      analyses.map((analysis) => [
        analysis.source.physicalPath,
        analysis.context,
      ]),
    );
    const index = new EvidenceFingerprintIndex(inventory);
    const digests = new Map<string, string>();
    for (const unit of inventory.units) {
      const context = unit.sites.flatMap(
        (site) => contexts.get(site.file) ?? [],
      );
      if (context.length === 0) continue;
      digests.set(
        unit.id,
        createHash("sha256")
          .update(
            JSON.stringify([index.inspect(unit.id).contentDigest, context]),
          )
          .digest("hex"),
      );
    }
    for (const unit of inventory.units) {
      const digest = digests.get(unit.id);
      if (digest !== undefined) unit.contentDigest = digest;
    }
  }

  /**
   * Extracts one PHP file and translates acquisition or syntax failures.
   *
   * A failed scan preserves the source and located cause with incomplete state,
   * allowing the enclosing inventory to explain why coverage cannot be
   * certified.
   */
  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidencePhpFileAnalysis> {
    const file = source.addresses[0]?.relative ?? source.physicalPath;
    try {
      return await parser.parse(
        { type: "php", file, content: source.content },
        (session) => new EvidencePhpFileScanner(session, source).scan(),
      );
    } catch (cause) {
      const parserError =
        cause instanceof EvidenceParserError ? cause : undefined;
      return {
        source,
        declarations: [],
        documentation: [],
        context: [],
        diagnostics: [
          {
            code: `php-${parserError?.code ?? "parse-failed"}`,
            severity: "error",
            message:
              parserError?.message ??
              `PHP parsing failed: ${cause instanceof Error ? cause.message : String(cause)}`,
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
   * Materializes public PHP identities and reports conflicting declarations.
   *
   * It retains compatible physical sites under one unit while emitting each
   * configured file address.
   */
  private materializeUnits(
    inventory: IEvidenceInventory,
    analyses: IEvidencePhpFileAnalysis[],
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
          previousDeclarations.size !== 0 &&
          !previousDeclarations.has(declaration.id)
        )
          this.problem(
            inventory,
            analysis,
            "php-declaration-conflict",
            `PHP public identity '${declaration.identity.join(".")}' has more than one selected declaration.`,
            "Select one source declaration for this namespace identity before checking coverage.",
          );
        previousDeclarations.add(declaration.id);
        declarationIds.set(id, previousDeclarations);

        let unit = units.get(id);
        if (unit === undefined) {
          unit = {
            id,
            type: "php",
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
   * Attaches PHPDoc after unit materialization and reconciles withdrawals.
   *
   * Unsupported tagged carriers still receive diagnostic hosts so their
   * directives remain visible.
   */
  private materializeDocumentation(
    inventory: IEvidenceInventory,
    analyses: IEvidencePhpFileAnalysis[],
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
   * Creates hosts for public declarations without attached documentation.
   *
   * This preserves their claim obligations after withdrawn and documented units
   * are excluded.
   */
  private materializeUndocumentedHosts(
    inventory: IEvidenceInventory,
    analysis: IEvidencePhpFileAnalysis,
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
    const groups = new Map<string, IEvidencePhpDeclaration[]>();
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
   * Groups a PHPDoc carrier's published declarations by physical source site.
   *
   * One carrier can attach to multiple units, but each site requires its own
   * host boundary.
   */
  private attachmentGroups(
    documentation: IEvidencePhpDocumentation,
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
   * Creates a host for attached documentation or an unsupported tagged carrier.
   *
   * The host retains the original source range and eligible unit IDs for tag
   * parsing.
   */
  private host(
    source: IEvidenceSourceFile,
    documentation: IEvidencePhpDocumentation,
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
              "Move the annotation into PHPDoc attached to a supported public PHP declaration.",
          }),
    };
  }

  /**
   * Parses evidence tags after the adapter has established their owning host.
   *
   * This prevents source-adjacent text from acquiring units through later
   * lexical coincidence.
   */
  private parse(
    source: IEvidenceSourceFile,
    documentation: IEvidencePhpDocumentation,
    host: IEvidenceHost,
  ): IEvidenceTagParseResult {
    return EvidenceTagParser.parse(
      source.content,
      host,
      EvidencePhpDocumentation.read(source, documentation, host.id),
    );
  }

  /**
   * Detects supported annotations on a PHPDoc carrier before it has a host.
   *
   * The result decides whether unsupported placement requires an actionable
   * diagnostic host.
   */
  private annotation(
    analysis: IEvidencePhpFileAnalysis,
    documentation: IEvidencePhpDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidencePhpDocumentation.read(
        analysis.source,
        documentation,
        documentation.id,
      ).text,
      true,
    );
  }

  /**
   * Distinguishes claim annotations from withdrawal-only documentation.
   *
   * Withdrawn units suppress ordinary hosts unless the carrier still contains
   * an independent claim.
   */
  private claimAnnotation(
    analysis: IEvidencePhpFileAnalysis,
    documentation: IEvidencePhpDocumentation,
  ): boolean {
    return this.annotationPattern(
      EvidencePhpDocumentation.read(
        analysis.source,
        documentation,
        documentation.id,
      ).text,
      false,
    );
  }

  /**
   * Recognizes supported tag names at normalized documentation line boundaries.
   *
   * Parsing uses PHPDoc masking first so examples cannot accidentally create
   * declarations.
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
   * Determines whether a unit is withdrawn directly or through its lexical
   * parent.
   *
   * The visited set prevents malformed ownership cycles from making withdrawal
   * traversal recurse indefinitely.
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
   * Builds the unit ID using PHP's case-insensitive identity rules where
   * applicable.
   *
   * Public accessor spelling remains separate so case-sensitive properties
   * retain their address.
   */
  private unitId(declaration: IEvidencePhpDeclaration): string {
    const identity = declaration.identity.map((segment, index) =>
      declaration.symbol === "property" &&
      index === declaration.identity.length - 1
        ? segment
        : segment.replace(/[A-Z]/gu, (character) => character.toLowerCase()),
    );
    return `php:${declaration.symbol}:${JSON.stringify(identity)}`;
  }

  /**
   * Records a declaration conflict and marks the inventory incomplete.
   *
   * This prevents duplicate public identities from reducing the population to a
   * passing subset.
   */
  private problem(
    inventory: IEvidenceInventory,
    analysis: IEvidencePhpFileAnalysis,
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
