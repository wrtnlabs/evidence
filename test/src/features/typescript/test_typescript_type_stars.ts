import { EvidenceTypeScriptAdapter } from "@wrtnlabs/evidence";
import type {
  IEvidenceInventory,
  IEvidencePublicAddress,
  IEvidenceDiagnostic,
  IEvidenceUnit,
  IEvidenceUnitSite,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Preserves type-only projections for complete star and namespace exports.
 *
 * The pinned grammar recovers the TypeScript 5.0 `type` token in these forms.
 * Bounded support must retain type-space identity and source coordinates while
 * refusing unrelated recovery elsewhere in the file.
 *
 * 1. Export a class, interface, function, and value through ordinary stars,
 *    type-only stars, namespace exports, and a transitive named barrel. Require
 *    original identities with value-only members absent only in types.
 * 2. Repeat in TS and TSX with comments and Unicode before the exports; require
 *    complete inventories and unchanged declaration source ownership.
 * 3. Combine supported stars with missing syntax or a second recovered token;
 *    require incomplete extraction instead of accepting the entire file.
 */
export async function test_typescript_type_stars(): Promise<void> {
  const adapter: EvidenceTypeScriptAdapter = new EvidenceTypeScriptAdapter();
  for (const extension of ["ts", "tsx"]) {
    const inventory: IEvidenceInventory = await adapter.analyze(
      EvidenceTestSourceSnapshot.combine([
        EvidenceTestSourceSnapshot.create(
          "src/owner.ts",
          dedent`
        export class Box { member = 1; }
        export interface Contract { id: string; run(): void; }
        export function execute(): void {}
        export const value = 1;
      `,
        ),
        EvidenceTestSourceSnapshot.create(
          `src/star.${extension}`,
          '/* 한글 🐈 */\nexport /* before */ type /* after */ * from "./owner";',
        ),
        EvidenceTestSourceSnapshot.create(
          `src/namespace.${extension}`,
          'export type * as API from "./owner";',
        ),
        EvidenceTestSourceSnapshot.create(
          `src/ordinary.${extension}`,
          'export * from "./owner";',
        ),
        EvidenceTestSourceSnapshot.create(
          "src/chain.ts",
          `export * from "./star.${extension}"; export { API } from "./namespace.${extension}";`,
        ),
      ]),
    );
    TestValidator.equals(
      `${extension} complete type stars`,
      inventory.diagnostics,
      [],
    );
    const types: string[] = ["Box", "Contract", "Contract.id", "Contract.run"];
    TestValidator.equals(
      `${extension} type star projection`,
      addresses(inventory, `/project/src/star.${extension}`),
      types,
    );
    TestValidator.equals(
      `${extension} namespace projection`,
      addresses(inventory, `/project/src/namespace.${extension}`),
      types
        .map((name: string): string => "API." + name)
        .sort((x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0)),
    );
    TestValidator.equals(
      `${extension} transitive projection`,
      addresses(inventory, "/project/src/chain.ts"),
      [...types, ...types.map((name: string): string => "API." + name)].sort(
        (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0),
      ),
    );
    TestValidator.equals(
      `${extension} ordinary star retains values`,
      addresses(inventory, `/project/src/ordinary.${extension}`),
      [...types, "Box.prototype.member", "execute", "value"].sort(
        (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0),
      ),
    );
    TestValidator.predicate(
      "aliases retain declaration owner sites",
      inventory.units.every((unit: IEvidenceUnit): boolean =>
        unit.sites.every(
          (site: IEvidenceUnitSite): boolean =>
            site.file === "/project/src/owner.ts",
        ),
      ),
    );
  }

  for (const content of [
    "export type * from;",
    'export type * as from "foreign";',
    'export type type * from "foreign";',
    'export type * from "foreign"; export interface Broken {',
    'export type * as API from "foreign"; export function broken( {',
  ]) {
    const incomplete: IEvidenceInventory = await adapter.analyze(
      EvidenceTestSourceSnapshot.create("src/broken.ts", content),
    );
    TestValidator.equals(
      "separate grammar recovery is incomplete",
      incomplete.complete,
      false,
    );
    TestValidator.predicate(
      "underlying extraction diagnostic survives",
      incomplete.diagnostics.some(
        (diagnostic: IEvidenceDiagnostic): boolean =>
          diagnostic.code === "typescript-parse-incomplete",
      ),
    );
  }
}

/**
 * Reads public aliases for one barrel in deterministic accessor order.
 *
 * The expected spellings distinguish namespace prefixes from declaration
 * identity and expose accidental publication of value-space members.
 */
function addresses(inventory: IEvidenceInventory, file: string): string[] {
  return inventory.addresses
    .filter((address: IEvidencePublicAddress): boolean => address.file === file)
    .map((address: IEvidencePublicAddress): string =>
      address.segments.join("."),
    )
    .sort((x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0));
}
