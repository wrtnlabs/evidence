import type { IEvidenceCheckContextIndex } from "../internal/IEvidenceCheckContextIndex";
import type { IEvidenceCheckAnalysis } from "../structures/IEvidenceCheckAnalysis";
import type { IEvidenceCheckReport } from "../structures/IEvidenceCheckReport";
import type { IEvidenceDiagnostic } from "../structures/IEvidenceDiagnostic";
import type { IEvidenceDiagnosticContext } from "../structures/IEvidenceDiagnosticContext";
import type { IEvidenceGraphClaim } from "../structures/IEvidenceGraphClaim";
import type { IEvidenceGraphHostCoverage } from "../structures/IEvidenceGraphHostCoverage";
import type { IEvidenceGraphObligation } from "../structures/IEvidenceGraphObligation";
import type { IEvidenceGraphReference } from "../structures/IEvidenceGraphReference";
import type { IEvidenceSourceFile } from "../structures/IEvidenceSourceFile";
import type { IEvidenceSourceRange } from "../structures/IEvidenceSourceRange";
import type { IEvidenceUnit } from "../structures/IEvidenceUnit";
import type { IEvidenceUnitSite } from "../structures/IEvidenceUnitSite";
import { EvidenceFileTarget } from "../targets/EvidenceFileTarget";

const MAX_SECTIONS: number = 8;
const MAX_LINES: number = 40;
const MAX_CHARACTERS: number = 8192;

/**
 * Adds captured Markdown source to displayed missing-obligation diagnostics.
 *
 * The report may already be focused and windowed. Authored indices bind each
 * diagnostic to its own reference inventory, and no source file is reopened.
 *
 * @evidence contracts/common.md#principled-implementation Only structured missing identities join an authored reference to complete Markdown inventory units and their captured source spans.
 * @evidence contracts/common.md#clear-and-simple-design This presentation step enriches an existing report without reevaluating graph coverage.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Diagnostic prose is never parsed and unavailable source is never invented.
 * @evidence contracts/common.md#meaningful-documentation The comment explains focus, boundaries and snapshot ownership.
 * @evidence contracts/performance.md#efficient-algorithms Authored boundaries are indexed once; each displayed boundary builds unit, source, address and host maps once, then each displayed diagnostic resolves at most eight sections by identity.
 * @evidence contracts/performance.md#reuse-equivalent-work Equivalent diagnostics on one reference boundary reuse its captured inventory indexes for this rendering pass.
 * @evidence contracts/performance.md#bound-retention-and-release-resources Boundary maps live for one enrichment call and release on return or failure; their entries are bounded by displayed boundaries and captured inventory records. Returned excerpts belong to the report, with at most eight bounded sections per displayed diagnostic; no handle or task is retained.
 */
export function enrichCheckContext(
  analysis: IEvidenceCheckAnalysis,
  report: IEvidenceCheckReport,
): IEvidenceCheckReport {
  const references: Map<string, IEvidenceGraphReference> = new Map();
  analysis.graphInput.claims.forEach(
    (claim: IEvidenceGraphClaim, claimPosition: number): void => {
      claim.references.forEach(
        (
          reference: IEvidenceGraphReference,
          referencePosition: number,
        ): void => {
          references.set(
            boundary(
              claim.index ?? claimPosition,
              reference.index ?? referencePosition,
            ),
            reference,
          );
        },
      );
    },
  );
  const obligations: Map<string, IEvidenceGraphObligation> = new Map();
  for (const claim of analysis.graph.claims)
    for (const obligation of claim.obligations)
      obligations.set(boundary(claim.claim, obligation.reference), obligation);
  const indexes: Map<string, IEvidenceCheckContextIndex> = new Map();
  const unavailable: Set<string> = new Set();
  const diagnostics: IEvidenceDiagnostic[] = report.diagnostics.map(
    (diagnostic: IEvidenceDiagnostic): IEvidenceDiagnostic => {
      if (
        diagnostic.claim === undefined ||
        diagnostic.reference === undefined ||
        diagnostic.severity !== "error" ||
        (diagnostic.code !== "graph-missing-acknowledgement" &&
          diagnostic.code !== "graph-checklist-missing")
      )
        return diagnostic;
      const key: string = boundary(diagnostic.claim, diagnostic.reference);
      if (unavailable.has(key)) return diagnostic;
      const reference: IEvidenceGraphReference | undefined =
        references.get(key);
      if (
        reference === undefined ||
        !reference.inventory.complete ||
        !reference.inventory.units.some(
          (unit: IEvidenceUnit): boolean => unit.type === "markdown",
        )
      ) {
        unavailable.add(key);
        return diagnostic;
      }
      let index: IEvidenceCheckContextIndex | undefined = indexes.get(key);
      if (index === undefined) {
        index = createIndex(reference, obligations.get(key));
        indexes.set(key, index);
      }
      const ids: string[] =
        diagnostic.code === "graph-checklist-missing"
          ? (diagnostic.missingUnitIds ??
            missingChecklistIds(index, diagnostic))
          : diagnostic.unitId === undefined
            ? []
            : [diagnostic.unitId];
      const unique: string[] = [...new Set(ids)];
      const context: IEvidenceDiagnosticContext[] = unique
        .slice(0, MAX_SECTIONS)
        .flatMap((id: string): IEvidenceDiagnosticContext[] => {
          const unit: IEvidenceUnit | undefined = index.units.get(id);
          if (unit?.type !== "markdown") return [];
          const section: IEvidenceDiagnosticContext | undefined =
            captureSection(index, unit);
          return section === undefined ? [] : [section];
        });
      const omittedContext: number = Math.max(0, unique.length - MAX_SECTIONS);
      return context.length === 0 && omittedContext === 0
        ? diagnostic
        : {
            ...diagnostic,
            ...(context.length === 0 ? {} : { context }),
            ...(omittedContext === 0 ? {} : { omittedContext }),
          };
    },
  );
  return { ...report, diagnostics };
}

