import { createHash } from "node:crypto";
import path from "node:path";

import typia from "typia";

import { EvidenceInventoryIndex } from "../../internal/EvidenceInventoryIndex";
import { EvidenceSourceLoader } from "../../loaders/EvidenceSourceLoader";
import { EvidenceTagParser } from "../../parsers/EvidenceTagParser";
import type { IEvidenceRemoteSwaggerSource } from "./IEvidenceRemoteSwaggerSource";
import type { IEvidenceSwaggerOperation } from "./IEvidenceSwaggerOperation";
import type { IEvidenceYamlScalarMapping } from "./IEvidenceYamlScalarMapping";
import { EvidenceSourcePath } from "../../internal/EvidenceSourcePath";
import { EvidenceSourceText } from "../../internal/EvidenceSourceText";
import { EvidenceSwaggerDescription } from "./EvidenceSwaggerDescription";
import { EvidenceSwaggerDocumentLoader } from "./EvidenceSwaggerDocumentLoader";
import { EvidenceSwaggerRemoteReader } from "./EvidenceSwaggerRemoteReader";
import type { IEvidenceAdapter } from "../../structures/IEvidenceAdapter";
import type { IEvidenceDocumentation } from "../../structures/IEvidenceDocumentation";
import type { IEvidenceHost } from "../../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceSnapshot } from "../../structures/IEvidenceSourceSnapshot";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { IEvidenceUnitSite } from "../../structures/IEvidenceUnitSite";

/**
 * Extracts Swagger/OpenAPI operations and their description-based annotation
 * hosts.
 *
 * Local snapshots and explicitly configured remote documents pass through the
 * same normalization and materialization path. Each method/path operation
 * retains its own identity even without a description, while supported
 * description spans map annotations back to source coordinates.
 * EvidenceDocument failures remain incomplete.
 *
 * @evidence contracts/common.md#principled-implementation Local and remote documents go through one normalization path; each METHOD:/path operation becomes a unit even without a description, and supported description scalars are mapped back to source for tags.
 * @evidence contracts/common.md#clear-and-simple-design The adapter materializes operations; version conversion, fingerprints, remote reading and scalar mapping are separate modules.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Document and access failures produce incomplete inventories instead of empty operation lists.
 * @evidence contracts/common.md#meaningful-documentation The class comment explains both input paths; every member is documented.
 * @evidence contracts/performance.md#efficient-algorithms Linear in document size: one conversion plus one host per operation.
 * @evidence contracts/performance.md#reuse-equivalent-work Normalized documents are cached by content digest in the loader.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The adapter holds no state between analyses.
 */
export class EvidenceSwaggerAdapter implements IEvidenceAdapter<"swagger"> {
  /**
   * Artifact discriminator selecting API-operation extraction.
   *
   * Operations use method/path targets within each independent document
   * population.
   */
  public get type(): "swagger" {
    return "swagger";
  }

  /**
   * Normalizes captured JSON/YAML documents into operation inventories.
   *
   * Each document failure is retained alongside successfully loaded documents.
   * Input is cloned, and final inventory validation preserves incompleteness
   * rather than treating failed normalization as a document with no
   * operations.
   *
   * @evidence contracts/common.md#principled-implementation Each snapshot file is normalized through the loader and its operations materialized with their description hosts.
   * @evidence contracts/common.md#clear-and-simple-design Normalization is delegated; analyze materializes.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Discovery and conversion failures remain diagnostics.
   * @evidence contracts/common.md#meaningful-documentation The comment explains snapshot handling.
   * @evidence contracts/performance.md#efficient-algorithms Linear in document size.
   * @evidence contracts/performance.md#reuse-equivalent-work The loader's digest cache avoids reconverting unchanged documents.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The inventory is owned by the caller.
   */
  public async analyze(
    snapshot: IEvidenceSourceSnapshot,
  ): Promise<IEvidenceInventory> {
    const input = structuredClone(typia.assert(snapshot));
    const inventory = this.inventory(input);
    if (input.files.length === 0)
      return new EvidenceInventoryIndex([inventory]).snapshot();

    // Keep every document's outcome: one failed normalization must not discard
    // useful diagnostics from peers or be interpreted as an empty operation set.
    const loaded = await Promise.allSettled(
      input.files.map((source) => EvidenceSwaggerDocumentLoader.load(source)),
    );
    loaded.forEach((entry, index) => {
      const source = input.files[index];
      if (source === undefined) return;
      if (entry.status === "rejected") {
        const reason: unknown = entry.reason;
        inventory.complete = false;
        inventory.diagnostics.push({
          code: "swagger-normalization-failed",
          severity: "error",
          message: `The Swagger document could not be normalized: ${this.message(reason)}`,
          repair:
            "Correct the JSON/YAML document and use a Swagger 2.0 or supported OpenAPI 3.x shape.",
          location: { file: source.physicalPath },
        });
      } else this.materialize(inventory, source, entry.value.operations);
    });
    return new EvidenceInventoryIndex([inventory]).snapshot();
  }

