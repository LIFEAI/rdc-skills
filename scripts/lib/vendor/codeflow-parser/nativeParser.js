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
import { loadGrammar } from './grammars.js';
import { buildReferenceGraph, countIdentifiers, extractMembers, hasLanguageProfile, resolveOverrideShapes, } from './memberFacts.js';
import { extractXml, isXmlLanguage, XML_LANGUAGES } from './xmlParser.js';
const DEFAULT_MAX_CALLS = 200;
// The tree-sitter node that represents "a call" is NAMED DIFFERENTLY IN EVERY
// GRAMMAR. This map is the whole reason python and csharp had 0 CALLS edges
// while carrying 20,871 and 10,076 symbols respectively: extractCallsFromBody
// tested `node.type === 'call_expression'` — true only for the C-like grammars —
// so the python and csharp walks ran to completion and matched nothing.
//
// All four shapes expose the SAME two fields (`function`, `arguments`), which is
// why only the type test varies below and the extraction body is shared.
const CALL_NODE_TYPES = {
    typescript: ['call_expression'],
    javascript: ['call_expression'],
    python: ['call'],
    c: ['call_expression'],
    cpp: ['call_expression'],
    csharp: ['invocation_expression'],
};
function callNodeTypesFor(language) {
    return CALL_NODE_TYPES[language] ?? ['call_expression'];
}
/**
 * Create a native tree-sitter LanguageParser.
 */
