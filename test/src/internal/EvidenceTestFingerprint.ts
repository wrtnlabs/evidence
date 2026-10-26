import { createHash } from "node:crypto";
import type { EvidenceSymbol } from "@wrtnlabs/evidence";

/** Computes the specified v2 frame for one explicit, annotation-free unit. */
export namespace EvidenceTestFingerprint {
  /**
   * Hashes independently authored portable identity and normalized content.
   *
   * Callers supply the expected semantic text and identity directly; this
   * oracle performs no inventory normalization, token replacement or range
   * extraction.
   */
  export function single(
    identity: string,
    symbol: EvidenceSymbol,
    content: string,
  ): string {
    const contentDigest: string = createHash("sha256")
      .update(content)
      .digest("hex");
    return createHash("sha256")
      .update(
        `evidence:fingerprint:2\0${identity}\0${symbol}\0${contentDigest}\0`,
      )
      .digest("hex")
      .slice(0, 7);
  }
}
