/**
 * nativeParser.ts — LanguageParser implementation via pre-built tree-sitter WASM.
 *
 * Implements the LanguageParser contract from @regen/codeflow using the native
 * web-tree-sitter bindings. Extracts symbols, interfaces, calls, and imports
 * from TypeScript, JavaScript, Python, C, C++, and C# source files.
 *
 * Design decisions:
 *   D2  — parser topology: native node-tree-sitter in PM2 service
 *   D3  — rich CALLS edge (call_line, receiver, resolved, arity, count)
 *   D10 — types live in @regen/codeflow (no new shared package)
 *   A2  — resolution_confidence scale per phase-f
 *   A3  — parse_status enum for false-RED guard
 */
import { type ParsedMember, type ParsedUnit, type SymbolReference } from './memberFacts.js';
export type { DeclaredName, MagicNumber, OverrideShape, ParsedMember, ParsedUnit, SwitchFact, SymbolReference, } from './memberFacts.js';
export interface ParseFileInput {
    path: string;
    content: string;
    language: string;
}
export interface ParsedSymbol {
    name: string;
    kind: string;
    exported: boolean;
    start_line: number;
    end_line: number;
    signature?: string;
    return_type?: string;
    decorators?: string[];
    complexity?: number;
}
export interface ParsedInterface {
    name: string;
    kind: string;
    exported: boolean;
    start_line: number;
    end_line: number;
}
export interface ParsedCall {
    caller: string;
    callee: string;
    call_line: number;
    receiver?: string;
    resolved: boolean;
    resolution_confidence: number;
    arity: number;
    count?: number;
}
export interface ParsedImport {
    source: string;
    specifiers: string[];
    line: number;
}
export type ParseStatus = 'parsed' | 'no_grammar' | 'parse_error' | 'legitimately_empty';
export interface ParseFileResult {
    path: string;
    language: string;
    symbols: ParsedSymbol[];
    interfaces: ParsedInterface[];
    calls: ParsedCall[];
    imports: ParsedImport[];
    parse_status: ParseStatus;
    /**
     * True when at least one function body hit `maxCallsPerFunction` and its
     * remaining calls were dropped.
     *
     * Without this, a capped file is INDISTINGUISHABLE from a fully-parsed one,
     * so any coverage figure computed over these results silently reports
     * truncated data as complete. The cap differs by surface on purpose
     * (local-index 50 for editor latency, hydration 200, evidence 500), which
     * makes the ambiguity worse, not better — the same file yields different
     * call counts depending on who parsed it, with nothing in the result saying so.
     */
    calls_truncated: boolean;
    /**
     * One entry per callable body — free function, class method, constructor,
     * accessor, lambda, nested helper — carrying the structural facts a
     * SOLID/Clean-Code/patterns/refactoring scorer reads.
     *
     * This is the surface that did not exist. `symbols`/`calls`/`imports` above
     * are the coarse view CodeFlow's graph consumes and are unchanged in shape.
     */
    members: ParsedMember[];
    /** One entry per class declared in the file. */
    units: ParsedUnit[];
    /**
     * For each symbol this file exports: how many times it is referenced in the
     * OTHER files of the same `parse()` batch, and which files those are.
     * `count: 0` with `files: []` is the dead-export signal.
     */
    references: SymbolReference[];
    /**
     * False when this language has no hand-written node-type profile and fell
     * back to the C-like defaults.
     *
     * A scorer must be able to tell "this member genuinely has no branches" from
     * "we asked a grammar the wrong node-type names and it truthfully answered
     * zero". That distinction is invisible in the numbers themselves, which is
     * precisely how python and csharp carried 0 CALLS for months while looking
     * like clean, call-free code.
     */
    profile_complete: boolean;
}
export interface LanguageParser {
    readonly id: string;
    readonly languages: string[];
    parse(files: ParseFileInput[]): Promise<ParseFileResult[]>;
}
/**
 * Create a native tree-sitter LanguageParser.
 */
export declare function createNativeParser(opts?: {
    maxCallsPerFunction?: number;
}): LanguageParser;
