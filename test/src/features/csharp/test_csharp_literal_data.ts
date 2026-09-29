import { EvidenceCSharpAdapter } from "@wrtnlabs/evidence";
import { assertEvidenceLiteralData } from "../../internal/assertEvidenceLiteralData";
import type { IEvidenceLiteralFixture } from "../../internal/IEvidenceLiteralFixture";

/**
 * Preserves CSharp expression strings as implementation data.
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
export async function test_csharp_literal_data(): Promise<void> {
  const fixtures: IEvidenceLiteralFixture[] = [
    {
      adapter: new EvidenceCSharpAdapter(),
      file: "Data.cs",
      source: (data: string, doc: string): string =>
        `public class Data {\n${doc === "" ? "" : `/// ${doc}\n`}public string Value = ${JSON.stringify(data)};\n}\n`,
    },
    {
      adapter: new EvidenceCSharpAdapter(),
      file: "Raw.cs",
      source: (data: string, doc: string): string =>
        `public class Raw {\n${doc === "" ? "" : `/// ${doc}\n`}public string Value = @"${data.replaceAll('"', '""')}";\n}\n`,
    },
    {
      adapter: new EvidenceCSharpAdapter(),
      file: "Literal.cs",
      source: (data: string, doc: string): string =>
        `public class Literal {\n${doc === "" ? "" : `/// ${doc}\n`}public string Value = """\n${data}\n""";\n}\n`,
    },
    {
      adapter: new EvidenceCSharpAdapter(),
      file: "Interpolated.cs",
      source: (data: string, doc: string): string =>
        `public class Interpolated {\n${doc === "" ? "" : `/// ${doc}\n`}public string Value = $@"${data.replaceAll('"', '""')}";\n}\n`,
    },
  ];
  await assertEvidenceLiteralData(fixtures);
}
