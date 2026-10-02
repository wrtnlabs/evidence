import type { IEvidenceScalaDeclaration } from "./IEvidenceScalaDeclaration";

/**
 * Represents a Scala forwarding declaration awaiting source-member resolution.
 *
 * The scanner preserves the forwarder's host and site first, then resolves the
 * requested source member through lexical paths during export materialization.
 */
export interface IEvidenceScalaExport {
  /**
   * Holds the forwarding declaration and its original extraction metadata.
   *
   * Its site remains the public declaration site even when the target is
   * declared in another object or file.
   */
  declaration: IEvidenceScalaDeclaration;

  /**
   * Lists lexical paths at which the source singleton can be found.
   *
   * Each path is tried in declaration context because relative Scala references
   * can resolve through nested owners.
   */
  paths: string[][];

  /**
   * Number of authored qualifier segments after any enclosing lexical prefix.
   *
   * Enclosing objects alone do not prove that a forwarded qualifier is local.
   * Resolution uses this boundary to avoid classifying a foreign path as local
   * merely because the export sits inside a selected object.
   */
  qualifierLength: number;

  /**
   * Names the literal member requested from the resolved source object.
   *
   * Dynamic or computed exports are excluded before this record is created.
   */
  member: string;

  /**
   * Whether imports could affect the lexical qualifier lookup.
   *
   * Selected local targets retain the import/shadowing boundary. Foreign
   * forwarding does not require resolving the imported dependency.
   */
  imported: boolean;
}
