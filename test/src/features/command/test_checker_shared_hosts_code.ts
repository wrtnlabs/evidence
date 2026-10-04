import { EvidenceChecker } from "@wrtnlabs/evidence";
import type {
  IEvidenceCheckReport,
  IEvidenceDiagnostic,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Lets claims that select the same code hosts own only their own citations.
 *
 * Shared hosts are not specific to Markdown. Two TypeScript claims over the
 * same host files cite different TypeScript references, and two more claims
 * cite different Prisma schemas. Each claim reads every annotation, so a claim
 * must ignore a citation that only another claim's reference contains, while a
 * citation that no claim accepts must still fail.
 *
 * 1. Check TypeScript claims whose hosts cite `src/a.ts` and `src/b.ts`
 *    respectively and require exit 0 with no diagnostic.
 * 2. Remove both citations and require each claim to report only its own missing
 *    acknowledgement.
 * 3. Cite an existing file that no reference selects, then a file that does not
 *    exist; both claims must report each citation, because no claim accepts
 *    it.
 * 4. Check Prisma claims over two schemas, each host citing a model of one schema,
 *    and require exit 0 with no diagnostic.
 * 5. Mistype a Prisma model so that neither schema contains it and require both
 *    claims to report the missing member instead of letting either claim own
 *    it.
 */
export async function test_checker_shared_hosts_code(): Promise<void> {
  const location = join(__dirname, `shared hosts code ${randomUUID()}`);
  await EvidenceTestFileSystem.experiment(
    location,
    {
      "evidence.json": typescriptConfiguration(),
      "src/a.ts": "export function a(): void {}\n",
      "src/b.ts": "export function b(): void {}\n",
      "src/c.ts": "export function c(): void {}\n",
      "hosts/host.ts": hosts("../src/a.ts#a", "../src/b.ts#b"),
    },
    async (directory: string): Promise<void> => {
      const config: string = join(directory, "evidence.json");

      // Each host cites the reference of one claim and is read by both.
      const passing: IEvidenceCheckReport = await EvidenceChecker.check(config);
      TestValidator.equals("typescript shared hosts exit", passing.exitCode, 0);
      TestValidator.equals(
        "typescript shared hosts covered units",
        passing.counts.coveredUnits,
        2,
      );
      TestValidator.equals(
        "typescript shared hosts diagnostics",
        codes(passing),
        [],
      );

      // Without citations each owner reports coverage, never a foreign target.
      await EvidenceTestFileSystem.save(directory, {
        "hosts/host.ts": dedent`
          export function hostA(): void {}

          export function hostB(): void {}
        `,
      });
      TestValidator.equals(
        "uncited typescript claims report their own gaps",
        codes(await EvidenceChecker.check(config)),
        ["0:graph-missing-acknowledgement", "1:graph-missing-acknowledgement"],
      );

      // An unselected existing file and a missing file are accepted by no claim.
      await EvidenceTestFileSystem.save(directory, {
        "hosts/host.ts": hosts("../src/c.ts#c", "../src/b.ts#b"),
      });
      TestValidator.equals(
        "unselected typescript file is reported by every claim",
        codes(await EvidenceChecker.check(config)),
        [
          "0:graph-missing-acknowledgement",
          "0:target-out-of-population",
          "1:target-out-of-population",
        ],
      );
      await EvidenceTestFileSystem.save(directory, {
        "hosts/host.ts": hosts("../src/d.ts#d", "../src/b.ts#b"),
      });
      TestValidator.equals(
        "missing typescript file is reported by every claim",
        codes(await EvidenceChecker.check(config)),
        [
          "0:graph-missing-acknowledgement",
          "0:target-missing-file",
          "1:target-missing-file",
        ],
      );

      // Prisma names carry no file, so each schema decides whether it owns one.
      await EvidenceTestFileSystem.save(directory, {
        "evidence.json": prismaConfiguration(),
        "prisma/a.prisma": schema("Sale"),
        "prisma/b.prisma": schema("Order"),
        "hosts/host.ts": hosts("prisma:Sale", "prisma:Order"),
      });
      const prisma: IEvidenceCheckReport = await EvidenceChecker.check(config);
      TestValidator.equals("prisma shared hosts exit", prisma.exitCode, 0);
      TestValidator.equals(
        "prisma shared hosts diagnostics",
        codes(prisma),
        [],
      );

      // A model in neither schema ties at the same level, so both claims keep it.
      await EvidenceTestFileSystem.save(directory, {
        "hosts/host.ts": hosts("prisma:Salee", "prisma:Order"),
      });
      TestValidator.equals(
        "mistyped prisma model is reported by every claim",
        codes(await EvidenceChecker.check(config)),
        [
          "0:graph-missing-acknowledgement",
          "0:target-missing-member",
          "1:target-missing-member",
        ],
      );
    },
  );
}

/** Declares two TypeScript claims over `hosts/*.ts`, one reference file each. */
function typescriptConfiguration(): string {
  return JSON.stringify({
    claims: ["a", "b"].map((name: string) => ({
      name,
      type: "typescript",
      files: ["hosts/*.ts"],
      symbol: "function",
      reference: {
        type: "typescript",
        files: [`src/${name}.ts`],
        symbol: "function",
      },
    })),
  });
}

/** Declares two TypeScript claims over `hosts/*.ts`, one Prisma schema each. */
function prismaConfiguration(): string {
  return JSON.stringify({
    claims: ["a", "b"].map((name: string) => ({
      name,
      type: "typescript",
      files: ["hosts/*.ts"],
      symbol: "function",
      reference: {
        type: "prisma",
        files: [`prisma/${name}.prisma`],
        symbol: "model",
      },
    })),
  });
}

/** Writes two hosts whose tags cite the given targets of either family. */
function hosts(first: string, second: string): string {
  return dedent`
    /** @evidence ${first} The first host covers its function. */
    export function hostA(): void {}

    /** @evidence ${second} The second host covers its function. */
    export function hostB(): void {}
  `;
}

/** Writes a Prisma schema with one model of the given name. */
function schema(model: string): string {
  return dedent`
    model ${model} {
      id Int @id
    }
  `;
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
