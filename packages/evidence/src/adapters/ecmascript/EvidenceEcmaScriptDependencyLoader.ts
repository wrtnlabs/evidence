import { realpath, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";

import { EvidenceSourcePath } from "../../internal/EvidenceSourcePath";
import { EvidenceSourceLoader } from "../../loaders/EvidenceSourceLoader";
import type { IEvidenceSourceAddress } from "../../structures/IEvidenceSourceAddress";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceSnapshot } from "../../structures/IEvidenceSourceSnapshot";
import type { IEvidenceEcmaScriptFileAnalysis } from "./IEvidenceEcmaScriptFileAnalysis";
import type { IEvidenceEcmaScriptExport } from "./IEvidenceEcmaScriptExport";
import type { IEvidenceEcmaScriptImport } from "./IEvidenceEcmaScriptImport";
import type { EvidenceEcmaScriptType } from "./EvidenceEcmaScriptType";
import { EvidenceEcmaScriptModulePaths } from "./EvidenceEcmaScriptModulePaths";

/**
 * Captures unselected local files needed to resolve selected forwarding paths.
 *
 * Globs select declaration owners, not every intermediate barrel. This loader
 * reads only reachable local export dependencies, marks their addresses as
 * support-only, and retains file candidates for watch recovery. Package
 * resolution and dependency declaration enrollment remain outside this pass.
 */
export namespace EvidenceEcmaScriptDependencyLoader {
  /**
   * Extends one copied snapshot and its analyses with reachable support files.
   *
   * The adapter supplies its scanner so dependency files use the same parser
   * session lifecycle as selected files. Physical identities are deduplicated;
   * lexical and symlink root escapes never introduce support units.
   */
  export async function expand(
    snapshot: IEvidenceSourceSnapshot,
    analyses: IEvidenceEcmaScriptFileAnalysis[],
    type: EvidenceEcmaScriptType,
    scan: (
      source: IEvidenceSourceFile,
    ) => Promise<IEvidenceEcmaScriptFileAnalysis>,
  ): Promise<void> {
    const visited: Set<string> = new Set<string>();
    const sources: Map<string, IEvidenceSourceFile> = new Map(
      snapshot.files.map(
        (source: IEvidenceSourceFile): [string, IEvidenceSourceFile] => [
          source.id,
          source,
        ],
      ),
    );
    const locations: Set<string> = new Set(
      snapshot.files.flatMap((source: IEvidenceSourceFile): string[] => [
        source.physicalPath,
        ...source.addresses.map(
          (address: IEvidenceSourceAddress): string => address.absolute,
        ),
      ]),
    );
    for (let index: number = 0; index < analyses.length; ++index) {
      const analysis: IEvidenceEcmaScriptFileAnalysis | undefined =
        analyses[index];
      if (analysis === undefined) continue;
      // Only imports forwarded by an export require declaration provenance.
      // Ordinary implementation imports do not expand the Evidence population.
      const forwarded: Set<string> = new Set(
        analysis.exports.flatMap((edge: IEvidenceEcmaScriptExport): string[] =>
          edge.localName === undefined ? [] : [edge.localName],
        ),
      );
      const specifiers: string[] = [
        ...new Set([
          ...analysis.exports.flatMap(
            (edge: IEvidenceEcmaScriptExport): string[] =>
              edge.specifier === undefined ? [] : [edge.specifier],
          ),
          ...analysis.imports
            .filter((entry: IEvidenceEcmaScriptImport): boolean =>
              forwarded.has(entry.localName),
            )
            .map((entry: IEvidenceEcmaScriptImport): string => entry.specifier),
        ]),
      ];
      for (const specifier of specifiers) {
        const request: string = specifier.replaceAll("\\", "/");
        if (
          !request.startsWith(".") &&
          !path.posix.isAbsolute(request) &&
          !/^[A-Za-z]:\//u.test(request)
        )
          continue;
        for (const address of analysis.source.addresses) {
          const base: string = EvidenceSourcePath.resolve(
            path.posix.dirname(address.absolute),
            request,
          );
          for (const candidate of EvidenceEcmaScriptModulePaths.candidates(
            base,
            type,
          )) {
            if (
              visited.has(candidate) ||
              locations.has(candidate) ||
              !EvidenceSourcePath.contains(snapshot.root.absolute, candidate)
            )
              continue;
            visited.add(candidate);
            snapshot.dependencies.push({ path: candidate, recursive: false });
            try {
              const info: Stats = await stat(candidate);
              if (!info.isFile()) continue;
              const physical: string = EvidenceSourcePath.slash(
                await realpath(candidate),
              );
              if (
                !EvidenceSourcePath.contains(
                  snapshot.root.physical ?? snapshot.root.absolute,
                  physical,
                )
              ) {
                snapshot.complete = false;
                snapshot.diagnostics.push({
                  code: "path-unreadable",
                  path: candidate,
                  message:
                    "The local export dependency resolves outside the declared physical source root.",
                });
                continue;
              }
            } catch (cause) {
              if (
                cause instanceof Error &&
                "code" in cause &&
                (cause.code === "ENOENT" || cause.code === "ENOTDIR")
              )
                continue;
              snapshot.complete = false;
              snapshot.diagnostics.push({
                code: "path-unreadable",
                path: candidate,
                message: cause instanceof Error ? cause.message : String(cause),
              });
              continue;
            }
            const dependency: IEvidenceSourceSnapshot =
              await EvidenceSourceLoader.file(
                path.posix.join(snapshot.root.absolute, "evidence.config.ts"),
                candidate,
                snapshot.root.absolute,
              );
            snapshot.dependencies.push(...dependency.dependencies);
            snapshot.diagnostics.push(...dependency.diagnostics);
            snapshot.complete &&= dependency.complete;
            for (const source of dependency.files) {
              if (
                !EvidenceSourcePath.contains(
                  snapshot.root.physical ?? snapshot.root.absolute,
                  source.physicalPath,
                )
              )
                continue;
              for (const support of source.addresses) support.selected = false;
              const previous: IEvidenceSourceFile | undefined = sources.get(
                source.id,
              );
              if (previous !== undefined) {
                for (const support of source.addresses)
                  if (
                    !previous.addresses.some(
                      (entry: IEvidenceSourceAddress): boolean =>
                        entry.absolute === support.absolute,
                    )
                  )
                    previous.addresses.push(support);
                continue;
              }
              sources.set(source.id, source);
              locations.add(candidate);
              snapshot.files.push(source);
              analyses.push(await scan(source));
            }
          }
        }
      }
    }
  }
}
