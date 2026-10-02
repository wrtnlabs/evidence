import { createHash } from "node:crypto";
import typia from "typia";

import { EvidenceInventoryMerge } from "../../internal/EvidenceInventoryMerge";
import { EvidenceInventory } from "../../graph/EvidenceInventory";
import { EvidenceDbmlDocumentation } from "./EvidenceDbmlDocumentation";
import { EvidenceParser } from "../../parsers/EvidenceParser";
import { EvidenceParserError } from "../../parsers/EvidenceParserError";
import { EvidenceTagParser } from "../../parsers/EvidenceTagParser";
import type { IEvidenceAdapter } from "../../structures/IEvidenceAdapter";
import type { IEvidenceHost } from "../../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceSnapshot } from "../../structures/IEvidenceSourceSnapshot";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { IEvidenceDbmlDeclaration } from "./IEvidenceDbmlDeclaration";
import type { IEvidenceDbmlDocumentation } from "./IEvidenceDbmlDocumentation";
import type { IEvidenceDbmlEndpoint } from "./IEvidenceDbmlEndpoint";
import type { IEvidenceDbmlFileAnalysis } from "./IEvidenceDbmlFileAnalysis";
import { EvidenceDbmlFileScanner } from "./EvidenceDbmlFileScanner";

/**
 * Extracts DBML tables, columns, relations, and supported documentation hosts.
 *
 * Physical source aliases are deduplicated before parsing. Schema aliases and
 * relation endpoints are resolved across file analyses before public units and
 * annotation carriers are materialized, preserving semantic ownership and
 * explicit failures instead of guessing unresolved schema links.
 */
export class EvidenceDbmlAdapter implements IEvidenceAdapter<"dbml"> {
  /**
   * Database family discriminator selecting DBML parsing and schema rules.
   *
   * Claims and references use this value to apply the adapter's database
   * selectors.
   */
  public get type(): "dbml" {
    return "dbml";
  }

  /**
   * Builds a normalized DBML inventory from a validated, cloned source
   * snapshot.
   *
   * Failed scans preserve located diagnostics and incomplete state.
   * Successfully scanned files contribute dependencies, aliases, relation
   * ownership, and documentation before the parser runtime closes in cleanup.
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
      dependencies: input.dependencies,
      complete: input.complete,
      diagnostics: input.diagnostics.map((diagnostic) => ({
        code: `source-${diagnostic.code}`,
        severity: "error",
        message: diagnostic.message,
        repair: "Restore every selected DBML source before checking coverage.",
        location: { file: diagnostic.path },
      })),
    };
    const parser = new EvidenceParser();
    try {
      const records = new Map<string, IEvidenceSourceFile>();
      for (const source of input.files) {
        const previous = records.get(source.id);
        if (previous === undefined) records.set(source.id, source);
        else
          previous.addresses = EvidenceInventoryMerge.sourceAddresses([
            ...previous.addresses,
            ...source.addresses,
          ]);
      }
      const sources = Array.from(records.values());
      const analyses = await Promise.all(
        sources.map((source) => this.scan(parser, source)),
      );
      for (const analysis of analyses) {
        inventory.complete &&= analysis.complete;
        inventory.diagnostics.push(...analysis.diagnostics);
        inventory.dependencies.push({
          path: analysis.source.physicalPath,
          recursive: false,
        });
      }
      // Relation endpoints may use table aliases from another selected file.
      // Resolve those names before units and their documentation acquire owners.
      const aliases = this.aliases(inventory, analyses);
      this.relations(inventory, analyses, aliases);
      this.units(inventory, analyses, aliases);
      this.documentation(inventory, analyses);
      return new EvidenceInventory([inventory]).snapshot();
    } finally {
      await parser.close();
    }
  }

  /**
   * Extracts DBML declaration records inside one borrowed parse session.
   *
   * Syntax and acquisition failures retain their source range when available
   * and mark analysis incomplete, rather than contributing a successful empty
   * schema.
   */
  private async scan(
    parser: EvidenceParser,
    source: IEvidenceSourceFile,
  ): Promise<IEvidenceDbmlFileAnalysis> {
    try {
      return await parser.parse(
        {
          type: "dbml",
          file: source.addresses[0]?.relative ?? source.physicalPath,
          content: source.content,
        },
        (session) => new EvidenceDbmlFileScanner(session, source).scan(),
      );
    } catch (cause) {
      const error = cause instanceof EvidenceParserError ? cause : undefined;
      return {
        source,
        declarations: [],
        relations: [],
        documentation: [],
        enums: [],
        complete: false,
        diagnostics: [
          {
            code: `dbml-${error?.code ?? "parse-failed"}`,
            severity: "error",
            message: error?.message ?? String(cause),
            repair:
              "Ensure grammar and adapter support for the reported source construct before evaluating coverage.",
            location: {
              file: source.physicalPath,
              ...(error?.range === undefined ? {} : { range: error.range }),
            },
          },
        ],
      };
    }
  }

