import { EvidenceArrays } from "../internal/EvidenceArrays";
import typia from "typia";
import { Parser } from "web-tree-sitter";
import type { Language, Tree, Node as EvidenceNode } from "web-tree-sitter";

import { EvidenceLanguageRegistry } from "./EvidenceLanguageRegistry";
import { EvidenceParseSession } from "./EvidenceParseSession";
import { EvidenceParserError } from "./EvidenceParserError";
import { EvidenceParserSlots } from "../internal/EvidenceParserSlots";
import { EvidenceTypeScriptSyntax } from "./EvidenceTypeScriptSyntax";
import { EvidenceTreeSitterAssets } from "../internal/EvidenceTreeSitterAssets";
import { EvidenceTreeSitterRange } from "../internal/EvidenceTreeSitterRange";
import { EvidenceTreeSitterRuntime } from "../internal/EvidenceTreeSitterRuntime";
import type { IEvidenceGrammar } from "../structures/IEvidenceGrammar";
import type { IEvidenceParserInput } from "../structures/IEvidenceParserInput";
import type { IEvidenceParserOptions } from "../structures/IEvidenceParserOptions";
import type { IEvidenceParserState } from "../structures/IEvidenceParserState";

/**
 * Owns bounded Tree-sitter parse sessions with lazy, verified grammar
 * acquisition.
 *
 * Create a parser for a group of source extractions, call `parse` for each
 * file, then await `close`. Grammar selection uses the configured artifact and
 * filename; acquisition starts only when that grammar is needed. Construction
 * and metadata inspection do not initialize a language or parse source.
 *
 * Each request owns a native parser and tree. Its callback receives a borrowed
 * session only after syntax completeness is established, and must return data
 * that no longer depends on native objects. The concurrency slot remains held
 * during asynchronous callback work, so a callback must not await another parse
 * or close on the same pool: that work can wait for the callback's own slot.
 *
 * Cleanup runs for successful extraction and every failure path. Closing
 * rejects new requests and waits for accepted callbacks; immutable process-wide
 * grammar data can remain cached for later runtimes.
 *
 * @example
 *   const parser: EvidenceParser = new EvidenceParser({ concurrency: 2 });
 *   try {
 *     const range: IEvidenceSourceRange = await parser.parse(
 *       {
 *         type: "typescript",
 *         file: "api.ts",
 *         content: "export const value = 1;",
 *       },
 *       (session: EvidenceParseSession): IEvidenceSourceRange =>
 *         session.range(session.root),
 *     );
 *   } finally {
 *     await parser.close();
 *   }
 *
 * @evidence contracts/common.md#principled-implementation A bounded pool runs each parse with its own native Parser and Tree, rejects ERROR and MISSING recovery anywhere in the tree, and lends a session to the callback.
 * @evidence contracts/common.md#clear-and-simple-design Grammar acquisition, admission and sessions are separate collaborators; the parser sequences them and owns cleanup.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Known grammar gaps are accepted only through EvidenceTypeScriptSyntax; every other recovery fails as parse-incomplete.
 * @evidence contracts/common.md#meaningful-documentation The class comment explains the lifecycle, the no-nested-parse rule and gives an example; every member is documented.
 * @evidence contracts/performance.md#efficient-algorithms Each parse is linear in source size; recovery inspection walks only error-bearing branches.
 * @evidence contracts/performance.md#reuse-equivalent-work Language loads are shared per grammar ID within the runtime, and verified bytes and loaded languages are shared process-wide.
 * @evidence contracts/performance.md#bound-retention-and-release-resources Parser, tree and session are released in finally for every request; close drains accepted work and drops runtime-local load promises.
 */
export class EvidenceParser {
  /**
   * Asset provider for pinned grammar metadata and verified bytes.
   *
   * Keeping one provider per runtime shares acquisition work without loading
   * every registered grammar when the parser is constructed.
   */
  private readonly assets = new EvidenceTreeSitterAssets();

  /**
   * Admission queue and lifecycle boundary for parse callbacks.
   *
   * A slot covers acquisition, parsing, and the callback's asynchronous
   * lifetime. Closing this queue prevents new work before native resources are
   * discarded.
   */
  private readonly slots: EvidenceParserSlots;

  /**
   * In-flight or fulfilled language loads keyed by grammar ID.
   *
   * Concurrent requests share a load. A rejected entry is removed so a later
   * request can recover after acquisition or initialization becomes available.
   */
  private readonly languages = new Map<string, Promise<Language>>();

  /**
   * Grammar IDs successfully loaded by this runtime.
   *
   * State inspection reports this history separately from pending loads, so a
   * failed acquisition is not advertised as a usable language.
   */
  private readonly loaded = new Set<string>();

