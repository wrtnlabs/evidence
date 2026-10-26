import { groupEvidenceRecords } from "../internal/groupEvidenceRecords";
import type { IEvidenceGraphBoundary } from "../structures/IEvidenceGraphBoundary";
import type { IEvidenceGraphExportEdge } from "../structures/IEvidenceGraphExportEdge";
import type { IEvidenceGraphExportReview } from "../structures/IEvidenceGraphExportReview";
import type { IEvidenceGraphReport } from "../structures/IEvidenceGraphReport";
import type { EvidenceGraphFormat } from "../typings/EvidenceGraphFormat";
import type { EvidenceGraphNode } from "../typings/EvidenceGraphNode";

/**
 * Serializes the authoritative graph report as JSON, Mermaid, or DOT.
 *
 * Visual formats escape authored labels before embedding them in their
 * respective grammars. They are projections of an already evaluated graph and
 * never change graph membership, coverage, or review resolution.
 *
 * @evidence contracts/common.md#principled-implementation The graph report is rendered as JSON, a Mermaid flowchart or a DOT digraph, with synthetic node names and escaped labels so authored text cannot become format syntax.
 * @evidence contracts/common.md#clear-and-simple-design Rendering is a projection; private helpers name nodes and escape labels.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Visual formats never change membership, coverage or review resolution.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains escaping; every function and helper is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceGraphReporter {
  /**
   * Chooses the requested graph serialization.
   *
   * JSON preserves the report object, while Mermaid and DOT encode its
   * boundaries, nodes, evidence edges, and review edges for visualization
   * tools.
   *
   * @evidence contracts/common.md#principled-implementation The format selects JSON, Mermaid or DOT.
   * @evidence contracts/common.md#clear-and-simple-design Render only dispatches.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No graph data is altered.
   * @evidence contracts/common.md#meaningful-documentation The comment explains what each format encodes.
   * @evidence contracts/performance.md#efficient-algorithms Rendering is linear in the report's size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each report is rendered once per output.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Rendering returns a string and keeps nothing; the caller owns the output.
   */
  export function render(
    report: IEvidenceGraphReport,
    format: EvidenceGraphFormat,
  ): string {
    if (format === "json") return json(report);
    return format === "mermaid" ? mermaid(report) : dot(report);
  }

  /**
   * Serializes the complete graph report as indented JSON.
   *
   * This format keeps stable identifiers and every exported property available
   * to programmatic consumers without visual-format escaping.
   *
   * @evidence contracts/common.md#principled-implementation The complete graph report is serialized as indented JSON with stable identifiers.
   * @evidence contracts/common.md#clear-and-simple-design JSON output is the plain serialization.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts No property is escaped or dropped.
   * @evidence contracts/common.md#meaningful-documentation The comment explains its programmatic use.
   * @evidence contracts/performance.md#efficient-algorithms Rendering is linear in the report's size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each report is rendered once per output.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Rendering returns a string and keeps nothing; the caller owns the output.
   */
  export function json(report: IEvidenceGraphReport): string {
    return JSON.stringify(report, null, 2) + "\n";
  }

  /**
   * Emits a Mermaid flowchart with one subgraph per configured boundary.
   *
   * Synthetic node names avoid treating semantic IDs as Mermaid syntax; labels
   * carry the authored values after escaping text-sensitive characters.
   *
   * @evidence contracts/common.md#principled-implementation One subgraph per boundary holds synthetic node names whose labels carry escaped authored values.
   * @evidence contracts/common.md#clear-and-simple-design Naming and escaping are shared private helpers.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Semantic IDs never appear as Mermaid syntax.
   * @evidence contracts/common.md#meaningful-documentation The comment explains synthetic names and escaping.
   * @evidence contracts/performance.md#efficient-algorithms Rendering is linear in the report's size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each report is rendered once per output.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Rendering returns a string and keeps nothing; the caller owns the output.
   */
  export function mermaid(report: IEvidenceGraphReport): string {
    const names = nodeNames(report.nodes);
    const grouped: Map<string, EvidenceGraphNode[]> = groupEvidenceRecords(
      report.nodes,
      (node: EvidenceGraphNode): string => node.boundaryId,
    );
    const lines: string[] = ["flowchart LR"];
    report.boundaries.forEach((entry, index) => {
      lines.push(
        `  subgraph b${index}["${mermaidText(boundaryLabel(entry))}"]`,
      );
      for (const node of grouped.get(entry.id) ?? [])
        lines.push(
          `    ${requireNodeName(names, node.id)}["${mermaidText(nodeLabel(node))}"]`,
        );
      lines.push("  end");
    });
    for (const edge of report.edges)
      for (const source of edge.sourceNodeIds)
        lines.push(
          `  ${requireNodeName(names, source)} ${edge.kind === "evidence" ? "-->" : "-.->"}|${mermaidText(edgeLabel(edge))}| ${requireNodeName(names, edge.targetNodeId)}`,
        );
    for (const review of report.reviews)
      for (const source of review.sourceNodeIds)
        for (const target of review.targetNodeIds)
          lines.push(
            `  ${requireNodeName(names, source)} -.->|${mermaidText(reviewLabel(review))}| ${requireNodeName(names, target)}`,
          );
    return lines.join("\n") + "\n";
  }

  /**
   * Emits a DOT directed graph with clusters for configuration boundaries.
   *
   * Evidence Graph exclusion and review relations use distinct line styles so
   * their meaning remains visible when a viewer does not expose edge metadata.
   *
   * @evidence contracts/common.md#principled-implementation Clusters per boundary contain escaped labels, and exclusion and review relations use distinct line styles.
   * @evidence contracts/common.md#clear-and-simple-design Naming and escaping are shared private helpers.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Escaping prevents labels from creating different DOT escape sequences.
   * @evidence contracts/common.md#meaningful-documentation The comment explains clusters and line styles.
   * @evidence contracts/performance.md#efficient-algorithms Rendering is linear in the report's size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each report is rendered once per output.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Rendering returns a string and keeps nothing; the caller owns the output.
   */
  export function dot(report: IEvidenceGraphReport): string {
    const names = nodeNames(report.nodes);
    const grouped: Map<string, EvidenceGraphNode[]> = groupEvidenceRecords(
      report.nodes,
      (node: EvidenceGraphNode): string => node.boundaryId,
    );
    const lines: string[] = ["digraph Evidence {", "  rankdir=LR;"];
    report.boundaries.forEach((entry, index) => {
      lines.push(
        `  subgraph cluster_${index} {`,
        `    label="${dotText(boundaryLabel(entry))}";`,
      );
      for (const node of grouped.get(entry.id) ?? [])
        lines.push(
          `    ${requireNodeName(names, node.id)} [label="${dotText(nodeLabel(node))}"];`,
        );
      lines.push("  }");
    });
    for (const edge of report.edges)
      for (const source of edge.sourceNodeIds)
        lines.push(
          `  ${requireNodeName(names, source)} -> ${requireNodeName(names, edge.targetNodeId)} [label="${dotText(edgeLabel(edge))}"${edge.kind === "evidenceExclude" ? ', style="dashed"' : ""}];`,
        );
    for (const review of report.reviews)
      for (const source of review.sourceNodeIds)
        for (const target of review.targetNodeIds)
          lines.push(
            `  ${requireNodeName(names, source)} -> ${requireNodeName(names, target)} [label="${dotText(reviewLabel(review))}", style="dotted"];`,
          );
    lines.push("}");
    return lines.join("\n") + "\n";
  }
}

