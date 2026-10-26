import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceEcmaScriptExport } from "./IEvidenceEcmaScriptExport";
import type { IEvidenceEcmaScriptImport } from "./IEvidenceEcmaScriptImport";
import type { IEvidenceEcmaScriptOwnedUnit } from "./IEvidenceEcmaScriptOwnedUnit";

/**
 * Resolver state retained for one parsed ECMAScript-family source module.
 *
 * `EvidenceEcmaScriptExportResolver` converts scanner output into this mutable
 * graph node, then uses it to follow local declarations, imports, and re-export
 * edges while assigning public addresses to the inventory.
 *
 * @evidence contracts/common.md#principled-implementation Resolver state per module holds its source, units, export edges, imports and exported names for graph traversal.
 * @evidence contracts/common.md#clear-and-simple-design The export resolver owns and mutates this state during one publication.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Fields are filled from parsed syntax; no project, package or fixture value is encoded.
 * @evidence contracts/common.md#meaningful-documentation The comment states what the record represents and its role in the adapter; each field is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidenceEcmaScriptModule {
  /**
   * Captured source file represented by this graph node.
   *
   * Its identity selects the module in resolution, while its addresses provide
   * the physical public files for each published unit.
   */
  source: IEvidenceSourceFile;

  /**
   * Local units declared by this source before publication filtering.
   *
   * The resolver matches an export binding against each unit's root and appends
   * its suffix after the public export path.
   */
  units: IEvidenceEcmaScriptOwnedUnit[];

  /**
   * Local roots deliberately excluded from supported publication.
   *
   * An export of one of these roots propagates exclusion through re-exports
   * without reporting that the module lacks a supported declaration.
   */
  excludedRoots: Set<string>;

  /**
   * Static export edges scanned from this module.
   *
   * Resolution chooses explicit edges before star edges for a requested public
   * name and follows their local or module-qualified targets.
   */
  exports: IEvidenceEcmaScriptExport[];

  /** Explicit edges grouped by public name in authored order. */
  explicit: Map<string, IEvidenceEcmaScriptExport[]>;

  /** Star edges in authored order. */
  stars: IEvidenceEcmaScriptExport[];

  /** Owned units grouped by their lexical root. */
  roots: Map<string, IEvidenceEcmaScriptOwnedUnit[]>;

  /**
   * Imported bindings keyed by their local identifier.
   *
   * A local export consults this map to distinguish an imported alias from a
   * declaration owned by this module.
   */
  imports: Map<string, IEvidenceEcmaScriptImport>;

  /**
   * Public names currently known for this module.
   *
   * The resolver seeds this set from explicit exports and expands it with names
   * reachable through star exports before publishing addresses.
   */
  names: Set<string>;
}
