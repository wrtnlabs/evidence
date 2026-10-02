import {
  EvidenceTypeScriptAdapter,
  EvidenceJavaScriptAdapter,
  EvidencePythonAdapter,
  EvidenceRustAdapter,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceAdapter,
  IEvidenceInventory,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Carries foreign provenance through selected local forwarding chains.
 *
 * A named caller above a foreign star or an explicit export list must not turn
 * an intentionally unenrolled dependency into a missing local owner.
 *
 * 1. Follow named and namespace forwards above foreign stars in TypeScript and
 *    JavaScript, retaining the single local function.
 * 2. Follow Python named and namespace aliases with static `__all__`, including a
 *    selected name supplied only by a foreign star; retain one local function.
 * 3. Follow Rust named and wildcard uses through private local modules forwarding
 *    foreign crates; retain one local function without dependency units.
 * 4. Put a foreign Python star after a local declaration and require that owner to
 *    remain selected; put a restricted Rust declaration beside a foreign star
 *    and require its attempted local re-export to remain incomplete.
 */
export async function test_foreign_export_chains(): Promise<void> {
  const adapters: IEvidenceAdapter[] = [
    new EvidenceTypeScriptAdapter(),
    new EvidenceJavaScriptAdapter(),
  ];
  for (const adapter of adapters) {
    const extension: string = adapter.type === "typescript" ? "ts" : "mjs";
    const inventory: IEvidenceInventory = await adapter.analyze(
      EvidenceTestSourceSnapshot.combine([
        EvidenceTestSourceSnapshot.create(
          `src/star.${extension}`,
          'export * from "foreign";',
        ),
        EvidenceTestSourceSnapshot.create(
          `src/bridge.${extension}`,
          `export { Foreign } from "./star.${extension}"; export * as Namespace from "./star.${extension}";`,
        ),
        EvidenceTestSourceSnapshot.create(
          `src/owner.${extension}`,
          `export { Foreign, Namespace } from "./bridge.${extension}"; export function Own() {}`,
        ),
      ]),
    );
    TestValidator.equals(
      `${adapter.type} foreign chain diagnostics`,
      inventory.diagnostics,
      [],
    );
    TestValidator.equals(
      `${adapter.type} direct owner survives`,
      inventory.units.map((unit: IEvidenceUnit): string => unit.name),
      ["Own"],
    );
  }
  const python: IEvidenceInventory = await new EvidencePythonAdapter().analyze(
    EvidenceTestSourceSnapshot.combine([
      EvidenceTestSourceSnapshot.create(
        "pkg/bridge.py",
        'from dependency import *\n__all__ = ["Foreign"]\n',
      ),
      EvidenceTestSourceSnapshot.create(
        "pkg/owner.py",
        dedent`
      from .bridge import Foreign as Forwarded
      import pkg.bridge as Namespace
      __all__ = ["Forwarded", "Namespace", "Own"]
      def Own():
          pass
    `,
      ),
    ]),
  );
  TestValidator.equals(
    "Python foreign chain diagnostics",
    python.diagnostics,
    [],
  );
  TestValidator.equals(
    "Python direct owner survives",
    python.units.map((unit: IEvidenceUnit): string => unit.name),
    ["Own"],
  );

  const rust: IEvidenceInventory = await new EvidenceRustAdapter().analyze(
    EvidenceTestSourceSnapshot.create(
      "src/lib.rs",
      dedent`
    mod named { pub use dependency::{Foreign, Other}; }
    mod bridge { pub use crate::named::*; pub use dependency::*; }
    pub use crate::named::{Foreign, Other};
    mod named_bridge { pub use crate::named::*; }
    pub use crate::named_bridge::Foreign as Forwarded;
    pub use crate::bridge::{Foreign, Other};
    pub use crate::bridge::*;
    pub fn Own() {}
  `,
    ),
  );
  TestValidator.equals("Rust foreign chain diagnostics", rust.diagnostics, []);
  TestValidator.equals(
    "Rust direct owner survives",
    rust.units.map((unit: IEvidenceUnit): string => unit.name),
    ["Own"],
  );

  const trailing: IEvidenceInventory =
    await new EvidencePythonAdapter().analyze(
      EvidenceTestSourceSnapshot.create(
        "pkg/owner.py",
        dedent`
    def Own():
        pass
    from dependency import *
  `,
      ),
    );
  TestValidator.equals(
    "unknown foreign star does not erase a local owner",
    trailing.units.map((unit: IEvidenceUnit): string => unit.name),
    ["Own"],
  );
  TestValidator.equals(
    "trailing dependency star remains complete",
    trailing.diagnostics,
    [],
  );

  const restricted: IEvidenceInventory =
    await new EvidenceRustAdapter().analyze(
      EvidenceTestSourceSnapshot.create(
        "src/lib.rs",
        dedent`
    mod bridge { struct Hidden; pub use dependency::*; }
    pub use crate::bridge::Hidden;
    pub fn Own() {}
  `,
      ),
    );
  TestValidator.equals(
    "foreign star does not hide a restricted local export",
    restricted.complete,
    false,
  );
}
