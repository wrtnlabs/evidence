import { EvidenceObjcAdapter } from "../adapters/objc/EvidenceObjcAdapter";
import { EvidenceDartAdapter } from "../adapters/dart/EvidenceDartAdapter";
import { EvidenceCAdapter } from "../adapters/c/EvidenceCAdapter";
import { EvidenceBigQueryAdapter } from "../adapters/bigquery/EvidenceBigQueryAdapter";
import { EvidenceCppAdapter } from "../adapters/cpp/EvidenceCppAdapter";
import { EvidenceCSharpAdapter } from "../adapters/csharp/EvidenceCSharpAdapter";
import { EvidenceDbmlAdapter } from "../adapters/dbml/EvidenceDbmlAdapter";
import { EvidenceDelimitedAdapter } from "../adapters/delimited/EvidenceDelimitedAdapter";
import { EvidenceGoAdapter } from "../adapters/go/EvidenceGoAdapter";
import { EvidenceJavaAdapter } from "../adapters/java/EvidenceJavaAdapter";
import { EvidenceJavaScriptAdapter } from "../adapters/javascript/EvidenceJavaScriptAdapter";
import { EvidenceKotlinAdapter } from "../adapters/kotlin/EvidenceKotlinAdapter";
import { EvidenceLuaAdapter } from "../adapters/lua/EvidenceLuaAdapter";
import { EvidenceMarkdownAdapter } from "../adapters/markdown/EvidenceMarkdownAdapter";
import { EvidenceMatlabAdapter } from "../adapters/matlab/EvidenceMatlabAdapter";
import { EvidencePhpAdapter } from "../adapters/php/EvidencePhpAdapter";
import { EvidenceMysqlAdapter } from "../adapters/mysql/EvidenceMysqlAdapter";
import { EvidencePrismaAdapter } from "../adapters/prisma/EvidencePrismaAdapter";
import { EvidencePostgresqlAdapter } from "../adapters/postgresql/EvidencePostgresqlAdapter";
import { EvidencePythonAdapter } from "../adapters/python/EvidencePythonAdapter";
import { EvidenceRubyAdapter } from "../adapters/ruby/EvidenceRubyAdapter";
import { EvidenceScalaAdapter } from "../adapters/scala/EvidenceScalaAdapter";
import { EvidenceRustAdapter } from "../adapters/rust/EvidenceRustAdapter";
import { EvidenceSqlAdapter } from "../adapters/sql/EvidenceSqlAdapter";
import { EvidenceSqliteAdapter } from "../adapters/sqlite/EvidenceSqliteAdapter";
import { EvidenceSwiftAdapter } from "../adapters/swift/EvidenceSwiftAdapter";
import { EvidenceSwaggerAdapter } from "../adapters/swagger/EvidenceSwaggerAdapter";
import { EvidenceTypeScriptAdapter } from "../adapters/typescript/EvidenceTypeScriptAdapter";
import { EvidenceZigAdapter } from "../adapters/zig/EvidenceZigAdapter";
import type { IEvidenceAdapter } from "../structures/IEvidenceAdapter";
import type { IEvidenceDelimitedOptions } from "../structures/IEvidenceDelimitedOptions";
import type { EvidenceArtifactType } from "../typings/EvidenceArtifactType";

/**
 * Constructs the adapter implementing one certified artifact contract.
 *
 * A fresh instance isolates parser/session state between analyses; unsupported
 * additions fail here instead of producing a partial inventory downstream.
 *
 * @evidence contracts/common.md#principled-implementation A factory keyed by the validated discriminator gives every certified artifact type exactly one adapter class.
 * @evidence contracts/common.md#clear-and-simple-design The namespace only maps types to constructors; adapters own extraction.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Unknown types throw instead of falling back to a generic adapter.
 * @evidence contracts/common.md#meaningful-documentation The namespace comment explains fresh instances and the failure for unsupported additions.
 * @evidenceExclude contracts/performance.md#efficient-algorithms The namespace only groups its exported functions, which each own their processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work The namespace owns no cached result; any reuse belongs to its member functions or module singletons documented there.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources Grouping functions acquires no resource; member functions own any resource they use.
 */
