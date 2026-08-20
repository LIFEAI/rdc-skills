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
 *
 * @typedef {object} NormalizedUnit
 * @property {string} name
 * @property {'class'|'module'} kind
 * @property {NormalizedMember[]} members
 * @property {boolean} hasBaseClass       - true if this unit extends/inherits from something
 * @property {number} concreteInstantiations - count of `new <LocalClass>()`-equivalent constructions of project-local types
 * @property {number} totalDependencies   - concreteInstantiations + count of distinct imported/injected names used
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
