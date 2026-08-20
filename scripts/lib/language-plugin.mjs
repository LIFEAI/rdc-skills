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
 *
 * @typedef {object} NormalizedUnit
 * @property {string} name
 * @property {'class'|'module'} kind
 * @property {NormalizedMember[]} members
 * @property {boolean} hasBaseClass       - true if this unit extends/inherits from something
 * @property {number} concreteInstantiations - count of `new <LocalClass>()`-equivalent constructions of project-local types
 * @property {number} totalDependencies   - concreteInstantiations + count of distinct imported/injected names used
 *
 * @typedef {object} LanguagePlugin
 * @property {string} id
 * @property {(filePath: string) => boolean} canHandle
 * @property {(filePath: string, sourceText?: string) => NormalizedUnit[]} extractUnits
 * @property {(filePath: string, sourceText?: string) => string[]} importsOf   - module specifiers this file imports, for the boundary check
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