  /**
   * Establishes file-independent tables and detects conflicting schema
   * declarations or aliases.
   *
   * Relation resolution uses this map after every selected DBML file has been
   * scanned.
   */
  private aliases(
    inventory: IEvidenceInventory,
    analyses: IEvidenceDbmlFileAnalysis[],
  ): Map<string, string[]> {
    const aliases = new Map<string, string[]>();
    const enums = new Set<string>();
    for (const analysis of analyses)
      for (const enumeration of analysis.enums) {
        const key = JSON.stringify(enumeration.identity);
        if (enums.has(key))
          this.problem(
            inventory,
            analysis,
            "A DBML enum identity has multiple declarations. Select one declaration per schema enum.",
          );
        enums.add(key);
      }
    for (const analysis of analyses)
      for (const declaration of analysis.declarations.filter(
        (entry) => entry.symbol === "model",
      )) {
        for (const name of [
          declaration.identity,
          ...(declaration.alias === undefined
            ? []
            : [["public", declaration.alias]]),
        ]) {
          const key = JSON.stringify(name);
          if (aliases.has(key))
            this.problem(
              inventory,
              analysis,
              `DBML table or alias '${name.join(".")}' is declared more than once. Select one unambiguous schema declaration.`,
            );
          else aliases.set(key, declaration.identity);
        }
      }
    return aliases;
  }

  /**
   * Resolves endpoint existence, ordered composite arity, direction, and owning
   * model.
   *
   * Resolved relations become semantic declarations before units and hosts are
   * materialized.
   */
  private relations(
    inventory: IEvidenceInventory,
    analyses: IEvidenceDbmlFileAnalysis[],
    aliases: Map<string, string[]>,
  ): void {
    const columns = new Set(
      analyses.flatMap((analysis) =>
        analysis.declarations
          .filter((entry) => entry.symbol === "column")
          .map((entry) => JSON.stringify(entry.identity)),
      ),
    );
    for (const analysis of analyses)
      for (const relation of analysis.relations) {
        const from = this.endpoint(
          inventory,
          analysis,
          relation.from,
          aliases,
          columns,
        );
        const to = this.endpoint(
          inventory,
          analysis,
          relation.to,
          aliases,
          columns,
        );
        if (from === undefined || to === undefined) continue;
        if (from.columns.length !== to.columns.length) {
          this.problem(
            inventory,
            analysis,
            "DBML composite relation endpoints have different column counts. Use corresponding ordered columns on both sides.",
          );
          continue;
        }
        const owner =
          relation.cardinality === "<" ||
          (relation.cardinality === "-" && !relation.inline)
            ? to.table
            : from.table;
        const name =
          relation.name === undefined
            ? `$ref:${JSON.stringify([from.table, from.columns, relation.cardinality, to.table, to.columns])}`
            : `$ref:${relation.name}`;
        const identity = [...owner, name];
        const key = JSON.stringify(relation.identity);
        for (const documentation of analysis.documentation)
          documentation.owners = documentation.owners.map((entry) =>
            JSON.stringify(entry) === key ? identity : entry,
          );
        analysis.declarations.push({
          identity,
          symbol: "relation",
          content: relation.content,
          range: relation.range,
        });
      }
  }

