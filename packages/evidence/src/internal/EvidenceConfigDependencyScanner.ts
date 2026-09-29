import { readFile, realpath, stat } from "node:fs/promises";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import typia from "typia";
import type { Node } from "web-tree-sitter";

import { EvidenceParser } from "../parsers/EvidenceParser";
import type { EvidenceParseSession } from "../parsers/EvidenceParseSession";
import type { IEvidenceSourceDependency } from "../structures/IEvidenceSourceDependency";
import type { EvidenceProgrammingType } from "../typings/EvidenceProgrammingType";
import { EvidenceEcmaScriptSyntax } from "../adapters/ecmascript/EvidenceEcmaScriptSyntax";
import { EvidenceConfigPackageMainError } from "./EvidenceConfigPackageMainError";
import { EvidenceConfigPackageTargetError } from "./EvidenceConfigPackageTargetError";
import type { EvidenceConfigModuleMode } from "./EvidenceConfigModuleMode";
import type { IEvidenceConfigDataModule } from "./IEvidenceConfigDataModule";
import type { IEvidenceConfigModuleSpecifier } from "./IEvidenceConfigModuleSpecifier";
import type { IEvidenceConfigPackageBoundary } from "./IEvidenceConfigPackageBoundary";
import type { IEvidenceConfigPackageScope } from "./IEvidenceConfigPackageScope";
import type { IEvidenceConfigResolutionManifest } from "./IEvidenceConfigResolutionManifest";
import { EvidenceSourcePath } from "./EvidenceSourcePath";

/**
 * Finds static local and package-resolution dependencies of one evaluated
 * config.
 *
 * It records dependencies before reads and resolution complete, allowing watch
 * mode to observe a repaired import rather than remaining stuck on a failed
 * scan.
 */
export class EvidenceConfigDependencyScanner {
  /**
   * Strongest observation requested for each logical or physical path.
   *
   * Entries are recorded before reads so failed scans retain enough state for a
   * later repair to invalidate watch mode.
   */
  private readonly dependencies = new Map<string, IEvidenceSourceDependency>();

  /**
   * Physical module paths already parsed during this scan.
   *
   * Real-path identity terminates import cycles while logical aliases remain
   * separate watch dependencies.
   */
  private readonly scanned = new Set<string>();

  /**
   * Immutable data URL modules already inspected during this scan.
   *
   * Exact URL identity terminates recursive embedded-module traversal without
   * inventing a filesystem dependency for source already stored in its
   * importer.
   */
  private readonly scannedData = new Set<string>();

  /**
   * Single-worker parser owned for the duration of one dependency scan.
   *
   * Serial parsing keeps module traversal deterministic, and {@link scan} closes
   * the underlying WASM resources on success or failure.
   */
  private readonly parser = new EvidenceParser({ concurrency: 1 });

  /**
   * Static import mode emitted for extension-neutral TypeScript dependencies.
   *
   * The configuration entry establishes this mode from its extension or nearest
   * package scope before recursive parsing begins.
   */
  private configMode: EvidenceConfigModuleMode = "require";

  /**
   * Creates a dependency scanner for one configuration entry file.
   *
   * The scanner owns a private parser and closes it after `scan` completes, so
   * callers receive only serializable watch dependencies.
   */
  public constructor(private readonly configFile: string) {}

  /**
   * Scans the configuration and every statically reachable local module.
   *
   * Parser resources close on both success and failure, while already
   * discovered dependencies remain available through `list` for watch recovery.
   * Data configuration entries have no executable module scope and do not read
   * package metadata.
   */
  public async scan(): Promise<IEvidenceSourceDependency[]> {
    try {
      const logical: string = EvidenceSourcePath.slash(
        path.resolve(this.configFile),
      );
      this.watch(logical, false);
      this.watch(EvidenceSourcePath.slash(path.dirname(logical)), true);
      const physical: string = EvidenceSourcePath.slash(
        await realpath(logical),
      );
      this.watch(physical, false);
      this.watch(EvidenceSourcePath.slash(path.dirname(physical)), true);
      // Only executable modules need package scope to choose import semantics.
      // JSON loading cannot fail because unrelated package metadata is malformed.
      if (programmingType(physical) !== undefined)
        this.configMode = await this.moduleMode(physical);
      await this.scanFile(logical);
      return this.list();
    } finally {
      await this.parser.close();
    }
  }

  /**
   * Returns ordered dependencies discovered before a failed read or parse.
   *
   * Watch setup uses this partial result so a repaired module or package
   * boundary can restart a failed configuration cycle.
   */
  public list(): IEvidenceSourceDependency[] {
    return Array.from(this.dependencies.values()).sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  }

  /**
   * Watches and parses one physical module once, then follows its static
   * specifiers.
   *
   * Logical and real paths are both retained because symlink changes can alter
   * resolution even when the parsed physical file is unchanged.
   */
  private async scanFile(file: string): Promise<void> {
    const logical = EvidenceSourcePath.slash(path.resolve(file));
    this.watch(logical, false);
    this.watch(EvidenceSourcePath.slash(path.dirname(logical)), true);

    const physical = EvidenceSourcePath.slash(await realpath(logical));
    this.watch(physical, false);
    this.watch(EvidenceSourcePath.slash(path.dirname(physical)), true);
    if (this.scanned.has(physical)) return;
    this.scanned.add(physical);

    const type = programmingType(physical);
    if (type === undefined) return;
    const content = await readFile(physical, "utf8");
    const mode: EvidenceConfigModuleMode = await this.staticMode(physical);
    const specifiers: IEvidenceConfigModuleSpecifier[] =
      await this.parser.parse(
        { type, file: physical, content },
        (session: EvidenceParseSession): IEvidenceConfigModuleSpecifier[] =>
          collectSpecifiers(session, mode, type),
      );
    for (const request of specifiers)
      for (const resolved of await this.resolve(physical, request))
        await this.scanFile(resolved);
  }

  /**
   * Resolves one static specifier while recording paths that can alter its
   * resolution.
   *
   * Local, file URL, and package forms use their respective Node-compatible
   * lookup paths before recursive scanning continues.
   */
  private async resolve(
    owner: string,
    request: IEvidenceConfigModuleSpecifier,
  ): Promise<string[]> {
    const specifier: string = request.specifier;
    if (specifier.startsWith("node:") || isBuiltin(specifier)) return [];
    if (specifier.startsWith("data:")) {
      if (request.mode !== "import")
        throw new Error(
          `CommonJS require cannot load data URL '${specifier}'.`,
        );
      return this.resolveData(specifier);
    }
    if (specifier.startsWith("file:")) {
      if (request.mode !== "import")
        throw new Error(
          `CommonJS require cannot load file URL '${specifier}'.`,
        );
      return this.resolveExact(fileURLToPath(specifier));
    }
    if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
      const base: string =
        request.mode === "import" && specifier.startsWith(".")
          ? fileURLToPath(new URL(specifier, pathToFileURL(owner)))
          : path.resolve(path.dirname(owner), specifier);
      return this.resolvePath(base);
    }

