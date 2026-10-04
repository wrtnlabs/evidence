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
 * 6. Require reviews in both references and review each citation without a
 *    fingerprint:
 *
 *    - Each claim reports the missing fingerprint of its own citation only.
 *    - Neither claim reports the other claim's review as orphaned or unresolved.
 * 7. Write each reported fingerprint into its review and require exit 0 with no
 *    diagnostic.
 * 8. Lower the H2 claim to a warning:
 *
 *    - A valid layout still passes without diagnostics, because a clean resolution
 *         hides nothing.
 *    - A mistyped anchor in that claim's reference stays a warning while the error
 *         claim keeps its own error, so a warning cannot absorb an error.
 *    - A mistyped anchor in the error claim's reference is reported once, as an
 *         error, by the claim that owns the file.
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
      const review = (first: string, second: string): string =>
        document(
          "rules/obligations.md#o1",
          "rules/principles.md#p1",
          [
            `<!-- @evidenceReview rules/obligations.md#o1 ${first}Reviewed against O1. -->`,
          ],
          [
            `<!-- @evidenceReview rules/principles.md#p1 ${second}Reviewed against P1. -->`,
          ],
        );
      await EvidenceTestFileSystem.save(directory, {
        "evidence.json": configuration(true),
        "docs/a.md": review("", ""),
      });
      const unpinned: IEvidenceCheckReport =
        await EvidenceChecker.check(config);
      TestValidator.equals(
        "each claim judges only the review of its own citation",
        codes(unpinned),
        [
          "0:graph-missing-review-fingerprint",
          "1:graph-missing-review-fingerprint",
        ],
      );

      // Pinning each reported fingerprint settles the reviews in their owners.
      const fingerprints: Map<string, string> = new Map<string, string>();
      for (const diagnostic of unpinned.diagnostics) {
        const match: RegExpExecArray | null =
          /@evidenceReview for '([^']+)'.*fingerprint is '(#[0-9a-f]{7})'/.exec(
            diagnostic.message,
          );
        if (match?.[1] !== undefined && match[2] !== undefined)
          fingerprints.set(match[1], match[2]);
      }
      const first: string | undefined = fingerprints.get(
        "rules/obligations.md#o1",
      );
      const second: string | undefined = fingerprints.get(
        "rules/principles.md#p1",
      );
      if (first === undefined || second === undefined)
        throw new Error("A review diagnostic names no fingerprint.");
      await EvidenceTestFileSystem.save(directory, {
        "docs/a.md": review(`${first} `, `${second} `),
      });
      const pinned: IEvidenceCheckReport = await EvidenceChecker.check(config);
      TestValidator.equals("pinned reviews exit", pinned.exitCode, 0);
      TestValidator.equals("pinned reviews diagnostics", codes(pinned), []);

      // A warning claim may own a clean citation but cannot absorb another claim's error.
      await EvidenceTestFileSystem.save(directory, {
        "evidence.json": configuration(false, "warning"),
        "docs/a.md": document(
          "rules/obligations.md#o1",
          "rules/principles.md#p1",
        ),
      });
      const lowered: IEvidenceCheckReport = await EvidenceChecker.check(config);
      TestValidator.equals("warning claim exit", lowered.exitCode, 0);
      TestValidator.equals("warning claim diagnostics", codes(lowered), []);
      await EvidenceTestFileSystem.save(directory, {
        "docs/a.md": document(
          "rules/obligations.md#o1",
          "rules/principles.md#p9",
        ),
      });
      const downgraded: IEvidenceCheckReport =
        await EvidenceChecker.check(config);
      TestValidator.equals(
        "warning claim keeps the error claim's own finding",
        codes(downgraded),
        [
          "0:target-missing-file",
          "1:graph-checklist-missing",
          "1:target-missing-member",
        ],
      );
      TestValidator.equals(
        "warning claim mistype exit",
        downgraded.exitCode,
        1,
      );
      await EvidenceTestFileSystem.save(directory, {
        "docs/a.md": document(
          "rules/obligations.md#o9",
          "rules/principles.md#p1",
        ),
      });
      const owned: IEvidenceCheckReport = await EvidenceChecker.check(config);
      TestValidator.equals(
        "error claim owns its mistyped anchor",
        codes(owned),
        ["0:graph-missing-acknowledgement", "0:target-missing-member"],
      );
      TestValidator.equals("error claim mistype exit", owned.exitCode, 1);
    },
  );
}

/**
 * Builds the two-claim layout over the same document files.
 *
 * The file claim answers the obligations rule file and the H2 claim answers the
 * principles rule file. `requireReview` applies to both references, and
 * `principles` sets the severity of the H2 claim.
 */
function configuration(
  requireReview: boolean,
  principles: "error" | "warning" = "error",
): string {
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
          ...(requireReview ? { requireReview: true } : {}),
        },
      },
      {
        name: "h2 answers principles",
        severity: principles,
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
 * `head` lines follow the file-level tag, where a review of the file citation
 * belongs. `extra` lines follow the H2 tag inside the same section, which is
 * where a review of the H2 citation belongs.
 */
function document(
  file: string,
  h2: string,
  head: string[] = [],
  extra: string[] = [],
): string {
  return [
    `<!-- @evidence ${file} The file answers its obligation once. -->`,
    ...head,
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
