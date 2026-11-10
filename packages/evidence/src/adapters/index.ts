/**
 * Certified adapters for supported programming, database, document, and ledger
 * artifacts.
 *
 * Consumers select these adapters when constructing an explicit parsing
 * boundary. Configuration-driven checks select the appropriate adapter from the
 * package registry by artifact type instead.
 */
export * from "./bigquery/EvidenceBigQueryAdapter";
export * from "./c/EvidenceCAdapter";
export * from "./cpp/EvidenceCppAdapter";
export * from "./csharp/EvidenceCSharpAdapter";
export * from "./dart/EvidenceDartAdapter";
export * from "./dbml/EvidenceDbmlAdapter";
export * from "./delimited/EvidenceDelimitedAdapter";
export * from "./go/EvidenceGoAdapter";
export * from "./java/EvidenceJavaAdapter";
export * from "./javascript/EvidenceJavaScriptAdapter";
export * from "./kotlin/EvidenceKotlinAdapter";
export * from "./lua/EvidenceLuaAdapter";
export * from "./markdown/EvidenceMarkdownAdapter";
export * from "./matlab/EvidenceMatlabAdapter";
export * from "./mysql/EvidenceMysqlAdapter";
export * from "./objc/EvidenceObjcAdapter";
export * from "./php/EvidencePhpAdapter";
export * from "./postgresql/EvidencePostgresqlAdapter";
export * from "./prisma/EvidencePrismaAdapter";
export * from "./python/EvidencePythonAdapter";
export * from "./ruby/EvidenceRubyAdapter";
export * from "./rust/EvidenceRustAdapter";
export * from "./scala/EvidenceScalaAdapter";
export * from "./sql/EvidenceSqlAdapter";
export * from "./sqlite/EvidenceSqliteAdapter";
export * from "./swagger/EvidenceSwaggerAdapter";
export * from "./swift/EvidenceSwiftAdapter";
export * from "./typescript/EvidenceTypeScriptAdapter";
export * from "./zig/EvidenceZigAdapter";
