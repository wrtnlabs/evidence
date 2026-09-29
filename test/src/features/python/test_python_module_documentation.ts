import { EvidencePythonAdapter } from "@wrtnlabs/evidence";
import type {
  IEvidenceInventory,
  IEvidenceDiagnostic,
  IEvidenceDeclaration,
  IEvidenceUnit,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Distinguishes real module documentation from expression-string data.
 *
 * Modules provide no declaration host, so their docstring tags must retain an
 * unsupported-host finding. Ignoring arbitrary strings cannot erase that
 * guard.
 *
 * 1. Analyze ordinary and concatenated first-statement module docstrings and
 *    require an unsupported-host finding with no acknowledged declaration.
 * 2. Analyze first-statement f-strings and bytes, assigned strings and later
 *    expression strings; require inert data and a complete public inventory.
 * 3. Preserve one real function acknowledgement in every scenario.
 */
export async function test_python_module_documentation(): Promise<void> {
  const documentation: string[] = [
    '"""@evidence requirements.md#module Module documentation."""',
    '"@evidence requirements.md#module " "Module documentation."',
  ];
  const data: string[] = [
    'f"""@evidence requirements.md#data Formatted data."""',
    'b"@evidence requirements.md#data Byte data."',
    'Value = "@evidence requirements.md#data Assigned data."',
    'Value = 1\n"@evidence requirements.md#data Later expression data."',
  ];
  for (const prefix of [...documentation, ...data]) {
    const inventory: IEvidenceInventory =
      await new EvidencePythonAdapter().analyze(
        EvidenceTestSourceSnapshot.create(
          "module.py",
          `${prefix}\ndef documented():\n    """@evidence requirements.md#real Real documentation."""\n    return 1\n`,
        ),
      );
    TestValidator.equals(
      "module carrier acknowledgement isolation",
      inventory.declarations.map(
        (declaration: IEvidenceDeclaration): string => declaration.target,
      ),
      ["requirements.md#real"],
    );
    TestValidator.equals(
      "module carrier unsupported host",
      inventory.diagnostics.filter(
        (diagnostic: IEvidenceDiagnostic): boolean =>
          diagnostic.code === "unsupported-annotation-host",
      ).length,
      documentation.includes(prefix) ? 1 : 0,
    );
    TestValidator.predicate(
      "module carrier preserves function",
      inventory.units.some(
        (unit: IEvidenceUnit): boolean => unit.name === "documented",
      ),
    );
    if (data.includes(prefix))
      TestValidator.equals(
        "module expression data complete",
        inventory.complete,
        true,
      );
  }
}