  /**
   * Rejects missing or ambiguous semantic endpoints instead of dropping a
   * relation obligation.
   *
   * Returning no endpoint preserves the failure in inventory completeness.
   */
  private endpoint(
    inventory: IEvidenceInventory,
    analysis: IEvidenceDbmlFileAnalysis,
    endpoint: IEvidenceDbmlEndpoint,
    aliases: Map<string, string[]>,
    columns: Set<string>,
  ): IEvidenceDbmlEndpoint | undefined {
    const table = aliases.get(JSON.stringify(endpoint.table));
    if (
      table === undefined ||
      endpoint.columns.some(
        (column) => !columns.has(JSON.stringify([...table, column])),
      )
    ) {
      this.problem(
        inventory,
        analysis,
        `DBML relation endpoint '${[...endpoint.table, ...endpoint.columns].join(".")}' does not resolve to selected table columns. Include its schema source and correct the endpoint.`,
      );
      return undefined;
    }
    if (new Set(endpoint.columns).size !== endpoint.columns.length) {
      this.problem(
        inventory,
        analysis,
        "A DBML composite relation endpoint repeats a column. Use each endpoint column once.",
      );
      return undefined;
    }
    return { table, columns: endpoint.columns };
  }

  /**
   * Publishes one semantic identity and each declaration's physical file
   * address.
   *
   * Aliased schema declarations can therefore share a unit while retaining
   * their source sites.
   */
  private units(
    inventory: IEvidenceInventory,
    analyses: IEvidenceDbmlFileAnalysis[],
    aliases: Map<string, string[]>,
  ): void {
    const seen = new Set<string>();
    const enums = analyses
      .flatMap((analysis) =>
        analysis.enums.map((enumeration) => enumeration.content),
      )
      .sort(EvidenceInventoryMerge.compare)
      .join("\n");
    for (const analysis of analyses)
      for (const declaration of analysis.declarations) {
        const id = this.id(declaration.identity);
        if (seen.has(id)) {
          this.problem(
            inventory,
            analysis,
            `DBML identity '${declaration.identity.join(".")}' has multiple declarations. Rename duplicate columns/relations or select one schema declaration.`,
          );
          continue;
        }
        seen.add(id);
        const siteId = `dbml:site:${analysis.source.id}:${declaration.range.start.offset}`;
        inventory.units.push({
          id,
          type: "dbml",
          symbol: declaration.symbol,
          identity: declaration.identity,
          name: declaration.identity.join("."),
          ...(declaration.symbol === "model"
            ? {}
            : { parentId: this.id(declaration.identity.slice(0, 2)) }),
          contentDigest: this.digest(declaration, enums),
          sites: [
            {
              id: siteId,
              file: analysis.source.physicalPath,
              range: declaration.range,
              content: [declaration.range],
            },
          ],
          withdrawals: [],
        });
        const table = declaration.identity.slice(0, 2);
        const names = [declaration.identity];
        if (table[0] === "public") names.push(declaration.identity.slice(1));
        for (const [key, target] of aliases)
          if (JSON.stringify(target) === JSON.stringify(table)) {
            const name: string[] = typia.json.assertParse<string[]>(key);
            if (JSON.stringify(name) !== JSON.stringify(table))
              names.push([name[1] ?? "", ...declaration.identity.slice(2)]);
          }
        for (const address of analysis.source.addresses)
          for (const segments of names)
            inventory.addresses.push({
              unitId: id,
              file: address.absolute,
              segments,
            });
      }
  }

  /**
   * Hashes semantic declaration text and enum dependencies without
   * documentation syntax.
   *
   * Review fingerprints change for schema behavior, not annotation prose.
   */
  private digest(declaration: IEvidenceDbmlDeclaration, enums: string): string {
    return createHash("sha256")
      .update((declaration.content + "\n" + enums).replace(/\r\n/gu, "\n"))
      .digest("hex");
  }

