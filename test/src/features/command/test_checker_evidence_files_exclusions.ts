import { EvidenceChecker, EvidenceFingerprint } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckAnalysis,
  IEvidenceConfigPlan,
  IEvidenceConfigPlanClaim,
  IEvidenceConfigPlanReference,
  IEvidenceDiagnostic,
  IEvidenceGraphEdge,
  IEvidenceGraphReference,
  IEvidenceHost,
  IEvidenceMarkdownReference,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Applies native exclusion policies to exclusions and exclusion reviews written
 * in separate evidence files.
 *
 * 1. Answer one requirement with a detached `@evidence` heading and exclude the
 *    other with a detached `@evidenceExclude` heading on one function.
 *
 *    - Require a pass whose exclusion edge belongs to the function while keeping its
 *         Markdown carrier location.
 *    - Remove the exclusion heading and require the second requirement to be
 *         missing.
 * 2. Refuse the detached exclusion with `noEvidenceExclude`.
 * 3. Restrict exclusion carriers: a glob matching the owner's source file accepts
 *    the exclusion, and a glob matching no claim file rejects it at its
 *    Markdown location.
 * 4. Add native positive evidence for the excluded requirement and require a
 *    conflict between the two locations.
 * 5. Require reviews:
 *
 *    - Without reviews, both detached statements lack one.
 *    - An `@evidenceReview` comment under the exclusion is the wrong kind.
 *    - An `@evidenceExcludeReview` comment with the current fingerprint passes.
 *    - Editing the excluded requirement expires only that review.
 * 6. Excuse one function from a whole checklist file with a detached exclusion
 *    while a second, unanswered function still has every item missing.
 * 7. For a Markdown claim rooted at `docs`, match exclusion carriers against the
 *    owner's root-relative path.
 *
 * @evidence contracts/testing.md#behavioral-verification Runs EvidenceChecker over detached exclusion headings and review comments and asserts exit codes, edge kinds, semantic and physical hosts, and diagnostic codes and locations for coverage, noEvidenceExclude, evidenceExcludeCarriers, conflicts, review kind, current and stale reviews, checklist excuses, and rooted Markdown claims; it catches exclusions that are rejected, ignored, attributed to the Markdown heading, or exempt from native policy, and allows a detached exclusion to cover exactly what a native one covers.
 * @evidence contracts/testing.md#independent-expectations Expectations follow the README rules for native exclusions: an exclusion covers its target, noEvidenceExclude refuses it, carriers are judged by the claim file that holds the excluded unit, overlapping evidence conflicts, and requireReview needs a same-kind review with the current reference fingerprint computed by EvidenceFingerprint from the reference text. The fixture has one selected function per role, so a misattributed host cannot satisfy these assertions.
 * @evidence contracts/testing.md#distinguishing-cases Present and removed exclusions, permitted and refused exclusions, matching and non-matching carriers in code and rooted Markdown claims, single- and two-location statements, absent, wrong-kind, current and stale reviews, and an excused next to an unanswered checklist host separate each policy decision; binding failures belong to test_checker_evidence_files_boundaries and positive-evidence policies to test_checker_evidence_files_policies.
 * @evidence contracts/testing.md#execution-ownership DynamicExecutor discovers this exported test, which calls EvidenceChecker in-process and writes only its disposable fixture through EvidenceTestFileSystem.
 */
