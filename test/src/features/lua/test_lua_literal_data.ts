import { EvidenceLuaAdapter } from "@wrtnlabs/evidence";
import { assertEvidenceLiteralData } from "../../internal/assertEvidenceLiteralData";
import type { IEvidenceLiteralFixture } from "../../internal/IEvidenceLiteralFixture";

/**
 * Preserves Lua expression strings as implementation data.
 *
 * Tag-shaped literal content must retain the public denominator and participate
 * in review fingerprints while independently attached documentation still
 * works.
 *
 * 1. Exercise the language's selected literal carriers with every annotation
 *    category, escaped quotes, multiline prefixes and CRLF content.
 * 2. Require unchanged identities, hosts, addresses and withdrawals with no
 *    annotations, reviews, additional accepted ranges or diagnostics.
 * 3. Attach real documentation and require its acknowledgement alone; edit literal
 *    data independently and require a changed owner fingerprint.
 */
export async function test_lua_literal_data(): Promise<void> {
  const fixtures: IEvidenceLiteralFixture[] = [
    {
      adapter: new EvidenceLuaAdapter(),
      file: "escaped.lua",
      source: (data: string, doc: string): string =>
        `${doc === "" ? "" : `--- ${doc}\n`}Value = ${JSON.stringify(data)}\n`,
    },
    {
      adapter: new EvidenceLuaAdapter(),
      file: "delimited.lua",
      source: (data: string, doc: string): string =>
        `${doc === "" ? "" : `--- ${doc}\n`}Value = [==[${data}]==]\n`,
    },
    {
      adapter: new EvidenceLuaAdapter(),
      file: "data.lua",
      source: (data: string, doc: string): string =>
        `${doc === "" ? "" : `--- ${doc}\n`}Value = [[${data}]]\n`,
    },
  ];
  await assertEvidenceLiteralData(fixtures);
}
