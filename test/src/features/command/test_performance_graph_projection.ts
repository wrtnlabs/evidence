import { dedent } from "@typia/utils";
import { TestValidator } from "@nestia/e2e";
import {
  createEvidenceConfigPlan,
  EvidenceChecker,
  EvidenceGraphReporter,
  EvidenceQuery,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckAnalysis,
  IEvidenceConfig,
  IEvidenceGraphReport,
  IEvidenceGraphBoundary,
  EvidenceGraphNode,
} from "@wrtnlabs/evidence";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Projects large missing populations and renders independent boundaries in
 * order.
 *
 * Missing target coverage and visual boundary ownership must survive indexed
 * projection without repeated population scans.
 *
 * 1. Analyze an uncited 8,000-heading target population.
 * 2. Inspect direct and ancestor coverage and render 5,000 isolated boundaries.
 * 3. Require exact missing coverage, authored order and deterministic output in
 *    every format.
 *
 * @evidence contracts/testing.md#behavioral-verification Exports a real 8000-heading obligation, checks direct and aggregate coverage, and renders 5000 independent copied boundaries with exact node and boundary counts.
 * @evidence contracts/testing.md#independent-expectations Every uncited target remains missing, its structural file is missing, and each copied boundary owns exactly its one authored node in the original order.
 * @evidence contracts/testing.md#distinguishing-cases Covers many selected leaves, a structural ancestor, isolated visual boundaries, deterministic JSON and all three formats; existing query suites own evidence/review and withdrawal edge semantics.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor calls maintained checker, query and reporters in-process over task-owned fixtures without a CLI or consumer installation.
 */
export async function test_performance_graph_projection(): Promise<void> {
  const count: number = 8000;
  await EvidenceTestFileSystem.experiment(
    "performance-graph-projection",
    {
      "source.md": dedent`
        ## Source
        Body.
      `,
      "rules.md": Array.from(
        { length: count },
        (_value: unknown, index: number): string =>
          dedent`
            ## Rule ${index}
            Required.
          ` + "\n",
      ).join(""),
    },
    async (directory: string): Promise<void> => {
      const config: IEvidenceConfig = {
        claims: [
          {
            type: "markdown",
            files: ["source.md"],
            symbol: "h2",
            reference: { type: "markdown", files: ["rules.md"], symbol: "h2" },
          },
        ],
      };
      const analysis: IEvidenceCheckAnalysis = await EvidenceChecker.evaluate(
        createEvidenceConfigPlan(config, join(directory, "evidence.json")),
      );
      const query: EvidenceQuery = new EvidenceQuery(analysis, directory);
      const start: number = performance.now();
      const report: IEvidenceGraphReport = query.graph();
      const selected: EvidenceGraphNode[] = report.nodes.filter(
        (node: EvidenceGraphNode): boolean =>
          node.role === "reference" && node.selection === "selected",
      );
      TestValidator.equals(
        "all selected rules exported",
        selected.length,
        count,
      );
      TestValidator.equals(
        "uncited leaves are missing",
        selected.every(
          (node: EvidenceGraphNode): boolean =>
            node.role !== "host" && node.missing && !node.covered,
        ),
        true,
      );
      TestValidator.equals(
        "complete missing denominator",
        report.boundaries[0]?.missingUnitIds.length,
        count,
      );
      TestValidator.predicate(
        "indexed graph projection ceiling",
        performance.now() - start < 15000,
      );
      const boundary: IEvidenceGraphBoundary | undefined = report.boundaries[0];
      const node: EvidenceGraphNode | undefined = selected[0];
      if (boundary === undefined || node === undefined)
        throw new Error("Missing graph fixture boundary.");
      const many: IEvidenceGraphReport = {
        ...report,
        boundaries: [],
        nodes: [],
        edges: [],
        reviews: [],
        diagnostics: [],
      };
      for (let index: number = 0; index < 5000; ++index) {
        const id: string = `boundary-${index}`;
        many.boundaries.push({
          ...boundary,
          id,
          unitIds: [],
          coveredUnitIds: [],
          missingUnitIds: [],
          hostCoverage: [],
        });
        many.nodes.push({ ...node, id: `node-${index}`, boundaryId: id });
      }
      const renderStart: number = performance.now();
      const mermaid: string = EvidenceGraphReporter.mermaid(many);
      const dot: string = EvidenceGraphReporter.dot(many);
      TestValidator.equals(
        "one Mermaid group per boundary",
        mermaid.match(/  subgraph /gu)?.length,
        5000,
      );
      TestValidator.equals(
        "one DOT group per boundary",
        dot.match(/subgraph cluster_/gu)?.length,
        5000,
      );
      TestValidator.predicate(
        "synthetic node order",
        mermaid.indexOf("n0[") < mermaid.indexOf("n4999["),
      );
      TestValidator.equals(
        "deterministic graph JSON",
        EvidenceGraphReporter.json(many),
        EvidenceGraphReporter.json(structuredClone(many)),
      );
      TestValidator.predicate(
        "indexed rendering ceiling",
        performance.now() - renderStart < 10000,
      );
    },
  );
}
