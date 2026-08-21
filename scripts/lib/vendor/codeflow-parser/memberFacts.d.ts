/**
 * memberFacts.ts — per-member structural facts for the validation engine.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `nativeParser.ts` extracted calls only under
 * `exported && declNode.type === 'function_declaration'`. Class methods —
 * which are most of what SOLID / Clean Code / design-pattern / refactoring
 * scoring actually reads — produced nothing at all: no calls, and in
 * nativeParser not even a symbol. A scorer fed that surface cannot tell an
 * empty class from an unparsed one.
 *
 * This module walks EVERY callable body (free function, class method,
 * constructor, accessor, arrow/lambda, nested helper) and reports the
 * structural facts a scorer needs, per member and per unit.
 *
 * CONSUMER SPLIT — deliberate, not an oversight
 * ---------------------------------------------
 * CodeFlow's graph wants the coarse surface (symbols / calls / imports) and is
 * unchanged by this file. The validation engine wants this. Both are served
 * from ONE parse of ONE tree, so the two views can never disagree about what
 * the source said — which is the failure mode that produced this work in the
 * first place (two independent parsers, same bug in both).
 *
 * NON-FUNCTIONAL CONTRACT
 * -----------------------
 * - **Deterministic.** Identical bytes for identical input, across calls and
 *   across processes. Every collection is emitted in a defined order (source
 *   order, or lexicographic where the set has no natural order). No
 *   timestamps. No absolute paths — `path` is echoed exactly as the caller
 *   supplied it and is never resolved against the filesystem.
 * - **No accumulating per-process state.** Every exported function here is
 *   pure over (node, profile) and allocates its own working set. The real
 *   defect behind this requirement was ts-morph's shared `Project` silently
 *   returning wrong reference counts once ~113 files accumulated in one
 *   process; nothing in this module caches across calls, so that class of
 *   drift cannot occur.
 * - **In-process, no network.** No service, no port, no grammar download.
 *
 * GRAMMAR PORTABILITY
 * -------------------
 * Every tree-sitter grammar spells the same construct differently — `call` vs
 * `call_expression` vs `invocation_expression` is the bug that cost python and
 * csharp their entire CALLS surface. So node types live in one table
 * (`LANGUAGE_PROFILES`) rather than being written inline at each test site. A
 * new language is a table row, and a language with no row degrades to the
 * C-like defaults with `profile_complete: false` on the result rather than
 * silently reporting zeros that look like clean code.
 */
/** A name bound inside a member: a parameter or a local declaration. */
export interface DeclaredName {
    name: string;
    line: number;
    kind: 'param' | 'const' | 'let' | 'var' | 'local';
}
/** A numeric literal that is not 0, 1 or -1 and is not a named constant. */
export interface MagicNumber {
    /** Literal source text, sign included when written as a unary minus. */
    value: string;
    line: number;
}
/**
 * One `switch` in a member body, described by the two shapes that matter to a
 * refactoring scorer.
 *
 * `behaviorDispatch` — cases select behaviour (call/return per case). The
 * classic replace-conditional-with-polymorphism candidate.
 *
 * `typeConstruction` — cases construct types (`new X()` per case). A factory
 * in disguise; a different refactoring with a different risk profile.
 *
 * They are not mutually exclusive and a switch can be neither.
 */
export interface SwitchFact {
    line: number;
    /** Normalized discriminant source text, grouping parens removed. */
    discriminant: string;
    /**
     * Non-default arms. `default` is reported separately by `hasDefault` rather
     * than folded in here, because "3 cases" and "2 cases plus a fallback" are
     * different refactoring situations and a single total cannot say which.
     */
    caseCount: number;
    hasDefault: boolean;
    behaviorDispatch: boolean;
    typeConstruction: boolean;
}
/**
 * How a member relates to the same-named member on its base class.
 *
 * Resolution is BATCH-SCOPED: the base class must be declared in one of the
 * files handed to the same `parse()` call. When it is not, the drift fields
 * are `null` — meaning "not determinable here", never `false`. A scorer must
 * be able to tell an override that matches from an override we could not
 * check, and collapsing those two into `false` is how a clean report gets
 * manufactured from missing data.
 */