export async function test_checker_evidence_files_exclusions(): Promise<void> {
  const location: string = join(
    __dirname,
    `evidence-exclusions-${randomUUID()}`,
  );
  const requirement: string = dedent`
    ## First {#first}

    First rule.

    ## Second {#second}

    Second rule.
  `;
  const statements: string = dedent`
    # src/execute.ts#execute

    ## @evidence docs/rules.md#first

    Implements the first rule.

    ## @evidenceExclude docs/rules.md#second

    The second rule governs refunds, which this function never issues.
  `;
  await EvidenceTestFileSystem.experiment(
    location,
    {
      "evidence.config.ts": "export default {};\n",
      "docs/rules.md": requirement,
      "docs/guide.md": "## Pricing {#pricing}\n\nPrices are computed.\n",
      "src/execute.ts": "export function execute(): void {}\n",
      "evidence/execute.md": statements,
      "evidence/guide.md": dedent`
        # docs/guide.md#pricing

        ## @evidence docs/rules.md#first

        Explains the first rule.

        ## @evidenceExclude docs/rules.md#second

        Pricing does not issue refunds.
      `,
    },
    async (directory: string): Promise<void> => {
      const plan: IEvidenceConfigPlan = {
        configFile: join(directory, "evidence.config.ts"),
        claims: [
          {
            index: 0,
            population: {
              type: "typescript",
              files: ["src/*.ts"],
              symbol: "function",
              evidenceFiles: ["evidence/execute.md"],
              reference: {
                type: "markdown",
                files: ["docs/rules.md"],
                symbol: "h2",
              },
            },
            severity: "error",
            symbols: ["function"],
            references: [
              {
                index: 0,
                population: {
                  type: "markdown",
                  files: ["docs/rules.md"],
                  symbol: "h2",
                },
                severity: "error",
                symbols: ["h2"],
              },
            ],
          },
        ],
      };

      // 1. A detached exclusion covers its target for the H1 owner.
      const passing: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(plan);
      TestValidator.equals(
        "detached exclusion passes",
        passing.report.exitCode,
        0,
      );
      const edges: IEvidenceGraphEdge[] =
        passing.graph.claims[0]?.obligations[0]?.edges ?? [];
      TestValidator.equals(
        "edge kinds",
        edges.map((edge: IEvidenceGraphEdge): string => edge.kind).sort(),
        ["evidence", "evidenceExclude"],
      );
      const execute: IEvidenceUnit | undefined =
        passing.graphInput.claims[0]?.inventory.units.find(
          (unit: IEvidenceUnit): boolean =>
            unit.symbol === "function" && unit.name === "execute",
        );
      const exclusion: IEvidenceGraphEdge | undefined = edges.find(
        (edge: IEvidenceGraphEdge): boolean => edge.kind === "evidenceExclude",
      );
      if (execute === undefined || exclusion === undefined)
        throw new Error("Missing detached exclusion fixture records.");
      TestValidator.equals("exclusion semantic host", exclusion.hostUnitIds, [
        execute.id,
      ]);
      const carrier: IEvidenceHost | undefined =
        passing.graphInput.claims[0]?.inventory.hosts.find(
          (host: IEvidenceHost): boolean => host.id === exclusion.hostId,
        );
      TestValidator.predicate(
        "exclusion physical carrier",
        carrier?.file.endsWith("execute.md") === true,
      );

      await EvidenceTestFileSystem.save(directory, {
        "evidence/execute.md": statements.slice(
          0,
          statements.indexOf("\n\n## @evidenceExclude"),
        ),
      });
      const removed: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(plan);
      TestValidator.equals("removed exclusion leaves a gap", codes(removed), [
        "graph-missing-acknowledgement",
      ]);
      await EvidenceTestFileSystem.save(directory, {
        "evidence/execute.md": statements,
      });

      // 2. noEvidenceExclude refuses detached exclusions too.
      const forbidden: IEvidenceConfigPlan = structuredClone(plan);
      reference(forbidden).noEvidenceExclude = true;
      const refused: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(forbidden);
      TestValidator.predicate(
        "forbidden detached exclusion",
        located(refused, "graph-forbidden-exclusion", "execute.md"),
      );
      TestValidator.equals("forbidden exit", refused.report.exitCode, 1);

      // 3. Carriers are judged by the owner's claim file.
      const carriers: IEvidenceConfigPlan = structuredClone(plan);
      claim(carriers).population.evidenceExcludeCarriers = ["src/execute.ts"];
      const permitted: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(carriers);
      TestValidator.equals("owner file carrier", permitted.report.exitCode, 0);
      claim(carriers).population.evidenceExcludeCarriers = ["src/legacy/*.ts"];
      const outside: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(carriers);
      TestValidator.predicate(
        "carrier outside owner file",
        located(outside, "graph-out-of-scope-host", "execute.md"),
      );
      TestValidator.equals("carrier exit", outside.report.exitCode, 1);

      // 4. Native evidence and a detached exclusion conflict.
      await EvidenceTestFileSystem.save(directory, {
        "src/execute.ts": dedent`
          /** @evidence docs/rules.md#second Also implements the second rule. */
          export function execute(): void {}
        `,
      });
      const conflict: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(plan);
      TestValidator.predicate(
        "cross-location conflict",
        conflict.report.diagnostics.some(
          (diagnostic: IEvidenceDiagnostic): boolean =>
            diagnostic.code === "graph-conflicting-acknowledgements",
        ),
      );
      await EvidenceTestFileSystem.save(directory, {
        "src/execute.ts": "export function execute(): void {}\n",
      });

      // 5. Exclusion reviews sit in comments below the exclusion heading.
      const reviewed: IEvidenceConfigPlan = structuredClone(plan);
      reference(reviewed).requireReview = true;
      const unreviewed: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(reviewed);
      TestValidator.equals(
        "both detached statements need reviews",
        codes(unreviewed),
        ["graph-missing-review", "graph-missing-review"],
      );
      const first: string = fingerprint(unreviewed, "First");
      const second: string = fingerprint(unreviewed, "Second");
      await EvidenceTestFileSystem.save(directory, {
        "evidence/execute.md": review(
          statements,
          first,
          `<!-- @evidenceReview docs/rules.md#second #${second} Reviewed with the wrong kind. -->`,
        ),
      });
      const wrongKind: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(reviewed);
      TestValidator.predicate(
        "positive review under exclusion",
        located(wrongKind, "graph-review-kind", "execute.md"),
      );
      await EvidenceTestFileSystem.save(directory, {
        "evidence/execute.md": review(
          statements,
          first,
          `<!-- @evidenceExcludeReview docs/rules.md#second #${second} Confirmed that execute issues no refund. -->`,
        ),
      });
      const current: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(reviewed);
      TestValidator.equals(
        "current exclusion review",
        current.report.exitCode,
        0,
      );
      await EvidenceTestFileSystem.save(directory, {
        "docs/rules.md": requirement.replace(
          "Second rule.",
          "Updated second rule.",
        ),
      });
      const stale: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(reviewed);
      TestValidator.equals("only the exclusion review expires", codes(stale), [
        "graph-stale-review",
      ]);
      await EvidenceTestFileSystem.save(directory, {
        "docs/rules.md": requirement,
        "evidence/execute.md": statements,
      });

      // 6. A whole-file checklist exclusion excuses only its owner.
      const checklist: IEvidenceConfigPlan = structuredClone(plan);
      reference(checklist).checklist = true;
      await EvidenceTestFileSystem.save(directory, {
        "src/execute.ts": dedent`
          export function execute(): void {}
          export function another(): void {}
        `,
        "evidence/execute.md": dedent`
          # src/execute.ts#execute

          ## @evidenceExclude docs/rules.md

          No rule in this file applies to execute.
        `,
      });
      const excused: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(checklist);
      const missing: IEvidenceDiagnostic[] = excused.report.diagnostics.filter(
        (diagnostic: IEvidenceDiagnostic): boolean =>
          diagnostic.code === "graph-checklist-missing",
      );
      TestValidator.equals("one checklist host missing", missing.length, 1);
      const unanswered: string = missing[0]?.message ?? "";
      TestValidator.predicate(
        "unanswered host reported",
        unanswered.includes("another") && unanswered.includes("2 of 2"),
      );
      await EvidenceTestFileSystem.save(directory, {
        "src/execute.ts": "export function execute(): void {}\n",
        "evidence/execute.md": statements,
      });

      // 7. A rooted Markdown claim matches carriers from its root.
      const markdown: IEvidenceConfigPlan = {
        configFile: plan.configFile,
        claims: [
          {
            index: 0,
            population: {
              type: "markdown",
              root: "docs",
              files: ["guide.md"],
              symbol: "h2",
              evidenceFiles: ["evidence/guide.md"],
              evidenceExcludeCarriers: ["guide.md"],
              reference: {
                type: "markdown",
                files: ["docs/rules.md"],
                symbol: "h2",
              },
            },
            severity: "error",
            symbols: ["h2"],
            references: claim(plan).references,
          },
        ],
      };
      const rooted: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(markdown);
      TestValidator.equals("rooted carrier", rooted.report.exitCode, 0);
      const markdownClaim: IEvidenceConfigPlanClaim = claim(markdown);
      if (markdownClaim.population.type !== "markdown")
        throw new Error("Missing Markdown claim fixture.");
      markdownClaim.population.evidenceExcludeCarriers = ["docs/guide.md"];
      const unrooted: IEvidenceCheckAnalysis =
        await EvidenceChecker.evaluate(markdown);
      TestValidator.predicate(
        "config-relative carrier is outside the root",
        located(unrooted, "graph-out-of-scope-host", "guide.md"),
      );
    },
  );
}