export function createNativeParser(opts) {
    const maxCalls = opts?.maxCallsPerFunction ?? DEFAULT_MAX_CALLS;
    let initialized = false;
    let initializationFailed = false;
    let ParserClass = null;
    let Language = null;
    const languageCache = new Map();
    async function ensureRuntime() {
        if (initialized)
            return !initializationFailed;
        initialized = true;
        try {
            const moduleName = 'web-tree-sitter';
            const mod = await import(/* @vite-ignore */ moduleName);
            ParserClass = mod.default ?? mod.Parser;
            if (!ParserClass?.init)
                throw new Error('web-tree-sitter runtime is unavailable');
            await ParserClass.init();
            Language = mod.Language ?? ParserClass.Language;
            return Boolean(Language);
        }
        catch {
            initializationFailed = true;
            return false;
        }
    }
    async function getLanguage(language) {
        const cached = languageCache.get(language);
        if (cached)
            return cached;
        const grammar = loadGrammar(language);
        if (!grammar.available || !grammar.grammar || !Language)
            return null;
        try {
            const loaded = await Language.load(grammar.grammar);
            languageCache.set(language, loaded);
            return loaded;
        }
        catch {
            return null;
        }
    }
    return {
        id: 'tree-sitter',
        languages: ['typescript', 'javascript', 'python', 'c', 'cpp', 'csharp', ...XML_LANGUAGES],
        async parse(files) {
            const results = [];
            const ready = await ensureRuntime();
            if (!ready || !ParserClass) {
                return files.map(file => emptyResult(file, 'parse_error'));
            }
            // Per-file identifier frequencies + exported names, collected during the
            // main loop so the cross-file reference pass costs one extra sweep of
            // already-parsed data rather than re-parsing anything.
            const referenceInputs = [];
            const factsByPath = new Map();
            for (const file of files) {
                try {
                    // XML-family documents are handled BEFORE grammar loading: there is
                    // no tree-sitter grammar for them, so the grammar path would return
                    // `no_grammar` and drop a BPMN process — a program with real nodes
                    // and real edges — on the floor.
                    if (isXmlLanguage(file.language)) {
                        const xml = extractXml(file.content, file.language);
                        const hasXmlContent = xml.symbols.length > 0;
                        factsByPath.set(file.path, { members: xml.members, units: xml.units });
                        referenceInputs.push({
                            path: file.path,
                            exportedNames: exportedNamesOf(xml.symbols, xml.interfaces),
                            identifierCounts: countXmlIdentifiers(xml),
                        });
                        results.push({
                            path: file.path,
                            language: file.language,
                            symbols: xml.symbols,
                            interfaces: xml.interfaces,
                            calls: xml.calls,
                            imports: xml.imports,
                            parse_status: hasXmlContent ? 'parsed' : 'legitimately_empty',
                            calls_truncated: false,
                            members: xml.members,
                            units: xml.units,
                            references: [],
                            profile_complete: true,
                        });
                        continue;
                    }
                    const grammar = await getLanguage(file.language);
                    if (!grammar) {
                        results.push(emptyResult(file, 'no_grammar'));
                        continue;
                    }
                    const parser = new ParserClass();
                    parser.setLanguage(grammar);
                    const tree = parser.parse(file.content);
                    if (!tree) {
                        results.push(emptyResult(file, 'parse_error'));
                        parser.delete?.();
                        continue;
                    }
                    const symbols = [];
                    const interfaces = [];
                    const calls = [];
                    const imports = [];
                    const rootNode = tree.rootNode;
                    // Declarations first: `calls` resolution tests a callee against the
                    // known-symbol set, so the roster has to be complete before any body
                    // is walked.
                    if (file.language === 'typescript' || file.language === 'javascript') {
                        extractTsJsSymbols(rootNode, file, symbols, interfaces, imports);
                    }
                    else if (file.language === 'python') {
                        extractPythonSymbols(rootNode, file, symbols, interfaces, imports);
                    }
                    else if (file.language === 'c' || file.language === 'cpp' || file.language === 'csharp') {
                        extractCFamilySymbols(rootNode, file, symbols, interfaces, imports);
                    }
                    // THE FIX. Calls used to be pulled only from bodies that were both
                    // exported and a top-level `function_declaration`, which excluded
                    // every class method, every arrow, every non-exported helper and
                    // every nested function — the majority of real code. Now one member
                    // walk decides what a callable body is, and both the fact surface
                    // and the call surface are driven from it.
                    const callNodeTypes = callNodeTypesFor(file.language);
                    let callsTruncated = false;
                    const facts = extractMembers(rootNode, file.language, (member, body) => {
                        // `caller` stays the BARE member name on purpose. CodeFlow's graph
                        // resolves a call edge by matching this against the symbol roster,
                        // and qualifying it (`Widget.render`) would leave every edge from a
                        // method unresolvable against a symbol recorded as `render`. The
                        // owner is not lost — `members[].owner` carries it for the
                        // validation engine, which is the consumer that needs the
                        // distinction between two same-named methods.
                        callsTruncated = extractCallsFromBody(member.name, body, symbols, calls, maxCalls, callNodeTypes) || callsTruncated;
                    });
                    // Class members were absent from `symbols` entirely in this parser —
                    // a class read as one opaque symbol with no methods. Add them, since
                    // a graph that cannot name a method cannot resolve a call to it.
                    appendMemberSymbols(facts.members, symbols);
                    factsByPath.set(file.path, facts);
                    referenceInputs.push({
                        path: file.path,
                        exportedNames: exportedNamesOf(symbols, interfaces),
                        identifierCounts: countIdentifiers(rootNode),
                    });
                    const hasContent = symbols.length > 0 || interfaces.length > 0;
                    const parseStatus = hasContent ? 'parsed' : 'legitimately_empty';
                    results.push({
                        path: file.path,
                        language: file.language,
                        symbols,
                        interfaces,
                        calls,
                        imports,
                        parse_status: parseStatus,
                        calls_truncated: callsTruncated,
                        members: facts.members,
                        units: facts.units,
                        references: [],
                        profile_complete: hasLanguageProfile(file.language),
                    });
                    tree.delete?.();
                    parser.delete?.();
                }
                catch {
                    results.push(emptyResult(file, 'parse_error'));
                }
            }
            // Batch passes. Both are deliberately AFTER the per-file loop: an
            // override's base class and a symbol's callers live in other files, and
            // resolving them mid-loop would make a file's output depend on the order
            // it happened to appear in — the exact non-determinism this parser must
            // not have.
            resolveOverrideShapes([...factsByPath.values()]);
            const referencesByPath = buildReferenceGraph(referenceInputs);
            for (const result of results) {
                result.references = referencesByPath.get(result.path) ?? [];
            }
            return results;
        },
    };
}
/**
 * The one shape an unparseable file takes.
 *
 * Written once because five hand-rolled copies is how `calls_truncated: false`
 * ended up duplicated on the same object literal — every future field on
 * `ParseFileResult` would otherwise need five identical edits, and a missed
 * one is a type error at best and a silently absent surface at worst.
 */
