import { EvidenceChecker } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckReport,
  IEvidenceDiagnostic,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Lets claims that select the same Markdown hosts own only their own citations.
 *
 * A file-level claim answers one rule file and an H2 claim answers another over
 * the same documents. Each claim reads both annotations, but an annotation that
 * cites the other claim's reference is that claim's obligation. A citation that
 * no claim accepts must still fail.
 *
 * 1. Check the shared-host layout with one tag per claim and require exit 0, two
 *    covered units, and no diagnostic.
 * 2. Remove both tags:
 *
 *    - Each claim reports its own missing acknowledgement.
 *    - No claim reports a target-resolution error for a tag that is gone.
 * 3. Mistype the anchor inside the file claim's reference:
 *
 *    - Only the claim that owns the file reports the missing member.
 *    - The other claim stays silent about that tag.
 * 4. Mistype the file name: no claim accepts the citation, so both claims report
 *    the missing file and the owner keeps its missing acknowledgement.
 * 5. Cite an existing file that neither claim selects and require both claims to
 *    report that the file is not among their selected reference files.
 * 6. Require a review of the H2 claim's reference and add a review without a
 *    fingerprint to a document both claims read:
 *
 *    - Only the claim that owns the citation reports the missing fingerprint.
 *    - The other claim reports no review target error.
 * 7. Write the fingerprint from that diagnostic into the review and require exit 0
 *    with no diagnostic.
 */
export async function test_checker_shared_hosts_markdown(): Promise<void> {
  const location = join(__dirname, `shared hosts markdown ${randomUUID()}`);
  await EvidenceTestFileSystem.experiment(
    location,
    {
      "evidence.json": configuration(false),
      "rules/principles.md": "# Principles\n\n## P1 {#p1}\n\nq\n",
      "rules/obligations.md": "# Obligations\n\n## O1 {#o1}\n\nq\n",
      "rules/other.md": "# Other\n\n## X1 {#x1}\n\nq\n",
      "docs/a.md": document(
        "rules/obligations.md#o1",
        "rules/principles.md#p1",
      ),
    },
    async (directory: string): Promise<void> => {
      const config: string = join(directory, "evidence.json");

      // Each tag is read by both claims but cites only one claim's reference.
      const passing: IEvidenceCheckReport = await EvidenceChecker.check(config);
      TestValidator.equals("shared hosts exit", passing.exitCode, 0);
      TestValidator.equals(
        "shared hosts covered units",
        passing.counts.coveredUnits,
        2,
      );
      TestValidator.equals("shared hosts diagnostics", codes(passing), []);

      // Without tags the failure is coverage in each owner, never resolution.
      await EvidenceTestFileSystem.save(directory, {
        "docs/a.md": "# A\n\n## Unit {#unit}\n\nBody.\n",
      });
      TestValidator.equals(
        "untagged claims report their own gaps",
        codes(await EvidenceChecker.check(config)),
        ["0:graph-missing-acknowledgement", "1:graph-checklist-missing"],
      );

      // The file is selected by claim 0 only, so claim 1 must not echo the error.
      await EvidenceTestFileSystem.save(directory, {
        "docs/a.md": document(
          "rules/obligations.md#o9",
          "rules/principles.md#p1",
        ),
      });
      TestValidator.equals(
        "mistyped anchor belongs to the file's owner",
        codes(await EvidenceChecker.check(config)),
        ["0:graph-missing-acknowledgement", "0:target-missing-member"],
      );

      // No reference contains the file, so ownership cannot hide the mistake.
      await EvidenceTestFileSystem.save(directory, {
        "docs/a.md": document(
          "rules/obligation.md#o1",
          "rules/principles.md#p1",
        ),
      });
      TestValidator.equals(
        "mistyped file is reported by every claim",
        codes(await EvidenceChecker.check(config)),
        [
          "0:graph-missing-acknowledgement",
          "0:target-missing-file",
          "1:target-missing-file",
        ],
      );

      // A real file outside every reference is still a selection error in each claim.
      await EvidenceTestFileSystem.save(directory, {
        "docs/a.md": document("rules/other.md#x1", "rules/principles.md#p1"),
      });
      TestValidator.equals(
        "unselected file is reported by every claim",
        codes(await EvidenceChecker.check(config)),
        [
          "0:graph-missing-acknowledgement",
          "0:target-missing-file",
          "1:target-missing-file",
        ],
      );

      // A review follows the citation it pairs with, not the claim that reads it.
      const review = (fingerprint: string): string =>
        document("rules/obligations.md#o1", "rules/principles.md#p1", [
          `<!-- @evidenceReview rules/principles.md#p1 ${fingerprint}Reviewed against P1. -->`,
        ]);
      await EvidenceTestFileSystem.save(directory, {
        "evidence.json": configuration(true),
        "docs/a.md": review(""),
      });
      const unpinned: IEvidenceCheckReport =
        await EvidenceChecker.check(config);
      TestValidator.equals(
        "review is judged only by the claim that owns the citation",
        codes(unpinned),
        ["1:graph-missing-review-fingerprint"],
      );

      // Pinning the reported fingerprint settles the review in the owning claim.
      const fingerprint: string | undefined = unpinned.diagnostics
        .map(
          (diagnostic: IEvidenceDiagnostic): string | undefined =>
            /#[0-9a-f]{7}/.exec(diagnostic.message)?.[0],
        )
        .find((value: string | undefined): boolean => value !== undefined);
      if (fingerprint === undefined)
        throw new Error("The review diagnostic names no fingerprint.");
      await EvidenceTestFileSystem.save(directory, {
        "docs/a.md": review(`${fingerprint} `),
      });
      const pinned: IEvidenceCheckReport = await EvidenceChecker.check(config);
      TestValidator.equals("pinned review exit", pinned.exitCode, 0);
      TestValidator.equals("pinned review diagnostics", codes(pinned), []);
    },
  );
}