/** Returns the only claim of a fixture plan. */
function claim(plan: IEvidenceConfigPlan): IEvidenceConfigPlanClaim {
  const entry: IEvidenceConfigPlanClaim | undefined = plan.claims[0];
  if (entry === undefined) throw new Error("Missing fixture claim.");
  return entry;
}

/** Returns the Markdown reference population of a fixture plan's claim. */
function reference(plan: IEvidenceConfigPlan): IEvidenceMarkdownReference {
  const entry: IEvidenceConfigPlanReference | undefined =
    claim(plan).references[0];
  if (entry === undefined || entry.population.type !== "markdown")
    throw new Error("Missing Markdown fixture reference.");
  return entry.population;
}

/** Lists a report's diagnostic codes in report order. */
function codes(analysis: IEvidenceCheckAnalysis): string[] {
  return analysis.report.diagnostics.map(
    (diagnostic: IEvidenceDiagnostic): string => diagnostic.code,
  );
}

/** Tests whether a diagnostic code is reported in a file with this suffix. */
function located(
  analysis: IEvidenceCheckAnalysis,
  code: string,
  suffix: string,
): boolean {
  return analysis.report.diagnostics.some(
    (diagnostic: IEvidenceDiagnostic): boolean =>
      diagnostic.code === code &&
      diagnostic.location?.file.endsWith(suffix) === true,
  );
}

/** Computes the current fingerprint of one requirement heading. */
function fingerprint(analysis: IEvidenceCheckAnalysis, name: string): string {
  const input: IEvidenceGraphReference | undefined =
    analysis.graphInput.claims[0]?.references[0];
  const unit: IEvidenceUnit | undefined = input?.inventory.units.find(
    (candidate: IEvidenceUnit): boolean => candidate.name === name,
  );
  if (input === undefined || unit === undefined)
    throw new Error(`Missing fingerprint fixture unit '${name}'.`);
  return EvidenceFingerprint.inspect(input.inventory, unit.id).fingerprint;
}

/**
 * Places a positive review below the evidence heading and the given comment
 * below the exclusion heading.
 */
function review(statements: string, first: string, comment: string): string {
  return statements
    .replace(
      "## @evidence docs/rules.md#first\n",
      `## @evidence docs/rules.md#first\n<!-- @evidenceReview docs/rules.md#first #${first} Confirmed that execute implements the first rule. -->\n`,
    )
    .replace(
      "## @evidenceExclude docs/rules.md#second\n",
      `## @evidenceExclude docs/rules.md#second\n${comment}\n`,
    );
}