function emptyResult(file, status) {
    return {
        path: file.path,
        language: file.language,
        symbols: [],
        interfaces: [],
        calls: [],
        imports: [],
        parse_status: status,
        calls_truncated: false,
        members: [],
        units: [],
        references: [],
        profile_complete: hasLanguageProfile(file.language),
    };
}
/**
 * Add class members to the symbol roster.
 *
 * Only members that BELONG to a unit are added. A nested helper or a callback
 * inside a function body is a real member for scoring purposes but is not a
 * declaration anything outside the file can reference, and recording it as a
 * symbol produces the "nine symbols named genId from one file" problem — a
 * bigger index that is worse to search.
 */
function appendMemberSymbols(members, symbols) {
    const seen = new Set(symbols.map(s => `${s.name}:${s.start_line}`));
    for (const member of members) {
        if (!member.owner)
            continue;
        const key = `${member.name}:${member.start_line}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        symbols.push({
            name: member.name,
            kind: member.kind === 'function' ? 'method' : member.kind,
            exported: member.exported,
            start_line: member.start_line,
            end_line: member.end_line,
            return_type: member.return_type ?? undefined,
        });
    }
}
/**
 * Name frequencies for an XML document, so its symbols participate in the same
 * cross-file reference graph as code.
 *
 * A BPMN flow node referenced from another document (a call activity naming a
 * process, a DMN decision cited by a rule task) is a genuine cross-file
 * reference; excluding XML from the graph would report every process as a dead
 * export.
 */
function countXmlIdentifiers(xml) {
    const counts = new Map();
    const bump = (name) => {
        if (name)
            counts.set(name, (counts.get(name) ?? 0) + 1);
    };
    for (const symbol of xml.symbols)
        bump(symbol.name);
    for (const call of xml.calls) {
        bump(call.caller);
        bump(call.callee);
    }
    return counts;
}
/** Names this file exposes to other files — the reference-graph subjects. */
function exportedNamesOf(symbols, interfaces) {
    const names = new Set();
    for (const symbol of symbols)
        if (symbol.exported)
            names.add(symbol.name);
    for (const iface of interfaces)
        if (iface.exported)
            names.add(iface.name);
    return [...names].sort();
}
// ── TS/JS extraction ──────────────────────────────────────────────────────────
function isExported(node) {
    const parent = node.parent;
    if (!parent)
        return false;
    return parent.type === 'export_statement';
}
function getDeclarationNode(node) {
    if (node.type === 'export_statement') {
        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child && child.type !== 'comment')
                return child;
        }
        return null;
    }
    return node;
}
/**
 * Top-level declarations for the coarse symbol roster.
 *
 * Deliberately still top-level-only: this produces the FILE's public shape.
 * Members inside those declarations are produced by `extractMembers` and
 * merged in by `appendMemberSymbols`, so the two concerns stay separable and
 * neither has to know the other's traversal rules.
 */
function extractTsJsSymbols(rootNode, file, symbols, interfaces, imports) {
    for (let i = 0; i < rootNode.namedChildCount; i++) {
        const topNode = rootNode.namedChild(i);
        if (!topNode)
            continue;
        const exported = topNode.type === 'export_statement';
        const declNode = getDeclarationNode(topNode);
        if (!declNode)
            continue;
        switch (declNode.type) {
            case 'function_declaration': {
                const nameNode = declNode.childForFieldName('name');
                if (nameNode) {
                    const returnTypeNode = declNode.childForFieldName('return_type');
                    symbols.push({
                        name: nameNode.text,
                        kind: 'function',
                        exported,
                        start_line: declNode.startPosition.row + 1,
                        end_line: declNode.endPosition.row + 1,
                        return_type: returnTypeNode?.text?.replace(/^:\s*/, ''),
                    });
                }
                break;
            }
            case 'class_declaration': {
                const nameNode = declNode.childForFieldName('name');
                if (nameNode) {
                    symbols.push({
                        name: nameNode.text,
                        kind: 'class',
                        exported,
                        start_line: declNode.startPosition.row + 1,
                        end_line: declNode.endPosition.row + 1,
                    });
                }
                break;
            }
            case 'lexical_declaration': {
                for (let j = 0; j < declNode.namedChildCount; j++) {
                    const declarator = declNode.namedChild(j);
                    if (!declarator || declarator.type !== 'variable_declarator')
                        continue;
                    const nameNode = declarator.childForFieldName('name');
                    const valueNode = declarator.childForFieldName('value');
                    if (!nameNode)
                        continue;
                    let kind = 'const';
                    if (valueNode) {
                        const vt = valueNode.type;
                        if (vt === 'arrow_function' || vt === 'function_expression' || vt === 'function') {
                            kind = 'function';
                        }
                        else if (vt === 'class_expression' || vt === 'class') {
                            kind = 'class';
                        }
                        else {
                            kind = 'variable';
                        }
                    }
                    symbols.push({
                        name: nameNode.text,
                        kind,
                        exported,
                        start_line: declNode.startPosition.row + 1,
                        end_line: declNode.endPosition.row + 1,
                    });
                }
                break;
            }
            case 'interface_declaration': {
                const nameNode = declNode.childForFieldName('name');
                if (nameNode) {
                    interfaces.push({
                        name: nameNode.text,
                        kind: 'interface',
                        exported,
                        start_line: declNode.startPosition.row + 1,
                        end_line: declNode.endPosition.row + 1,
                    });
                }
                break;
            }
            case 'type_alias_declaration': {
                const nameNode = declNode.childForFieldName('name');
                if (nameNode) {
                    interfaces.push({
                        name: nameNode.text,
                        kind: 'type_alias',
                        exported,
                        start_line: declNode.startPosition.row + 1,
                        end_line: declNode.endPosition.row + 1,
                    });
                }
                break;
            }
        }
    }
    extractTsJsImports(rootNode, imports);
}
function extractCallsFromBody(callerName, bodyNode, symbols, calls, maxCalls, callNodeTypes = ['call_expression']) {
    const knownSymbols = new Set(symbols.map(s => s.name));
    const callMap = new Map();
    function walkForCalls(node, count) {
        if (count >= maxCalls)
            return count;
        if (callNodeTypes.includes(node.type)) {
            count++;
            const fnNode = node.childForFieldName('function');
            if (fnNode) {
                const fnText = fnNode.text;
                // Member access is spelled `.` in TS/JS/python/C#, but `->` and `::` in
                // C/C++. Split on all three so a C++ `obj->method()` yields callee
                // `method` with receiver `obj`, not one opaque `obj->method` callee.
                const parts = fnText.split(/->|::|\./);
                const calleeName = parts[parts.length - 1];
                const receiver = parts.length > 1 ? parts.slice(0, -1).join('.') : undefined;
                const argsNode = node.childForFieldName('arguments');
                const arity = argsNode ? argsNode.namedChildCount : 0;
                const callLine = node.startPosition.row + 1;
                const resolved = knownSymbols.has(calleeName);
                const resolution_confidence = resolved ? 0.9 : 0.0;
                const aggKey = `${callerName}→${calleeName}`;
                const existing = callMap.get(aggKey);
                if (existing) {
                    existing.count = (existing.count ?? 1) + 1;
                }
                else {
                    callMap.set(aggKey, {
                        caller: callerName,
                        callee: calleeName,
                        call_line: callLine,
                        receiver,
                        resolved,
                        resolution_confidence,
                        arity,
                        count: 1,
                    });
                }
            }
        }
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child)
                count = walkForCalls(child, count);
        }
        return count;
    }
    const visited = walkForCalls(bodyNode, 0);
    for (const call of callMap.values()) {
        calls.push(call);
    }
    return visited >= maxCalls;
}
function extractTsJsImports(rootNode, imports) {
    for (let i = 0; i < rootNode.namedChildCount; i++) {
        const node = rootNode.namedChild(i);
        if (!node || node.type !== 'import_statement')
            continue;
        const sourceNode = node.childForFieldName('source');
        if (!sourceNode)
            continue;
        const source = sourceNode.text.replace(/^['"]|['"]$/g, '');
        const specifiers = [];
        for (let j = 0; j < node.namedChildCount; j++) {
            const child = node.namedChild(j);
            if (!child)
                continue;
            if (child.type === 'import_clause') {
                for (let k = 0; k < child.namedChildCount; k++) {
                    const clauseChild = child.namedChild(k);
                    if (!clauseChild)
                        continue;
                    if (clauseChild.type === 'identifier') {
                        specifiers.push(clauseChild.text);
                    }
                    else if (clauseChild.type === 'named_imports') {
                        for (let m = 0; m < clauseChild.namedChildCount; m++) {
                            const specNode = clauseChild.namedChild(m);
                            if (specNode && specNode.type === 'import_specifier') {
                                const nameNode = specNode.childForFieldName('name');
                                if (nameNode)
                                    specifiers.push(nameNode.text);
                            }
                        }
                    }
                    else if (clauseChild.type === 'namespace_import') {
                        const nameNode = clauseChild.namedChild(0);
                        if (nameNode)
                            specifiers.push(`* as ${nameNode.text}`);
                    }
                }
            }
        }
        imports.push({ source, specifiers, line: node.startPosition.row + 1 });
    }
}
// ── Python extraction ─────────────────────────────────────────────────────────
function extractPythonSymbols(rootNode, file, symbols, interfaces, imports) {
    // RECURSIVE, deliberately. This walk was previously a single pass over
    // rootNode.namedChild(i) — top level only — so every method inside a class
    // was invisible: not a symbol, and therefore not a possible caller either.
    function walk(node) {
        switch (node.type) {
            case 'function_definition': {
                const nameNode = node.childForFieldName('name');
                if (nameNode) {
                    // Python exported = not underscore-prefixed (per assignment)
                    const name = nameNode.text;
                    symbols.push({
                        name,
                        kind: 'function',
                        exported: !name.startsWith('_'),
                        start_line: node.startPosition.row + 1,
                        end_line: node.endPosition.row + 1,
                    });
                }
                break;
            }
            case 'class_definition': {
                const nameNode = node.childForFieldName('name');
                if (nameNode) {
                    const name = nameNode.text;
                    symbols.push({
                        name,
                        kind: 'class',
                        exported: !name.startsWith('_'),
                        start_line: node.startPosition.row + 1,
                        end_line: node.endPosition.row + 1,
                    });
                }
                break;
            }
            case 'expression_statement': {
                const child = node.namedChild(0);
                if (child && child.type === 'assignment') {
                    const leftNode = child.childForFieldName('left');
                    if (leftNode && leftNode.type === 'identifier') {
                        const name = leftNode.text;
                        symbols.push({
                            name,
                            kind: 'variable',
                            exported: !name.startsWith('_'),
                            start_line: node.startPosition.row + 1,
                            end_line: node.endPosition.row + 1,
                        });
                    }
                }
                break;
            }
            case 'import_statement':
            case 'import_from_statement': {
                extractPythonImport(node, imports);
                return; // import internals hold no symbols worth descending into
            }
        }
        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child)
                walk(child);
        }
    }
    walk(rootNode);
}
function extractPythonImport(node, imports) {
    if (node.type === 'import_statement') {
        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child && (child.type === 'dotted_name' || child.type === 'aliased_import')) {
                const name = child.type === 'aliased_import'
                    ? (child.childForFieldName('name')?.text ?? child.text)
                    : child.text;
                imports.push({
                    source: name,
                    specifiers: [],
                    line: node.startPosition.row + 1,
                });
            }
        }
    }
    else if (node.type === 'import_from_statement') {
        const moduleNode = node.childForFieldName('module_name');
        const source = moduleNode?.text ?? '';
        const specifiers = [];
        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child && child.type === 'dotted_name' && child !== moduleNode) {
                specifiers.push(child.text);
            }
            else if (child && child.type === 'aliased_import') {
                const nameNode = child.childForFieldName('name');
                if (nameNode)
                    specifiers.push(nameNode.text);
            }
        }
        imports.push({ source, specifiers, line: node.startPosition.row + 1 });
    }
}
// ── C, C++, and C# extraction ───────────────────────────────────────────────
function extractCFamilySymbols(rootNode, file, symbols, interfaces, imports) {
    const seenSymbols = new Set();
    const seenInterfaces = new Set();
    function addSymbol(node, kind) {
        const name = getCFamilyName(node);
        if (!name || seenSymbols.has(`${kind}:${name}:${node.startIndex}`))
            return;
        seenSymbols.add(`${kind}:${name}:${node.startIndex}`);
        symbols.push({
            name,
            kind,
            exported: isCFamilyExported(node, file.language),
            start_line: node.startPosition.row + 1,
            end_line: node.endPosition.row + 1,
            signature: getCFamilySignature(node),
        });
    }
    function addInterface(node, kind) {
        const name = getCFamilyName(node);
        if (!name || seenInterfaces.has(`${kind}:${name}:${node.startIndex}`))
            return;
        seenInterfaces.add(`${kind}:${name}:${node.startIndex}`);
        interfaces.push({
            name,
            kind,
            exported: isCFamilyExported(node, file.language),
            start_line: node.startPosition.row + 1,
            end_line: node.endPosition.row + 1,
        });
    }
    function walk(node) {
        switch (node.type) {
            case 'function_definition':
            case 'function_declaration':
            case 'method_declaration':
            case 'constructor_declaration': {
                addSymbol(node, 'function');
                break;
            }
            case 'class_specifier':
            case 'class_declaration':
            case 'struct_specifier':
            case 'struct_declaration':
                addSymbol(node, 'class');
                break;
            case 'enum_specifier':
            case 'enum_declaration':
                addSymbol(node, 'enum');
                break;
            case 'interface_declaration':
                addInterface(node, 'interface');
                break;
            case 'preproc_include':
                addCFamilyInclude(node, imports);
                break;
            case 'using_directive':
                addCSharpUsing(node, imports);
                break;
        }
        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (child)
                walk(child);
        }
    }
    walk(rootNode);
}
function getCFamilyName(node) {
    const named = node.childForFieldName('name');
    if (named?.text)
        return named.text;
    const declarator = node.childForFieldName('declarator');
    if (declarator) {
        const name = findCFamilyIdentifier(declarator);
        if (name)
            return name;
    }
    return findCFamilyIdentifier(node);
}
function findCFamilyIdentifier(node) {
    if (node.type === 'identifier' || node.type === 'type_identifier')
        return node.text;
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        const name = child ? findCFamilyIdentifier(child) : undefined;
        if (name)
            return name;
    }
    return undefined;
}
function getCFamilySignature(node) {
    const rawText = String(node.text ?? '').trim();
    if (!rawText)
        return undefined;
    const bodyNode = node.childForFieldName('body');
    let signature = bodyNode?.startIndex > node.startIndex
        ? rawText.slice(0, bodyNode.startIndex - node.startIndex).trim()
        : rawText;
    if (!bodyNode) {
        const bodyStart = signature.indexOf('{');
        if (bodyStart >= 0)
            signature = signature.slice(0, bodyStart).trim();
    }
    signature = signature
        .replace(/\s+/g, ' ')
        .replace(/[;{]\s*$/, '')
        .trim();
    return signature.length > 300 ? `${signature.slice(0, 297)}...` : signature;
}
function isCFamilyExported(node, language) {
    if (language !== 'csharp')
        return true;
    return /\bpublic\b/.test(node.text);
}
function addCFamilyInclude(node, imports) {
    const match = node.text.match(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/);
    if (match)
        imports.push({ source: match[1], specifiers: [], line: node.startPosition.row + 1 });
}
function addCSharpUsing(node, imports) {
    const name = node.childForFieldName('name')?.text
        ?? node.text.replace(/^\s*using\s+/, '').replace(/;\s*$/, '').trim();
    if (name)
        imports.push({ source: name, specifiers: [], line: node.startPosition.row + 1 });
}
//# sourceMappingURL=nativeParser.js.map