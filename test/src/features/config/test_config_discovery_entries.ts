import { EvidenceConfigLoader, EvidenceCommand } from "@wrtnlabs/evidence";
import type {
  IEvidenceConfigPlan,
  IEvidenceCommandResult,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import assert from "node:assert/strict";
import { mkdir, symlink, unlink, chmod } from "node:fs/promises";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Limits fallback to absent entries and preserves physical configuration roots.
 *
 * A preferred directory or broken link must not switch policy to JSON. Existing
 * symlink and supported-format behavior must agree for discovery and
 * overrides.
 *
 * 1. Reject preferred TS and selected JSON directories even with valid
 *    alternatives.
 * 2. Reject broken TS junctions with valid JSON, then remove the entry and
 *    recover.
 * 3. Resolve a conventional link to a real JSON config and anchor relative roots
 *    to its physical directory; reject links to unsupported formats.
 * 4. On POSIX, reject unreadable TS and JSON entries without fallback; restore
 *    access and recover. Windows exercises file-kind and junction failures.
 */
export async function test_config_discovery_entries(): Promise<void> {
  const config: string = JSON.stringify({
    claims: [
      {
        type: "markdown",
        files: ["source.md"],
        symbol: "h1",
        reference: { type: "markdown", files: ["target.md"], symbol: "h1" },
      },
    ],
  });
  await EvidenceTestFileSystem.experiment(
    "discovery-entries",
    {
      "project/evidence.config.json": config,
      "physical/evidence.config.json": config,
      "physical/source.md":
        "# Source\n<!-- @evidence target.md#target Implements the target. -->\n",
      "physical/target.md": "# Target\n",
      "physical/config.yaml": config,
    },
    async (directory: string): Promise<void> => {
      const project: string = join(directory, "project");
      const ts: string = join(project, "evidence.config.ts");
      const json: string = join(project, "evidence.config.json");
      await mkdir(ts);
      await assert.rejects(
        (): Promise<string> => EvidenceConfigLoader.locate(undefined, project),
        /must be a file/u,
      );
      TestValidator.equals(
        "preferred directory CLI failure",
        (await EvidenceCommand.run(["--format", "json"], project)).exitCode,
        2,
      );
      await EvidenceTestFileSystem.erase(ts);
      await symlink(
        join(directory, "missing"),
        ts,
        process.platform === "win32" ? "junction" : "dir",
      );
      await assert.rejects((): Promise<string> =>
        EvidenceConfigLoader.locate(undefined, project),
      );
      await unlink(ts);
      TestValidator.equals(
        "entry removal recovers JSON",
        await EvidenceConfigLoader.locate(undefined, project),
        json,
      );
      await unlink(json);
      await mkdir(json);
      await assert.rejects(
        (): Promise<string> => EvidenceConfigLoader.locate(undefined, project),
        /must be a file/u,
      );
      await EvidenceTestFileSystem.erase(json);

      // Directory links need no Windows file-symlink privilege and still exercise
      // the loader's realpath and physical-root behavior.
      const linked: string = join(directory, "linked");
      await symlink(
        join(directory, "physical"),
        linked,
        process.platform === "win32" ? "junction" : "dir",
      );
      const selected: string = await EvidenceConfigLoader.locate(
        undefined,
        linked,
      );
      TestValidator.equals(
        "linked directory uses physical config",
        selected,
        join(directory, "physical", "evidence.config.json"),
      );
      const plan: IEvidenceConfigPlan =
        await EvidenceConfigLoader.plan(selected);
      TestValidator.equals(
        "linked plan physical anchor",
        plan.configFile,
        selected,
      );
      const result: IEvidenceCommandResult = await EvidenceCommand.run(
        ["--format", "json"],
        linked,
      );
      TestValidator.equals(
        "physical roots find covered sources",
        result.exitCode,
        0,
      );
      await assert.rejects(
        (): Promise<string> =>
          EvidenceConfigLoader.locate("config.yaml", linked),
        /configuration extension/u,
      );

      if (process.platform !== "win32") {
        await EvidenceTestFileSystem.save(project, {
          "evidence.config.json": config,
        });
        await symlink(join(directory, "missing.ts"), ts, "file");
        await assert.rejects((): Promise<string> =>
          EvidenceConfigLoader.locate(undefined, project),
        );
        await unlink(ts);
        await symlink(join(directory, "physical", "config.yaml"), ts, "file");
        await assert.rejects(
          (): Promise<string> =>
            EvidenceConfigLoader.locate(undefined, project),
          /configuration extension/u,
        );
        await unlink(ts);
        await symlink(
          join(directory, "physical", "evidence.config.json"),
          ts,
          "file",
        );
        TestValidator.equals(
          "file symlink retains supported physical format",
          await EvidenceConfigLoader.locate(undefined, project),
          selected,
        );
        TestValidator.equals(
          "file symlink retains physical roots",
          (await EvidenceCommand.run(["--format", "json"], project)).exitCode,
          0,
        );
        await unlink(ts);
      }

      if (process.platform !== "win32" && process.getuid?.() !== 0) {
        await EvidenceTestFileSystem.save(project, {
          "evidence.config.ts": `export default ${config};`,
          "evidence.config.json": config,
        });
        await chmod(ts, 0);
        try {
          const preferred: string = await EvidenceConfigLoader.locate(
            undefined,
            project,
          );
          TestValidator.equals("unreadable TS stays preferred", preferred, ts);
          await assert.rejects(
            (): Promise<IEvidenceConfigPlan> =>
              EvidenceConfigLoader.plan(preferred),
            /EACCES/u,
          );
        } finally {
          await chmod(ts, 0o600);
        }
        await unlink(ts);
        await chmod(json, 0);
        try {
          const preferred: string = await EvidenceConfigLoader.locate(
            undefined,
            project,
          );
          await assert.rejects(
            (): Promise<IEvidenceConfigPlan> =>
              EvidenceConfigLoader.plan(preferred),
            /EACCES/u,
          );
        } finally {
          await chmod(json, 0o600);
        }
        await EvidenceConfigLoader.plan(
          await EvidenceConfigLoader.locate(undefined, project),
        );
      }
    },
  );
}
