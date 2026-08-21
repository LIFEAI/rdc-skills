/**
 * grammars.ts — Pre-built WASM grammar registry for CodeFlow parsing.
 *
 * Grammar assets are resolved from tree-sitter-wasms, avoiding the native
 * Node ABI dependency that makes tree-sitter unavailable on newer runtimes.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const GRAMMAR_FILES = {
    typescript: 'tree-sitter-typescript.wasm',
    javascript: 'tree-sitter-javascript.wasm',
    python: 'tree-sitter-python.wasm',
    c: 'tree-sitter-c.wasm',
    cpp: 'tree-sitter-cpp.wasm',
    csharp: 'tree-sitter-c_sharp.wasm',
};
const PACKAGE_NAME = 'tree-sitter-wasms';
const _cache = new Map();
/** Resolve a grammar asset by language identifier. */
export function loadGrammar(language) {
    const cached = _cache.get(language);
    if (cached)
        return cached;
    const grammarFile = GRAMMAR_FILES[language];
    if (!grammarFile) {
        const info = { language, packageName: '', version: '', available: false, grammar: null };
        _cache.set(language, info);
        return info;
    }
    try {
        const grammar = require.resolve(`${PACKAGE_NAME}/out/${grammarFile}`);
        let version = '';
        try {
            version = require(`${PACKAGE_NAME}/package.json`).version ?? '';
        }
        catch {
            // Package metadata is optional; the resolved asset is the availability proof.
        }
        const info = { language, packageName: PACKAGE_NAME, version, available: true, grammar };
        _cache.set(language, info);
        return info;
    }
    catch {
        const info = { language, packageName: PACKAGE_NAME, version: '', available: false, grammar: null };
        _cache.set(language, info);
        return info;
    }
}
/** Load all known grammars and return their status. */
export function loadAllGrammars() {
    return Object.keys(GRAMMAR_FILES).map(loadGrammar);
}
/** Get the list of supported languages (those with available grammar assets). */
export function getSupportedLanguages() {
    return loadAllGrammars().filter(grammar => grammar.available).map(grammar => grammar.language);
}
//# sourceMappingURL=grammars.js.map