/**
 * Assigns syntax-safe local names to graph nodes in report order.
 *
 * Exported node IDs may contain target punctuation, so formats refer to these
 * generated names and reserve IDs for labels and lookup only.
 */
function nodeNames(nodes: EvidenceGraphNode[]): Map<string, string> {
  return new Map(nodes.map((node, index) => [node.id, `n${index}`]));
}

/**
 * Retrieves a generated node name and detects an inconsistent graph export.
 *
 * An edge without a listed endpoint is a report-construction failure, not an
 * opportunity to emit invalid visualization syntax.
 */
function requireNodeName(names: Map<string, string>, id: string): string {
  const name = names.get(id);
  if (name === undefined)
    throw new Error(`Graph edge names missing node '${id}'.`);
  return name;
}

/**
 * Summarizes a claim/reference boundary and its resolved policy state.
 *
 * The label makes inactive and incomplete boundaries visible even when they
 * have no ordinary evidence edges in the graph export.
 */
function boundaryLabel(boundary: IEvidenceGraphBoundary): string {
  const policies = [
    boundary.policy.noEvidenceExclude ? "no-exclude" : undefined,
    boundary.policy.uniqueEvidence ? "unique" : undefined,
    boundary.policy.singleEvidencePerSymbol ? "single" : undefined,
    boundary.policy.checklist ? "checklist" : undefined,
    boundary.policy.requireReview ? "review" : undefined,
  ].filter((value) => value !== undefined);
  const status = !boundary.active
    ? "inactive"
    : boundary.complete
      ? "complete"
      : "incomplete";
  return `claim[${boundary.claim.claim}] (${boundary.claim.type}) -> reference[${boundary.reference.reference ?? -1}] (${boundary.reference.type}); ${status}, ${boundary.policy.severity}${policies.length === 0 ? "" : `, ${policies.join(", ")}`}`;
}

/**
 * Produces a concise label for a graph node.
 *
 * Hosts identify their physical source location; unit nodes identify their
 * role, target, symbol, and selection or coverage state.
 */
function nodeLabel(node: EvidenceGraphNode): string {
  if (node.role === "host")
    return `host ${node.location.file}:${node.location.range?.start?.line ?? 1}`;
  const state = node.missing
    ? "missing"
    : node.covered
      ? "covered"
      : node.selection;
  return `${node.role} ${node.symbol} ${node.target} (${state})`;
}

/**
 * Labels an acknowledgement edge with its tag kind and fingerprint.
 *
 * Fingerprints connect rendered edges to their persistent review identifiers.
 */
function edgeLabel(edge: IEvidenceGraphExportEdge): string {
  return `@${edge.kind} #${edge.fingerprint}`;
}

/**
 * Labels a review relation with its review-tag spelling and optional
 * fingerprint.
 *
 * Missing fingerprints remain explicit because their absence affects review
 * matching rather than meaning that the review edge has no source data.
 */
function reviewLabel(review: IEvidenceGraphExportReview): string {
  const marker =
    review.reviews === "evidence"
      ? "@evidenceReview"
      : "@evidenceExcludeReview";
  return `${marker}${review.review.fingerprint === undefined ? "" : ` #${review.review.fingerprint}`}`;
}

/**
 * Escapes text embedded inside Mermaid quoted labels and edge labels.
 *
 * Entity encodings prevent authored markup, quotes, separators, and line breaks
 * from changing the surrounding flowchart grammar.
 */
function mermaidText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;");
}

/**
 * Escapes text embedded in a DOT quoted string literal.
 *
 * Backslashes are handled first so later quote and line-break substitutions
 * cannot create an escape sequence with a different meaning.
 */
function dotText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
}