  /**
   * Creates a lazy parser pool with a bounded callback count.
   *
   * The default permits four active requests. Options are validated
   * immediately, but grammar acquisition and native parser allocation wait for
   * `parse`.
   */
  public constructor(options: IEvidenceParserOptions = {}) {
    this.slots = new EvidenceParserSlots(
      typia.assert(options).concurrency ?? 4,
    );
  }

  /**
   * Lists pinned grammar provenance without loading a language.
   *
   * The returned catalog describes acquisition inputs, including checksums and
   * licenses. It does not imply that every grammar has a certified adapter or
   * that any grammar has already been downloaded.
   *
   * @evidence contracts/common.md#principled-implementation Pinned grammar provenance is listed through the asset provider without loading any language.
   * @evidence contracts/common.md#clear-and-simple-design The method delegates to EvidenceTreeSitterAssets.list.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Listing does not imply certification or acquisition.
   * @evidence contracts/common.md#meaningful-documentation The comment states what the catalog does and does not mean.
   * @evidence contracts/performance.md#efficient-algorithms Linear in catalog size.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work It relies on the provider's validated listing.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The method keeps no state after returning; its result is owned by the caller.
   */
  public async grammars(): Promise<IEvidenceGrammar[]> {
    return this.assets.list();
  }

  /**
   * Reports admission state and successfully loaded grammar IDs.
   *
   * Reading state does not acquire assets or wait for pending parses. The
   * returned counts describe this pool; the language list records its
   * successful loads.
   *
   * @evidence contracts/common.md#principled-implementation A snapshot of active and waiting slots, successfully loaded grammar IDs and closed state describes the pool without side effects.
   * @evidence contracts/common.md#clear-and-simple-design State reads the slot queue and load history only.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Pending or failed loads are not reported as usable languages.
   * @evidence contracts/common.md#meaningful-documentation The comment states that reading state acquires nothing.
   * @evidence contracts/performance.md#efficient-algorithms Linear in loaded language count.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work A snapshot is cheap and must be current.
   * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources The method keeps no state after returning; its result is owned by the caller.
   */
  public state(): IEvidenceParserState {
    return {
      active: this.slots.active,
      waiting: this.slots.waiting,
      languages: Array.from(this.loaded).sort((x, y) =>
        x.localeCompare(y, "en"),
      ),
      closed: this.slots.closed,
    };
  }

