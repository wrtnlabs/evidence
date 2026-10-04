import { EvidenceReporter } from "./EvidenceReporter";
import type { IEvidenceConfigReport } from "../structures/IEvidenceConfigReport";
import type { EvidenceReportFormat } from "../typings/EvidenceReportFormat";
import type { EvidenceWatchCycle } from "../typings/EvidenceWatchCycle";

/**
 * Serializes published watch cycles for terminal streams and append-only files.
 *
 * Watch output is framed per cycle so a long-lived process can report failures
 * and later recovery without mixing the fields of adjacent evaluations.
 */
export namespace EvidenceWatchReporter {
  /**
   * Selects text blocks or NDJSON framing for a published cycle.
   *
   * Both formats end in a newline, allowing the CLI to append each completed
   * publication without buffering the unbounded watch session.
   */
  export function render(
    cycle: EvidenceWatchCycle,
    format: EvidenceReportFormat,
    window: IEvidenceConfigReport = {},
  ): string {
    const bounded: EvidenceWatchCycle =
      cycle.status === "failed"
        ? cycle
        : { ...cycle, report: EvidenceReporter.narrow(cycle.report, window) };
    return format === "json" ? json(bounded) : text(bounded);
  }

  /**
   * Emits one complete cycle as a single NDJSON record.
   *
   * Compact JSON prevents line-oriented consumers from mistaking indentation in
   * a report for a record boundary while preserving the cycle envelope.
   */
  export function json(cycle: EvidenceWatchCycle): string {
    return JSON.stringify(cycle) + "\n";
  }

  /**
   * Renders a readable cycle heading followed by its report or failure
   * guidance.
   *
   * Normal cycles reuse check formatting. A preparation failure has no check
   * report, so it instead preserves configuration context and repair advice.
   */
  export function text(cycle: EvidenceWatchCycle): string {
    const heading = `Evidence Graph watch cycle ${cycle.cycle} (${cycle.status}).\n`;
    if (cycle.status !== "failed")
      return heading + EvidenceReporter.text(cycle.report);
    return `${heading}Config: ${cycle.configFile}\n${cycle.message}\nRepair: ${cycle.repair}\n`;
  }
}
