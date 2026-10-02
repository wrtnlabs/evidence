import type { Node as EvidenceNode } from "web-tree-sitter";

/**
 * Recognizes complete TypeScript export forms missing from the pinned grammar.
 *
 * The parser and ECMAScript scanner share these checks so accepting a known
 * grammar recovery also preserves its type-only projection. This does not
 * classify arbitrary recovered source as a complete declaration population.
 */
export namespace EvidenceTypeScriptSyntax {
  /**
   * Accepts the isolated `type` recovery in a complete type-only star export.
   *
   * Every surrounding token must form an ordinary star or namespace export, and
   * all other children must be free of grammar recovery. Original source ranges
   * remain intact because the source and tree are never rewritten.
   */
  export function typeOnlyStar(node: EvidenceNode): boolean {
    if (!node.isError || node.isMissing || node.text !== "type") return false;
    const parent: EvidenceNode | null = node.parent;
    if (parent?.type !== "export_statement") return false;
    const children: EvidenceNode[] = parent.children.filter(
      (child: EvidenceNode): boolean => child.type !== "comment",
    );
    if (children.length !== 5 && children.length !== 6) return false;
    const marker: EvidenceNode | undefined = children[1];
    return (
      children[0]?.type === "export" &&
      marker !== undefined &&
      marker.equals(node) &&
      ["*", "namespace_export"].includes(children[2]?.type ?? "") &&
      children[3]?.type === "from" &&
      children[4]?.type === "string" &&
      (children.length === 5 || children[5]?.type === ";") &&
      children.every(
        (child: EvidenceNode): boolean =>
          child.equals(node) || (!child.hasError && !child.isMissing),
      )
    );
  }
}
