import path from "node:path";

import type { EvidenceEcmaScriptType } from "./EvidenceEcmaScriptType";

/**
 * Shares bounded local module candidates between capture and alias resolution.
 *
 * Dependency reads and in-memory resolution must consider the same emitted
 * extensions and index spellings so excluded barrels behave like selected
 * ones.
 */
export namespace EvidenceEcmaScriptModulePaths {
  /**
   * Lists source candidates for a local module base without accessing files.
   *
   * TypeScript substitutes source/declaration extensions for emitted JavaScript
   * paths; JavaScript explicit extensions remain exact. Extensionless requests
   * consider ordinary files and index modules.
   */
  export function candidates(
    base: string,
    type: EvidenceEcmaScriptType,
  ): string[] {
    const extension: string = path.posix.extname(base).toLowerCase();
    if (extension === "") {
      const extensions: string[] =
        type === "javascript"
          ? [".js", ".jsx", ".mjs", ".cjs"]
          : [".ts", ".tsx", ".d.ts", ".mts", ".cts", ".d.mts", ".d.cts"];
      return extensions
        .map((suffix: string): string => base + suffix)
        .concat(
          extensions.map((suffix: string): string =>
            path.posix.join(base, "index" + suffix),
          ),
        );
    }
    if (type === "javascript") return [base];
    const without: string = base.slice(0, -extension.length);
    if (extension === ".js" || extension === ".jsx")
      return [without + ".ts", without + ".tsx", without + ".d.ts"];
    if (extension === ".mjs") return [without + ".mts", without + ".d.mts"];
    if (extension === ".cjs") return [without + ".cts", without + ".d.cts"];
    return [base];
  }
}
