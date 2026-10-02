import {
  EvidenceTargetResolver,
  EvidenceTypeScriptAdapter,
} from "@wrtnlabs/evidence";
import type {
  IEvidenceHost,
  IEvidenceInventory,
  IEvidenceUnit,
  IEvidenceTargetStatement,
  IEvidenceTargetResolution,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Resolves public files, ancestors, aliases, and literal members.
 *
 * Resolution must distinguish structural containment from public identity while
 * preserving aliases and literal member names.
 *
 * 1. Build units with files, ancestors, aliases, and literal members.
 * 2. Resolve each supported target form.
 * 3. Verify the exact resolved unit or failure status.
 * 4. Keep an excluded declaration outside the population through a selected
 *    barrel; select its owner and require both original and alias resolution.
 */
export async function test_target_resolution(): Promise<void> {
  const inventory = await new EvidenceTypeScriptAdapter().analyze(
    EvidenceTestSourceSnapshot.combine([
      EvidenceTestSourceSnapshot.create(
        "src/calculator.ts",
        "export function add(x: number, y: number): number { return x + y; }",
      ),
      EvidenceTestSourceSnapshot.create(
        "src/SomeClass.ts",
        dedent`
          export class SomeClass {
            public static member = 1;
            public run(): void {}
            public "literal.name" = 2;
            private secret = 3;
          }
        `,
      ),
      EvidenceTestSourceSnapshot.create(
        "src/SomeNamespace.ts",
        dedent`
          export namespace SomeNamespace {
            export const property = 1;
          }
        `,
      ),
      EvidenceTestSourceSnapshot.create(
        "src/barrel.ts",
        dedent`
          export { SomeClass as PublicClass } from "./SomeClass";
          export type { SomeClass as ClassType } from "./SomeClass";
        `,
      ),
      EvidenceTestSourceSnapshot.create(
        "src/a # b.ts",
        "export const encoded = 1;",
      ),
      EvidenceTestSourceSnapshot.create(
        "src/wrong.ts",
        "export const different = 1;",
      ),
    ]),
  );
  const resolver = new EvidenceTargetResolver([inventory]);
  const host = createHost("/project/docs/requirements.md");
  const ids = inventory.units.map((unit) => unit.id);

  // The four baseline file-qualified forms resolve only inside their named files.
  for (const target of [
    "../src/calculator.ts#add",
    "../src/SomeClass.ts#SomeClass.member",
    "../src/SomeClass.ts#SomeClass",
    "../src/SomeNamespace.ts#SomeNamespace.property",
  ]) {
    const result = await resolver.resolve(createStatement(target), host, ids);

    TestValidator.equals(target, result.status, "resolved");
    TestValidator.equals(target + " identity count", result.units.length, 1);
  }

  // A same-named export elsewhere cannot rescue an accessor in the wrong file.
  const wrong = await resolver.resolve(
    createStatement("../src/wrong.ts#add"),
    host,
    ids,
  );

  TestValidator.equals(
    "no global-name fallback",
    wrong.status,
    "missing-member",
  );

  // A barrel alias retains the declaring identity and contributes no extra unit.
  const direct = await resolver.resolve(
    createStatement("../src/SomeClass.ts#SomeClass.member"),
    host,
    ids,
  );
  const alias = await resolver.resolve(
    createStatement("../src/barrel.ts#PublicClass.member"),
    host,
    ids,
  );

  TestValidator.equals("barrel alias resolution", alias.status, "resolved");
  TestValidator.equals(
    "barrel alias identity",
    alias.units.map((unit) => unit.id),
    direct.units.map((unit) => unit.id),
  );

  // Type-only reexports keep the class identity but withhold its value-space members.
  const typeAlias = await resolver.resolve(
    createStatement("../src/barrel.ts#ClassType"),
    host,
    ids,
  );
  const typeMember = await resolver.resolve(
    createStatement("../src/barrel.ts#ClassType.member"),
    host,
    ids,
  );

  TestValidator.equals("type-only class", typeAlias.status, "resolved");
  TestValidator.equals(
    "type-only value member",
    typeMember.status,
    "missing-member",
  );

  // Selecting only a child keeps its real class ancestor addressable.
  const instance = inventory.addresses.find(
    (address) =>
      address.file === "/project/src/SomeClass.ts" &&
      address.segments.join(".") === "SomeClass.prototype.run",
  );
  if (instance === undefined)
    throw new Error("Missing instance method fixture.");
  const ancestor = await resolver.resolve(
    createStatement("../src/SomeClass.ts#SomeClass"),
    host,
    [instance.unitId],
  );

  TestValidator.equals(
    "structural ancestor target",
    ancestor.status,
    "resolved",
  );

  // Literal dots stay one segment and cannot collide with ownership syntax.
  const literal = await resolver.resolve(
    createStatement('../src/SomeClass.ts#SomeClass.prototype["literal.name"]'),
    host,
    ids,
  );
  const split = await resolver.resolve(
    createStatement("../src/SomeClass.ts#SomeClass.prototype.literal.name"),
    host,
    ids,
  );

  TestValidator.equals("literal accessor", literal.status, "resolved");
  TestValidator.equals("split accessor", split.status, "missing-member");
  const privateMember = await resolver.resolve(
    createStatement("../src/SomeClass.ts#SomeClass.prototype.secret"),
    host,
    ids,
  );

  TestValidator.equals(
    "private member stays unavailable",
    privateMember.status,
    "missing-member",
  );

  // Reserved file characters use percent encoding without changing file identity.
  const encoded = await resolver.resolve(
    createStatement("../src/a%20%23%20b.ts#encoded"),
    host,
    ids,
  );

  TestValidator.equals("encoded file path", encoded.status, "resolved");

  // A selected barrel cannot enroll an explicitly excluded declaration owner.
  const dependencySnapshot = EvidenceTestSourceSnapshot.create(
    "src/dependency.ts",
    "export interface Dependency { value: string; }",
  );
  const dependencySource = dependencySnapshot.files[0];
  if (dependencySource === undefined)
    throw new Error("Missing dependency source fixture.");
  const dependencyAddress = dependencySource.addresses[0];
  if (dependencyAddress === undefined)
    throw new Error("Missing dependency address fixture.");
  dependencyAddress.selected = false;
  const dependencyInventory = await new EvidenceTypeScriptAdapter().analyze(
    EvidenceTestSourceSnapshot.combine([
      dependencySnapshot,
      EvidenceTestSourceSnapshot.create(
        "src/entry.ts",
        'export { Dependency as PublicDependency } from "./dependency";',
      ),
    ]),
  );
  const dependencyResolver = new EvidenceTargetResolver([dependencyInventory]);
  const dependencyIds = dependencyInventory.units.map((unit) => unit.id);
  const throughEntry = await dependencyResolver.resolve(
    createStatement("../src/entry.ts#PublicDependency"),
    host,
    dependencyIds,
  );
  const directDependency = await dependencyResolver.resolve(
    createStatement("../src/dependency.ts#Dependency"),
    host,
    dependencyIds,
  );

  TestValidator.equals(
    "selected barrel does not enroll excluded owner",
    throughEntry.status,
    "missing-member",
  );
  TestValidator.equals(
    "loaded dependency stays unselected",
    directDependency.status,
    "out-of-population",
  );

  dependencyAddress.selected = true;
  const selectedInventory: IEvidenceInventory =
    await new EvidenceTypeScriptAdapter().analyze(
      EvidenceTestSourceSnapshot.combine([
        dependencySnapshot,
        EvidenceTestSourceSnapshot.create(
          "src/entry.ts",
          'export { Dependency as PublicDependency } from "./dependency";',
        ),
      ]),
    );
  const selectedResolver: EvidenceTargetResolver = new EvidenceTargetResolver([
    selectedInventory,
  ]);
  const selectedIds: string[] = selectedInventory.units.map(
    (unit: IEvidenceUnit): string => unit.id,
  );
  for (const target of [
    "../src/entry.ts#PublicDependency",
    "../src/dependency.ts#Dependency",
  ]) {
    const selected: IEvidenceTargetResolution = await selectedResolver.resolve(
      createStatement(target),
      host,
      selectedIds,
    );
    TestValidator.equals(
      "selected owner resolves " + target,
      selected.status,
      "resolved",
    );
  }
}

function createHost(file: string): IEvidenceHost {
  return {
    id: "claim-host",
    file,
    range: {
      start: { line: 0, column: 0, offset: 0 },
      end: { line: 0, column: 0, offset: 0 },
    },
    origins: [file],
    siteId: "claim-site",
    unitIds: ["claim-unit"],
    attachment: "attached",
  };
}

function createStatement(target: string): IEvidenceTargetStatement {
  return {
    hostId: "claim-host",
    target,
    location: { file: "/project/docs/requirements.md" },
  };
}
