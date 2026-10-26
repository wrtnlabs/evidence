import { createHash } from "node:crypto";
import type { ReadableStreamReadResult } from "node:stream/web";

import type { IEvidenceRemoteSwaggerSource } from "./IEvidenceRemoteSwaggerSource";

const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const REMOTE_TIMEOUT_MILLISECONDS = 30_000;

/**
 * Validates and reads explicitly configured HTTP(S) Swagger sources.
 *
 * Remote input is intentionally bounded before parsing so a configured URL
 * cannot turn schema discovery into an unbounded memory or time consumer.
 *
 * @evidence contracts/common.md#principled-implementation Remote sources must be HTTP(S) URLs without fragments, are read with a timeout and a byte limit enforced against both the declared length and the streamed count, and are digested before parsing.
 * @evidence contracts/common.md#clear-and-simple-design The namespace owns remote input and its redaction; parsing is the loader's.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Credentials and query values are redacted from labels and error messages, including malformed URL-like input.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains bounding; every function and helper is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceSwaggerRemoteReader {
  /**
   * Parses a configured remote source only when it has a URL scheme.
   *
   * Returning `undefined` leaves ordinary paths to the local-source loader;
   * explicit remote URLs must be HTTP(S) and cannot use fragments.
   *
   * @evidence contracts/common.md#principled-implementation A source with a URL scheme must parse as HTTP(S) without a fragment; other strings are left to the local loader.
   * @evidence contracts/common.md#clear-and-simple-design Parsing only classifies the source.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Unsupported schemes throw rather than being treated as paths.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the undefined result.
   * @evidence contracts/performance.md#efficient-algorithms Linear in source length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Each configured source is classified once.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function parse(source: string): URL | undefined {
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(source)) return undefined;
    const url = new URL(source);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error("Only HTTP(S) URLs can name a remote Swagger source.");
    if (url.hash !== "")
      throw new Error(
        "A remote Swagger document URL must not contain a fragment.",
      );
    return url;
  }

  /**
   * Reads one remote document and fingerprints the exact accepted bytes.
   *
   * The content-length preflight and streamed byte count enforce the same limit
   * when a server omits or lies about its response header.
   *
   * @evidence contracts/common.md#principled-implementation The response is fetched with a timeout, its declared length checked, its body streamed under the same byte cap, and the accepted bytes decoded and digested.
   * @evidence contracts/common.md#clear-and-simple-design Decoding and digesting are a private helper.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Oversized or lying responses are rejected before parsing.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the double size enforcement.
   * @evidence contracts/performance.md#efficient-algorithms Linear in response size, capped at sixteen MiB.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Remote documents are fetched on every load by design.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The stream is consumed or cancelled and the request is bounded by its timeout signal.
   */
  export async function read(url: URL): Promise<IEvidenceRemoteSwaggerSource> {
    const response: Response = await fetch(url, {
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MILLISECONDS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch((): void => {});
      throw new Error(
        `HTTP ${response.status} ${response.statusText === "" ? "response" : response.statusText}`,
      );
    }
    const declared: number = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) {
      await response.body?.cancel().catch((): void => {});
      throw new Error(
        `The Swagger document exceeds the ${MAX_DOCUMENT_BYTES} byte limit.`,
      );
    }
    if (response.body === null) return decode(new Uint8Array());
    const reader: ReadableStreamDefaultReader<Uint8Array> =
      response.body.getReader();
    try {
      const chunks: Uint8Array[] = [];
      let length: number = 0;
      let next: ReadableStreamReadResult<Uint8Array> = await reader.read();
      while (next.done === false) {
        length += next.value.byteLength;
        if (length > MAX_DOCUMENT_BYTES) {
          throw new Error(
            `The Swagger document exceeds the ${MAX_DOCUMENT_BYTES} byte limit.`,
          );
        }
        chunks.push(next.value);
        next = await reader.read();
      }
      const bytes: Uint8Array = new Uint8Array(length);
      let offset: number = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return decode(bytes);
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* Preserve the original read or decode failure. */
      }
      reader.releaseLock();
    }
  }

  /**
   * Renders a safe source label for diagnostics.
   *
   * Query values may carry credentials or arbitrary user data, so their
   * presence is retained while their contents are never exposed.
   *
   * @evidence contracts/common.md#principled-implementation The canonical label keeps scheme, host and path while marking but hiding query contents.
   * @evidence contracts/common.md#clear-and-simple-design Display is the single label contract for valid URLs.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Credentials and query values are never shown.
   * @evidence contracts/common.md#meaningful-documentation The comment explains the redaction.
   * @evidence contracts/performance.md#efficient-algorithms Linear in URL length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Labels are built per diagnostic.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function display(url: URL): string {
    const query = url.search === "" ? "" : "?<redacted>";
    return `${url.origin}${url.pathname}${query}`;
  }

  /**
   * Produces a safe diagnostic label before remote URL validation completes.
   *
   * Valid URLs reuse the canonical display contract. Malformed URL-like inputs
   * still lose user information, query values, and fragments without changing
   * ordinary local filesystem spellings.
   *
   * @evidence contracts/common.md#principled-implementation Valid URLs reuse display, and malformed remote-looking input still loses user info, query values and fragments.
   * @evidence contracts/common.md#clear-and-simple-design It delegates to display when possible.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Ordinary local paths are left unchanged.
   * @evidence contracts/common.md#meaningful-documentation The comment explains handling of malformed input.
   * @evidence contracts/performance.md#efficient-algorithms Linear in source length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Labels are built per diagnostic.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function safeDisplay(source: string): string {
    const candidate: string = source.trim();
    if (!remoteCandidate(candidate)) return source;
    try {
      const url: URL = new URL(candidate);
      const query: string = url.search === "" ? "" : "?<redacted>";
      const fragment: string = url.hash === "" ? "" : "#<redacted>";
      url.username = "";
      url.password = "";
      return `${url.origin}${url.pathname}${query}${fragment}`;
    } catch {
      return candidate
        .replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/?#]*@/u, "$1<redacted>@")
        .replace(/\?[^#]*/u, "?<redacted>")
        .replace(/#[\s\S]*/u, "#<redacted>");
    }
  }

  /**
   * Removes the configured remote source and any URL repeated by a lower error.
   *
   * Fetch implementations may embed credential-bearing input in exception text,
   * so sanitizing only the diagnostic location cannot establish redaction.
   *
   * @evidence contracts/common.md#principled-implementation The configured source and any URL repeated in a lower error message are replaced by their safe labels.
   * @evidence contracts/common.md#clear-and-simple-design It composes safeDisplay.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Sanitizing only the location would leak secrets embedded in fetch errors.
   * @evidence contracts/common.md#meaningful-documentation The comment explains why the message is sanitized.
   * @evidence contracts/performance.md#efficient-algorithms Linear in message length.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Messages are sanitized per diagnostic.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The function keeps no state after returning; its result is owned by the caller.
   */
  export function safeMessage(cause: unknown, source: string): string {
    let output: string = cause instanceof Error ? cause.message : String(cause);
    const candidate: string = source.trim();
    if (!remoteCandidate(candidate)) return output;
    const display: string = safeDisplay(source);
    output = output.replaceAll(source, display);
    output = output.replaceAll(candidate, display);
    try {
      output = output.replaceAll(new URL(candidate).href, display);
    } catch {
      // The exact source replacement above covers the invalid URL parser message.
    }
    return output;
  }
}

/**
 * Decodes accepted bytes and keeps a byte-exact cache identity.
 *
 * Digesting before text parsing makes cache ownership independent of Unicode
 * normalization performed by later document processing.
 */
function decode(bytes: Uint8Array): IEvidenceRemoteSwaggerSource {
  return {
    content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * Recognizes input whose spelling can expose remote URL secrets.
 *
 * Redaction starts before strict URL parsing because malformed remote-looking
 * input can still contain credentials or query values in parser diagnostics.
 */
function remoteCandidate(source: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(source);
}
