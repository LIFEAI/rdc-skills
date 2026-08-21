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
const DEFAULT_MAX_CALLS = 200;
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
        languages: ['typescript', 'javascript', 'python', 'c', 'cpp', 'csharp'],
        async parse(files) {
            const results = [];
            const ready = await ensureRuntime();
            if (!ready || !ParserClass) {
                return files.map(file => ({
                    path: file.path,
                    language: file.language,
                    symbols: [],
                    interfaces: [],
                    calls: [],
                    imports: [],
                    parse_status: 'parse_error',
                }));
            }
            for (const file of files) {
                try {
                    const grammar = await getLanguage(file.language);
                    if (!grammar) {
                        results.push({
                            path: file.path,
                            language: file.language,
                            symbols: [],
                            interfaces: [],
                            calls: [],
                            imports: [],
                            parse_status: 'no_grammar',
                        });
                        continue;
                    }
                    const parser = new ParserClass();
                    parser.setLanguage(grammar);
                    const tree = parser.parse(file.content);
                    if (!tree) {
                        results.push({
                            path: file.path,
                            language: file.language,
                            symbols: [],
                            interfaces: [],
                            calls: [],
                            imports: [],
                            parse_status: 'parse_error',
                        });
                        parser.delete?.();
                        continue;
                    }
                    const symbols = [];
                    const interfaces = [];
                    const calls = [];
                    const imports = [];
                    const rootNode = tree.rootNode;
                    if (file.language === 'typescript' || file.language === 'javascript') {
                        extractTsJsSymbols(rootNode, file, symbols, interfaces, calls, imports, maxCalls);
                    }
                    else if (file.language === 'python') {
                        extractPythonSymbols(rootNode, file, symbols, interfaces, calls, imports, maxCalls);
                    }
                    else if (file.language === 'c' || file.language === 'cpp' || file.language === 'csharp') {
                        extractCFamilySymbols(rootNode, file, symbols, interfaces, imports);
                    }
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
                    });
                    tree.delete?.();
                    parser.delete?.();
                }
                catch {
                    results.push({
                        path: file.path,
                        language: file.language,
                        symbols: [],
                        interfaces: [],
                        calls: [],
                        imports: [],
                        parse_status: 'parse_error',
                    });
                }
            }
            return results;
        },
    };
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
function extractTsJsSymbols(rootNode, file, symbols, interfaces, calls, imports, maxCalls) {
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
        // Extract calls from exported function bodies
        if (exported && declNode.type === 'function_declaration') {
            const nameNode = declNode.childForFieldName('name');
            const body = declNode.childForFieldName('body');
            if (nameNode && body) {
                extractCallsFromBody(nameNode.text, body, symbols, calls, maxCalls);
            }
        }
    }
    extractTsJsImports(rootNode, imports);
}
function extractCallsFromBody(callerName, bodyNode, symbols, calls, maxCalls) {
    const knownSymbols = new Set(symbols.map(s => s.name));
    const callMap = new Map();
    function walkForCalls(node, count) {
        if (count >= maxCalls)
            return count;
        if (node.type === 'call_expression') {
            count++;
            const fnNode = node.childForFieldName('function');
            if (fnNode) {
                const fnText = fnNode.text;
                const parts = fnText.split('.');
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
    walkForCalls(bodyNode, 0);
    for (const call of callMap.values()) {
        calls.push(call);
    }
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
function extractPythonSymbols(rootNode, file, symbols, interfaces, calls, imports, maxCalls) {
    for (let i = 0; i < rootNode.namedChildCount; i++) {
        const node = rootNode.namedChild(i);
        if (!node)
            continue;
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
                break;
            }
        }
    }
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
            case 'constructor_declaration':
                addSymbol(node, 'function');
                break;
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