export interface OverrideShape {
    callsSuper: boolean;
    baseClass: string | null;
    baseParamCount: number | null;
    /** own paramCount − base paramCount; null when the base is unresolved. */
    paramCountDrift: number | null;
    baseReturnType: string | null;
    /** true when both return types are known and differ. */
    returnTypeDrift: boolean | null;
}
/** Every structural fact for one callable body. */
export interface ParsedMember {
    name: string;
    /** Enclosing class/unit name; null at module scope. */
    owner: string | null;
    kind: 'function' | 'method' | 'constructor' | 'getter' | 'setter' | 'arrow';
    exported: boolean;
    isStatic: boolean;
    start_line: number;
    end_line: number;
    return_type: string | null;
    paramCount: number;
    /** Parameters first (source order), then locals (source order). */
    declaredNames: DeclaredName[];
    /** Flattened statement-kind descendant count. */
    statementCount: number;
    /** Normalized text of every statement longer than 10 chars, source order. */
    statementTexts: string[];
    /** `this.x` / `self.x` names, deduped, lexicographic. */
    fieldAccess: string[];
    /** Bare trailing call names with the receiver fully stripped, source order. */
    calleeNames: string[];
    /** Calls shaped `a.b.c(...)` — receiver depth >= 2. */
    deepChainCallCount: number;
    /** Every `new X()` target name, unfiltered, source order. */
    constructorNewCallTargets: string[];
    /** switch cases + instanceof/typeof checks + if/else-if chain lengths. */
    branchHits: number;
    switchStatements: SwitchFact[];
    /** `if` conditions whose source text is >= 50 chars, source order. */
    complexConditionals: string[];
    /** `if` conditions with a top-level null comparison. */
    nullChecks: number;
    magicNumbers: MagicNumber[];
    /** Catch blocks containing zero statements. */
    emptyCatches: number;
    /** `if (true)` / `if (false)` / `while (false)`. */
    deadConditionals: number;
    override: OverrideShape;
}
/** Facts about a class (or the file's module scope). */
export interface ParsedUnit {
    name: string;
    kind: 'class' | 'module';
    exported: boolean;
    start_line: number;
    end_line: number;
    baseClass: string | null;
    hasBaseClass: boolean;
    /** `new X()` where X is a class declared in THIS file. */
    concreteInstantiations: number;
    /**
     * Distinct external names this unit leans on: construction targets, call
     * receivers other than this/self, and callees not declared inside the unit.
     */
    totalDependencies: number;
    /** Static field/property names, lexicographic. */
    staticPropertyNames: string[];
    /** A `getInstance` / `get_instance` / `Instance` member — singleton tell. */
    hasGetInstanceMethod: boolean;
    /** Member names owned by this unit, source order. */
    memberNames: string[];
}
/**
 * Where one exported symbol is referenced, across the parse batch.
 *
 * Batch-scoped by construction, and that is the honest scope: `parse()` is
 * given a set of files and can only speak about those. `files` excludes the
 * declaring file and `count` excludes the declaration site itself, so a symbol
 * used nowhere else reads `count: 0, files: []` — the dead-export signal.
 */
export interface SymbolReference {
    name: string;
    count: number;
    files: string[];
}
/** Node-type vocabulary for one grammar. */
export interface LanguageProfile {
    call: string[];
    newExpr: string[];
    /** Field naming the constructed type on a `newExpr` node. */
    newTypeField: string[];
    func: string[];
    method: string[];
    constructorDecl: string[];
    klass: string[];
    lambda: string[];
    /** Receiver spellings that mean "my own instance". */
    selfWords: string[];
    /** Node type for an explicit self/this keyword, if the grammar has one. */
    selfNodes: string[];
    memberAccess: string[];
    memberObjectField: string;
    memberPropertyField: string;
    ifStmt: string[];
    switchStmt: string[];
    switchCase: string[];
    switchDefault: string[];
    catchClause: string[];
    whileStmt: string[];
    numberLit: string[];
    trueLit: string[];
    falseLit: string[];
    nullLit: string[];
    /** Extra node types counted as statements beyond the `_statement` suffix. */
    extraStatements: string[];
    /** Node types that hold a body of statements. */
    blocks: string[];
    paramsField: string[];
    bodyField: string[];
    nameField: string[];
    conditionField: string[];
    /** Node type for a class's static-modifier-bearing field declaration. */
    fieldDecl: string[];
    /** Operators that mean equality for null-check detection. */
    eqOperators: string[];
}
/** True when this language has a hand-written profile (not the fallback). */
export declare function hasLanguageProfile(language: string): boolean;
export declare function profileFor(language: string): LanguageProfile;
/** Collapse all whitespace runs to single spaces and trim. */
export declare function normalizeText(text: string): string;
/**
 * Extract every callable body in a file, with its owning unit.
 *
 * `onBody` receives each member's identity and its body node as the walk finds
 * it. That callback is how the coarse CALLS surface is driven: one traversal
 * decides what a member IS, and both the fact surface and the call surface
 * read that same decision. The alternative — a second walk with its own idea
 * of which bodies count — is exactly the arrangement that let `call` vs
 * `call_expression` diverge unnoticed across two parsers.
 */
export declare function extractMembers(rootNode: any, language: string, onBody?: (member: ParsedMember, bodyNode: any) => void): {
    members: ParsedMember[];
    units: ParsedUnit[];
};
/**
 * Fill in override drift for members whose base class was parsed in the same
 * batch. Mutates in place; members whose base is not in the batch keep their
 * `null` drift fields, which is the "not determinable" signal, not "no drift".
 */
export declare function resolveOverrideShapes(perFile: Array<{
    members: ParsedMember[];
    units: ParsedUnit[];
}>): void;
/**
 * Count references to each file's exported symbols across the rest of the
 * batch — the equivalent of ts-morph `findReferencesAsNodes()`, minus the
 * shared-`Project` state that made its counts drift after ~113 files.
 *
 * Identifier occurrences are collected per file ONCE, then counted. That is
 * O(files + names), not O(files x names), so a large batch does not degrade.
 */
export declare function buildReferenceGraph(files: Array<{
    path: string;
    exportedNames: string[];
    identifierCounts: Map<string, number>;
}>): Map<string, SymbolReference[]>;
/**
 * Every identifier occurrence in a tree, counted by name.
 *
 * Declaration-site occurrences are excluded by the caller subtracting the
 * declaring file, which is why this stays a dumb frequency map: a
 * declaration-aware version would need scope resolution the grammar does not
 * give us, and a half-correct one would be worse than an honest count.
 */
export declare function countIdentifiers(rootNode: any): Map<string, number>;
