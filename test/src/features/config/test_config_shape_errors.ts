import { TestValidator } from "@nestia/e2e";
import { EvidenceConfigLoader } from "@wrtnlabs/evidence";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Reports every configuration shape violation, for JSON and TypeScript alike.
 *
 * A value that disagrees with the declared configuration type must reject
 * loading instead of flowing into the graph, and one rejection should name all
 * offending locations so an author can repair them together.
 *
 * 1. Load a JSON configuration with two independently mistyped fields and require
 *    both locations in the single rejection.
 * 2. Load the same mistakes from a TypeScript configuration, which type-checks
 *    only because the default export is cast, and require the same locations.
 * 3. Load a well-formed configuration and require it to be accepted.
 */
export async function test_config_shape_errors(): Promise<void> {
  const invalid = {
    severity: 3,
    claims: [
      {
        type: "markdown",
        files: "source.md",
        reference: { type: "markdown", files: ["target.md"] },
      },
    ],
  };
  const valid = {
    claims: [
      {
        type: "markdown",
        files: ["source.md"],
        reference: { type: "markdown", files: ["target.md"] },
      },
    ],
  };
  await EvidenceTestFileSystem.experiment(
    "config-shape-errors",
    {
      "invalid.json": JSON.stringify(invalid),
      "invalid.config.ts": `export default ${JSON.stringify(invalid)} as never;`,
      "valid.json": JSON.stringify(valid),
    },
    async (directory) => {
      for (const name of ["invalid.json", "invalid.config.ts"]) {
        let message: string | undefined;
        try {
          await EvidenceConfigLoader.load(join(directory, name));
        } catch (cause) {
          message = cause instanceof Error ? cause.message : String(cause);
        }
        TestValidator.predicate(
          `${name} reports every violation`,
          message !== undefined &&
            message.includes("severity") &&
            message.includes("claims[0].files"),
        );
      }
      await EvidenceConfigLoader.load(join(directory, "valid.json"));
    },
  );
}