  /**
   * Extracts data from a complete syntax tree within a borrowed callback
   * session.
   *
   * Syntax errors, missing nodes, and incompatible grammars reject before the
   * callback can treat a partial tree as a complete declaration inventory.
   * Callback failures propagate after the tree, parser, and slot are released.
   *
   * Callbacks may await work, but must not await another parse or close on this
   * same pool. Copy names, ranges, and relationships into serializable values;
   * returning a node, tree, or session would retain already released
   * resources.
   *
   * @evidence contracts/common.md#principled-implementation The request is copied, its grammar selected, a slot acquired, the language loaded, the source parsed, every recovery branch inspected, and only then the callback runs with a session.
   * @evidence contracts/common.md#clear-and-simple-design Parse orchestrates; grammar selection, admission, loading and sessions are delegated.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Incomplete trees reject before the callback can treat a partial tree as a full inventory.
   * @evidence contracts/common.md#meaningful-documentation The comment explains completeness, callback rules and cleanup; inline comments explain request capture, recovery inspection and disposal order.
   * @evidence contracts/performance.md#efficient-algorithms Linear in source size plus the callback's own work.
   * @evidence contracts/performance.md#reuse-equivalent-work Concurrent parses of the same grammar share one language load.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Session, tree and parser are deleted and the slot released in finally on every path.
   */
  public async parse<T>(
    input: IEvidenceParserInput,
    closure: (session: EvidenceParseSession) => T | Promise<T>,
  ): Promise<T> {
    // Capture the string-valued request before queueing. Later caller mutation
    // must not change grammar selection or text after this request is admitted.
    input = { ...input };
    const grammar = EvidenceLanguageRegistry.select(input.type, input.file);
    try {
      await this.slots.acquire();
    } catch (cause) {
      throw new EvidenceParserError(
        "session-closed",
        input.file,
        "This parser runtime is closed. Create a new runtime to parse additional files.",
        undefined,
        { cause },
      );
    }

    let parser: Parser | undefined;
    let tree: Tree | null = null;
    let session: EvidenceParseSession | undefined;
    try {
      const language = await this.language(grammar.id);
      parser = new Parser();
      try {
        parser.setLanguage(language);
      } catch (cause) {
        throw new EvidenceParserError(
          "grammar-incompatible",
          input.file,
          `Grammar ${grammar.id} is not compatible with this runtime. Update the pinned grammar/runtime pair.`,
          undefined,
          { cause },
        );
      }
      try {
        tree = parser.parse(input.content);
      } catch (cause) {
        throw new EvidenceParserError(
          "parse-failed",
          input.file,
          "The parser could not analyze this source. Inspect the underlying parser failure.",
          undefined,
          { cause },
        );
      }
      if (tree === null)
        throw new EvidenceParserError(
          "parse-failed",
          input.file,
          "Parsing stopped before producing a tree; this source has no complete inventory.",
        );
      if (tree.rootNode.hasError) {
        // Visit every recovery branch. A recognized grammar gap cannot hide a
        // separate unreadable declaration elsewhere in the same source.
        const pending: EvidenceNode[] = [tree.rootNode];
        while (pending.length !== 0) {
          const node: EvidenceNode | undefined = pending.pop();
          if (node === undefined) break;
          const children: EvidenceNode[] = node.children.filter(
            (child: EvidenceNode): boolean =>
              child.hasError || child.isError || child.isMissing,
          );
          // Some grammars hide inserted tokens beneath an error-bearing leaf.
          // The absence of a visible recovery child must not certify that leaf.
          if (
            node.isError ||
            node.isMissing ||
            (node.hasError && children.length === 0)
          ) {
            if (
              input.type === "typescript" &&
              EvidenceTypeScriptSyntax.typeOnlyStar(node)
            )
              continue;
            throw new EvidenceParserError(
              "parse-incomplete",
              input.file,
              "The pinned Tree-sitter grammar could not extract a complete source tree (ERROR or MISSING node). This does not establish that the source is invalid. Add grammar or adapter support for the reported construct before checking coverage.",
              EvidenceTreeSitterRange.from(node),
            );
          }
          EvidenceArrays.append(pending, children.reverse());
        }
      }
      session = new EvidenceParseSession(tree, input.file);
      return await closure(session);
    } finally {
      // Queries borrow the tree, and the tree borrows its parser resources.
      // Dispose in that order, then free the slot even if extraction threw.
      if (session !== undefined) session.dispose();
      if (tree !== null) tree.delete();
      if (parser !== undefined) parser.delete();
      this.slots.release();
    }
  }

  /**
   * Stops admission and waits for accepted parse callbacks to finish.
   *
   * Call this outside a parse callback to avoid waiting on the callback itself.
   * Runtime-local load promises are released afterward; process-wide immutable
   * grammar data remains reusable by other parser instances.
   *
   * @evidence contracts/common.md#principled-implementation Admission is closed and accepted callbacks drain before runtime-local load promises are cleared.
   * @evidence contracts/common.md#clear-and-simple-design Close delegates draining to the slot queue.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts Accepted work is allowed to finish rather than being cut off.
   * @evidence contracts/common.md#meaningful-documentation The comment warns against calling close inside a callback.
   * @evidence contracts/performance.md#efficient-algorithms Constant work plus waiting for accepted callbacks.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Closing ends reuse within this runtime; process-wide caches remain for later runtimes.
   * @evidence contracts/performance.md#bound-retention-and-release-resources Runtime-local load promises are released; process-wide grammar data intentionally stays cached.
   */
  public async close(): Promise<void> {
    await this.slots.close();
    this.languages.clear();
  }

  /**
   * Reuses or starts the runtime-local load for one pinned grammar ID.
   *
   * Sharing the pending promise prevents concurrent parses from downloading and
   * initializing the same language repeatedly. A failed promise is removed only
   * when it is still current, allowing a later request to retry without
   * deleting a newer load that has replaced it.
   */
  private async language(id: string): Promise<Language> {
    let pending = this.languages.get(id);
    if (pending === undefined) {
      pending = this.load(id);
      this.languages.set(id, pending);
    }
    try {
      return await pending;
    } catch (cause) {
      if (this.languages.get(id) === pending) this.languages.delete(id);
      throw cause;
    }
  }

  /**
   * Acquires verified grammar bytes and initializes their Tree-sitter language.
   *
   * This is deliberately the only path that adds an ID to `loaded`, so parser
   * state reports languages usable by this runtime rather than merely requested
   * or unsuccessfully downloaded assets.
   */
  private async load(id: string): Promise<Language> {
    const grammar = await this.assets.grammar(id);
    const bytes = await this.assets.bytes(grammar);
    const language = await EvidenceTreeSitterRuntime.language(grammar, bytes);
    this.loaded.add(id);
    return language;
  }
}
