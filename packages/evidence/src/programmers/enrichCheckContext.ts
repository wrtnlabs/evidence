import { EvidenceFileTarget } from "../targets/EvidenceFileTarget";
import type { IEvidenceCheckAnalysis } from "../structures/IEvidenceCheckAnalysis";
import type { IEvidenceCheckReport } from "../structures/IEvidenceCheckReport";
import type { IEvidenceDiagnostic } from "../structures/IEvidenceDiagnostic";
import type { IEvidenceDiagnosticContext } from "../structures/IEvidenceDiagnosticContext";
import type { IEvidenceGraphClaim } from "../structures/IEvidenceGraphClaim";
import type { IEvidenceGraphClaimResult } from "../structures/IEvidenceGraphClaimResult";
import type { IEvidenceGraphHostCoverage } from "../structures/IEvidenceGraphHostCoverage";
import type { IEvidenceGraphObligation } from "../structures/IEvidenceGraphObligation";
import type { IEvidenceGraphReference } from "../structures/IEvidenceGraphReference";
import type { IEvidenceInventory } from "../structures/IEvidenceInventory";
import type { IEvidencePublicAddress } from "../structures/IEvidencePublicAddress";
import type { IEvidenceSourceFile } from "../structures/IEvidenceSourceFile";
import type { IEvidenceSourceRange } from "../structures/IEvidenceSourceRange";
import type { IEvidenceUnit } from "../structures/IEvidenceUnit";
import type { IEvidenceUnitSite } from "../structures/IEvidenceUnitSite";

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
 * @evidence contracts/performance.md#efficient-algorithms Work scales with displayed missing diagnostics and at most eight sections per finding; source lookup scans only its reference inventory.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The captured analysis is reused, and enrichment runs once per finite command output.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Returned strings belong to the report and no handle or task is retained.
 */
export function enrichCheckContext(
  analysis: IEvidenceCheckAnalysis,
  report: IEvidenceCheckReport,
): IEvidenceCheckReport {
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
      const claim: IEvidenceGraphClaim | undefined = analysis.graphInput.claims.find(
        (candidate: IEvidenceGraphClaim, index: number): boolean =>
          (candidate.index ?? index) === diagnostic.claim,
      );
      const reference: IEvidenceGraphReference | undefined =
        claim?.references.find(
          (candidate: IEvidenceGraphReference, index: number): boolean =>
            (candidate.index ?? index) === diagnostic.reference,
        );
      if (
        reference === undefined ||
        !reference.inventory.complete ||
        !reference.inventory.units.some(
          (unit: IEvidenceUnit): boolean => unit.type === "markdown",
        )
      )
        return diagnostic;
      const ids: string[] =
        diagnostic.code === "graph-checklist-missing"
          ? (diagnostic.missingUnitIds ?? missingChecklistIds(analysis, diagnostic))
          : diagnostic.unitId === undefined
            ? []
            : [diagnostic.unitId];
      const unique: string[] = [...new Set(ids)];
      const context: IEvidenceDiagnosticContext[] = unique
        .slice(0, MAX_SECTIONS)
        .flatMap((id: string): IEvidenceDiagnosticContext[] => {
          const unit: IEvidenceUnit | undefined = reference.inventory.units.find(
            (candidate: IEvidenceUnit): boolean => candidate.id === id,
          );
          if (unit?.type !== "markdown") return [];
          const section: IEvidenceDiagnosticContext | undefined = captureSection(
            reference.inventory,
            unit,
          );
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
 * Resolves the original host ledger when no focused selection supplied IDs.
 *
 * Explained invalid answers are not unanswered items in the diagnostic text.
 */
function missingChecklistIds(
  analysis: IEvidenceCheckAnalysis,
  diagnostic: IEvidenceDiagnostic,
): string[] {
  const claim: IEvidenceGraphClaimResult | undefined = analysis.graph.claims.find(
    (candidate: IEvidenceGraphClaimResult): boolean =>
      candidate.claim === diagnostic.claim,
  );
  const obligation: IEvidenceGraphObligation | undefined =
    claim?.obligations.find(
      (candidate: IEvidenceGraphObligation): boolean =>
        candidate.reference === diagnostic.reference,
    );
  const ledger: IEvidenceGraphHostCoverage | undefined =
    obligation?.hostCoverage.find(
      (candidate: IEvidenceGraphHostCoverage): boolean =>
        candidate.hostUnitId === diagnostic.unitId,
    );
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
  inventory: IEvidenceInventory,
  unit: IEvidenceUnit,
): IEvidenceDiagnosticContext | undefined {
  const site: IEvidenceUnitSite | undefined = unit.sites[0];
  if (site === undefined) return undefined;
  const source: IEvidenceSourceFile | undefined = inventory.sources.find(
    (candidate: IEvidenceSourceFile): boolean =>
      candidate.physicalPath === site.file,
  );
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
  const address: IEvidencePublicAddress | undefined = inventory.addresses.find(
    (candidate: IEvidencePublicAddress): boolean => candidate.unitId === unit.id,
  );
  return {
    target: address === undefined ? unit.name : EvidenceFileTarget.format(address),
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
