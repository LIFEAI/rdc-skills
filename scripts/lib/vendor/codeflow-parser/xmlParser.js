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
/** Languages this module handles, keyed by the caller's language string. */
export const XML_LANGUAGES = ['xml', 'bpmn', 'dmn', 'xsd', 'svg'];
export function isXmlLanguage(language) {
    return XML_LANGUAGES.includes(language);
}
const ATTR_RE = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
/**
 * Tokenize tags out of an XML document.
 *
 * Comments, CDATA, processing instructions and the prolog are skipped as spans
 * rather than parsed — a `<` inside a comment is not a tag, and treating it as
 * one is the classic way a regex "XML parser" invents structure that is not
 * there.
 */
export function tokenizeTags(content) {
    const tags = [];
    // Precompute line starts once; per-tag line lookup is then a binary search
    // instead of counting newlines from the top for every tag, which is what
    // turns a large document from linear into quadratic.
    const lineStarts = [0];
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10)
            lineStarts.push(i + 1);
    }
    const lineAt = (offset) => {
        let lo = 0;
        let hi = lineStarts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (lineStarts[mid] <= offset)
                lo = mid;
            else
                hi = mid - 1;
        }
        return lo + 1;
    };
    let i = 0;
    while (i < content.length) {
        const lt = content.indexOf('<', i);
        if (lt === -1)
            break;
        if (content.startsWith('<!--', lt)) {
            const end = content.indexOf('-->', lt + 4);
            i = end === -1 ? content.length : end + 3;
            continue;
        }
        if (content.startsWith('<![CDATA[', lt)) {
            const end = content.indexOf(']]>', lt + 9);
            i = end === -1 ? content.length : end + 3;
            continue;
        }
        if (content.startsWith('<?', lt) || content.startsWith('<!', lt)) {
            const end = content.indexOf('>', lt + 2);
            i = end === -1 ? content.length : end + 1;
            continue;
        }
        const gt = content.indexOf('>', lt);
        if (gt === -1)
            break;
        const inner = content.slice(lt + 1, gt);
        i = gt + 1;
        if (inner.length === 0)
            continue;
        const closing = inner.startsWith('/');
        const selfClosing = inner.endsWith('/');
        const body = inner.replace(/^\//, '').replace(/\/$/, '');
        const nameMatch = /^([\w:.-]+)/.exec(body);
        if (!nameMatch)
            continue;
        const raw = nameMatch[1];
        const attrs = {};
        if (!closing) {
            ATTR_RE.lastIndex = nameMatch[0].length;
            for (let m = ATTR_RE.exec(body); m !== null; m = ATTR_RE.exec(body)) {
                attrs[m[1]] = m[3] ?? m[4] ?? '';
            }
        }
        tags.push({
            name: raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw,
            raw,
            attrs,
            line: lineAt(lt),
            selfClosing,
            closing,
        });
    }
    return tags;
}
/** BPMN element names that are flow NODES — the members of a process. */
const BPMN_FLOW_NODES = new Set([
    'startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent',
    'boundaryEvent', 'task', 'userTask', 'serviceTask', 'scriptTask', 'manualTask',
    'businessRuleTask', 'sendTask', 'receiveTask', 'callActivity', 'subProcess',
    'transaction', 'exclusiveGateway', 'parallelGateway', 'inclusiveGateway',
    'eventBasedGateway', 'complexGateway',
]);
/** BPMN element names that own a set of flow nodes — the units. */
const BPMN_UNITS = new Set(['process', 'subProcess', 'collaboration', 'transaction']);
/** DMN elements that behave as members and as edge endpoints. */
const DMN_NODES = new Set(['decision', 'inputData', 'businessKnowledgeModel', 'knowledgeSource']);
function emptyMember(name, owner, kind, line) {
    return {
        name,
        owner,
        kind,
        exported: true,
        isStatic: false,
        start_line: line,
        end_line: line,
        return_type: null,
        paramCount: 0,
        declaredNames: [],
        statementCount: 0,
        statementTexts: [],
        fieldAccess: [],
        calleeNames: [],
        deepChainCallCount: 0,
        constructorNewCallTargets: [],
        branchHits: 0,
        switchStatements: [],
        complexConditionals: [],
        nullChecks: 0,
        magicNumbers: [],
        emptyCatches: 0,
        deadConditionals: 0,
        override: {
            callsSuper: false,
            baseClass: null,
            baseParamCount: null,
            paramCountDrift: null,
            baseReturnType: null,
            returnTypeDrift: null,
        },
    };
}
/**
 * Decide which dialect a document is, from its CONTENT rather than its
 * extension.
 *
 * The repository's own BPMN ships as `.bpmn20.xml`, so an extension test would
 * classify the one real BPMN file here as generic XML and drop every edge in
 * it. The root element is the thing that actually says what a document is.
 */