    try {
      return specifier.startsWith("#")
        ? await this.resolvePackageImport(owner, specifier, request.mode)
        : await this.resolveBarePackage(owner, specifier, request.mode);
    } catch (cause) {
      if (!specifier.startsWith("#"))
        await this.watchMissingPackage(owner, specifier);
      throw new Error(
        `Could not resolve configuration import '${specifier}' from ${owner}.`,
        { cause },
      );
    }
  }

  /**
   * Scans one immutable data URL and returns its reachable file dependencies.
   *
   * JavaScript payloads can import builtins, nested data modules, or absolute
   * file URLs. Node gives data modules no relative or package-resolution base,
   * so accepting any other request would publish an incomplete watch set.
   */
  private async resolveData(specifier: string): Promise<string[]> {
    if (this.scannedData.has(specifier)) return [];
    this.scannedData.add(specifier);
    const data: IEvidenceConfigDataModule = configDataModule(specifier);
    if (data.content === undefined) return [];
    const requests: IEvidenceConfigModuleSpecifier[] = await this.parser.parse(
      { type: "javascript", file: "data-module.mjs", content: data.content },
      (session: EvidenceParseSession): IEvidenceConfigModuleSpecifier[] =>
        collectSpecifiers(session, "import", "javascript"),
    );
    const output: string[] = [];
    for (const request of requests) {
      if (request.mode !== "import")
        throw new Error(
          "A JavaScript data module cannot call the CommonJS require loader.",
        );
      if (request.specifier.startsWith("node:") || isBuiltin(request.specifier))
        continue;
      if (request.specifier.startsWith("data:")) {
        output.push(...(await this.resolveData(request.specifier)));
        continue;
      }
      if (request.specifier.startsWith("file:")) {
        output.push(
          ...(await this.resolveExact(fileURLToPath(request.specifier))),
        );
        continue;
      }
      throw new Error(
        `Data URL module import '${request.specifier}' must be builtin, data, or an absolute file URL.`,
      );
    }
    return unique(output);
  }

  /**
   * Resolves an internal `#` request through its nearest package scope.
   *
   * The governing manifest and selected target remain watch dependencies. A
   * redirect can name another internal key or an external package, so recursion
   * is bounded by the visited request set rather than by filesystem traversal.
   */
  private async resolvePackageImport(
    owner: string,
    specifier: string,
    mode: EvidenceConfigModuleMode,
    visited: ReadonlySet<string> = new Set<string>(),
  ): Promise<string[]> {
    if (
      specifier === "#" ||
      specifier.startsWith("#/") ||
      specifier.endsWith("/")
    )
      throw new Error(`Invalid package import specifier '${specifier}'.`);
    if (visited.has(specifier))
      throw new Error(`Cyclic package import mapping for '${specifier}'.`);
    const scope: IEvidenceConfigPackageBoundary | undefined =
      await this.packageBoundary(owner);
    if (scope === undefined)
      throw new Error(`Package import '${specifier}' has no package scope.`);
    const target: string | undefined = packageImport(
      scope.manifest.imports,
      specifier,
      mode,
      scope.directory,
    );
    if (target === undefined)
      throw new Error(
        `Package scope '${scope.directory}' does not import '${specifier}' for ${mode}.`,
      );
    if (target.startsWith("./"))
      return this.resolveExact(packageTarget(scope.directory, target));
    if (target.startsWith("#"))
      return this.resolvePackageImport(
        owner,
        target,
        mode,
        new Set<string>([...visited, specifier]),
      );
    if (target.startsWith("node:") || isBuiltin(target)) return [];
    if (
      target.startsWith("../") ||
      target.startsWith("/") ||
      target.startsWith("file:") ||
      path.isAbsolute(target)
    )
      throw new Error(
        `Package import target '${target}' in '${scope.directory}' is invalid.`,
      );
    return this.resolveBarePackage(
      path.join(scope.directory, "package.json"),
      target,
      mode,
      true,
    );
  }

  /**
   * Resolves a bare request through self-reference or ancestor dependencies.
   *
   * A matching nearest package name makes its exports authoritative. Other
   * requests retain normal `node_modules` lookup, including targets reached
   * from an internal import map.
   */
  private async resolveBarePackage(
    owner: string,
    specifier: string,
    mode: EvidenceConfigModuleMode,
    packageMap: boolean = false,
  ): Promise<string[]> {
    const packageName: string = packageSpecifier(specifier);
    if (mode === "import" || packageMap)
      validatePackageRequest(specifier, packageName);
    const subpath: string = packageSubpath(specifier, packageName);
    const scope: IEvidenceConfigPackageBoundary | undefined =
      await this.packageBoundary(owner);
    if (
      scope !== undefined &&
      scope.manifest.name === packageName &&
      scope.manifest.exports !== undefined
    ) {
      const target: string | undefined = packageExport(
        scope.manifest.exports,
        subpath,
        mode,
        scope.directory,
      );
      if (target === undefined)
        throw new Error(
          `Package '${packageName}' does not export '${subpath}' for ${mode}.`,
        );
      return this.resolveExact(packageTarget(scope.directory, target));
    }
    if (mode === "require" && !packageMap)
      return this.resolveCommonJsPackage(owner, specifier);
    return this.resolvePackage(owner, specifier, mode);
  }

  /**
   * Resolves a direct CommonJS request with legacy search-root fallbacks.
   *
   * CommonJS probes the complete request as a file or directory at each
   * `node_modules` root. Empty nearer package directories may fall through, but
   * export maps and explicit broken main entries remain authoritative.
   */
  private async resolveCommonJsPackage(
    owner: string,
    specifier: string,
  ): Promise<string[]> {
    const packageName: string = packageSpecifier(specifier);
    const subpath: string = packageSubpath(specifier, packageName);
    let directory: string = path.dirname(owner);
    for (;;) {
      const nodeModules: string = EvidenceSourcePath.slash(
        path.join(directory, "node_modules"),
      );
      const packageDirectory: string = EvidenceSourcePath.slash(
        path.join(nodeModules, packageName),
      );
      this.watch(nodeModules, true);
      this.watch(
        EvidenceSourcePath.slash(path.dirname(packageDirectory)),
        true,
      );
      this.watch(packageDirectory, false);
      try {
        if ((await stat(packageDirectory)).isDirectory())
          try {
            return await this.resolvePackageDirectory(
              packageDirectory,
              subpath,
              "require",
            );
          } catch (cause) {
            if (!resolutionMissing(cause)) throw cause;
          }
      } catch (cause) {
        if (!absent(cause)) throw cause;
      }
      try {
        return await this.resolveRuntimePath(
          path.resolve(nodeModules, specifier),
        );
      } catch (cause) {
        if (!resolutionMissing(cause)) throw cause;
      }
      const parent: string = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    throw new Error(`Could not find CommonJS package request '${specifier}'.`);
  }

  /**
   * Finds and validates the nearest package manifest for one module.
   *
   * Every absent candidate remains watched because creating a closer boundary
   * can change internal maps, self-reference, and the module kind on the next
   * cycle.
   */
  private async packageBoundary(
    owner: string,
  ): Promise<IEvidenceConfigPackageBoundary | undefined> {
    let directory: string = path.dirname(owner);
    for (;;) {
      const manifestFile: string = EvidenceSourcePath.slash(
        path.join(directory, "package.json"),
      );
      this.watch(manifestFile, false);
      try {
        if ((await stat(manifestFile)).isFile()) {
          const manifest: IEvidenceConfigResolutionManifest =
            parseResolutionManifest(await readFile(manifestFile, "utf8"));
          return { directory: EvidenceSourcePath.slash(directory), manifest };
        }
      } catch (cause) {
        if (!absent(cause)) throw cause;
      }
      const parent: string = path.dirname(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  }

  /**
   * Determines the evaluator's module kind and observes every candidate
   * boundary.
   *
   * An unqualified TypeScript config follows its nearest package scope. Missing
   * manifests remain dependencies so adding a nearer scope can invalidate a
   * prior CommonJS decision; explicit MTS/CTS extensions bypass that lookup.
   */
  private async moduleMode(file: string): Promise<EvidenceConfigModuleMode> {
    const extension: string = path.extname(file).toLowerCase();
    if (extension === ".mts" || extension === ".mjs") return "import";
    if (extension === ".cts" || extension === ".cjs") return "require";
    let directory: string = path.dirname(file);
    for (;;) {
      const manifest: string = EvidenceSourcePath.slash(
        path.join(directory, "package.json"),
      );
      this.watch(manifest, false);
      try {
        if ((await stat(manifest)).isFile()) {
          const scope: IEvidenceConfigPackageScope = parsePackageScope(
            await readFile(manifest, "utf8"),
          );
          return scope.type === "module" ? "import" : "require";
        }
      } catch (cause) {
        if (!absent(cause)) throw cause;
      }
      const parent: string = path.dirname(directory);
      if (parent === directory) return "require";
      directory = parent;
    }
  }

  /**
   * Chooses the condition used by static syntax in one scanned module.
   *
   * Explicit MTS/MJS and CTS/CJS extensions fix their Node semantics.
   * JavaScript follows its nearest watched package scope, while TypeScript
   * source follows the root temporary compiler mode used by the evaluator.
   */
  private async staticMode(file: string): Promise<EvidenceConfigModuleMode> {
    const extension: string = path.extname(file).toLowerCase();
    if (extension === ".mts" || extension === ".mjs") return "import";
    if (extension === ".cts" || extension === ".cjs") return "require";
    if (extension === ".js" || extension === ".jsx") {
      const scope: IEvidenceConfigPackageBoundary | undefined =
        await this.packageBoundary(file);
      return scope !== undefined && scope.manifest.type === "module"
        ? "import"
        : "require";
    }
    return this.configMode;
  }

  /**
   * Resolves one package request without reusing process-global Node path
   * caches.
   *
   * Every candidate package boundary is observed before lookup. A new nearer
   * install, a retargeted package link, or a changed manifest therefore
   * rebuilds the dependency set from fresh bytes on the next watch attempt.
   */
  private async resolvePackage(
    owner: string,
    specifier: string,
    mode: EvidenceConfigModuleMode,
  ): Promise<string[]> {
    const packageName: string = packageSpecifier(specifier);
    const subpath: string = packageSubpath(specifier, packageName);
    let directory: string = path.dirname(owner);
    for (;;) {
      const nodeModules: string = EvidenceSourcePath.slash(
        path.join(directory, "node_modules"),
      );
      const packageDirectory: string = EvidenceSourcePath.slash(
        path.join(nodeModules, packageName),
      );
      this.watch(nodeModules, true);
      this.watch(
        EvidenceSourcePath.slash(path.dirname(packageDirectory)),
        true,
      );
      this.watch(packageDirectory, false);
      try {
        if ((await stat(packageDirectory)).isDirectory())
          return this.resolvePackageDirectory(packageDirectory, subpath, mode);
      } catch (cause) {
        if (!absent(cause)) throw cause;
      }
      const parent: string = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    throw new Error(`Could not find package '${packageName}'.`);
  }

  /**
   * Selects the runtime entry declared by one located package.
   *
   * Export maps are authoritative and use the request's retained condition.
   * Legacy ESM subpaths require their exact file, while CommonJS subpaths and
   * package roots retain their respective file, directory, `main`, and `index`
   * fallbacks. Selected and missing candidates remain observable for recovery.
   */
  private async resolvePackageDirectory(
    packageDirectory: string,
    subpath: string,
    mode: EvidenceConfigModuleMode,
  ): Promise<string[]> {
    const manifestFile: string = EvidenceSourcePath.slash(
      path.join(packageDirectory, "package.json"),
    );
    this.watch(manifestFile, false);
    let manifest: IEvidenceConfigResolutionManifest = {};
    try {
      manifest = parseResolutionManifest(await readFile(manifestFile, "utf8"));
    } catch (cause) {
      if (!absent(cause)) throw cause;
    }
    if (manifest.exports !== undefined) {
      const target: string | undefined = packageExport(
        manifest.exports,
        subpath,
        mode,
        packageDirectory,
      );
      if (target === undefined)
        throw new Error(
          `Package '${packageDirectory}' does not export '${subpath}' for ${mode}.`,
        );
      return this.resolveExact(packageTarget(packageDirectory, target));
    }
    if (subpath !== ".") {
      const target: string =
        mode === "import"
          ? packageSubpathTarget(packageDirectory, subpath)
          : path.resolve(packageDirectory, subpath.slice(2));
      return mode === "import"
        ? this.resolveExact(target)
        : this.resolveRuntimePath(target);
    }
    if (typeof manifest.main === "string")
      try {
        return await this.resolveRuntimePath(
          path.resolve(packageDirectory, manifest.main),
          false,
        );
      } catch (cause) {
        if (!resolutionMissing(cause)) throw cause;
      }
    return this.resolveRuntimeIndex(packageDirectory);
  }

  /**
   * Validates an exact resolved module and watches its parent for deletion or
   * replacement.
   *
   * The parent dependency lets watch mode notice a module that disappears after
   * resolution has succeeded.
   */
  private async resolveExact(file: string): Promise<string[]> {
    const location: string = EvidenceSourcePath.slash(path.resolve(file));
    this.watch(location, false);
    this.watch(EvidenceSourcePath.slash(path.dirname(location)), true);
    if ((await stat(location)).isFile()) return [location];
    throw new Error(`Configuration module '${location}' is not a file.`);
  }

  /**
   * Tries TypeScript-aware local extension candidates in deterministic order.
   *
   * The ordered candidates mirror supported config imports so a newly created
   * higher-precedence file can restart resolution.
   */
  private async resolvePath(base: string): Promise<string[]> {
    const candidates: string[] = moduleCandidates(base);
    for (const candidate of candidates) {
      this.watch(EvidenceSourcePath.slash(candidate), false);
      try {
        if ((await stat(candidate)).isFile()) return [candidate];
      } catch (cause) {
        if (!absent(cause)) throw cause;
      }
    }
    this.watch(EvidenceSourcePath.slash(path.dirname(base)), true);
    throw new Error(`Could not resolve local configuration module '${base}'.`);
  }

  /**
   * Resolves a legacy package target with Node's runtime candidate order.
   *
   * Package `main` and direct subpaths execute their JavaScript spelling even
   * when a same-stem TypeScript source exists. Direct subpath directories can
   * consult their own manifest; a legacy `main` target uses only file and index
   * fallbacks, matching Node's non-recursive main lookup. Every applicable
   * boundary remains observable for recovery.
   */
  private async resolveRuntimePath(
    base: string,
    readDirectoryManifest: boolean = true,
  ): Promise<string[]> {
    const location: string = EvidenceSourcePath.slash(path.resolve(base));
    for (const candidate of runtimeCandidates(location)) {
      this.watch(candidate, false);
      try {
        if ((await stat(candidate)).isFile()) return [candidate];
      } catch (cause) {
        if (!absent(cause)) throw cause;
      }
    }
    this.watch(location, true);
    try {
      if ((await stat(location)).isDirectory()) {
        let mainTarget: string | undefined;
        let mainFailure: unknown;
        if (readDirectoryManifest) {
          const manifestFile: string = EvidenceSourcePath.slash(
            path.join(location, "package.json"),
          );
          this.watch(manifestFile, false);
          try {
            const manifest: IEvidenceConfigResolutionManifest =
              parseResolutionManifest(await readFile(manifestFile, "utf8"));
            if (typeof manifest.main === "string") {
              mainTarget = manifest.main;
              try {
                return await this.resolveRuntimePath(
                  path.resolve(location, manifest.main),
                  false,
                );
              } catch (cause) {
                if (!resolutionMissing(cause)) throw cause;
                mainFailure = cause;
              }
            }
          } catch (cause) {
            if (!absent(cause)) throw cause;
          }
        }
        try {
          return await this.resolveRuntimeIndex(location);
        } catch (cause) {
          if (mainTarget !== undefined && resolutionMissing(cause))
            throw new EvidenceConfigPackageMainError(
              location,
              mainTarget,
              mainFailure,
            );
          throw cause;
        }
      }
    } catch (cause) {
      if (!absent(cause)) throw cause;
    }
    this.watch(EvidenceSourcePath.slash(path.dirname(location)), true);
    throw new Error(`Could not resolve runtime package module '${location}'.`);
  }

  /**
   * Probes the terminal index files for one legacy package directory.
   *
   * Node does not treat an `index` directory as another package boundary after
   * `LOAD_AS_DIRECTORY` reaches this phase. Keeping the probe nonrecursive
   * prevents nested manifests from selecting code the evaluator never
   * executes.
   */
  private async resolveRuntimeIndex(directory: string): Promise<string[]> {
    const base: string = EvidenceSourcePath.slash(
      path.join(directory, "index"),
    );
    for (const extension of [".js", ".json", ".node"]) {
      const candidate: string = base + extension;
      this.watch(candidate, false);
      try {
        if ((await stat(candidate)).isFile()) return [candidate];
      } catch (cause) {
        if (!absent(cause)) throw cause;
      }
    }
    this.watch(EvidenceSourcePath.slash(directory), true);
    throw new Error(`Could not resolve runtime package module '${base}'.`);
  }

  /**
   * Retains recursive missing package paths so installation or repair restarts
   * the watch cycle.
   *
   * Failed package resolution still establishes dependencies on every searched
   * package root instead of becoming a terminal blind spot.
   */
  private async watchMissingPackage(
    owner: string,
    specifier: string,
  ): Promise<void> {
    const packageName: string = packageSpecifier(specifier);
    let directory: string = path.dirname(owner);
    for (;;) {
      const nodeModules: string = EvidenceSourcePath.slash(
        path.join(directory, "node_modules"),
      );
      this.watch(nodeModules, true);
      this.watch(
        EvidenceSourcePath.slash(path.join(nodeModules, packageName)),
        true,
      );
      const parent: string = path.dirname(directory);
      if (parent === directory) return;
      directory = parent;
    }
  }

  /**
   * Merges duplicate dependencies and upgrades them to recursive observation
   * when needed.
   *
   * A path reached through several import routes retains the strongest watch
   * requirement without duplicate entries.
   */
  private watch(location: string, recursive: boolean): void {
    const previous: IEvidenceSourceDependency | undefined =
      this.dependencies.get(location);
    this.dependencies.set(location, {
      path: location,
      recursive: recursive || previous?.recursive === true,
    });
  }
}

/**
 * Parses the package fields that can redirect one configuration dependency.
 *
 * Node accepts a leading UTF-8 byte-order mark in package JSON. The scanner
 * removes that decoded marker before applying the same field-shape validation
 * on every fresh resolution cycle.
 */
function parseResolutionManifest(
  input: string,
): IEvidenceConfigResolutionManifest {
  return typia.json.assertParse<IEvidenceConfigResolutionManifest>(
    packageJson(input),
  );
}

/**
 * Parses the narrow package scope used to determine a config module's mode.
 *
 * This path shares package JSON decoding with entry resolution so a symlinked
 * config and its dependencies cannot disagree about a BOM-prefixed boundary.
 */
function parsePackageScope(input: string): IEvidenceConfigPackageScope {
  return typia.json.assertParse<IEvidenceConfigPackageScope>(
    packageJson(input),
  );
}

/**
 * Removes Node's permitted leading marker without normalizing manifest bytes.
 *
 * Other malformed JSON remains visible to the typed parsers and prevents the
 * scanner from publishing a dependency graph for an invalid package config.
 */
function packageJson(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

/**
 * Decodes a Node-supported data module for recursive dependency inspection.
 *
 * JavaScript media types return source text. JSON and Wasm cannot contain
 * module requests and remain leaf records; unsupported media types fail before
 * the scanner can mistake their payload for a complete dependency graph.
 */
function configDataModule(specifier: string): IEvidenceConfigDataModule {
  const url: URL = new URL(specifier);
  if (url.protocol !== "data:")
    throw new Error(`Unsupported embedded module URL '${specifier}'.`);
  const data: string = url.pathname;
  const comma: number = data.indexOf(",");
  if (comma < 0) throw new Error("A data URL module has no payload delimiter.");
  const metadata: string = data.slice(0, comma);
  const fields: string[] = metadata.split(";");
  const mediaType: string = (fields.shift() ?? "").toLowerCase();
  const base64: boolean = fields.some(
    (field: string): boolean => field.toLowerCase() === "base64",
  );
  let payload: string;
  try {
    payload = decodeURIComponent(data.slice(comma + 1));
  } catch (cause) {
    throw new Error("A data URL module has invalid percent encoding.", {
      cause,
    });
  }
  if (mediaType === "application/json" || mediaType === "application/wasm")
    return {};
  if (mediaType !== "text/javascript" && mediaType !== "application/javascript")
    throw new Error(`Unsupported data URL module media type '${mediaType}'.`);
  return {
    content: base64 ? Buffer.from(payload, "base64").toString("utf8") : payload,
  };
}

/**
 * Extracts statically knowable requests without erasing their loading
 * mechanism.
 *
 * Static imports and reexports inherit the evaluator's module output. Literal
 * calls keep their explicit `import` or `require` behavior. Computed calls fail
 * because watch cannot construct a complete dependency set without executing
 * arbitrary configuration logic.
 */
function collectSpecifiers(
  session: EvidenceParseSession,
  staticMode: EvidenceConfigModuleMode,
  type: EvidenceProgrammingType,
): IEvidenceConfigModuleSpecifier[] {
  const output: Map<string, IEvidenceConfigModuleSpecifier> = new Map<
    string,
    IEvidenceConfigModuleSpecifier
  >();
  const requireShadows: ReadonlySet<number> = collectRequireShadows(
    session.root,
    type === "javascript" && staticMode === "require",
  );
  const add: (specifier: string, mode: EvidenceConfigModuleMode) => void = (
    specifier: string,
    mode: EvidenceConfigModuleMode,
  ): void => {
    output.set(`${mode}\u0000${specifier}`, { specifier, mode });
  };
  for (const statement of session.root.namedChildren) {
    if (
      statement.type !== "import_statement" &&
      statement.type !== "export_statement"
    )
      continue;
    if (EvidenceEcmaScriptSyntax.token(statement, "type")) continue;
    const direct: string | undefined = EvidenceEcmaScriptSyntax.module(
      statement.childForFieldName("source"),
    );
    if (direct !== undefined) add(direct, staticMode);
    else if (statement.type === "import_statement") {
      const literal: Node | undefined = statement
        .descendantsOfType("string")
        .at(-1);
      const nested: string | undefined = EvidenceEcmaScriptSyntax.module(
        literal ?? null,
      );
      if (nested !== undefined) add(nested, staticMode);
    }
  }
  for (const call of session.root.descendantsOfType("call_expression")) {
    const callee: Node | null = call.childForFieldName("function");
    const loader: EvidenceConfigModuleMode | undefined = moduleLoader(callee);
    if (loader === undefined) continue;
    if (loader === "require" && shadowed(call, requireShadows)) continue;
    const argumentsNode: Node | null = call.childForFieldName("arguments");
    const argument: Node | undefined =
      argumentsNode === null ? undefined : argumentsNode.namedChildren[0];
    const specifier: string | undefined = EvidenceEcmaScriptSyntax.module(
      argument ?? null,
    );
    if (specifier === undefined)
      throw new Error(
        `Configuration ${loader}() dependencies require one static string literal.`,
      );
    add(specifier, loader);
  }
  return Array.from(output.values());
}

/**
 * Resolves a direct module-loader callee through runtime-transparent syntax.
 *
 * Parentheses and TypeScript assertions preserve the underlying call at
 * runtime. Other expressions require value flow and remain outside static
 * dependency discovery, while dynamic `import` stays dedicated syntax.
 */
function moduleLoader(
  callee: Node | null,
): EvidenceConfigModuleMode | undefined {
  if (callee?.text === "import") return "import";
  let expression: Node | undefined = callee ?? undefined;
  while (expression !== undefined) {
    if (expression.type === "identifier")
      return expression.text === "require" ? "require" : undefined;
    if (
      expression.type === "parenthesized_expression" ||
      expression.type === "as_expression" ||
      expression.type === "satisfies_expression" ||
      expression.type === "non_null_expression"
    )
      expression = expression.namedChildren[0];
    else if (expression.type === "type_assertion")
      expression = expression.namedChildren.at(-1);
    else return undefined;
  }
  return undefined;
}

/**
 * Finds scopes whose runtime bindings replace the CommonJS `require` wrapper.
 *
 * Binding scopes are recorded independently of declaration order because `var`
 * and function declarations hoist, while lexical bindings occupy their complete
 * temporal-dead-zone scope. Type-only and ambient TypeScript declarations do
 * not create runtime bindings and therefore leave the wrapper visible.
 */
function collectRequireShadows(
  root: Node,
  annexB: boolean,
): ReadonlySet<number> {
  const output: Set<number> = new Set<number>();
  for (const declaration of root.descendantsOfType("variable_declarator")) {
    if (
      ambient(declaration) ||
      !bindsRequire(declaration.childForFieldName("name"))
    )
      continue;
    const parent: Node | null = declaration.parent;
    if (parent?.type === "variable_declaration")
      addScope(output, functionScope(parent));
    else addScope(output, lexicalDeclarationScope(parent ?? declaration));
  }
  for (const loop of root.descendantsOfType([
    "for_in_statement",
    "for_of_statement",
  ])) {
    const left: Node | null = loop.childForFieldName("left");
    if (!bindsRequire(left)) continue;
    if (loop.children.some((child: Node): boolean => child.type === "var"))
      addScope(output, functionScope(loop));
    else if (
      loop.children.some(
        (child: Node): boolean =>
          child.type === "const" || child.type === "let",
      )
    )
      output.add(loop.id);
  }
  for (const callable of root.descendantsOfType(FUNCTION_SCOPES)) {
    if (bindsRequire(callable.childForFieldName("parameters")))
      output.add(callable.id);
    if (
      (callable.type === "function_expression" ||
        callable.type === "generator_function") &&
      bindsRequire(callable.childForFieldName("name"))
    )
      output.add(callable.id);
  }
  for (const clause of root.descendantsOfType("catch_clause"))
    if (bindsRequire(clause.childForFieldName("parameter")))
      output.add(clause.id);
  for (const statement of root.descendantsOfType("import_statement")) {
    if (EvidenceEcmaScriptSyntax.token(statement, "type")) continue;
    const clause: Node | undefined = statement.namedChildren.find(
      (child: Node): boolean => child.type === "import_clause",
    );
    if (clause !== undefined && importBindsRequire(clause)) output.add(root.id);
  }
  for (const declaration of root.descendantsOfType([
    "class_declaration",
    "enum_declaration",
    "function_declaration",
    "generator_function_declaration",
    "internal_module",
  ])) {
    if (
      ambient(declaration) ||
      !bindsRequire(declaration.childForFieldName("name"))
    )
      continue;
    addScope(output, lexicalScope(declaration));
    if (
      annexB &&
      (declaration.type === "function_declaration" ||
        declaration.type === "generator_function_declaration") &&
      !strictContext(declaration)
    )
      addScope(output, functionScope(declaration));
  }
  for (const expression of root.descendantsOfType("class"))
    if (bindsRequire(expression.childForFieldName("name")))
      output.add(expression.id);
  return output;
}

/**
 * Reports whether one call is enclosed by a scope that binds `require`.
 *
 * The collector uses this lexical check before applying literal/computed module
 * rules, so calls through user values never become watch dependencies.
 */
function shadowed(call: Node, scopes: ReadonlySet<number>): boolean {
  for (let node: Node | null = call.parent; node !== null; node = node.parent)
    if (scopes.has(node.id)) return true;
  return false;
}

/**
 * Detects `require` in one runtime binding pattern.
 *
 * Object-pattern keys describe input properties rather than local names. The
 * recursion therefore follows values, aliases, defaults, and rest targets while
 * excluding type annotations and initializer expressions.
 */
function bindsRequire(pattern: Node | null): boolean {
  if (pattern === null) return false;
  if (
    pattern.type === "identifier" ||
    pattern.type === "shorthand_property_identifier_pattern"
  )
    return pattern.text === "require";
  if (pattern.type === "pair_pattern")
    return bindsRequire(pattern.childForFieldName("value"));
  if (
    pattern.type === "assignment_pattern" ||
    pattern.type === "object_assignment_pattern"
  )
    return bindsRequire(pattern.childForFieldName("left"));
  if (pattern.type === "rest_pattern")
    return pattern.namedChildren.some(bindsRequire);
  if (
    pattern.type === "optional_parameter" ||
    pattern.type === "required_parameter"
  )
    return bindsRequire(
      pattern.childForFieldName("pattern") ??
        pattern.childForFieldName("name") ??
        pattern.namedChildren[0] ??
        null,
    );
  if (
    pattern.type === "array_pattern" ||
    pattern.type === "object_pattern" ||
    pattern.type === "formal_parameters"
  )
    return pattern.namedChildren.some(bindsRequire);
  return false;
}

/**
 * Detects a runtime import binding named `require`.
 *
 * Default, namespace, and named imports use different grammar shapes. A named
 * alias supplies the local binding, while type-only specifiers are erased
 * before the configuration runs and cannot hide a CommonJS wrapper.
 */
function importBindsRequire(clause: Node): boolean {
  for (const child of clause.namedChildren) {
    if (child.type === "identifier" && child.text === "require") return true;
    if (
      child.type === "namespace_import" &&
      child.namedChildren.some((node: Node): boolean => node.text === "require")
    )
      return true;
    for (const specifier of child.descendantsOfType("import_specifier")) {
      if (EvidenceEcmaScriptSyntax.token(specifier, "type")) continue;
      const binding: Node | null =
        specifier.childForFieldName("alias") ??
        specifier.childForFieldName("name");
      if (binding?.text === "require") return true;
    }
  }
  return false;
}

/**
 * Returns the scope that owns one lexical declaration.
 *
 * A `let` or `const` loop initializer belongs to the loop, whereas ordinary
 * lexical declarations belong to the nearest block, switch body, or program.
 */
function lexicalDeclarationScope(declaration: Node): Node | null {
  const parent: Node | null = declaration.parent;
  if (
    parent?.type === "for_statement" ||
    parent?.type === "for_in_statement" ||
    parent?.type === "for_of_statement"
  )
    return parent;
  return lexicalScope(declaration);
}

/**
 * Finds the nearest JavaScript lexical scope outside one declaration.
 *
 * Declaration names are visible throughout this scope for dependency
 * classification, including their temporal-dead-zone interval.
 */
function lexicalScope(declaration: Node): Node | null {
  for (
    let node: Node | null = declaration.parent;
    node !== null;
    node = node.parent
  )
    if (LEXICAL_SCOPES.has(node.type)) return node;
  return null;
}

/**
 * Finds the function or program scope to which a `var` binding hoists.
 *
 * Nested blocks do not constrain `var`, so every call in the owning callable or
 * module must see the local binding regardless of declaration order.
 */
function functionScope(declaration: Node): Node | null {
  for (
    let node: Node | null = declaration.parent;
    node !== null;
    node = node.parent
  )
    if (
      node.type === "class_static_block" ||
      node.type === "program" ||
      FUNCTION_SCOPE_SET.has(node.type)
    )
      return node;
  return null;
}

/**
 * Reports whether a declaration executes under JavaScript strict-mode rules.
 *
 * ECMAScript modules are filtered before this helper is used. CommonJS can
 * still enter strict mode through a script or function directive, and every
 * class body is strict regardless of its surrounding source. Annex B
 * block-function hoisting applies only when none of those boundaries is
 * active.
 */
function strictContext(declaration: Node): boolean {
  for (
    let node: Node | null = declaration.parent;
    node !== null;
    node = node.parent
  ) {
    if (STRICT_CLASS_SCOPES.has(node.type)) return true;
    if (node.type === "program" && strictDirective(node)) return true;
    if (FUNCTION_SCOPE_SET.has(node.type)) {
      const body: Node | null = node.childForFieldName("body");
      if (body !== null && strictDirective(body)) return true;
    }
  }
  return false;
}

/**
 * Detects a `use strict` directive in one script or function-body prologue.
 *
 * Only leading string expression statements participate. A later string after
 * executable code is ordinary data and cannot disable Annex B behavior.
 */
function strictDirective(scope: Node): boolean {
  for (const statement of scope.namedChildren) {
    if (statement.type === "comment" || statement.type === "hash_bang_line")
      continue;
    if (statement.type !== "expression_statement") return false;
    const expression: Node | undefined = statement.namedChildren[0];
    if (expression?.type !== "string") return false;
    if (EvidenceEcmaScriptSyntax.module(expression) === "use strict")
      return true;
  }
  return false;
}

/**
 * Detects TypeScript declarations erased before configuration evaluation.
 *
 * Ambient declarations describe an existing runtime name but emit no binding;
 * treating them as shadows would omit real CommonJS dependencies.
 */
function ambient(declaration: Node): boolean {
  for (
    let node: Node | null = declaration.parent;
    node !== null;
    node = node.parent
  ) {
    if (node.type === "ambient_declaration") return true;
    if (node.type === "program" || FUNCTION_SCOPE_SET.has(node.type))
      return false;
  }
  return false;
}

/**
 * Adds one parser scope when a runtime binding has a lexical owner.
 *
 * Malformed or unsupported trees can lack an enclosing scope; omitting that
 * entry leaves later dependency classification conservative.
 */
function addScope(scopes: Set<number>, scope: Node | null): void {
  if (scope !== null) scopes.add(scope.id);
}

/**
 * Function-like parser nodes that own JavaScript `var` bindings.
 *
 * The same list drives descendant collection and upward scope lookup so the two
 * passes cannot disagree about where the CommonJS wrapper is shadowed.
 */
const FUNCTION_SCOPES: string[] = [
  "arrow_function",
  "function_declaration",
  "function_expression",
  "generator_function",
  "generator_function_declaration",
  "method_definition",
];

/**
 * Constant-time membership view of {@link FUNCTION_SCOPES}.
 *
 * Scope walks use this set while Tree-sitter descendant queries require the
 * original array representation.
 */
const FUNCTION_SCOPE_SET: ReadonlySet<string> = new Set(FUNCTION_SCOPES);

/**
 * Parser nodes that bound lexical `let`, `const`, class, and function names.
 *
 * A declaration shadows `require` throughout the nearest one of these scopes,
 * including the temporal-dead-zone interval before its source position.
 */
const LEXICAL_SCOPES: ReadonlySet<string> = new Set([
  "class_static_block",
  "program",
  "statement_block",
  "switch_body",
]);

/**
 * Class contexts whose strict semantics disable Annex B block hoisting.
 *
 * A block function named `require` stays lexical inside these contexts instead
 * of replacing the surrounding CommonJS wrapper binding.
 */
const STRICT_CLASS_SCOPES: ReadonlySet<string> = new Set<string>([
  "abstract_class_declaration",
  "class",
  "class_body",
  "class_declaration",
  "class_static_block",
]);

/**
 * Resolves the public subpath and active conditions from one export map.
 *
 * Export-map key order remains significant for conditional objects. Subpath
 * patterns are considered only after an exact miss, and the most specific
 * matching prefix wins as required for stable package entry selection.
 */
function packageExport(
  value: unknown,
  subpath: string,
  mode: EvidenceConfigModuleMode,
  packageDirectory: string,
): string | undefined {
  let selected: unknown = value;
  let wildcard: string | undefined;
  if (record(value)) {
    const keys: string[] = Object.keys(value);
    const subpaths: boolean = keys.some((key: string): boolean =>
      key.startsWith("."),
    );
    if (subpaths) {
      if (keys.some((key: string): boolean => !key.startsWith(".")))
        throw new Error(
          "Package exports cannot mix condition and subpath keys at one level.",
        );
      if (Object.hasOwn(value, subpath)) selected = value[subpath];
      else {
        const pattern: string | undefined = exportPattern(keys, subpath);
        if (pattern === undefined) return undefined;
        const star: number = pattern.indexOf("*");
        wildcard = subpath.slice(
          star,
          subpath.length - (pattern.length - star - 1),
        );
        selected = value[pattern];
      }
    } else if (subpath !== ".") return undefined;
  } else if (subpath !== ".") return undefined;
  const target: string | null | undefined = conditionalTarget(
    selected,
    mode,
    "exports",
    packageDirectory,
  );
  if (target === null || target === undefined) return undefined;
  return wildcard === undefined ? target : target.replaceAll("*", wildcard);
}

/**
 * Resolves one exact or patterned package-import entry under active conditions.
 *
 * Only valid `#` entries participate, so malformed unrelated keys cannot block
 * a resolvable request. The selected wildcard text is substituted after the
 * condition branch resolves, matching the package map's authored target shape.
 */
function packageImport(
  value: unknown,
  specifier: string,
  mode: EvidenceConfigModuleMode,
  packageDirectory: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (!record(value))
    throw new Error(
      "Package imports must be an object of internal specifiers.",
    );
  const keys: string[] = Object.keys(value).filter(packageImportKey);
  let selected: unknown;
  let wildcard: string | undefined;
  if (Object.hasOwn(value, specifier)) selected = value[specifier];
  else {
    const pattern: string | undefined = exportPattern(keys, specifier);
    if (pattern === undefined) return undefined;
    const star: number = pattern.indexOf("*");
    wildcard = specifier.slice(
      star,
      specifier.length - (pattern.length - star - 1),
    );
    selected = value[pattern];
  }
  const target: string | null | undefined = conditionalTarget(
    selected,
    mode,
    "imports",
    packageDirectory,
  );
  if (target === null || target === undefined) return undefined;
  return wildcard === undefined ? target : target.replaceAll("*", wildcard);
}

/**
 * Converts a legacy ESM package subpath into the physical pathname Node
 * executes.
 *
 * Bare-package subpaths use URL normalization after the package directory is
 * located. This permits dot segments and removes query or fragment identity
 * from the watched filesystem path while `fileURLToPath` retains
 * encoded-separator validation.
 */
function packageSubpathTarget(
  packageDirectory: string,
  subpath: string,
): string {
  const root: string = path.resolve(packageDirectory);
  return fileURLToPath(
    new URL(subpath.slice(2), pathToFileURL(root + path.sep)),
  );
}

/**
 * Converts a relative package-map target into a confined filesystem path.
 *
 * URL decoding matches Node's file resolution while explicit segment checks
 * prevent encoded traversal and `node_modules` re-entry from escaping the
 * package boundary that authorized the target.
 */
function packageTarget(packageDirectory: string, target: string): string {
  if (!target.startsWith("./") || target.includes("\\"))
    throw new Error(
      `Package target '${target}' in '${packageDirectory}' is not a relative URL path.`,
    );
  const pathname: string = target.split(/[?#]/u, 1)[0] ?? target;
  if (/%(?:2f|5c)/iu.test(pathname))
    throw new Error(
      `Package target '${target}' in '${packageDirectory}' contains an encoded separator.`,
    );
  for (const raw of pathname.slice(2).split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch (cause) {
      throw new Error(
        `Package target '${target}' in '${packageDirectory}' has invalid URL encoding.`,
        { cause },
      );
    }
    if (
      segment === "." ||
      segment === ".." ||
      segment.toLowerCase() === "node_modules"
    )
      throw new Error(
        `Package target '${target}' in '${packageDirectory}' crosses a forbidden segment.`,
      );
  }
  const root: string = path.resolve(packageDirectory);
  const base: URL = pathToFileURL(root + path.sep);
  const location: string = fileURLToPath(new URL(target, base));
  const relative: string = path.relative(root, location);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(
      `Package target '${target}' escapes '${packageDirectory}'.`,
    );
  return location;
}

/**
 * Selects one target while preserving conditional-object declaration order.
 *
 * Only Node's built-in runtime conditions participate. Unknown conditions such
 * as `types` are skipped because they can identify declarations that the
 * evaluator never executes. A matched null target remains blocked.
 */
function conditionalTarget(
  value: unknown,
  mode: EvidenceConfigModuleMode,
  kind: "exports" | "imports",
  packageDirectory: string,
): string | null | undefined {
  if (typeof value === "string") {
    validatePackageMapTarget(value, kind, packageDirectory);
    return value;
  }
  if (value === null) return value;
  if (Array.isArray(value)) {
    const candidates: unknown[] = value;
    let failure: Error | undefined;
    let blocked: boolean = candidates.length === 0;
    for (const candidate of candidates) {
      try {
        const selected: string | null | undefined = conditionalTarget(
          candidate,
          mode,
          kind,
          packageDirectory,
        );
        if (selected !== undefined && selected !== null) return selected;
        if (selected === null) {
          // A later array candidate may still resolve. If none does, this null
          // supersedes earlier invalid alternatives and blocks later conditions.
          blocked = true;
          failure = undefined;
        }
      } catch (cause) {
        if (!(cause instanceof EvidenceConfigPackageTargetError)) throw cause;
        failure = cause;
        blocked = false;
      }
    }
    if (failure !== undefined) throw failure;
    return blocked ? null : undefined;
  }
  if (!record(value))
    throw new EvidenceConfigPackageTargetError(
      "Package export targets must be strings, arrays, or objects.",
    );
  const numeric: string | undefined = Object.keys(value).find(arrayIndex);
  if (numeric !== undefined)
    throw new Error(
      `Package condition '${numeric}' is an integer property key and cannot preserve declaration order.`,
    );
  const active: ReadonlySet<string> = new Set<string>([
    "node-addons",
    "node",
    "module-sync",
    mode,
    "default",
  ]);
  const conditions: Array<[string, unknown]> = Object.entries(value);
  for (const [condition, candidate] of conditions) {
    if (!active.has(condition)) continue;
    const selected: string | null | undefined = conditionalTarget(
      candidate,
      mode,
      kind,
      packageDirectory,
    );
    if (selected !== undefined) return selected;
  }
  return undefined;
}

/**
 * Validates a mapped string before an array commits to that alternative.
 *
 * Export targets must stay relative to their package. Import targets may
 * redirect to another internal key, builtin, or bare dependency, but path-like
 * escapes are invalid and allow an array to try its next alternative.
 */
function validatePackageMapTarget(
  target: string,
  kind: "exports" | "imports",
  packageDirectory: string,
): void {
  if (target.startsWith("./")) {
    try {
      packageTarget(packageDirectory, target);
    } catch (cause) {
      throw new EvidenceConfigPackageTargetError(
        `Package ${kind} target '${target}' in '${packageDirectory}' is invalid.`,
        cause,
      );
    }
    return;
  }
  if (kind === "exports")
    throw new EvidenceConfigPackageTargetError(
      `Package export '${target}' in '${packageDirectory}' is not relative.`,
    );
  if (
    target === "#" ||
    target.startsWith("#/") ||
    target.startsWith("../") ||
    target.startsWith("/") ||
    target.startsWith("file:") ||
    path.isAbsolute(target)
  )
    throw new EvidenceConfigPackageTargetError(
      `Package import target '${target}' in '${packageDirectory}' is invalid.`,
    );
}

/**
 * Identifies manifest keys eligible for internal package-import matching.
 *
 * Node validates the requested `#` name independently and ignores malformed
 * unrelated keys. Filtering candidates here preserves that behavior without
 * allowing an invalid key to act as an exact or wildcard match.
 */
function packageImportKey(key: string): boolean {
  return (
    key.startsWith("#") &&
    key !== "#" &&
    !key.startsWith("#/") &&
    !key.endsWith("/")
  );
}

/**
 * Recognizes property names that JavaScript enumerates as integer indices.
 *
 * Condition selection depends on insertion order, so Node rejects this exact
 * key class while leaving numeric-looking non-index strings such as `01` as
 * ordinary custom conditions.
 */
function arrayIndex(value: string): boolean {
  const numeric: number = Number(value);
  return (
    Number.isInteger(numeric) &&
    numeric >= 0 &&
    numeric < 4_294_967_295 &&
    String(numeric) === value
  );
}

/**
 * Finds the most specific matching export pattern after an exact subpath miss.
 *
 * Prefix length has precedence and total key length breaks suffix ties. This
 * prevents object insertion order from selecting a broader wildcard than the
 * package resolver would execute.
 */
function exportPattern(keys: string[], subpath: string): string | undefined {
  return keys
    .filter((key: string): boolean => {
      const star: number = key.indexOf("*");
      if (star < 0 || key.indexOf("*", star + 1) >= 0) return false;
      return (
        subpath.startsWith(key.slice(0, star)) &&
        subpath.endsWith(key.slice(star + 1))
      );
    })
    .sort((left: string, right: string): number => {
      const leftStar: number = left.indexOf("*");
      const rightStar: number = right.indexOf("*");
      const prefix: number = rightStar - leftStar;
      return prefix !== 0 ? prefix : right.length - left.length;
    })[0];
}

/**
 * Narrows a package-map value to a non-array object.
 *
 * Arrays have separate fallback semantics, while null represents an explicit
 * blocked target and therefore cannot enter condition or subpath lookup.
 */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Chooses a parser only for JavaScript-family modules relevant to configuration
 * imports.
 *
 * Non-code files can be resolved as dependencies but are not recursively parsed
 * for module specifiers.
 */
function programmingType(file: string): EvidenceProgrammingType | undefined {
  const extension = path.extname(file).toLowerCase();
  if ([".ts", ".tsx", ".cts", ".mts"].includes(extension)) return "typescript";
  if ([".js", ".jsx", ".cjs", ".mjs"].includes(extension)) return "javascript";
  return undefined;
}

/**
 * Produces the supported local TypeScript and JavaScript extension fallback
 * order.
 *
 * Local import resolution uses this ordered list to match configuration
 * evaluation and register each candidate for watch recovery.
 */
function moduleCandidates(base: string): string[] {
  const extension = path.extname(base).toLowerCase();
  if (extension === ".js" || extension === ".jsx")
    return unique([
      replaceExtension(base, ".ts"),
      replaceExtension(base, ".tsx"),
      base,
    ]);
  if (extension === ".mjs")
    return unique([replaceExtension(base, ".mts"), base]);
  if (extension === ".cjs")
    return unique([replaceExtension(base, ".cts"), base]);
  if (extension !== "") return [base];
  const extensions = [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
  ];
  return unique([
    base,
    ...extensions.map((value) => base + value),
    ...extensions.map((value) => path.join(base, "index" + value)),
  ]);
}

/**
 * Lists CommonJS legacy file candidates without compiler source substitution.
 *
 * Node checks the authored path before its JavaScript, JSON, and native
 * suffixes. Directory handling follows only after none of these candidates is a
 * file.
 */
function runtimeCandidates(base: string): string[] {
  return unique([base, `${base}.js`, `${base}.json`, `${base}.node`]).map(
    (candidate: string): string => EvidenceSourcePath.slash(candidate),
  );
}

/**
 * Replaces an existing extension without applying path normalization.
 *
 * Candidate generation preserves the authored base path while trying TypeScript
 * counterparts for JavaScript spellings.
 */
function replaceExtension(file: string, extension: string): string {
  return file.slice(0, -path.extname(file).length) + extension;
}

/**
 * Retains each candidate's first occurrence while eliminating fallback
 * duplicates.
 *
 * This preserves deterministic resolution precedence when extension
 * substitution produces the same path twice.
 */
function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Extracts the package root so subpath resolution watches the owning package
 * boundary.
 *
 * Scoped specifiers retain their first two segments; ordinary packages retain
 * only the first segment.
 */
function packageSpecifier(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? specifier);
}

/**
 * Converts a bare request into the key space used by package export maps.
 *
 * The package root is represented by `.` and authored subpaths keep their
 * slash, matching exact and pattern keys without filesystem normalization.
 */
function packageSubpath(specifier: string, packageName: string): string {
  const remainder: string = specifier.slice(packageName.length);
  return remainder === "" ? "." : `.${remainder}`;
}

/**
 * Validates the non-normalizable parts of a strict bare-package request.
 *
 * ESM requests and external package-map redirects reject malformed package
 * names, encoded separators, and terminal directory spellings. Dot segments
 * remain in the request because the evaluator normalizes them while resolving
 * the final module URL, including paths outside the package that supplied the
 * first segment.
 */
function validatePackageRequest(specifier: string, packageName: string): void {
  const nameSegments: string[] = packageName.split("/");
  if (
    packageName === "" ||
    packageName.startsWith(".") ||
    packageName.includes("\\") ||
    packageName.includes("%") ||
    (packageName.startsWith("@") &&
      (nameSegments.length !== 2 ||
        nameSegments[0]?.length === 1 ||
        nameSegments[1] === ""))
  )
    throw new Error(`Package request '${specifier}' has an invalid name.`);
  const remainder: string = specifier.slice(packageName.length);
  if (remainder === "") return;
  if (
    !remainder.startsWith("/") ||
    remainder.endsWith("/") ||
    remainder.includes("\\")
  )
    throw new Error(`Package request '${specifier}' has an invalid subpath.`);
  for (const raw of remainder.slice(1).split("/")) {
    if (/%(?:2f|5c)/iu.test(raw))
      throw new Error(
        `Package request '${specifier}' contains an encoded separator.`,
      );
    try {
      decodeURIComponent(raw);
    } catch (cause) {
      throw new Error(
        `Package request '${specifier}' has invalid URL encoding.`,
        { cause },
      );
    }
  }
}

/**
 * Identifies expected missing-path errors that resolution can continue past.
 *
 * Resolution probes may skip absent candidates, whereas permission and other
 * filesystem failures must remain diagnostic.
 */
function absent(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    "code" in cause &&
    (cause.code === "ENOENT" || cause.code === "ENOTDIR")
  );
}

/**
 * Distinguishes an exhausted runtime candidate search from invalid metadata.
 *
 * Legacy `main` permits an index fallback only when its selected file is
 * absent; malformed manifests and permission failures must remain visible.
 */
function resolutionMissing(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    cause.message.startsWith("Could not resolve runtime package module '")
  );
}
