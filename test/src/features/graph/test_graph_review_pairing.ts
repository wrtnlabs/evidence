import {
  EvidenceFingerprint,
  EvidenceGraph,
  EvidenceMarkdownAdapter,
  EvidenceTypeScriptAdapter,
} from "@wrtnlabs/evidence";
import type { IEvidenceInventory, IEvidenceUnit } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestGraph } from "../../internal/EvidenceTestGraph";
import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Pairs reviews by semantic host, resolved target, and acknowledgement kind.
 *
 * Real Markdown requirements and TypeScript declarations exercise pairing after
 * adapter reconciliation. A review on another part of a merged declaration can
 * belong to the same host, while identical target text on an unrelated function
 * must not borrow that host's evidence.
 *
 * 1. Create Pricing and Tax requirements and compute their current fingerprints.
 * 2. Put Pricing evidence and its review on separate merged interface sites;
 *    require no review finding for that shared semantic identity.
 * 3. Add three independent invalid review scenarios and verify that:
 *
 *    - A positive review of a Tax exclusion produces one wrong-kind finding.
 *    - A Pricing review on an unrelated host produces one orphan finding.
 *    - Two reviews on one acknowledgement produce one duplicate finding.
 * 4. Require no derivative missing-review finding for the wrong-kind pair, so the
 *    diagnostic identifies the actual repair rather than reporting it twice.
 *
 * @evidence contracts/testing.md#behavioral-verification Evaluates reviews across merged and unrelated hosts and asserts the absence or presence of pairing findings.
 * @evidence contracts/testing.md#independent-expectations Review fingerprints are computed with EvidenceFingerprint; pairing expectations follow host, target and kind rules.
 * @evidence contracts/testing.md#distinguishing-cases Covers a review on a merged declaration part, a wrong-kind review, an orphan review on an unrelated host, duplicate reviews, and no derivative missing-review finding.
 * @evidence contracts/testing.md#execution-ownership The exported test_graph_review_pairing is discovered by DynamicExecutor under test/src/features and calls maintained source in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_graph_review_pairing(): Promise<void> {
  const requirements = await new EvidenceMarkdownAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "docs/spec.md",
      dedent`
        ## Pricing {#pricing}

        The rate is capped.

        ## Tax {#tax}

        The tax service owns jurisdiction rules.
      `,
    ),
  );
  const pricing = requireUnit(requirements, "pricing");
  const tax = requireUnit(requirements, "tax");
  const pricingFingerprint = EvidenceFingerprint.inspect(
    requirements,
    pricing.id,
  ).fingerprint;
  const taxFingerprint = EvidenceFingerprint.inspect(
    requirements,
    tax.id,
  ).fingerprint;
  const claims = await new EvidenceTypeScriptAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "src/pairing.ts",
      dedent`
        /** @evidence docs/spec.md#pricing Implements the pricing rule. */
        export interface Merged {
          price: number;
        }

        /** @evidenceReview docs/spec.md#pricing #${pricingFingerprint} Checked both halves of the merged contract. */
        export interface Merged {
          category: string;
        }

        /**
         * @evidenceExclude docs/spec.md#tax The tax service owns this rule.
         * @evidenceReview docs/spec.md#tax #${taxFingerprint} Filed under the wrong question.
         */
        export function wrongKind(): void {}

        /** @evidenceReview docs/spec.md#pricing #${pricingFingerprint} Reviewed another host's citation. */
        export function orphan(): void {}

        /**
         * @evidence docs/spec.md#pricing Implements the pricing rule.
         * @evidenceReview docs/spec.md#pricing #${pricingFingerprint} Checked the cap once.
         * @evidenceReview docs/spec.md#pricing #${pricingFingerprint} Checked the cap twice.
         */
        export function duplicate(): void {}
      `,
    ),
  );
  const unitIds = ["Merged", "wrongKind", "orphan", "duplicate"].map(
    (name) => requireUnit(claims, name).id,
  );
  const selected = [pricing.id, tax.id];
  const result = EvidenceGraph.evaluate({
    claims: [
      {
        severity: "error",
        inventory: claims,
        unitIds,
        references: [
          {
            severity: "error",
            inventory: requirements,
            unitIds: selected,
            resolutions: await EvidenceTestGraph.resolveDeclarations(
              claims,
              requirements,
              selected,
            ),
            reviewResolutions: await EvidenceTestGraph.resolveReviews(
              claims,
              requirements,
              selected,
            ),
            requireReview: true,
          },
        ],
      },
    ],
  });

  TestValidator.equals(
    "wrong review kind",
    count(result, "graph-review-kind"),
    1,
  );
  TestValidator.equals(
    "unrelated semantic host remains orphaned",
    count(result, "graph-orphan-review"),
    1,
  );
  TestValidator.equals(
    "same documentation position repeats review",
    count(result, "graph-duplicate-review"),
    1,
  );
  TestValidator.equals(
    "wrong-kind review suppresses derivative missing review",
    count(result, "graph-missing-review"),
    0,
  );
  TestValidator.equals(
    "merged identity accepts review from another declaration",
    result.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code.includes("review") &&
        diagnostic.message.includes("Merged"),
    ),
    [],
  );
}

/**
 * Locates a fixture unit by its display name or final identity segment.
 *
 * Markdown anchors and TypeScript names use different presentation conventions.
 * The helper accepts either fixture spelling and throws if extraction loses the
 * declaration, preventing a missing fixture from weakening the graph setup.
 */
function requireUnit(
  inventory: IEvidenceInventory,
  identity: string,
): IEvidenceUnit {
  const unit = inventory.units.find(
    (candidate) =>
      candidate.name === identity || candidate.identity.at(-1) === identity,
  );
  if (unit === undefined) throw new Error(`Missing review unit: ${identity}`);
  return unit;
}

/**
 * Counts graph findings for one expected review failure code.
 *
 * Exact counts distinguish one actionable diagnosis from duplicated or
 * derivative findings, which a presence-only assertion would not detect.
 */
function count(
  result: ReturnType<typeof EvidenceGraph.evaluate>,
  code: string,
): number {
  return result.diagnostics.filter((diagnostic) => diagnostic.code === code)
    .length;
}
