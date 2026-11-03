/**
 * Public programming declarations classified by each language adapter.
 *
 * - "type": classes, interfaces, type aliases, and their equivalents.
 * - "function": functions, public methods, and callable declarations.
 * - "property": public data fields and variables.
 *
 * TypeScript classification:
 *
 * - Type declarations must be exported; enums are excluded. Namespaces provide
 *   address scopes and do not create type obligations or evidence hosts.
 * - Functions include:
 *
 *   - Exported functions and consts initialized with arrow/function expressions,
 *       including parentheses and type-only wrappers.
 *   - Public class methods and method signatures of interfaces and object-shaped
 *       type aliases, including the same forms inside namespaces.
 *   - Members initialized with functions or annotated with an inline function type.
 *       Overload declarations form one unit.
 * - Properties include:
 *
 *   - Exported const/let/var bindings and destructured leaves, except the const
 *       function initializers above. Function-valued let/var remain properties.
 *       A function type annotation alone also leaves a variable a property.
 *   - Non-callable members of classes, interfaces, and object-shaped type aliases.
 *       A named type alias, union, or constructor type does not make a member a
 *       function; an inline function type does.
 *   - Public constructor parameter properties, classified like body fields
 *       regardless of the constructor's visibility. Property modifiers include
 *       public, protected, private, readonly, and override; documentation
 *       belongs on the parameter.
 * - Constructors, accessors, computed names, and private/protected members are
 *   excluded. Computed literal names are excluded too.
 *
 * TypeScript addresses:
 *
 * - Use the public export name, including aliases; default exports use "default".
 *   Anonymous default classes/functions also have that address. A default-only
 *   local binding is not a named export.
 * - Namespace members use qualified names; ambient members are public without
 *   individual export modifiers.
 * - Type-only exports expose type-space declarations and withhold value-space
 *   declarations across every export spelling and module boundary:
 *
 *   - Classes and namespace address scopes remain visible, but class members and
 *       namespace values do not.
 *   - Standalone interface and object-shaped alias members remain visible,
 *       including callable members. Interfaces merged with classes follow the
 *       class's value-space member rules.
 * - Static class members use Class.member; instance members and parameter
 *   properties use Class.prototype.member. Standalone interface/alias members
 *   use Type.member; interfaces merged with classes use
 *   Class.prototype.member.
 * - File-qualified targets use a path relative to the citing file, "#", and the
 *   accessor. Literal member names use bracketed JSON strings. Symbol
 *   characters match exactly; path normalization must not rewrite them.
 * - Re-exports do not create duplicate units in the barrel file.
 *
 * Types and address-only namespaces contain their declared descendants.
 * Ordinary citations and permitted exclusions cover selected descendants, and
 * unselected ancestors remain addressable.
 *
 * @evidence contracts/common.md#principled-implementation Three cross-language kinds give every programming adapter one classification target while each adapter maps its own declarations onto them.
 * @evidence contracts/common.md#clear-and-simple-design The alias defines only the shared kinds; the TypeScript classification and addressing it documents are implemented by the TypeScript adapter.
 * @evidence contracts/common.md#prohibited-implementation-shortcuts Exclusions such as enums, accessors and computed names are stated as contract boundaries, not consumer-specific omissions.
 * @evidence contracts/common.md#meaningful-documentation The comment documents TypeScript classification, address spelling, type-only export visibility, and descendant coverage.
 * @evidenceExclude contracts/performance.md#efficient-algorithms A type declaration chooses no processing strategy.
 * @evidenceExclude contracts/performance.md#reuse-equivalent-work A type declaration computes nothing, so there is no work to share.
 * @evidenceExclude contracts/performance.md#bound-retention-and-release-resources A type declaration acquires and holds no runtime resource.
 */
export type EvidenceProgrammingSymbol = "type" | "function" | "property";