/**
 * Builds bounded-lifetime lookup maps for one displayed reference boundary.
 *
 * The inventory and graph obligation were captured in the same analysis.
 */
function createIndex(
  reference: IEvidenceGraphReference,
  obligation: IEvidenceGraphObligation | undefined,
): IEvidenceCheckContextIndex {
  const targets: Map<string, string> = new Map();
  for (const address of reference.inventory.addresses)
    if (!targets.has(address.unitId))
      targets.set(address.unitId, EvidenceFileTarget.format(address));
  return {
    units: new Map(
      reference.inventory.units.map(
        (unit: IEvidenceUnit): [string, IEvidenceUnit] => [unit.id, unit],
      ),
    ),
    sources: new Map(
      reference.inventory.sources.map(
        (source: IEvidenceSourceFile): [string, IEvidenceSourceFile] => [
          source.physicalPath,
          source,
        ],
      ),
    ),
    targets,
    hostCoverage: new Map(
      (obligation?.hostCoverage ?? []).map(
        (
          ledger: IEvidenceGraphHostCoverage,
        ): [string, IEvidenceGraphHostCoverage] => [ledger.hostUnitId, ledger],
      ),
    ),
  };
}

/**
 * Resolves the original host ledger when no focused selection supplied IDs.
 *
 * Explained invalid answers are not unanswered items in the diagnostic text.
 */
function missingChecklistIds(
  index: IEvidenceCheckContextIndex,
  diagnostic: IEvidenceDiagnostic,
): string[] {
  const ledger: IEvidenceGraphHostCoverage | undefined =
    diagnostic.unitId === undefined
      ? undefined
      : index.hostCoverage.get(diagnostic.unitId);
  return (
    ledger?.missingUnitIds.filter(
      (id: string): boolean => !ledger.explainedUnitIds.includes(id),
    ) ?? []
  );
}

/**
 * Slices one semantic Markdown site from the original captured source.
 *
 * A missing or invalid site is skipped, preserving the existing diagnostic.
 * Limiting at a line boundary keeps terminal output readable and exact.
 */
function captureSection(
  index: IEvidenceCheckContextIndex,
  unit: IEvidenceUnit,
): IEvidenceDiagnosticContext | undefined {
  const site: IEvidenceUnitSite | undefined = unit.sites[0];
  if (site === undefined) return undefined;
  const source: IEvidenceSourceFile | undefined = index.sources.get(site.file);
  if (source === undefined) return undefined;
  const range: IEvidenceSourceRange = site.range;
  if (
    range.start.offset < 0 ||
    range.end.offset > source.content.length ||
    range.end.offset < range.start.offset
  )
    return undefined;
  const raw: string = source.content.slice(
    range.start.offset,
    range.end.offset,
  );
  let end: number = Math.min(raw.length, MAX_CHARACTERS);
  let lines: number = 1;
  for (let index: number = 0; index < end; index++)
    if (raw[index] === "\n") {
      lines++;
      if (lines > MAX_LINES) {
        end = index + 1;
        break;
      }
    }
  if (end < raw.length && end > 0) {
    const code: number = raw.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end--;
  }
  const text: string = raw.slice(0, end);
  const remainder: string = raw.slice(end);
  const target: string | undefined = index.targets.get(unit.id);
  return {
    target: target ?? unit.name,
    file: site.file,
    startLine: range.start.line,
    endLine: Math.max(
      range.start.line,
      range.end.line - (range.end.column === 1 ? 1 : 0),
    ),
    text,
    truncated: remainder.length !== 0,
    omittedCharacters: remainder.length,
    omittedLines:
      remainder === ""
        ? 0
        : remainder.split("\n").length - (remainder.endsWith("\n") ? 1 : 0),
  };
}

/** Encodes authored claim and reference indices without delimiter collisions. */
function boundary(claim: number, reference: number): string {
  return JSON.stringify([claim, reference]);
}
