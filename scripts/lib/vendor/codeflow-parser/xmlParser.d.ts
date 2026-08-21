/**
 * xmlParser.ts — XML, BPMN and DMN extraction, without a tree-sitter grammar.
 *
 * WHY NOT tree-sitter
 * -------------------
 * The grammar set shipped here has no XML. The choice is therefore between
 * adding a WASM grammar (a new binary artifact, a new load path, a new failure
 * mode at boot) and tokenizing a format whose entire syntax is angle brackets
 * and quoted attributes. XML is regular enough at the tag level that the second
 * is smaller, has no runtime dependency, and cannot fail to load.
 *
 * The limits of that choice, stated rather than discovered later: this reads
 * TAGS and ATTRIBUTES. It does not validate, resolve namespaces, expand
 * entities, or parse DTDs. It is a structural index, not an XML processor, and
 * anything that needs real XML semantics must not use it.
 *
 * WHY BPMN GETS ITS OWN TREATMENT
 * -------------------------------
 * A BPMN file is not decoration — it is a program, and it already has the exact
 * shape the rest of this parser emits:
 *
 *   `bpmn:process`                  → a unit, like a class
 *   `userTask` / `serviceTask` / …  → members, like methods
 *   `sequenceFlow src → tgt`        → a CALL edge, precisely
 *
 * Indexing one as generic XML would record 32 elements with ids and lose all 36
 * edges between them — the part that makes it a program rather than a list. The
 * repository's own onramp BPMN is 36 sequence flows over 32 flow nodes; as
 * generic XML that graph is invisible.
 *
 * DETERMINISM: source order throughout, line numbers from the byte offset, no
 * timestamps, no path resolution.
 */
import type { ParsedCall, ParsedImport, ParsedInterface, ParsedSymbol } from './nativeParser.js';
import type { ParsedMember, ParsedUnit } from './memberFacts.js';
/** Languages this module handles, keyed by the caller's language string. */
export declare const XML_LANGUAGES: readonly ["xml", "bpmn", "dmn", "xsd", "svg"];
export declare function isXmlLanguage(language: string): boolean;
/** One tag occurrence, with its attributes and 1-based line. */
interface Tag {
    /** Local name with any namespace prefix stripped. */
    name: string;
    /** Name exactly as written, prefix included. */
    raw: string;
    attrs: Record<string, string>;
    line: number;
    selfClosing: boolean;
    closing: boolean;
}
/**
 * Tokenize tags out of an XML document.
 *
 * Comments, CDATA, processing instructions and the prolog are skipped as spans
 * rather than parsed — a `<` inside a comment is not a tag, and treating it as
 * one is the classic way a regex "XML parser" invents structure that is not
 * there.
 */
export declare function tokenizeTags(content: string): Tag[];
export interface XmlExtraction {
    symbols: ParsedSymbol[];
    interfaces: ParsedInterface[];
    calls: ParsedCall[];
    imports: ParsedImport[];
    members: ParsedMember[];
    units: ParsedUnit[];
}
/**
 * Decide which dialect a document is, from its CONTENT rather than its
 * extension.
 *
 * The repository's own BPMN ships as `.bpmn20.xml`, so an extension test would
 * classify the one real BPMN file here as generic XML and drop every edge in
 * it. The root element is the thing that actually says what a document is.
 */
export declare function detectXmlDialect(tags: Tag[], language: string): 'bpmn' | 'dmn' | 'xml';
export declare function extractXml(content: string, language: string): XmlExtraction;
export {};