  /**
   * Loads one exact local document or explicitly configured HTTP(S) URL.
   *
   * Local paths resolve from the configuration-relative root and use
   * source-loader dependency tracking. Remote bytes become a synthetic source
   * snapshot without filesystem dependencies. Access and normalization failures
   * return incomplete inventory diagnostics for the requested document.
   *
   * @evidence contracts/common.md#principled-implementation A local path is captured through the source loader with dependency tracking, while an HTTP(S) URL is read with bounds into a synthetic snapshot, and both are analyzed the same way.
   * @evidence contracts/common.md#clear-and-simple-design Load chooses the input path and then reuses analyze.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Access and normalization failures return incomplete inventories for the requested document.
   * @evidence contracts/common.md#meaningful-documentation The comment explains both paths and failure handling.
   * @evidence contracts/performance.md#efficient-algorithms One bounded read or file capture plus analysis.
   * @evidence contracts/performance.md#reuse-equivalent-work Normalization results are reused from the loader cache by digest.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Remote reads are size- and time-bounded and release their stream; local captures close their files.
   */
  public async load(
    configFile: string,
    file: string,
    root: string = ".",
  ): Promise<IEvidenceInventory> {
    let display: string = EvidenceSwaggerRemoteReader.safeDisplay(file);
    try {
      if (file === "" || file.trim() !== file)
        throw new Error("A Swagger source must not be empty or padded.");
      const remote: URL | undefined = EvidenceSwaggerRemoteReader.parse(file);
      if (remote === undefined)
        return await this.analyze(
          await EvidenceSourceLoader.file(configFile, file, root),
        );
      display = EvidenceSwaggerRemoteReader.display(remote);
      const read: IEvidenceRemoteSwaggerSource =
        await EvidenceSwaggerRemoteReader.read(remote);
      const absoluteRoot: string = EvidenceSourcePath.root(configFile, root);
      return await this.analyze({
        root: {
          declared: root,
          absolute: absoluteRoot,
          display: EvidenceSourcePath.display(
            path.dirname(path.resolve(configFile)),
            absoluteRoot,
          ),
        },
        files: [
          {
            id: `swagger:remote:${createHash("sha256").update(file).digest("hex")}`,
            physicalPath: display,
            fingerprintPath: display,
            content: read.content,
            digest: read.digest,
            addresses: [
              {
                absolute: display,
                relative: display,
                display,
              },
            ],
          },
        ],
        dependencies: [],
        diagnostics: [],
        complete: true,
      });
    } catch (cause) {
      return this.failure(
        display,
        EvidenceSwaggerRemoteReader.safeMessage(cause, file),
      );
    }
  }

