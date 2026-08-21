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
