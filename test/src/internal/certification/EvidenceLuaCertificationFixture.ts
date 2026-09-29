import { EvidenceLuaAdapter } from "@wrtnlabs/evidence";
import { dedent } from "@typia/utils";

import type { IEvidenceAdapterCertification } from "./IEvidenceAdapterCertification";

/**
 * Supplies independent exact Lua expectations without inventing type
 * declarations.
 */
export namespace EvidenceLuaCertificationFixture {
  /** Builds a fresh Lua certification scenario. */
  export function create(): IEvidenceAdapterCertification {
    const file = "src/contract.lua";
    return {
      type: "lua",
      adapter: new EvidenceLuaAdapter(),
      sources: [
        {
          file,
          content: dedent`
      --- 계약 📘
      --- @evidence docs/requirements.md#module Implements the module.
      local M = {
        --- 실행
        --- @evidence docs/requirements.md#function Implements the certified function.
        run = function() return 1 end,
        --- 값
        --- @evidence docs/requirements.md#property Implements the property.
        value = 1,
        --- @internal Retired public contract.
        legacy = 0,
      }
      local hidden = 0
      return M
    `,
        },
      ],
      units: [
        {
          key: "property:module",
          symbol: "property",
          identity: ["module"],
          sites: 1,
          addresses: [{ file, accessor: "module" }],
          withdrawals: [],
        },
        {
          key: "function:module.run",
          symbol: "function",
          identity: ["module", "run"],
          parent: "property:module",
          sites: 1,
          addresses: [{ file, accessor: "module.run" }],
          withdrawals: [],
        },
        {
          key: "property:module.value",
          symbol: "property",
          identity: ["module", "value"],
          parent: "property:module",
          sites: 1,
          addresses: [{ file, accessor: "module.value" }],
          withdrawals: [],
        },
        {
          key: "property:module.legacy",
          symbol: "property",
          identity: ["module", "legacy"],
          parent: "property:module",
          sites: 1,
          addresses: [{ file, accessor: "module.legacy" }],
          withdrawals: ["internal"],
        },
      ],
      hosts: [
        "property:module",
        "function:module.run",
        "property:module.value",
      ].map((unit) => ({ attachment: "attached", units: [unit] })),
      requirements: [
        { unit: "property:module", target: "docs/requirements.md#module" },
        {
          unit: "function:module.run",
          target: "docs/requirements.md#function",
        },
        {
          unit: "property:module.value",
          target: "docs/requirements.md#property",
        },
      ],
      excludedUnits: ["property:hidden"],
      annotationRanges: 4,
      incomplete: {
        sources: [
          { file, content: "local M = {}\nsetmetatable(M, {})\nreturn M\n" },
        ],
        diagnosticCodes: ["lua-dynamic-surface"],
      },
      malformed: {
        sources: [{ file, content: "function broken( end\n" }],
        diagnosticCodes: ["lua-parse-incomplete"],
      },
      falsePositive: {
        source: {
          file,
          content: dedent`
        --- @evidence docs/requirements.md#attached Attached documentation.
        function run()
          -- @evidence docs/requirements.md#comment Body comments are inert.
          return "@evidence docs/requirements.md#literal Literal text is inert."
        end
      `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 1,
      },
      mutation: {
        unit: "function:module.run",
        reasonBefore: "Implements the certified function.",
        reasonAfter: "Explains the certified function differently.",
        contentBefore: "run = function() return 1 end",
        contentAfter: "run = function() return 2 end",
      },
    };
  }
}
