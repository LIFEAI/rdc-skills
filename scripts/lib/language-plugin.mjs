/**
 * The language-plugin contract for solid-score.
 *
 * Everything downstream of this file — the five SOLID scorers and the Clean
 * Architecture boundary check — reads ONLY a `NormalizedUnit`. No scoring
 * function may import ts-morph, a Python AST module, or any language-specific
 * parser. That boundary is the whole point: the first version of this tool
 * had `srp()`/`ocp()`/`lsp()`/`isp()`/`dip()` walking ts-morph `SyntaxKind`
 * nodes directly, which is the exact god-object-orchestrator shape this
 * scorer exists to catch, just relocated into the scorer itself. A Python
 * plugin must be addable by writing ONE new file that implements
 * `extractUnits`, touching nothing under scoring/.
 *
 * @typedef {object} NormalizedMember
 * @property {string} name
 * @property {number} paramCount
 * @property {string[]} fieldAccess       - names of instance-scope fields this member reads/writes (e.g. `this.x`, `self.x`)
 * @property {string[]} calls             - names this member calls (bare names, receiver stripped)
 * @property {number} branchHits          - switch-cases + instanceof/typeof-equivalent checks + if-else-if chain links
 * @property {boolean} isPublic
 * @property {object|null} override        - present only if this member overrides a base-class member
 * @property {number} override.baseParamCount
 * @property {boolean} override.callsSuper
 * @property {string|null} override.returnType
 * @property {string|null} override.baseReturnType
 * @property {number} statementCount      - total statement-kind descendants (flattened, all nesting depths) — clean-code F1 (long method)
 * @property {{name: string, line: number}[]} declaredNames - parameter + local `let`/`const`/`var` bindings with simple (non-destructured) names — clean-code N1/N2 (naming)
 * @property {{value: number, line: number}[]} magicNumbers - numeric literals other than 0/1/-1 that are NOT the direct initializer of a `const` variable declaration or an enum member — clean-code N4
 * @property {{line: number}[]} emptyCatches - `catch` blocks with zero statements — clean-code E1
 * @property {{line: number, kind: 'if-true'|'if-false'|'while-false'}[]} deadConditionals - `if(true)`/`if(false)`/`while(false)` constant-conditional branches — clean-code G9 (unreachable-code half)
 * @property {{text: string, line: number}[]} statementTexts - whitespace-normalized text of every statement-kind descendant (same STATEMENT_KINDS as statementCount), filtered to text longer than 10 chars — refactoring consolidate-duplicate-code. ADDED for refactoring-scoring.mjs (2026-08-20), additive-only.
 * @property {{line: number}[]} nullChecks - `if` statements whose condition contains a top-level `=== null` / `!== null` comparison, one entry per matching `if` (deduplicated per-if, not per-comparison) — refactoring null-object-transform. ADDED for refactoring-scoring.mjs (2026-08-20), additive-only.
 * @property {{line: number, hasBehaviorCall: boolean, hasTypeCreation: boolean}[]} switchStatements - every `switch` statement, flagged for behavior-dispatch shape (case bodies call something matching /calculate|process|validate|format/i — refactoring strategy-transform) and type-based-construction shape (discriminant text contains "type" AND the switch body contains a `new X()` — refactoring factory-transform). ADDED for refactoring-scoring.mjs (2026-08-20), additive-only.
 * @property {{line: number, length: number}[]} complexConditionals - `if` statement conditions whose source text is >= 50 chars — refactoring decompose-conditional. ADDED for refactoring-scoring.mjs (2026-08-20), additive-only.
 * @property {number|null} switchBehaviorCallLine - line of the first `switch` statement in this member whose text matches /calculate|process|execute|validate|format/i — pattern-advisor Strategy signal (behavioral-pattern-analyzer.ts:44's exact word list; a superset of `switchStatements[].hasBehaviorCall`'s list above, which omits "execute" and is ported from a different toolkit file — kept as a separate fact rather than edited in place). `null` if no switch in this member matches. ADDED for pattern-scoring.mjs (2026-08-20), additive-only.
 * @property {string[]} constructorNewCallTargets - ALL `new X(...)` target names anywhere in this member's body, UNFILTERED (includes stdlib) — pattern-advisor Factory Method "scattered instantiation" signal (creational-pattern-analyzer.ts:68-83: >5 total, >3 unique). Distinct from `concreteInstantiations` on NormalizedUnit, which is local-classes-only and would under-count this check. ADDED for pattern-scoring.mjs (2026-08-20), additive-only.
 * @property {number|null} conditionalFeatureCallLine - line of the first `if` statement in this member whose THEN block calls a function whose bare name matches /wrap|add|extend|enhance/i — pattern-advisor Decorator signal (structural-pattern-analyzer.ts:39-43). `null` if none. ADDED for pattern-scoring.mjs (2026-08-20), additive-only.
 * @property {number} deepChainCallCount - count of call expressions shaped `a.b.c(...)` (callee is a property access whose own receiver is itself a property access) — pattern-advisor Facade signal (structural-pattern-analyzer.ts:104-105, threshold >5). ADDED for pattern-scoring.mjs (2026-08-20), additive-only.
 * @property {string[]} calleeNames - bare trailing call name (receiver stripped entirely, not just `this.`) for every call expression in this member — pattern-advisor Adapter/Observer/Command/Template Method keyword scans. Distinct from `calls` above, which keeps `this.`-stripped but otherwise full receiver-qualified text. ADDED for pattern-scoring.mjs (2026-08-20), additive-only.
 *
 * @typedef {object} NormalizedUnit
 * @property {string} name
 * @property {'class'|'module'} kind
 * @property {NormalizedMember[]} members
 * @property {boolean} hasBaseClass       - true if this unit extends/inherits from something
 * @property {number} concreteInstantiations - count of `new <LocalClass>()`-equivalent constructions of project-local types
 * @property {number} totalDependencies   - concreteInstantiations + count of distinct imported/injected names used
 * @property {string[]} staticPropertyNames - names of static properties declared directly on this class; always `[]` for a module — pattern-advisor Singleton signal (creational-pattern-analyzer.ts:124-146). ADDED for pattern-scoring.mjs (2026-08-20), additive-only.
 * @property {boolean} hasGetInstanceMethod - true if any member (class method or top-level module function) is named exactly 'getInstance' — pattern-advisor Singleton signal, paired with `staticPropertyNames`. ADDED for pattern-scoring.mjs (2026-08-20), additive-only.
 *
 * @typedef {object} DeadExportFact
 * @property {string} name
 * @property {number} line
 * @property {number} referenceCount      - reference sites found anywhere in the scanned project, EXCLUDING the declaration's own name occurrence. -1 means "declaration kind not supported by the reference finder", never treat -1 as zero.
 * @property {string} kind                - ts-morph declaration kind name, for diagnostics
 *
 * @typedef {object} LanguagePlugin
 * @property {string} id
 * @property {(filePath: string) => boolean} canHandle
 * @property {(filePath: string, sourceText?: string) => NormalizedUnit[]} extractUnits
 * @property {(filePath: string, sourceText?: string) => string[]} importsOf   - module specifiers this file imports, for the boundary check
 * @property {(filePath: string, projectFilePaths?: string[]) => DeadExportFact[]} [deadExportsOf] - OPTIONAL. Cross-file reference count per exported symbol in `filePath`, resolved against the full set of `projectFilePaths` (a real reference-graph walk, not a text grep). Absent on a plugin that hasn't implemented it — a caller MUST treat a missing method as "G9 export-usage half unmeasured", never as "zero dead exports".
 * @property {(filePath: string, exportName: string, projectFilePaths?: string[]) => {referenceCount: number, files: string[], kind: string|null}} [referenceSitesOf] - OPTIONAL. ADDED for refactoring-scoring.mjs (2026-08-20), additive-only. Same `findReferencesAsNodes()` walk as `deadExportsOf`, targeted at ONE named export, returning both the count and the deduplicated list of file paths that reference it (declaration's own occurrence excluded) — refactoring effort estimation's call-site-count and package-boundary-crossing criteria. `referenceCount: -1` means "declaration kind unsupported by the reference finder", never treat -1 as zero. Absent on a plugin that hasn't implemented it — a caller MUST treat a missing method as "effort unmeasured", never as "0 call sites".
 */

/** @type {LanguagePlugin[]} */
const REGISTRY = [];

/** @param {LanguagePlugin} plugin */
export function registerPlugin(plugin) {
  REGISTRY.push(plugin);
}

/** @returns {LanguagePlugin|null} */
export function pluginFor(filePath) {
  return REGISTRY.find((p) => p.canHandle(filePath)) ?? null;
}

export function registeredPlugins() {
  return [...REGISTRY];
}
