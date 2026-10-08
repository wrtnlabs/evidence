import {
  EvidenceChecker,
  EvidenceCommand,
  EvidenceFingerprint,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckAnalysis,
  IEvidenceCheckReport,
  IEvidenceCommandResult,
  IEvidenceConfig,
  IEvidenceDiagnostic,
  IEvidenceGraphClaim,
  IEvidenceGraphReference,
  IEvidenceMarkdownReference,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { join } from "node:path";
import typia from "typia";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Preserves full evidence policy when reporting a selected reference subtree.
 *
 * Filtering must not make a multi-target host or duplicate ownership pass, and
 * a descendant still depends on its aggregate citation's review fingerprint.
 *
 * 1. Select a child acknowledged by two aggregate citations and require duplicate
 *    ownership and both hosts' original cardinality failures, excluding an
 *    unrelated untagged host's finding.
 * 2. Evaluate one exclusion under repeated permissive and strict references;
 *    require independent coverage and the strict refusal at its source.
 * 3. Require an aggregate review for a focused child, write its current full
 *    fingerprint, and verify success, then mutate a sibling and require
 *    staleness.
 */
export async function test_command_only_policies(): Promise<void> {
  const reference: IEvidenceMarkdownReference = {
    type: "markdown",
    root: "docs",
    files: ["*.md"],
    symbol: ["h2", "h3"],
    uniqueEvidence: true,
    singleEvidencePerSymbol: true,
  };
  function config(references: IEvidenceMarkdownReference[]): IEvidenceConfig {
    return {
      claims: [
        {
          type: "typescript",
          files: ["src/*.ts"],
          symbol: "function",
          reference: references,
        },
      ],
    };
  }
  const requirements: string = dedent`
    ## Pricing {#pricing}
    Pricing requirements.
    ### Tax {#tax}
    Tax requirements.
    ### Discount {#discount}
    Discount requirements.
    ## Refund {#refund}
    Refund requirements.
  `;
  await EvidenceTestFileSystem.experiment(
    "only policies",
    {
      "evidence.config.json": JSON.stringify(config([reference])),
      "docs/requirements.md": requirements,
      "src/main.ts": dedent`
      /**
       * @evidence requirements.md#pricing Implements pricing.
       * @evidence requirements.md#refund Implements refunds.
       */
      export function first(): void {}
      /** @evidence requirements.md#pricing Also implements pricing. */
      export function second(): void {}
      export function unrelated(): void {}
    `,
    },
    async (directory: string): Promise<void> => {
      async function run(target: string): Promise<IEvidenceCheckReport> {
        const result: IEvidenceCommandResult = await EvidenceCommand.run(
          ["--only", target, "--format", "json"],
          directory,
        );
        return typia.json.assertParse<IEvidenceCheckReport>(result.stdout);
      }
      const tax: IEvidenceCheckReport = await run("requirements.md#tax");
      TestValidator.equals("focused denominator", tax.counts.units, 1);
      TestValidator.equals(
        "duplicate ownership",
        tax.diagnostics.filter(
          (diagnostic: IEvidenceDiagnostic): boolean =>
            diagnostic.code === "graph-unique-evidence",
        ).length,
        1,
      );
      TestValidator.equals(
        "full host cardinality",
        tax.diagnostics.filter(
          (diagnostic: IEvidenceDiagnostic): boolean =>
            diagnostic.code === "graph-single-evidence-per-symbol",
        ).length,
        2,
      );
      const refund: IEvidenceCheckReport = await run("requirements.md#refund");
      TestValidator.equals(
        "unrelated duplicate omitted",
        refund.diagnostics.filter(
          (diagnostic: IEvidenceDiagnostic): boolean =>
            diagnostic.code === "graph-unique-evidence",
        ).length,
        0,
      );
      TestValidator.equals(
        "only refund host",
        refund.diagnostics.filter(
          (diagnostic: IEvidenceDiagnostic): boolean =>
            diagnostic.code === "graph-single-evidence-per-symbol",
        ).length,
        1,
      );

      // The same selected identity remains a separate requirement in each reference.
      const permissive: IEvidenceMarkdownReference = {
        type: "markdown",
        root: "docs",
        files: ["*.md"],
        symbol: ["h2", "h3"],
      };
      await EvidenceTestFileSystem.save(directory, {
        "evidence.config.json": JSON.stringify(
          config([permissive, { ...permissive, noEvidenceExclude: true }]),
        ),
        "src/main.ts": dedent`
        /** @evidenceExclude requirements.md#pricing Pricing is owned elsewhere. */
        export function excluded(): void {}
      `,
      });
      const excluded: IEvidenceCheckReport = await run("requirements.md#tax");
      TestValidator.equals(
        "independent coverage",
        [
          excluded.counts.units,
          excluded.counts.coveredUnits,
          excluded.counts.missingUnits,
        ],
        [2, 1, 1],
      );
      TestValidator.predicate(
        "strict exclusion refusal",
        excluded.diagnostics.some(
          (diagnostic: IEvidenceDiagnostic): boolean =>
            diagnostic.code === "graph-forbidden-exclusion" &&
            diagnostic.reference === 1,
        ),
      );

      // A focused child uses the aggregate's fingerprint, including sibling content.
      await EvidenceTestFileSystem.save(directory, {
        "evidence.config.json": JSON.stringify(
          config([{ ...permissive, requireReview: true }]),
        ),
        "src/main.ts":
          "/** @evidence requirements.md#pricing Implements pricing. */\nexport function reviewed(): void {}\n",
      });
      const missing: IEvidenceCheckReport = await run("requirements.md#tax");
      TestValidator.predicate(
        "aggregate review required",
        missing.diagnostics.some(
          (diagnostic: IEvidenceDiagnostic): boolean =>
            diagnostic.code === "graph-missing-review",
        ),
      );
      const analysis: IEvidenceCheckAnalysis = await EvidenceChecker.analyze(
        join(directory, "evidence.config.json"),
      );
      const claim: IEvidenceGraphClaim | undefined =
        analysis.graphInput.claims[0];
      const population: IEvidenceGraphReference | undefined =
        claim === undefined ? undefined : claim.references[0];
      if (population === undefined)
        throw new Error("Missing review population.");
      const parent: IEvidenceUnit | undefined = population.inventory.units.find(
        (unit: IEvidenceUnit): boolean => unit.name === "Pricing",
      );
      if (parent === undefined)
        throw new Error("Missing aggregate review unit.");
      const fingerprint: string = EvidenceFingerprint.inspect(
        population.inventory,
        parent.id,
      ).fingerprint;
      await EvidenceTestFileSystem.save(directory, {
        "src/main.ts": dedent`
        /**
         * @evidence requirements.md#pricing Implements pricing.
         * @evidenceReview requirements.md#pricing #${fingerprint} Checked all pricing requirements.
         */
        export function reviewed(): void {}
      `,
      });
      TestValidator.equals(
        "current aggregate review passes",
        (await run("requirements.md#tax")).exitCode,
        0,
      );
      await EvidenceTestFileSystem.save(directory, {
        "docs/requirements.md": requirements.replace(
          "Discount requirements.",
          "Apply the revised discount.",
        ),
      });
      const stale: IEvidenceCheckReport = await run("requirements.md#tax");
      TestValidator.equals("sibling edit fails", stale.exitCode, 1);
      TestValidator.predicate(
        "full fingerprint retained",
        stale.diagnostics.some(
          (diagnostic: IEvidenceDiagnostic): boolean =>
            diagnostic.code === "graph-stale-review",
        ),
      );
    },
  );
}
