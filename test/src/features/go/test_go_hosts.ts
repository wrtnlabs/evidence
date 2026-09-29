import { EvidenceGoAdapter, EvidenceInventory } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Attaches Go group, specification, field, and method documentation.
 *
 * Declaration documentation can host evidence while non-document carriers
 * remain diagnostics.
 *
 * 1. Analyze supported Go doc positions.
 * 2. Compare attached hosts.
 * 3. Reject misplaced comment annotations and ignore literal data.
 */
export async function test_go_hosts(): Promise<void> {
  const inventory = await new EvidenceGoAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "shop/hosts.go",
      dedent`
        package shop

        // Group values implement one requirement together.
        // @evidence docs/requirements.md#group Implements the grouped values.
        const (
            // @evidence docs/requirements.md#version Implements the version.
            Version = 1
            Name = "shop"
        )

        /*
         * @evidence docs/requirements.md#record Implements the record.
         */
        type Record struct {
            // @evidence docs/requirements.md#field Implements the field.
            Value int
        }

        // @evidence docs/requirements.md#method Implements the method.
        func (Record) Run() {}

        // @evidence docs/requirements.md#detached This is detached.

        func Detached() {}

        func Unsupported() {
            // @evidence docs/requirements.md#body Function-body comments are unsupported.
            _ = "@evidence docs/requirements.md#string Interpreted strings are unsupported."
            _ = ${"`"}@evidence docs/requirements.md#raw Raw strings are unsupported.${"`"}
        }

        // @evidence docs/requirements.md#commented Commented declarations are unsupported.
        // func Commented() {}
      `,
    ),
  );

  TestValidator.equals(
    "Go attached declarations",
    inventory.declarations
      .map((declaration) => declaration.target)
      .sort(compare),
    [
      "docs/requirements.md#field",
      "docs/requirements.md#group",
      "docs/requirements.md#method",
      "docs/requirements.md#record",
      "docs/requirements.md#version",
    ],
  );

  // One group comment owns both constants through their shared declaration site.
  const groupDeclaration = inventory.declarations.find(
    (declaration) => declaration.target === "docs/requirements.md#group",
  );
  if (groupDeclaration === undefined)
    throw new Error("Missing Go group evidence declaration.");
  const groupHost = inventory.hosts.find(
    (host) => host.id === groupDeclaration.hostId,
  );
  if (groupHost === undefined) throw new Error("Missing Go group host.");
  TestValidator.equals(
    "Go group host units",
    groupHost.unitIds
      .flatMap((unitId) => {
        const unit = inventory.units.find(
          (candidate) => candidate.id === unitId,
        );
        return unit === undefined ? [] : [unit.name];
      })
      .sort(compare),
    ["Name", "Version"],
  );

  // Detached comments, body comments and commented-out code remain diagnosable.
  TestValidator.equals(
    "unsupported Go annotation count",
    inventory.diagnostics.filter(
      (diagnostic) => diagnostic.code === "unsupported-annotation-host",
    ).length,
    3,
  );

  const withdrawn = await new EvidenceGoAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "shop/internal.go",
      dedent`
        package shop

        // @internal This type and its children are internal.
        type Hidden struct {
            Value int
        }
      ` + "\n",
    ),
  );
  const population = new EvidenceInventory([withdrawn]).select(
    withdrawn.units.map((unit) => unit.id),
  );
  TestValidator.equals(
    "withdrawn Go hierarchy",
    population.hidden.map((unit) => unit.identity.join(".")).sort(compare),
    ["Hidden", "Hidden.Value"],
  );
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