/**
 * Builds the two-claim layout over the same document files.
 *
 * The file claim answers the obligations rule file and the H2 claim answers the
 * principles rule file. `requireReview` applies to the H2 claim's reference.
 */
function configuration(requireReview: boolean): string {
  return JSON.stringify({
    claims: [
      {
        name: "file answers obligations",
        type: "markdown",
        files: ["docs/*.md"],
        symbol: "file",
        reference: {
          type: "markdown",
          files: ["rules/obligations.md"],
          symbol: "h2",
          noEvidenceExclude: true,
        },
      },
      {
        name: "h2 answers principles",
        type: "markdown",
        files: ["docs/*.md"],
        symbol: "h2",
        reference: {
          type: "markdown",
          files: ["rules/principles.md"],
          symbol: "h2",
          checklist: true,
          noEvidenceExclude: true,
          ...(requireReview ? { requireReview: true } : {}),
        },
      },
    ],
  });
}

/**
 * Writes one document whose file-level and H2 tags cite the given targets.
 *
 * `extra` lines follow the H2 tag inside the same section, which is where a
 * review of the H2 citation belongs.
 */
function document(file: string, h2: string, extra: string[] = []): string {
  return [
    `<!-- @evidence ${file} The file answers its obligation once. -->`,
    "",
    "# A",
    "",
    "## Unit {#unit}",
    "",
    `<!-- @evidence ${h2} This H2 answers its principle. -->`,
    ...extra,
    "",
    "Body.",
    "",
  ].join("\n");
}

/** Lists each diagnostic as `<claim>:<code>` in a stable order. */
function codes(report: IEvidenceCheckReport): string[] {
  return report.diagnostics
    .map(
      (diagnostic: IEvidenceDiagnostic): string =>
        `${String(diagnostic.claim)}:${diagnostic.code}`,
    )
    .sort((x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0));
}
