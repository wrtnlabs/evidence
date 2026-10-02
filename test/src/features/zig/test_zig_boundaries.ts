import { EvidenceZigAdapter } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Rejects Zig public populations that require compiler evaluation.
 *
 * Compiler-dependent declarations must remain incomplete while explicit private
 * and local counterparts retain their documented boundaries.
 *
 * 1. Analyze compiler-dependent, private, and local declarations.
 * 2. Verify incomplete diagnostics and retained boundary behavior.
 */
export async function test_zig_boundaries(): Promise<void> {
  const adapter = new EvidenceZigAdapter();
  const cases = new Map<string, string>([
    [String.raw`pub const @"\x61" = 1;`, "zig-identifier-escape"],
    [
      "const Meta = type; pub const Generated: Meta = Factory();",
      "zig-generated-type",
    ],
    ["pub const Empty = struct {};", "zig-parse-incomplete"],
    ["pub const Empty = opaque {};", "zig-parse-incomplete"],
    [
      "pub const value: struct { field: i32, } = undefined;",
      "zig-anonymous-field-type",
    ],
    ["pub const value: @Type(info) = undefined;", "zig-anonymous-field-type"],
    [
      "const Meta = type; pub fn factory() Meta { return struct { field: i32, }; }",
      "zig-type-producing-function",
    ],
    ["pub const same = 1; pub fn same() void {}", "zig-duplicate-name"],
    ["pub const Pointer = *struct { value: i32, };", "zig-compound-type"],
    [
      "pub fn generated() @Type(info) { return undefined; }",
      "zig-type-producing-function",
    ],
    ['pub const Imported = @import("other.zig");', "zig-inferred-surface"],
    ['pub const Root = @import("root");', "zig-inferred-surface"],
    ["pub const Dynamic = @import(module_name);", "zig-inferred-surface"],
    ['pub usingnamespace @import("other.zig");', "zig-usingnamespace"],
    [
      'usingnamespace @import("other.zig"); pub const Alias = Imported;',
      "zig-usingnamespace",
    ],
    [
      'comptime { @export(run, .{ .name = "run" }); } pub fn run() void {}',
      "zig-comptime",
    ],
    [
      "pub fn Factory(comptime T: type) type { return struct { value: T, }; }",
      "zig-type-producing-function",
    ],
    [
      "pub fn factory(comptime T: type) T { return undefined; }",
      "zig-type-producing-function",
    ],
    [
      "pub const Selected = if (option) struct { a: i32, } else struct { b: i32, };",
      "zig-inferred-surface",
    ],
    ["pub const Generated: type = @Type(info);", "zig-generated-type"],
    ["pub const Generated = Factory(i32);", "zig-inferred-surface"],
    ["pub const object = .{ .value = 1 };", "zig-anonymous-value"],
    ["pub const A = B; const B = A;", "zig-alias-cycle"],
    ["pub const A = Other.Type;", "zig-inferred-surface"],
    ["pub const A = Missing;", "zig-alias-unresolved"],
    [
      "pub const A = struct { child: struct { value: i32, }, };",
      "zig-anonymous-field-type",
    ],
    ["pub fn broken( {", "zig-parse-incomplete"],
  ]);
  for (const [content, code] of cases) {
    const inventory = await adapter.analyze(
      EvidenceTestSourceSnapshot.create("src/Boundary.zig", content),
    );
    TestValidator.equals(`incomplete ${content}`, inventory.complete, false);
    TestValidator.predicate(
      `actionable ${code}`,
      inventory.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === code && diagnostic.repair !== undefined,
      ),
    );
  }
  for (const content of [
    'const Imported = @import("other.zig"); pub const value: i32 = Imported.value;',
    "const Generated = Factory(i32); pub const value = 1;",
    "const Hidden = struct { comptime {} pub usingnamespace other; }; pub const value = 1;",
    "pub fn run() void { const Local = struct { pub const value = 1; }; }",
    "pub fn generic(comptime T: type) i32 { return 1; }",
    'test "local" { const ignored = @import("test.zig"); } pub var count: i32 = calculate();',
  ]) {
    const inventory = await adapter.analyze(
      EvidenceTestSourceSnapshot.create("src/Accepted.zig", content),
    );
    TestValidator.equals(
      `accepted boundary ${content}`,
      inventory.diagnostics,
      [],
    );
  }
  const extension = await adapter.analyze(
    EvidenceTestSourceSnapshot.create("src/Wrong.ZIG", "pub const value = 1;"),
  );
  TestValidator.equals(
    "case-sensitive extension failure",
    extension.complete,
    false,
  );
  TestValidator.predicate(
    "configured Zig controls extension",
    extension.diagnostics.some(
      (item) => item.code === "zig-unsupported-extension",
    ),
  );
  const failed = await adapter.analyze(
    EvidenceTestSourceSnapshot.fail(
      EvidenceTestSourceSnapshot.create("src/Unavailable.zig", ""),
      {
        code: "path-unreadable",
        path: "/project/src/Unavailable.zig",
        message: "Unavailable",
      },
    ),
  );
  TestValidator.equals(
    "source failure cannot pass with an empty inventory",
    failed.complete,
    false,
  );
}
