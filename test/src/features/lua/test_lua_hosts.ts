import { EvidenceFingerprint, EvidenceLuaAdapter } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Attaches LuaDoc at original UTF-16 coordinates and keeps inert carriers out.
 *
 * Declaration-owned LuaDoc can acknowledge units while examples and detached
 * comments cannot.
 *
 * 1. Analyze coordinate-sensitive LuaDoc. 2. Compare attached hosts and ranges. 3.
 *    Reject examples and detached annotations.
 */
export async function test_lua_hosts(): Promise<void> {
  const content = dedent`
    --- 한글 📘
    --- @evidence spec.md#run Covers the run requirement.
    --- \`\`\`lua
    --- @evidence spec.md#example A fenced example is inert.
    --- \`\`\`
    function run() return 1 end
    --[=[
    @internal Hidden table and descendants.
    ]=]
    local hidden = { child = 1 }
    return { hidden = hidden }
  `.replaceAll("\n", "\r\n");
  const adapter = new EvidenceLuaAdapter();
  const inventory = await adapter.analyze(
    EvidenceTestSourceSnapshot.create("source.lua", content),
  );

  TestValidator.equals(
    "documentation parsing succeeds",
    inventory.diagnostics,
    [],
  );
  TestValidator.equals(
    "fence creates no acknowledgement",
    inventory.declarations.map((declaration) => declaration.target),
    ["spec.md#run"],
  );
  const declaration = inventory.declarations[0];
  if (declaration === undefined || declaration.location.range === undefined)
    throw new Error("Attached annotation range is missing.");
  TestValidator.equals(
    "original UTF-16 annotation offset",
    declaration.location.range.start.offset,
    content.indexOf("@evidence spec.md#run"),
  );
  const hidden = inventory.units.find((unit) => unit.name === "hidden");
  if (hidden === undefined) throw new Error("Hidden table is missing.");
  TestValidator.equals(
    "long documentation withdraws owner",
    hidden.withdrawals.map((withdrawal) => withdrawal.tag),
    ["internal"],
  );
  TestValidator.equals(
    "withdrawn descendants have no eligible hosts",
    inventory.hosts.flatMap((host) => host.unitIds).length,
    2,
  );
  const fn = inventory.units.find((unit) => unit.name === "run");
  if (fn === undefined) throw new Error("Public function is missing.");
  const normalized = await adapter.analyze(
    EvidenceTestSourceSnapshot.create(
      "source.lua",
      content.replaceAll("\r\n", "\n"),
    ),
  );
  TestValidator.equals(
    "CRLF semantic fingerprints are stable",
    EvidenceFingerprint.inspect(inventory, fn.id).fingerprint,
    EvidenceFingerprint.inspect(normalized, fn.id).fingerprint,
  );
  const unsupported = await adapter.analyze(
    EvidenceTestSourceSnapshot.create(
      "source.lua",
      dedent`
    --- @evidence spec.md#private Private documentation cannot claim coverage.
    local function hidden() end
    -- @evidence spec.md#ordinary Ordinary comment is not LuaDoc.
    function publicFunction() return "@evidence spec.md#string A string cannot claim coverage." end
  `,
    ),
  );
  TestValidator.equals(
    "unsupported carriers cannot acknowledge",
    unsupported.declarations,
    [],
  );
  TestValidator.equals(
    "unsupported carriers are diagnosed",
    unsupported.diagnostics.map((diagnostic) => diagnostic.code),
    ["unsupported-annotation-host", "unsupported-annotation-host"],
  );
  const unsupportedSource = unsupported.sources[0];
  if (unsupportedSource === undefined)
    throw new Error("Unsupported carrier source is missing.");
  const changedLiteral = await adapter.analyze(
    EvidenceTestSourceSnapshot.create(
      "source.lua",
      unsupportedSource.content.replace(
        "A string cannot claim coverage.",
        "A different runtime string.",
      ),
    ),
  );
  const publicFunction = unsupported.units.find(
    (unit) => unit.name === "publicFunction",
  );
  if (publicFunction === undefined)
    throw new Error("Public string-returning function is missing.");
  TestValidator.notEquals(
    "tag-shaped strings remain semantic content",
    EvidenceFingerprint.inspect(unsupported, publicFunction.id).fingerprint,
    EvidenceFingerprint.inspect(changedLiteral, publicFunction.id).fingerprint,
  );
}
