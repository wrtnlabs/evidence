import { EvidencePythonAdapter } from "@wrtnlabs/evidence";
import { assertEvidenceLiteralData } from "../../internal/assertEvidenceLiteralData";
import type { IEvidenceLiteralFixture } from "../../internal/IEvidenceLiteralFixture";

/**
 * Preserves Python expression strings as implementation data.
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
export async function test_python_literal_data(): Promise<void> {
  const fixtures: IEvidenceLiteralFixture[] = [
    {
      adapter: new EvidencePythonAdapter(),
      file: "data.py",
      source: (data: string, doc: string): string =>
        `${doc === "" ? "" : `# ${doc}\n`}Value = ${JSON.stringify(data)}\n`,
    },
    {
      adapter: new EvidencePythonAdapter(),
      file: "raw.py",
      source: (data: string, doc: string): string =>
        `def Value():\n    """${doc === "" ? "Documented function." : doc}"""\n    return r"""${data}"""\n`,
    },
    {
      adapter: new EvidencePythonAdapter(),
      file: "formatted.py",
      source: (data: string, doc: string): string =>
        `${doc === "" ? "" : `# ${doc}\n`}Value = f${JSON.stringify(data)}\n`,
    },
  ];
  await assertEvidenceLiteralData(fixtures);
}