  /**
   * Seeds an operation inventory with snapshot provenance and discovery
   * failures.
   *
   * Operation and annotation collections remain empty until document
   * normalization establishes supported API structure and source mappings.
   */
  private inventory(input: IEvidenceSourceSnapshot): IEvidenceInventory {
    return {
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
          "Restore access to the selected Swagger source before evaluating coverage.",
        location: { file: diagnostic.path },
      })),
      dependencies: input.dependencies,
      complete: input.complete,
    };
  }

  /**
   * Creates semantic operation units and mapped description carriers.
   *
   * Source identity qualifies each operation token so separate documents do not
   * merge accidentally. Operations remain represented even when no description
   * supplies an annotation, preserving per-host coverage requirements.
   */
  private materialize(
    inventory: IEvidenceInventory,
    source: IEvidenceSourceFile,
    operations: IEvidenceSwaggerOperation[],
  ): void {
    const text = new EvidenceSourceText(source.content);
    for (const operation of operations) {
      const range = operation.location?.range ?? text.range(0, 0);
      const unitId = `swagger:${source.id}:${operation.target}`;
      const site: IEvidenceUnitSite = {
        id: `${unitId}:site`,
        file: source.physicalPath,
        range,
        content: [range],
      };
      const unit: IEvidenceUnit = {
        id: unitId,
        type: "swagger",
        symbol: "operation",
        identity: [operation.target],
        name: operation.target,
        contentDigest: operation.digest,
        sites: [site],
        withdrawals: [],
      };
      inventory.units.push(unit);
      inventory.addresses.push({
        unitId,
        file: "swagger:",
        segments: [operation.target],
      });

      const mapping = operation.location?.description;
      const host: IEvidenceHost = {
        id: `${unitId}:description`,
        file: source.physicalPath,
        range: mapping?.range ?? range,
        origins: source.addresses.map((address) => address.absolute),
        siteId: site.id,
        unitIds: [unit.id],
        attachment: "attached",
      };
      inventory.hosts.push(host);
      if (mapping !== undefined) this.parse(inventory, source, host, mapping);
      else if (
        operation.description !== undefined &&
        EvidenceSwaggerDescription.hasMetadata(operation.description)
      ) {
        inventory.complete = false;
        inventory.diagnostics.push({
          code: "swagger-description-location",
          severity: "error",
          message: `The description for '${operation.target}' contains Evidence metadata without a verifiable source scalar.`,
          repair:
            "Write the operation description as a direct JSON/YAML string or scalar alias so its annotation positions can be verified.",
          location: { file: source.physicalPath, range },
          hostId: host.id,
        });
      }
    }
  }

  /**
   * Parses one mapped operation description into inventory annotations.
   *
   * Declarations, reviews, diagnostics, and their exact source ranges are
   * copied together so fingerprinting can exclude metadata without dropping
   * prose.
   */
  private parse(
    inventory: IEvidenceInventory,
    source: IEvidenceSourceFile,
    host: IEvidenceHost,
    mapping: IEvidenceYamlScalarMapping,
  ): void {
    const documentation: IEvidenceDocumentation = {
      hostId: host.id,
      text: mapping.text,
      offsets: mapping.offsets,
      ends: mapping.ends,
      tagBoundaries: false,
      allowWithdrawal: false,
    };
    const parsed = EvidenceTagParser.parse(source.content, host, documentation);
    inventory.declarations.push(...parsed.declarations);
    inventory.reviews.push(...parsed.reviews);
    inventory.diagnostics.push(...parsed.diagnostics);
    inventory.annotationRanges.push(
      ...parsed.declarations.map((entry) => entry.location),
      ...parsed.reviews.map((entry) => entry.location),
      ...parsed.diagnostics
        .map((entry) => entry.location)
        .filter((entry) => entry !== undefined),
    );
  }

  /**
   * Creates an incomplete inventory for one safely described source failure.
   *
   * The diagnostic retains the requested source label while an empty population
   * cannot be mistaken for a complete Swagger document.
   */
  private failure(file: string, message: string): IEvidenceInventory {
    return new EvidenceInventoryIndex([
      {
        schemaVersion: 1,
        sources: [],
        annotationRanges: [],
        units: [],
        addresses: [],
        hosts: [],
        declarations: [],
        reviews: [],
        diagnostics: [
          {
            code: "swagger-source-failed",
            severity: "error",
            message: `The Swagger source could not be loaded: ${message}`,
            repair:
              "Correct the exact local path or HTTP(S) URL and restore access to the document.",
            location: { file },
          },
        ],
        dependencies: [],
        complete: false,
      },
    ]).snapshot();
  }

  /**
   * Converts an unknown local analysis failure into diagnostic text.
   *
   * Remote load failures use EvidenceSwaggerRemoteReader's credential-safe
   * boundary before they reach this adapter.
   */
  private message(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }
}