export namespace EvidenceAdapterFactory {
  /**
   * Creates the dedicated adapter for a validated artifact discriminator.
   *
   * Each call returns a fresh instance so parser and scan state cannot cross an
   * inventory boundary. CSV and TSV need the population's key and evidence
   * column; every other type ignores `options`.
   *
   * @evidence contracts/common.md#principled-implementation An overload preserves the requested artifact type in the return type, and the implementation returns a fresh adapter per call, passing column options only to the delimited adapter.
   * @evidence contracts/common.md#clear-and-simple-design The function only constructs; it neither validates configuration nor caches adapters.
   * @evidence contracts/common.md#prohibited-implementation-shortcuts An unmapped type, or a delimited type without column options, throws with the reason rather than returning a partial adapter.
   * @evidence contracts/common.md#meaningful-documentation The comment explains fresh instances and which types consume options.
   * @evidence contracts/performance.md#efficient-algorithms A fixed chain of at most thirty comparisons selects the constructor.
   * @evidenceExclude contracts/performance.md#reuse-equivalent-work Adapters are deliberately not shared so parser and scan state cannot cross inventories.
   * @evidence contracts/performance.md#bound-retention-and-release-resources The new adapter is owned by the caller for one analysis; the factory keeps no reference.
   */
  export function create<Type extends EvidenceArtifactType>(
    type: Type,
    options?: IEvidenceDelimitedOptions,
  ): IEvidenceAdapter<Type>;
  export function create(
    type: EvidenceArtifactType,
    options?: IEvidenceDelimitedOptions,
  ): IEvidenceAdapter {
    if (type === "csv" || type === "tsv") {
      if (options === undefined)
        throw new Error(
          `Artifact type '${type}' needs key column options to build row units.`,
        );
      return new EvidenceDelimitedAdapter(type, options);
    }
    if (type === "objc") return new EvidenceObjcAdapter();
    if (type === "dart") return new EvidenceDartAdapter();
    if (type === "c") return new EvidenceCAdapter();
    if (type === "bigquery") return new EvidenceBigQueryAdapter();
    if (type === "cpp") return new EvidenceCppAdapter();
    if (type === "csharp") return new EvidenceCSharpAdapter();
    if (type === "dbml") return new EvidenceDbmlAdapter();
    if (type === "go") return new EvidenceGoAdapter();
    if (type === "java") return new EvidenceJavaAdapter();
    if (type === "javascript") return new EvidenceJavaScriptAdapter();
    if (type === "kotlin") return new EvidenceKotlinAdapter();
    if (type === "lua") return new EvidenceLuaAdapter();
    if (type === "markdown") return new EvidenceMarkdownAdapter();
    if (type === "matlab") return new EvidenceMatlabAdapter();
    if (type === "php") return new EvidencePhpAdapter();
    if (type === "mysql") return new EvidenceMysqlAdapter();
    if (type === "prisma") return new EvidencePrismaAdapter();
    if (type === "postgresql") return new EvidencePostgresqlAdapter();
    if (type === "python") return new EvidencePythonAdapter();
    if (type === "ruby") return new EvidenceRubyAdapter();
    if (type === "scala") return new EvidenceScalaAdapter();
    if (type === "rust") return new EvidenceRustAdapter();
    if (type === "sql") return new EvidenceSqlAdapter();
    if (type === "sqlite") return new EvidenceSqliteAdapter();
    if (type === "swift") return new EvidenceSwiftAdapter();
    if (type === "swagger") return new EvidenceSwaggerAdapter();
    if (type === "typescript") return new EvidenceTypeScriptAdapter();
    if (type === "zig") return new EvidenceZigAdapter();
    throw new Error(
      `Artifact type '${type}' has no certified Evidence adapter.`,
    );
  }
}