  /**
   * Applies withdrawals first, then retains every visible documented or
   * undocumented host.
   *
   * Hidden declarations must not create hosts that can satisfy graph
   * obligations.
   */
  private documentation(
    inventory: IEvidenceInventory,
    analyses: IEvidenceDbmlFileAnalysis[],
  ): void {
    const units = new Map(inventory.units.map((unit) => [unit.id, unit]));
    for (const analysis of analyses)
      for (const documentation of analysis.documentation) {
        const host = this.host(analysis, documentation, units);
        const parsed = this.parse(analysis, documentation, host);
        inventory.annotationRanges.push({
          file: analysis.source.physicalPath,
          range: documentation.annotationRange,
        });
        for (const id of host.unitIds) {
          const unit = units.get(id);
          if (unit !== undefined) unit.withdrawals.push(...parsed.withdrawals);
        }
      }
    const hidden = new Set(
      inventory.units
        .filter(
          (unit) =>
            unit.withdrawals.length !== 0 ||
            (unit.parentId !== undefined &&
              (units.get(unit.parentId)?.withdrawals?.length ?? 0) !== 0),
        )
        .map((unit) => unit.id),
    );
    const documented = new Set<string>();
    for (const analysis of analyses)
      for (const documentation of analysis.documentation) {
        const host = this.host(analysis, documentation, units);
        host.unitIds = host.unitIds.filter((id) => !hidden.has(id));
        if (host.unitIds.length === 0) {
          host.attachment = "unsupported";
          delete host.siteId;
          host.problem =
            "Move the annotation to a visible DBML table, column or relation documentation host.";
        }
        const parsed = this.parse(analysis, documentation, host);
        if (
          host.unitIds.length === 0 &&
          parsed.declarations.length === 0 &&
          parsed.reviews.length === 0 &&
          parsed.diagnostics.length === 0
        )
          continue;
        inventory.hosts.push(host);
        for (const id of host.unitIds)
          documented.add(`${id}:${host.siteId ?? ""}`);
        inventory.declarations.push(...parsed.declarations);
        inventory.reviews.push(...parsed.reviews);
        inventory.diagnostics.push(...parsed.diagnostics);
      }
    for (const unit of inventory.units)
      for (const site of unit.sites)
        if (!hidden.has(unit.id) && !documented.has(`${unit.id}:${site.id}`))
          inventory.hosts.push({
            id: `${site.id}:host`,
            file: site.file,
            range: site.range,
            siteId: site.id,
            unitIds: [unit.id],
            attachment: "attached",
          });
  }

  /**
   * Creates a source-mapped carrier sharing one declaration site for inline
   * column relations.
   *
   * The shared site lets one DBML note acknowledge the column and its inline
   * relation.
   */
  private host(
    analysis: IEvidenceDbmlFileAnalysis,
    documentation: IEvidenceDbmlDocumentation,
    units: Map<string, IEvidenceUnit>,
  ): IEvidenceHost {
    const owners = documentation.owners
      .map((identity) => units.get(this.id(identity)))
      .filter((unit) => unit !== undefined);
    const first = owners[0];
    const site =
      first === undefined
        ? undefined
        : first.sites.find(
            (candidate) => candidate.file === analysis.source.physicalPath,
          );
    return {
      id: `dbml:${analysis.source.id}:documentation:${documentation.range.start.offset}`,
      file: analysis.source.physicalPath,
      range: documentation.range,
      origins: analysis.source.addresses.map((address) => address.absolute),
      unitIds: owners.map((unit) => unit.id),
      attachment: site === undefined ? "unsupported" : "attached",
      ...(site === undefined
        ? {
            problem:
              "Attach DBML annotations to supported table, column or relation documentation.",
          }
        : { siteId: site.id }),
    };
  }

  /**
   * Parses notes and comments only after structural ownership is known.
   *
   * Tag parsing needs the resolved unit IDs and attachment status of each
   * carrier.
   */
  private parse(
    analysis: IEvidenceDbmlFileAnalysis,
    documentation: IEvidenceDbmlDocumentation,
    host: IEvidenceHost,
  ) {
    return EvidenceTagParser.parse(
      analysis.source.content,
      host,
      EvidenceDbmlDocumentation.read(
        analysis.source.content,
        host.id,
        documentation,
      ),
    );
  }

  /**
   * Encodes literal schema segments without conflating punctuation or file
   * placement.
   *
   * JSON serialization preserves a stable unit key for segments containing dots
   * or separators.
   */
  private id(identity: string[]): string {
    return `dbml:${JSON.stringify(identity)}`;
  }

  /**
   * Preserves missing schema facts as actionable incomplete analysis.
   *
   * The diagnostic prevents unresolved DBML declarations from silently
   * shrinking coverage.
   */
  private problem(
    inventory: IEvidenceInventory,
    analysis: IEvidenceDbmlFileAnalysis,
    message: string,
  ): void {
    inventory.complete = false;
    inventory.diagnostics.push({
      code: "dbml-schema-incomplete",
      severity: "error",
      message,
      repair:
        "Correct conflicting declarations or include every referenced DBML schema source.",
      location: { file: analysis.source.physicalPath },
    });
  }
}
