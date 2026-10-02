import type { IEvidencePythonResolvedBinding } from "./IEvidencePythonResolvedBinding";

/**
 * Represents the bounded static result of one Python name lookup.
 *
 * The resolver distinguishes reachable bindings from a cyclic path so callers
 * can retain an incomplete diagnostic instead of treating recursion as
 * absence.
 */
export interface IEvidencePythonResolution {
  /**
   * Declaration roots or namespaces reached by the requested name.
   *
   * Multiple entries preserve aliases and star-import alternatives until
   * publication deduplicates units.
   */
  bindings: IEvidencePythonResolvedBinding[];

  /**
   * Whether resolving this lookup encountered an active import cycle.
   *
   * A cycle prevents the resolver from certifying that omitted exports are
   * private.
   */
  cyclic: boolean;

  /**
   * Whether the requested name forwards a dependency outside the local
   * snapshot.
   *
   * Omission means no foreign binding was found. Foreign names introduce no
   * local declaration obligation, including through a selected local barrel.
   */
  foreign?: boolean;
}
