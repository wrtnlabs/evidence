import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidencePythonAll } from "./IEvidencePythonAll";
import type { IEvidencePythonBinding } from "./IEvidencePythonBinding";
import type { IEvidencePythonOwnedUnit } from "./IEvidencePythonOwnedUnit";

/**
 * Provides one selected Python module to the bounded export resolver.
 *
 * It combines file-local extraction with a mutable name index, allowing imports
 * and re-exports to resolve without reopening parser sessions or executing
 * code.
 *
 * @evidence contracts/common.md#principled-implementation A module combines file extraction with a mutable name index for resolution without reopening parsers.
 * @evidence contracts/common.md#clear-and-simple-design The export resolver owns modules.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Fields hold values derived from parsed syntax; no project-specific value is encoded.
 * @evidence contracts/common.md#meaningful-documentation The comment states what the record represents and its role in the adapter; each field is documented.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export interface IEvidencePythonModule {
  /**
   * Source identity and path used to resolve relative module specifiers.
   *
   * The resolver never follows a module that is absent from the selected
   * snapshot.
   */
  source: IEvidenceSourceFile;

  /**
   * Explicit-export state governing this module's public names.
   *
   * Dynamic `__all__` keeps the enclosing inventory incomplete.
   */
  all: IEvidencePythonAll;

  /**
   * Local and imported bindings in their source order.
   *
   * These records encode Python's overwrite behavior for a requested name.
   */
  bindings: IEvidencePythonBinding[];

  /** Explicit local bindings by name, in source order. */
  locals: Map<string, IEvidencePythonBinding[]>;

  /** Ordered star bindings retained for last-winner semantics. */
  stars: IEvidencePythonBinding[];

  /** Owned unit projections grouped by each supported root. */
  roots: Map<string, IEvidencePythonOwnedUnit[]>;

  /**
   * Scanned declaration roots that may be published through a reachable
   * binding.
   *
   * Their semantic identities remain independent of the aliases that expose
   * them.
   */
  units: IEvidencePythonOwnedUnit[];

  /**
   * Names currently being resolved through this module.
   *
   * The set detects import cycles before recursive traversal can invent a
   * complete result.
   */
  names: Set<string>;
}
