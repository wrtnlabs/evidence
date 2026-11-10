import { EvidenceMarkdownTarget } from "../markdown/EvidenceMarkdownTarget";
import type { IEvidenceAddress } from "../../structures/IEvidenceAddress";
import { EvidenceDelimitedSyntax } from "./EvidenceDelimitedSyntax";

/**
 * Parses one CSV or TSV target: a root-relative path and an optional row key.
 *
 * Paths follow the Markdown rule, relative to the reference root with portable
 * separators and no leading `./`. The key after `#` stays one literal segment,
 * so a composite `crm:sales` is never split into accessor parts.
 *
 * @example
 *   EvidenceDelimitedTarget.parse("data/links.csv#crm:sales");
 *   // { file: "data/links.csv", segments: ["crm:sales"] }
 *
 * @evidence contracts/common.md#principled-implementation The Markdown root-relative path normalization is reused and the text after the first '#' is kept as one key segment validated by the shared key rule.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns ledger target spelling; resolution maps it to selected files.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts A key the adapter could never materialize is reported as malformed instead of missing.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains path and key rules with an example.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource.
 */
export namespace EvidenceDelimitedTarget {
  /**
   * Splits a ledger target into its root-relative file and row key.
   *
   * A target without `#` cites the file aggregate. A trailing `#`, an empty
   * path, or a key the adapter would reject throws with the correct spelling.
   * Composite parts are not re-validated here because the target does not know
   * how many key columns its population uses.
   *
   * @evidence contracts/common.md#principled-implementation The first '#' separates the normalized path from one literal key segment checked by EvidenceDelimitedSyntax.keyProblem.
   * @evidence contracts/common.md#clear-and-simple-design Path normalization is delegated to EvidenceMarkdownTarget.normalize.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts A trailing '#' or invalid key throws instead of citing the file by accident.
   * @evidence contracts/common.md#meaningful-documentation The comment states the aggregate form and each failure.
   * @evidence contracts/performance.md#efficient-algorithms Linear in target length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each target is parsed once per resolution.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning.
   */
  export function parse(target: string): IEvidenceAddress {
    const hash: number = target.indexOf("#");
    if (hash === target.length - 1)
      throw new Error(
        "Name a row key after '#', or omit '#' when citing every row of the file.",
      );
    const file: string = EvidenceMarkdownTarget.normalize(
      hash < 0 ? target : target.slice(0, hash),
    );
    if (file === "") throw new Error("Name the CSV or TSV file before '#'.");
    if (hash < 0) return { file, segments: [] };
    const key: string = target.slice(hash + 1);
    const problem: string | undefined = EvidenceDelimitedSyntax.keyProblem(
      key,
      false,
    );
    if (problem !== undefined) throw new Error(problem);
    return { file, segments: [key] };
  }
}
