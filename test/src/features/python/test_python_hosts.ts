import { EvidencePythonAdapter } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Attaches evidence from valid Python docstring and comment hosts.
 *
 * The source mixes ordinary and concatenated docstrings, decorator-adjacent
 * comments, assigned strings, f-strings, and detached comments to distinguish
 * documentation carriers from lookalikes.
 *
 * 1. Analyze the mixed host fixture.
 * 2. Verify only ordinary, concatenated, and decorator-adjacent documentation
 *    produces declarations and their expected hosts.
 * 3. Verify assigned strings, f-strings, and detached comments do not acknowledge
 *    declarations; only the detached comment produces a host diagnostic.
 */
export async function test_python_hosts(): Promise<void> {
  const inventory = await new EvidencePythonAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "src/hosts.py",
      dedent`
        def documented():
            """
            @evidence docs/requirements.md#documented Implements the documented requirement.
            """
            return None

        def concatenated():
            """@evidence docs/requirements.md#concatenated Implements""" """ the concatenated requirement."""
            return None

        # Decorator-adjacent documentation remains attached to the definition.
        # @evidence docs/requirements.md#decorated Implements the decorated requirement.
        @trace
        async def decorated():
            return None

        def arbitrary():
            value = """
            @evidence docs/requirements.md#wrong This is only an assigned string.
            """
            return value

        def f_literal():
            f"""@evidence docs/requirements.md#wrong-f An f-string is not a docstring."""
            return None

        # @evidence docs/requirements.md#detached This comment is detached.

        def detached():
            return None
      `,
    ),
  );

  TestValidator.equals(
    "Python attached declarations",
    inventory.declarations
      .map((declaration) => declaration.target)
      .sort(compare),
    [
      "docs/requirements.md#concatenated",
      "docs/requirements.md#decorated",
      "docs/requirements.md#documented",
    ],
  );
  TestValidator.equals(
    "Python attached host units",
    inventory.hosts
      .filter((host) => host.attachment === "attached")
      .flatMap((host) => host.unitIds)
      .flatMap((unitId) => {
        const unit = inventory.units.find(
          (candidate) => candidate.id === unitId,
        );
        return unit === undefined ? [] : [unit.name];
      })
      .sort(compare),
    [
      "arbitrary",
      "concatenated",
      "decorated",
      "detached",
      "documented",
      "f_literal",
    ],
  );

  // The detached comment remains a failure; assigned strings and f-strings are data.
  TestValidator.equals(
    "unsupported Python annotation count",
    inventory.diagnostics.filter(
      (diagnostic) => diagnostic.code === "unsupported-annotation-host",
    ).length,
    1,
  );
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
