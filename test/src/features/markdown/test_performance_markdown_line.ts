import { dedent } from "@typia/utils";
import { TestValidator } from "@nestia/e2e";
import { EvidenceMarkdownAdapter } from "@wrtnlabs/evidence";
import type { IEvidenceUnit, IEvidenceInventory } from "@wrtnlabs/evidence";
import { performance } from "node:perf_hooks";
import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Scans a comment-rich physical line while keeping inline examples inert.
 *
 * A long physical line must keep comment ranges accurate and inline code inert
 * while reusing its lexical spans.
 *
 * 1. Put 16,000 HTML comments and an inline code example on one Unicode line.
 * 2. Analyze that line and its two surrounding headings.
 * 3. Require exact annotation counts and heading names within the execution
 *    ceiling.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs the real adapter with 16000 comments and asserts exact ranges, heading ownership, completeness and a generous scale ceiling.
 * @evidence contracts/testing.md#independent-expectations Only authored HTML comments are annotation ranges; comment-looking text inside the closed inline code span is inert.
 * @evidence contracts/testing.md#distinguishing-cases Covers a long comment-rich line, closed inline code, Unicode prose and a later heading; existing syntax suites own escapes, unmatched delimiters, HTML and MDX.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor invokes the adapter on an in-memory source without filesystem access or a subprocess.
 */
export async function test_performance_markdown_line(): Promise<void> {
  const count: number = 16000;
  const start: number = performance.now();
  const inventory: IEvidenceInventory =
    await new EvidenceMarkdownAdapter().analyze(
      EvidenceTestSourceSnapshot.create(
        "rules.md",
        dedent`
          ## First
          Text Ω ${"<!-- note --> ".repeat(count)}\`<!-- inert -->\`
          ## Second
          Body.
        `,
      ),
    );
  TestValidator.equals("complete long line", inventory.diagnostics, []);
  TestValidator.equals(
    "exact comment ranges",
    inventory.annotationRanges.length,
    count,
  );
  TestValidator.equals(
    "visible headings",
    inventory.units
      .filter((unit: IEvidenceUnit): boolean => unit.symbol === "h2")
      .map((unit: IEvidenceUnit): string => unit.name),
    ["First", "Second"],
  );
  TestValidator.predicate(
    "long-line scan ceiling",
    performance.now() - start < 10000,
  );
}