export function detectXmlDialect(tags, language) {
    if (language === 'bpmn')
        return 'bpmn';
    if (language === 'dmn')
        return 'dmn';
    for (const tag of tags) {
        if (tag.closing)
            continue;
        if (tag.name === 'definitions') {
            const ns = Object.entries(tag.attrs).find(([k]) => k.startsWith('xmlns'));
            const value = ns?.[1] ?? '';
            if (/BPMN/i.test(value) || tag.raw.startsWith('bpmn'))
                return 'bpmn';
            if (/DMN/i.test(value) || tag.raw.startsWith('dmn'))
                return 'dmn';
        }
        if (tag.name === 'process' || tag.name === 'collaboration')
            return 'bpmn';
        if (tag.name === 'decision')
            return 'dmn';
        break;
    }
    return 'xml';
}
export function extractXml(content, language) {
    const tags = tokenizeTags(content);
    const dialect = detectXmlDialect(tags, language);
    const symbols = [];
    const interfaces = [];
    const calls = [];
    const imports = [];
    const members = [];
    const units = [];
    // A flow node's id is what edges reference, but its NAME is what a human
    // reads. Both are kept: symbols are indexed under the readable name, and this
    // map resolves an edge's id reference back to it.
    const idToName = new Map();
    const unitStack = [];
    // Read through the stack rather than mirroring its top in a separate
    // variable: one source of truth for "which unit are we inside", and no way
    // for the mirror to drift out of step with a push or pop.
    const currentUnit = () => unitStack[unitStack.length - 1] ?? null;
    // Namespace declarations are this format's imports — they say which
    // vocabularies the document depends on, which is exactly what an import is.
    for (const tag of tags) {
        if (tag.closing)
            continue;
        for (const [key, value] of Object.entries(tag.attrs)) {
            if (key === 'xmlns' || key.startsWith('xmlns:')) {
                const alias = key === 'xmlns' ? '*' : key.slice('xmlns:'.length);
                if (!imports.some(imp => imp.source === value)) {
                    imports.push({ source: value, specifiers: [alias], line: tag.line });
                }
            }
        }
    }
    // Pass 1: ids → readable names, so an edge declared before its target still
    // resolves. Source order cannot be relied on for references in XML.
    for (const tag of tags) {
        if (tag.closing)
            continue;
        const id = tag.attrs.id;
        if (id)
            idToName.set(id, tag.attrs.name || id);
    }
    /**
     * `emitSymbol` is false when the caller has already recorded this element —
     * the generic-XML branch indexes an element and THEN opens it as a unit, and
     * pushing from both sites listed the document root twice.
     */
    const openUnit = (tag, emitSymbol = true) => {
        const name = tag.attrs.id || tag.attrs.name || tag.name;
        const unit = {
            name,
            kind: 'class',
            exported: true,
            start_line: tag.line,
            end_line: tag.line,
            baseClass: null,
            hasBaseClass: false,
            concreteInstantiations: 0,
            totalDependencies: 0,
            staticPropertyNames: [],
            hasGetInstanceMethod: false,
            memberNames: [],
        };
        units.push(unit);
        if (emitSymbol) {
            symbols.push({
                name,
                kind: dialect === 'bpmn' ? 'process' : 'element',
                exported: true,
                start_line: tag.line,
                end_line: tag.line,
            });
        }
        unitStack.push(unit);
    };
    const closeUnit = (tag) => {
        const closed = unitStack.pop();
        if (closed)
            closed.end_line = tag.line;
    };
    for (const tag of tags) {
        if (tag.closing) {
            if ((dialect === 'bpmn' && BPMN_UNITS.has(tag.name))
                || (dialect === 'dmn' && tag.name === 'definitions')
                || (dialect === 'xml' && unitStack.length > 0 && unitStack[unitStack.length - 1].name === tag.name)) {
                closeUnit(tag);
            }
            continue;
        }
        if (dialect === 'bpmn') {
            if (BPMN_UNITS.has(tag.name)) {
                // A subProcess is both a member of its parent and a unit of its own.
                if (tag.name === 'subProcess' && currentUnit()) {
                    const memberName = tag.attrs.name || tag.attrs.id || tag.name;
                    members.push(emptyMember(memberName, currentUnit()?.name ?? null, 'method', tag.line));
                    currentUnit()?.memberNames.push(memberName);
                }
                if (!tag.selfClosing)
                    openUnit(tag);
                continue;
            }
            if (BPMN_FLOW_NODES.has(tag.name)) {
                const name = tag.attrs.name || tag.attrs.id || tag.name;
                symbols.push({
                    name,
                    kind: tag.name,
                    exported: true,
                    start_line: tag.line,
                    end_line: tag.line,
                });
                const member = emptyMember(name, currentUnit()?.name ?? null, 'method', tag.line);
                // A gateway IS a branch. Recording it as one lets the same complexity
                // signal cover a process definition and the code it compiles to.
                if (/Gateway$/.test(tag.name))
                    member.branchHits = 1;
                members.push(member);
                currentUnit()?.memberNames.push(name);
                continue;
            }
            if (tag.name === 'sequenceFlow') {
                const from = tag.attrs.sourceRef;
                const to = tag.attrs.targetRef;
                if (from && to) {
                    calls.push({
                        caller: idToName.get(from) ?? from,
                        callee: idToName.get(to) ?? to,
                        call_line: tag.line,
                        resolved: idToName.has(to),
                        resolution_confidence: idToName.has(to) ? 0.9 : 0.0,
                        arity: 0,
                        count: 1,
                    });
                }
                continue;
            }
            continue;
        }
        if (dialect === 'dmn') {
            if (tag.name === 'definitions' && !tag.selfClosing) {
                openUnit(tag);
                continue;
            }
            if (DMN_NODES.has(tag.name)) {
                const name = tag.attrs.name || tag.attrs.id || tag.name;
                symbols.push({
                    name, kind: tag.name, exported: true, start_line: tag.line, end_line: tag.line,
                });
                members.push(emptyMember(name, currentUnit()?.name ?? null, 'method', tag.line));
                currentUnit()?.memberNames.push(name);
                continue;
            }
            // A requirement edge names its source in an href like `#decision_id`.
            // There was a `continue` here for exactly these element names, which
            // skipped the href read below and discarded every DMN edge in the
            // document — the one thing this branch exists to capture.
            const href = tag.attrs.href;
            if (href?.startsWith('#')) {
                const target = href.slice(1);
                const owner = currentUnit()?.name;
                if (owner) {
                    calls.push({
                        caller: owner,
                        callee: idToName.get(target) ?? target,
                        call_line: tag.line,
                        resolved: idToName.has(target),
                        resolution_confidence: idToName.has(target) ? 0.9 : 0.0,
                        arity: 0,
                        count: 1,
                    });
                }
            }
            continue;
        }
        // Generic XML: an element carrying an id or a name is a thing worth
        // indexing. An element carrying neither is structure, not content — the
        // 30,000 anonymous `<g>` elements in an SVG are not symbols, and recording
        // them would bury the ones that are.
        const identity = tag.attrs.id || tag.attrs.name;
        if (identity) {
            symbols.push({
                name: identity,
                kind: tag.name,
                exported: true,
                start_line: tag.line,
                end_line: tag.line,
            });
            if (unitStack.length === 0 && !tag.selfClosing) {
                openUnit(tag, false);
            }
            else {
                members.push(emptyMember(identity, currentUnit()?.name ?? null, 'method', tag.line));
                currentUnit()?.memberNames.push(identity);
            }
        }
    }
    for (const unit of units) {
        unit.totalDependencies = new Set(calls.filter(c => unit.memberNames.includes(c.caller)).map(c => c.callee)).size;
    }
    return { symbols, interfaces, calls, imports, members, units };
}
//# sourceMappingURL=xmlParser.js.map