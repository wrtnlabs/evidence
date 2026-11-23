import { EvidenceArrays } from "../internal/EvidenceArrays";
import type { IEvidenceDiagnostic } from "../structures/IEvidenceDiagnostic";
import type { IEvidenceInspection } from "../structures/IEvidenceInspection";
import type { IEvidenceInspectReport } from "../structures/IEvidenceInspectReport";
import type { IEvidenceLanguagesReport } from "../structures/IEvidenceLanguagesReport";
import type { IEvidenceListItem } from "../structures/IEvidenceListItem";
import type { IEvidenceListReport } from "../structures/IEvidenceListReport";
import type { IEvidenceQueryScope } from "../structures/IEvidenceQueryScope";
import type { EvidenceQueryReport } from "../typings/EvidenceQueryReport";
import type { EvidenceReportFormat } from "../typings/EvidenceReportFormat";

/**
 * Serializes query projections for people and automation.
 *
 * Query commands share their analysis boundary with checks, but expose selected
 * targets, one target's explanation, or the shipped language catalog. These
 * renderers preserve that structured data without triggering configuration or
 * source I/O.
 *
 * @evidence contracts/common.md#principled-implementation List, inspect and languages reports are rendered as JSON or command-specific text from the same structured data.
 * @evidence contracts/common.md#clear-and-simple-design Rendering is separate from querying; private helpers format each command.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts No configuration or source I/O is triggered.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains the three report kinds; helpers are documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceQueryReporter {
  /**
   * Selects the text or JSON representation for a query result.
   *
   * Every representation ends with a newline so callers can write it directly
   * to stdout or a report file. The command discriminator selects the text
   * layout.
   *
   * @evidence contracts/common.md#principled-implementation The format selects JSON or the command-specific text layout, each ending with a newline.
   * @evidence contracts/common.md#clear-and-simple-design Render only dispatches.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No I/O is performed.
   * @evidence contracts/common.md#meaningful-documentation The comment states the newline contract.
   * @evidence contracts/performance.md#efficient-algorithms Rendering is linear in the report's size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each report is rendered once per output.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Rendering returns a string and keeps nothing; the caller owns the output.
   */
  export function render(
    report: EvidenceQueryReport,
    format: EvidenceReportFormat,
  ): string {
    return format === "json" ? json(report) : text(report);
  }

  /**
   * Serializes the complete query report as indented JSON.
   *
   * JSON retains all diagnostics and inspection details for tools that should
   * not infer structure from terminal-oriented text.
   *
   * @evidence contracts/common.md#principled-implementation The complete query report is serialized as indented JSON.
   * @evidence contracts/common.md#clear-and-simple-design JSON output is the plain serialization.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No inspection detail is dropped.
   * @evidence contracts/common.md#meaningful-documentation The comment explains why tools should use JSON.
   * @evidence contracts/performance.md#efficient-algorithms Rendering is linear in the report's size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each report is rendered once per output.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Rendering returns a string and keeps nothing; the caller owns the output.
   */
  export function json(report: EvidenceQueryReport): string {
    return JSON.stringify(report, null, 2) + "\n";
  }

  /**
   * Renders the human-readable layout appropriate to the query command.
   *
   * Language discovery has no project configuration, list reports enumerate
   * filtered units, and inspection reports retain every applicable population.
   *
   * @evidence contracts/common.md#principled-implementation The command discriminator selects the languages, list or inspect layout.
   * @evidence contracts/common.md#clear-and-simple-design Each layout is a private helper.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Every applicable population is kept in inspect text.
   * @evidence contracts/common.md#meaningful-documentation The comment describes each layout.
   * @evidence contracts/performance.md#efficient-algorithms Rendering is linear in the report's size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each report is rendered once per output.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Rendering returns a string and keeps nothing; the caller owns the output.
   */
  export function text(report: EvidenceQueryReport): string {
    if (report.command === "languages") return languages(report);
    if (report.command === "list") return list(report);
    return inspect(report);
  }
}

/**
 * Renders a filtered inventory listing and its analysis diagnostics.
 *
 * Filters appear in the heading so a copied terminal report records the
 * selected population even when its item list is empty.
 */
function list(report: IEvidenceListReport): string {
  const filters = [
    report.language === undefined ? undefined : `language=${report.language}`,
    report.kind === undefined ? undefined : `kind=${report.kind}`,
  ].filter((value) => value !== undefined);
  const lines: string[] = [
    `evidence list ${report.status}.`,
    `Config: ${report.configFile}`,
    `Targets: ${report.total}${filters.length === 0 ? "" : ` (${filters.join(", ")})`}.`,
  ];
  for (const item of report.items) lines.push("", ...listItem(item));
  appendDiagnostics(lines, report.diagnostics);
  return lines.join("\n") + "\n";
}

/**
 * Expands one public unit into its stable terminal fields.
 *
 * Aliases and declaration sites remain separate because one semantic unit may
 * have several public addresses or physical declarations.
 */
function listItem(item: IEvidenceListItem): string[] {
  const lines = [
    `${scope(item.scope)} ${item.symbol} ${item.selection} ${JSON.stringify(item.target)}`,
    `  Identity: ${item.unitId}`,
  ];
  if (item.aliases.length > 1)
    lines.push(
      `  Aliases: ${item.aliases.map((alias) => JSON.stringify(alias)).join(", ")}`,
    );
  for (const location of item.locations)
    lines.push(
      `  Declaration: ${location.file}:${location.range?.start?.line ?? 1}:${location.range?.start?.column ?? 1}`,
    );
  return lines;
}

