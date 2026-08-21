/**
 * grammars.ts — Pre-built WASM grammar registry for CodeFlow parsing.
 *
 * Grammar assets are resolved from tree-sitter-wasms, avoiding the native
 * Node ABI dependency that makes tree-sitter unavailable on newer runtimes.
 */
export interface GrammarInfo {
    language: string;
    /** npm package containing the pre-built grammar asset */
    packageName: string;
    /** Version from the installed package */
    version: string;
    /** Whether the grammar asset resolved successfully */
    available: boolean;
    /** Resolved .wasm grammar path (null if unavailable) */
    grammar: string | null;
}
/** Resolve a grammar asset by language identifier. */
export declare function loadGrammar(language: string): GrammarInfo;
/** Load all known grammars and return their status. */
export declare function loadAllGrammars(): GrammarInfo[];
/** Get the list of supported languages (those with available grammar assets). */
export declare function getSupportedLanguages(): string[];
