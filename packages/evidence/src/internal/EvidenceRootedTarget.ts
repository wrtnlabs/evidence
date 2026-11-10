import { EvidenceDelimitedSyntax } from "../adapters/delimited/EvidenceDelimitedSyntax";
import { EvidenceDelimitedTarget } from "../adapters/delimited/EvidenceDelimitedTarget";
import { EvidenceMarkdownTarget } from "../adapters/markdown/EvidenceMarkdownTarget";
import type { IEvidenceAddress } from "../structures/IEvidenceAddress";
import type { EvidenceArtifactType } from "../typings/EvidenceArtifactType";
import type { EvidenceDelimitedType } from "../typings/EvidenceDelimitedType";

/**
 * Target grammar shared by document artifacts addressed from a reference root.
 *
 * Markdown, CSV, and TSV targets name a path relative to the reference root,
 * optionally followed by `#` and one literal segment: a heading anchor or a row
 * key. Resolution, affinity scoring, query rendering, and detached H1 owners
 * use this one boundary so the three artifacts follow the same path rules while
 * keeping their own segment checks.
 *
 * @evidence contracts/common.md#principled-implementation Root-relative path plus one literal segment is the common grammar; each artifact keeps its own parser for the segment rules.
 * @evidence contracts/common.md#clear-and-simple-design Consumers branch once on is() and delegate parsing, labels and extension signals here instead of repeating per-artifact cases.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Only artifacts whose adapters publish root-relative addresses are rooted; programming targets keep file-relative resolution.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains the shared grammar and its consumers; every export is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource.
 */
export namespace EvidenceRootedTarget {
  /**
   * Narrows an artifact type to one addressed from its reference root.
   *
   * @evidence contracts/common.md#principled-implementation Markdown and the delimited dialects are exactly the adapters that publish root-relative addresses.
   * @evidence contracts/common.md#clear-and-simple-design The delimited membership test is delegated to EvidenceDelimitedSyntax.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts An undefined or mixed type is not rooted, so no grammar is guessed.
   * @evidence contracts/common.md#meaningful-documentation The comment states what the guard narrows.
   * @evidence contracts/performance.md#efficient-algorithms Three string comparisons.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work The comparison is cheaper than any cache.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The guard keeps no state after returning.
   */
  export function is(
    type: EvidenceArtifactType | undefined,
  ): type is "markdown" | EvidenceDelimitedType {
    return type === "markdown" || EvidenceDelimitedSyntax.is(type);
  }

  /**
   * Parses a target with the segment rules of its artifact.
   *
   * @evidence contracts/common.md#principled-implementation Markdown anchors and row keys each go through their own parser, which share root-relative path normalization.
   * @evidence contracts/common.md#clear-and-simple-design The function only dispatches.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Each parser throws its own repair for malformed spellings.
   * @evidence contracts/common.md#meaningful-documentation The comment states the dispatch.
   * @evidence contracts/performance.md#efficient-algorithms Linear in target length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each target is parsed once per resolution.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning.
   */
  export function parse(
    type: "markdown" | EvidenceDelimitedType,
    target: string,
  ): IEvidenceAddress {
    return type === "markdown"
      ? EvidenceMarkdownTarget.parse(target)
      : EvidenceDelimitedTarget.parse(target);
  }

  /**
   * Returns the artifact's display name for diagnostics.
   *
   * @evidence contracts/common.md#principled-implementation Markdown keeps its name; delimited dialects use their uppercase names.
   * @evidence contracts/common.md#clear-and-simple-design One mapping serves every rooted diagnostic.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts The name depends only on the type.
   * @evidence contracts/common.md#meaningful-documentation The comment states the purpose.
   * @evidence contracts/performance.md#efficient-algorithms Constant time.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work The mapping is cheaper than any cache.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning.
   */
  export function label(type: "markdown" | EvidenceDelimitedType): string {
    return type === "markdown"
      ? "Markdown"
      : EvidenceDelimitedSyntax.label(type);
  }

  /**
   * Tests whether a path uses the artifact's conventional extension.
   *
   * Applicability uses this as a weak signal when no selected file matches
   * exactly; it never decides how a selected file is parsed.
   *
   * @evidence contracts/common.md#principled-implementation Each artifact's registered extensions are matched case-insensitively at the end of the path.
   * @evidence contracts/common.md#clear-and-simple-design Extension knowledge for rooted artifacts lives here once.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts The result only scores affinity; parsing always follows the configured type.
   * @evidence contracts/common.md#meaningful-documentation The comment states that the signal is weak and why.
   * @evidence contracts/performance.md#efficient-algorithms One anchored regular expression per call.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work The test is cheaper than any cache.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning.
   */
  export function conventional(
    type: "markdown" | EvidenceDelimitedType,
    file: string,
  ): boolean {
    return type === "markdown"
      ? /\.(?:md|markdown|mdx)$/iu.test(file)
      : type === "csv"
        ? /\.csv$/iu.test(file)
        : /\.tsv$/iu.test(file);
  }
}