/**
 * Renders every population's resolution of one requested target.
 *
 * An unresolved population is retained in the result rather than being hidden,
 * which explains why an inspect command may complete with an exit code of one.
 */
function inspect(report: IEvidenceInspectReport): string {
  const lines: string[] = [
    `evidence inspect ${report.status}.`,
    `Config: ${report.configFile}`,
    `Target: ${JSON.stringify(report.target)}`,
    `Populations: ${report.inspections.length}.`,
  ];
  for (const inspection of report.inspections)
    lines.push("", ...inspectionLines(inspection));
  appendDiagnostics(lines, report.diagnostics);
  return lines.join("\n") + "\n";
}

/**
 * Expands one population's selected units, obligations, and acknowledgements.
 *
 * The report includes both declared target candidates and resolved units so
 * users can distinguish spelling ambiguity from graph coverage or review
 * state.
 */
function inspectionLines(inspection: IEvidenceInspection): string[] {
  const lines = [`${scope(inspection.scope)} ${inspection.status}`];
  if (inspection.addresses.length !== 0)
    lines.push(
      `  Candidates: ${inspection.addresses
        .map((address) => JSON.stringify(address))
        .join(", ")}`,
    );
  for (const unit of inspection.units) {
    EvidenceArrays.append(lines, listItem(unit.item));
    if (unit.children.length !== 0)
      lines.push(
        `  Children: ${unit.children.map((child) => JSON.stringify(child.target)).join(", ")}`,
      );
    for (const host of unit.hosts)
      lines.push(
        `  Host: ${host.file}:${host.range.start.line}:${host.range.start.column}`,
      );
    if (unit.fingerprint !== undefined)
      lines.push(`  Fingerprint: #${unit.fingerprint.fingerprint}`);
  }
  for (const obligation of inspection.obligations)
    lines.push(
      `  Obligation: claim[${obligation.claim}] -> reference[${obligation.reference}] ${obligation.policy.severity}, ${obligation.selection}, ${obligation.covered ? "covered" : obligation.missing ? "missing" : "aggregate"}`,
      `  Policies: exclusion=${obligation.policy.noEvidenceExclude ? "forbidden" : "allowed"}, unique=${obligation.policy.uniqueEvidence}, single=${obligation.policy.singleEvidencePerSymbol}, checklist=${obligation.policy.checklist}, review=${obligation.policy.requireReview}`,
    );
  for (const acknowledgement of inspection.acknowledgements)
    lines.push(
      `  Incoming: @${acknowledgement.declaration.kind} from ${acknowledgement.declaration.location.file} in host ${acknowledgement.host.file}:${acknowledgement.host.range.start.line}:${acknowledgement.host.range.start.column} #${acknowledgement.fingerprint}`,
    );
  for (const review of inspection.reviews)
    lines.push(
      `  Review: @${review.review.reviews === "evidence" ? "evidenceReview" : "evidenceExcludeReview"} ${review.review.fingerprint === undefined ? "without fingerprint" : `#${review.review.fingerprint}`} in host ${review.host.file}:${review.host.range.start.line}:${review.host.range.start.column} (${review.status})`,
    );
  return lines;
}

/**
 * Renders the certified adapter catalog without consulting project
 * configuration.
 *
 * Grammar patterns, addressing rules, and documented unsupported forms let an
 * author choose an available artifact type before writing a configuration.
 */
function languages(report: IEvidenceLanguagesReport): string {
  const lines: string[] = [
    "Evidence Graph certified languages.",
    `Languages: ${report.total}.`,
  ];
  for (const language of report.languages) {
    const grammars = language.grammars.map((grammar) => {
      const patterns = [...grammar.extensions, ...grammar.filenames];
      return `${grammar.id} (${patterns.join(", ")})`;
    });
    lines.push(
      "",
      `${language.type}: ${language.name}`,
      `  Grammars: ${grammars.join(", ")}`,
      `  Symbols: ${language.adapter.symbols.join(", ")}`,
      `  Surface: ${language.adapter.publicSurface}`,
      `  Addressing: ${language.adapter.addressing}`,
      `  Documentation: ${language.adapter.comments.join(", ")}`,
      `  Unsupported: ${language.adapter.unsupported.join(", ")}`,
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * Appends analysis findings in the compact query-report diagnostic layout.
 *
 * Query reports retain diagnostics from the shared analysis even if their
 * primary listing or inspection data was successfully produced.
 */
function appendDiagnostics(
  lines: string[],
  diagnostics: IEvidenceDiagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    const location = diagnostic.location;
    lines.push(
      "",
      `${diagnostic.severity.toUpperCase()} [${diagnostic.code}]`,
      ...(location === undefined
        ? []
        : [
            `  Location: ${location.file}:${location.range?.start?.line ?? 1}:${location.range?.start?.column ?? 1}`,
          ]),
      `  ${diagnostic.message}`,
      `  Repair: ${diagnostic.repair}`,
    );
  }
}

/**
 * Formats the authored claim and optional reference boundary for a query item.
 *
 * Names supplement stable numeric indices while artifact types identify which
 * adapter's target grammar applies to the displayed result.
 */
function scope(value: IEvidenceQueryScope): string {
  const claim = `claim[${value.claim}]${value.name === undefined ? "" : ` '${value.name}'`}`;
  return value.reference === undefined
    ? `${claim} (${value.type})`
    : `${claim} -> reference[${value.reference}] (${value.type})`;
}
