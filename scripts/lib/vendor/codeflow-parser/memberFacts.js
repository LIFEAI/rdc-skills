/**
 * memberFacts.ts — per-member structural facts for the validation engine.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `nativeParser.ts` extracted calls only under
 * `exported && declNode.type === 'function_declaration'`. Class methods —
 * which are most of what SOLID / Clean Code / design-pattern / refactoring
 * scoring actually reads — produced nothing at all: no calls, and in
 * nativeParser not even a symbol. A scorer fed that surface cannot tell an
 * empty class from an unparsed one.
 *
 * This module walks EVERY callable body (free function, class method,
 * constructor, accessor, arrow/lambda, nested helper) and reports the
 * structural facts a scorer needs, per member and per unit.
 *
 * CONSUMER SPLIT — deliberate, not an oversight
 * ---------------------------------------------
 * CodeFlow's graph wants the coarse surface (symbols / calls / imports) and is
 * unchanged by this file. The validation engine wants this. Both are served
 * from ONE parse of ONE tree, so the two views can never disagree about what
 * the source said — which is the failure mode that produced this work in the
 * first place (two independent parsers, same bug in both).
 *
 * NON-FUNCTIONAL CONTRACT
 * -----------------------
 * - **Deterministic.** Identical bytes for identical input, across calls and
 *   across processes. Every collection is emitted in a defined order (source
 *   order, or lexicographic where the set has no natural order). No
 *   timestamps. No absolute paths — `path` is echoed exactly as the caller
 *   supplied it and is never resolved against the filesystem.
 * - **No accumulating per-process state.** Every exported function here is
 *   pure over (node, profile) and allocates its own working set. The real
 *   defect behind this requirement was ts-morph's shared `Project` silently
 *   returning wrong reference counts once ~113 files accumulated in one
 *   process; nothing in this module caches across calls, so that class of
 *   drift cannot occur.
 * - **In-process, no network.** No service, no port, no grammar download.
 *
 * GRAMMAR PORTABILITY
 * -------------------
 * Every tree-sitter grammar spells the same construct differently — `call` vs
 * `call_expression` vs `invocation_expression` is the bug that cost python and
 * csharp their entire CALLS surface. So node types live in one table
 * (`LANGUAGE_PROFILES`) rather than being written inline at each test site. A
 * new language is a table row, and a language with no row degrades to the
 * C-like defaults with `profile_complete: false` on the result rather than
 * silently reporting zeros that look like clean code.
 */
const TS_LIKE = {
    call: ['call_expression'],
    newExpr: ['new_expression'],
    newTypeField: ['constructor'],
    func: ['function_declaration', 'generator_function_declaration', 'function_expression', 'function'],
    method: ['method_definition', 'method_signature'],
    constructorDecl: [],
    klass: ['class_declaration', 'class', 'abstract_class_declaration'],
    lambda: ['arrow_function'],
    selfWords: ['this'],
    selfNodes: ['this'],
    memberAccess: ['member_expression'],
    memberObjectField: 'object',
    memberPropertyField: 'property',
    ifStmt: ['if_statement'],
    switchStmt: ['switch_statement'],
    switchCase: ['switch_case'],
    switchDefault: ['switch_default'],
    catchClause: ['catch_clause'],
    whileStmt: ['while_statement', 'do_statement'],
    numberLit: ['number'],
    trueLit: ['true'],
    falseLit: ['false'],
    nullLit: ['null', 'undefined'],
    extraStatements: ['lexical_declaration', 'variable_declaration'],
    blocks: ['statement_block', 'class_body', 'program'],
    paramsField: ['parameters', 'parameter'],
    bodyField: ['body'],
    nameField: ['name'],
    conditionField: ['condition'],
    fieldDecl: ['public_field_definition', 'field_definition', 'property_signature'],
    eqOperators: ['===', '!==', '==', '!='],
};
const PYTHON = {
    call: ['call'],
    // Python has no `new`; construction is a call to a class name, resolved by
    // the caller against the file's declared classes rather than guessed here.
    newExpr: [],
    newTypeField: ['function'],
    func: ['function_definition'],
    method: [],
    constructorDecl: [],
    klass: ['class_definition'],
    lambda: ['lambda'],
    selfWords: ['self', 'cls'],
    selfNodes: [],
    memberAccess: ['attribute'],
    memberObjectField: 'object',
    memberPropertyField: 'attribute',
    ifStmt: ['if_statement', 'elif_clause'],
    switchStmt: ['match_statement'],
    switchCase: ['case_clause'],
    switchDefault: [],
    catchClause: ['except_clause'],
    whileStmt: ['while_statement'],
    numberLit: ['integer', 'float'],
    trueLit: ['true'],
    falseLit: ['false'],
    nullLit: ['none'],
    extraStatements: [],
    blocks: ['block', 'module'],
    paramsField: ['parameters'],
    bodyField: ['body'],
    nameField: ['name'],
    conditionField: ['condition'],
    fieldDecl: [],
    eqOperators: ['==', '!=', 'is', 'is not'],
};
const CSHARP = {
    call: ['invocation_expression'],
    newExpr: ['object_creation_expression'],
    newTypeField: ['type'],
    func: ['local_function_statement'],
    method: ['method_declaration', 'property_declaration', 'accessor_declaration'],
    constructorDecl: ['constructor_declaration'],
    klass: ['class_declaration', 'struct_declaration', 'record_declaration'],
    lambda: ['lambda_expression'],
    selfWords: ['this'],
    selfNodes: ['this_expression'],
    memberAccess: ['member_access_expression'],
    memberObjectField: 'expression',
    memberPropertyField: 'name',
    ifStmt: ['if_statement'],
    switchStmt: ['switch_statement', 'switch_expression'],
    switchCase: ['switch_section', 'switch_expression_arm'],
    switchDefault: ['default_switch_label'],
    catchClause: ['catch_clause'],
    whileStmt: ['while_statement', 'do_statement'],
    numberLit: ['integer_literal', 'real_literal'],
    trueLit: ['boolean_literal'],
    falseLit: [],
    nullLit: ['null_literal'],
    extraStatements: ['local_declaration_statement'],
    blocks: ['block', 'declaration_list', 'compilation_unit'],
    paramsField: ['parameters', 'parameter_list'],
    bodyField: ['body'],
    nameField: ['name'],
    conditionField: ['condition'],
    fieldDecl: ['field_declaration', 'property_declaration'],
    eqOperators: ['==', '!='],
};
const C_LIKE = {
    call: ['call_expression'],
    newExpr: ['new_expression'],
    newTypeField: ['type', 'constructor'],
    func: ['function_definition'],
    method: [],
    constructorDecl: [],
    klass: ['class_specifier', 'struct_specifier'],
    lambda: ['lambda_expression'],
    selfWords: ['this'],
    selfNodes: ['this'],
    memberAccess: ['field_expression'],
    memberObjectField: 'argument',
    memberPropertyField: 'field',
    ifStmt: ['if_statement'],
    switchStmt: ['switch_statement'],
    switchCase: ['case_statement'],
    switchDefault: [],
    catchClause: ['catch_clause'],
    whileStmt: ['while_statement', 'do_statement'],
    numberLit: ['number_literal'],
    trueLit: ['true'],
    falseLit: ['false'],
    nullLit: ['null', 'nullptr'],
    extraStatements: ['declaration'],
    blocks: ['compound_statement', 'field_declaration_list', 'translation_unit'],
    paramsField: ['parameters', 'parameter_list'],
    bodyField: ['body'],
    // NOT 'declarator': in the C grammar that field's text is `main(void)` —
    // the whole declarator including the parameter list — so using it as a name
    // yields symbols nothing can ever match. memberName falls back to the first
    // identifier inside the declarator instead.
    nameField: ['name'],
    conditionField: ['condition'],
    fieldDecl: ['field_declaration'],
    eqOperators: ['==', '!='],
};
const LANGUAGE_PROFILES = {
    typescript: TS_LIKE,
    javascript: TS_LIKE,
    python: PYTHON,
    csharp: CSHARP,
    c: C_LIKE,
    cpp: C_LIKE,
};
/** True when this language has a hand-written profile (not the fallback). */
export function hasLanguageProfile(language) {
    return Object.hasOwn(LANGUAGE_PROFILES, language);
}
export function profileFor(language) {
    return LANGUAGE_PROFILES[language] ?? C_LIKE;
}
// ── Small tree helpers ───────────────────────────────────────────────────────
/** Named children as a plain array. Tree-sitter nodes are not iterable. */
function namedChildren(node) {
    const out = [];
    if (!node)
        return out;
    for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c)
            out.push(c);
    }
    return out;
}
function allChildren(node) {
    const out = [];
    if (!node)
        return out;
    for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c)
            out.push(c);
    }
    return out;
}
function fieldOf(node, names) {
    if (!node)
        return null;
    for (const name of names) {
        const found = node.childForFieldName?.(name);
        if (found)
            return found;
    }
    return null;
}
/** Collapse all whitespace runs to single spaces and trim. */
export function normalizeText(text) {
    return text.replace(/\s+/g, ' ').trim();
}
/**
 * Strip one layer of grouping parens so a condition can be inspected
 * structurally. `if (x === null)` hands us `(x === null)` in the C-like
 * grammars and `x === null` in python; both must reduce to the comparison.
 */
function unwrapGrouping(node) {
    let current = node;
    while (current
        && (current.type === 'parenthesized_expression' || current.type === 'parenthesized_declarator')) {
        const inner = namedChildren(current).find(c => c.type !== 'comment');
        if (!inner)
            break;
        current = inner;
    }
    return current;
}
function operatorText(node) {
    const field = node?.childForFieldName?.('operator');
    if (field)
        return field.text;
    // Some grammars leave the operator as an anonymous child rather than a field.
    for (const child of allChildren(node)) {
        if (!child.isNamed && child.text)
            return child.text;
    }
    return '';
}
/** Does this node type read as a statement in this grammar? */
function isStatementNode(node, profile) {
    const t = node.type;
    return t.endsWith('_statement') || profile.extraStatements.includes(t);
}
/** Every callable-body node type, for "stop descending at a nested member". */
function callableTypes(profile) {
    return new Set([
        ...profile.func,
        ...profile.method,
        ...profile.constructorDecl,
        ...profile.lambda,
    ]);
}
/**
 * Walk a member body WITHOUT crossing into a nested callable.
 *
 * This boundary is the difference between "facts about this method" and "facts
 * about this method and everything lexically inside it". A closure passed to
 * `map()` is its own member with its own facts; folding its statements into
 * the enclosing method would inflate every complexity signal and make an
 * ordinary functional style read as an unmaintainable body.
 */
function walkOwnBody(root, profile, visit) {
    const nested = callableTypes(profile);
    function go(node, isRoot) {
        if (!isRoot && nested.has(node.type))
            return;
        visit(node);
        for (const child of allChildren(node))
            go(child, false);
    }
    if (root)
        go(root, true);
}
// ── Per-fact extractors ──────────────────────────────────────────────────────
/** `this.x` / `self.x` names touched in the body. Deduped, lexicographic. */
function extractFieldAccess(body, profile) {
    const names = new Set();
    walkOwnBody(body, profile, node => {
        if (!profile.memberAccess.includes(node.type))
            return;
        const object = node.childForFieldName?.(profile.memberObjectField);
        if (!object)
            return;
        const isSelf = profile.selfNodes.includes(object.type) || profile.selfWords.includes(object.text);
        if (!isSelf)
            return;
        const property = node.childForFieldName?.(profile.memberPropertyField);
        if (property?.text)
            names.add(property.text);
    });
    return [...names].sort();
}
/**
 * Receiver chain depth for a call's function expression.
 * `f()` → 0 · `a.f()` → 1 · `a.b.f()` → 2.
 */
function receiverDepth(fnNode, profile) {
    let depth = 0;
    let current = fnNode;
    while (current && profile.memberAccess.includes(current.type)) {
        depth++;
        current = current.childForFieldName?.(profile.memberObjectField);
    }
    return depth;
}
/** Bare trailing name of a call target, receiver fully stripped. */
function calleeNameOf(fnNode, profile) {
    if (!fnNode)
        return null;
    if (profile.memberAccess.includes(fnNode.type)) {
        const property = fnNode.childForFieldName?.(profile.memberPropertyField);
        return property?.text ?? null;
    }
    // Fall back to splitting the source text — covers `a::b` and `a->b` in the
    // C-family, where the access node type varies with the operator used.
    const parts = fnNode.text.split(/->|::|\./);
    const last = parts[parts.length - 1];
    return last ? last.trim() : null;
}
function extractCallFacts(body, profile) {
    const calleeNames = [];
    const externalReceivers = new Set();
    let deepChainCallCount = 0;
    walkOwnBody(body, profile, node => {
        if (!profile.call.includes(node.type))
            return;
        const fnNode = node.childForFieldName?.('function') ?? node.childForFieldName?.('expression');
        if (!fnNode)
            return;
        const name = calleeNameOf(fnNode, profile);
        if (name)
            calleeNames.push(name);
        const depth = receiverDepth(fnNode, profile);
        if (depth >= 2)
            deepChainCallCount++;
        if (depth >= 1) {
            const object = fnNode.childForFieldName?.(profile.memberObjectField);
            const receiverText = object?.text;
            const isSelf = object
                && (profile.selfNodes.includes(object.type) || profile.selfWords.includes(object.text));
            if (receiverText && !isSelf)
                externalReceivers.add(normalizeText(receiverText));
        }
    });
    return {
        calleeNames,
        deepChainCallCount,
        externalReceivers: [...externalReceivers].sort(),
    };
}
/**
 * Every `new X()` target, unfiltered and in source order.
 *
 * "Unfiltered" is load-bearing: the scorer decides what counts as a concrete
 * dependency, not the parser. Dropping `new Error()` here because it looks
 * uninteresting would silently change a dependency-inversion score.
 */
function extractNewTargets(body, profile) {
    const targets = [];
    walkOwnBody(body, profile, node => {
        if (!profile.newExpr.includes(node.type))
            return;
        const typeNode = fieldOf(node, profile.newTypeField) ?? namedChildren(node)[0];
        if (typeNode?.text)
            targets.push(normalizeText(typeNode.text));
    });
    return targets;
}
/** Statement-kind descendants: count, and normalized text of the long ones. */
function extractStatements(body, profile) {
    let statementCount = 0;
    const statementTexts = [];
    walkOwnBody(body, profile, node => {
        if (!isStatementNode(node, profile))
            return;
        statementCount++;
        const text = normalizeText(node.text);
        if (text.length > 10)
            statementTexts.push(text);
    });
    return { statementCount, statementTexts };
}
/** Parameters, then local bindings, each with its declaration line. */
function extractDeclaredNames(member, body, profile) {
    const declaredNames = [];
    const params = findParamsNode(member, profile);
    const paramNodes = namedChildren(params).filter(p => p.type !== 'comment');
    for (const param of paramNodes) {
        const name = parameterName(param);
        if (name)
            declaredNames.push({ name, line: param.startPosition.row + 1, kind: 'param' });
    }
    walkOwnBody(body, profile, node => {
        if (node.type === 'variable_declarator') {
            const nameNode = node.childForFieldName?.('name');
            if (nameNode?.text) {
                declaredNames.push({
                    name: nameNode.text,
                    line: node.startPosition.row + 1,
                    kind: declarationKind(node),
                });
            }
            return;
        }
        // Python and the C-family bind without a declarator node.
        if (node.type === 'assignment' || node.type === 'init_declarator') {
            const left = node.childForFieldName?.('left') ?? node.childForFieldName?.('declarator');
            if (left && left.type === 'identifier') {
                declaredNames.push({
                    name: left.text,
                    line: node.startPosition.row + 1,
                    kind: 'local',
                });
            }
        }
    });
    return { declaredNames, paramCount: paramNodes.length };
}
/**
 * The node holding a member's parameter list.
 *
 * A field lookup alone is not enough: in the C grammar the parameters live
 * under `declarator > parameter_list`, not on a `parameters` field, so a
 * field-only lookup returns the declarator and counts the function's own name
 * as a parameter. The bounded descendant search covers that shape without
 * needing a per-grammar path expression.
 */
function findParamsNode(member, profile) {
    const direct = fieldOf(member, profile.paramsField);
    if (direct && /parameter_list$|^parameters$|^formal_parameters$/.test(direct.type))
        return direct;
    const declarator = member.childForFieldName?.('declarator') ?? direct ?? member;
    let found = null;
    (function search(node, depth) {
        if (found || !node || depth > 3)
            return;
        if (/parameter_list$|^parameters$|^formal_parameters$/.test(node.type)) {
            found = node;
            return;
        }
        for (const child of namedChildren(node))
            search(child, depth + 1);
    })(declarator, 0);
    return found ?? direct;
}
/** Peel type annotations, defaults and patterns down to the bound identifier. */
function parameterName(param) {
    if (!param)
        return null;
    if (param.type === 'identifier' || param.type === 'shorthand_property_identifier_pattern') {
        return param.text;
    }
    const pattern = param.childForFieldName?.('pattern')
        ?? param.childForFieldName?.('name')
        ?? param.childForFieldName?.('declarator');
    if (pattern)
        return parameterName(pattern);
    const firstIdentifier = namedChildren(param).find(c => /identifier$/.test(c.type));
    if (firstIdentifier?.text)
        return firstIdentifier.text;
    const raw = normalizeText(param.text);
    return raw.length > 0 ? raw : null;
}
function declarationKind(declarator) {
    const parentText = declarator.parent?.text ?? '';
    if (parentText.startsWith('const'))
        return 'const';
    if (parentText.startsWith('let'))
        return 'let';
    if (parentText.startsWith('var'))
        return 'var';
    return 'local';
}
/**
 * `if` chains, `switch` shapes, type checks — everything a scorer reads as a
 * branch, plus the two conditional-quality signals.
 */
function extractBranchFacts(body, profile) {
    const switchStatements = [];
    const complexConditionals = [];
    let branchHits = 0;
    let nullChecks = 0;
    let deadConditionals = 0;
    walkOwnBody(body, profile, node => {
        // if / else-if chains — counted once per chain head so a 3-arm chain
        // contributes 3, not 6.
        if (profile.ifStmt.includes(node.type)) {
            const condition = unwrapGrouping(fieldOf(node, profile.conditionField));
            if (condition) {
                const text = normalizeText(condition.text);
                if (text.length >= 50)
                    complexConditionals.push(text);
                if (isNullComparison(condition, profile))
                    nullChecks++;
                if (isBooleanLiteral(condition, profile))
                    deadConditionals++;
            }
            if (!isChainContinuation(node, profile))
                branchHits += chainLength(node, profile);
        }
        if (profile.whileStmt.includes(node.type)) {
            const condition = unwrapGrouping(fieldOf(node, profile.conditionField));
            if (condition && isFalseLiteral(condition, profile))
                deadConditionals++;
        }
        if (profile.switchStmt.includes(node.type)) {
            const fact = describeSwitch(node, profile);
            switchStatements.push(fact);
            // A `default` is a reachable arm, so it is a branch even though it is
            // not a `case`. Counting only `caseCount` here would under-report every
            // exhaustive switch by exactly one.
            branchHits += fact.caseCount + (fact.hasDefault ? 1 : 0);
        }
        if (isTypeCheck(node, profile))
            branchHits++;
    });
    return { branchHits, switchStatements, complexConditionals, nullChecks, deadConditionals };
}
/** True when this `if` is the `else` arm of another `if` (an else-if link). */
function isChainContinuation(node, profile) {
    const parent = node.parent;
    if (!parent)
        return false;
    if (profile.ifStmt.includes(parent.type)) {
        const alternative = parent.childForFieldName?.('alternative');
        if (alternative === node)
            return true;
        // Some grammars wrap the else arm in an `else_clause`.
        if (alternative && namedChildren(alternative).includes(node))
            return true;
    }
    if (parent.type === 'else_clause' && parent.parent && profile.ifStmt.includes(parent.parent.type)) {
        return true;
    }
    // python spells else-if as its own `elif_clause` child of the head `if`.
    if (node.type === 'elif_clause')
        return true;
    return false;
}
/** Number of arms in an if/else-if chain headed by this node. */
function chainLength(node, profile) {
    let length = 1;
    let current = node;
    // python: every `elif_clause` is a sibling child of the head `if`.
    const elifArms = namedChildren(node).filter(c => c.type === 'elif_clause').length;
    if (elifArms > 0)
        return 1 + elifArms;
    while (current) {
        let alternative = current.childForFieldName?.('alternative');
        if (alternative && alternative.type === 'else_clause') {
            alternative = namedChildren(alternative).find(c => c.type !== 'comment');
        }
        if (alternative && profile.ifStmt.includes(alternative.type)) {
            length++;
            current = alternative;
        }
        else {
            break;
        }
    }
    return length;
}
function isBooleanLiteral(node, profile) {
    if (!node)
        return false;
    if (profile.trueLit.includes(node.type) || profile.falseLit.includes(node.type))
        return true;
    const text = node.text?.trim();
    return text === 'true' || text === 'false' || text === 'True' || text === 'False';
}
function isFalseLiteral(node, profile) {
    if (!node)
        return false;
    const text = node.text?.trim();
    if (text === 'false' || text === 'False')
        return true;
    return profile.falseLit.includes(node.type) && text === 'false';
}
/** A top-level `x === null` / `x is None` / `x != null` comparison. */
function isNullComparison(condition, profile) {
    const node = unwrapGrouping(condition);
    if (!node)
        return false;
    const isComparison = node.type === 'binary_expression'
        || node.type === 'comparison_operator'
        || node.type === 'equality_expression';
    if (!isComparison)
        return false;
    const operator = operatorText(node);
    const operatorMatches = profile.eqOperators.some(op => operator === op)
        || /^(is|is not)$/.test(normalizeText(node.text).replace(/^.*?\b(is not|is)\b.*$/, '$1'));
    if (!operatorMatches && !/\bis\b/.test(node.text))
        return false;
    return allChildren(node).some(child => {
        const text = child.text?.trim().toLowerCase();
        return profile.nullLit.includes(child.type) || text === 'null' || text === 'none' || text === 'nullptr';
    });
}
/** `instanceof` / `typeof` / `is` type interrogation. */
function isTypeCheck(node, profile) {
    if (node.type === 'binary_expression') {
        const operator = operatorText(node);
        if (operator === 'instanceof')
            return true;
    }
    if (node.type === 'unary_expression' || node.type === 'typeof_expression') {
        if (operatorText(node) === 'typeof')
            return true;
    }
    if (node.type === 'is_pattern_expression' || node.type === 'as_expression')
        return true;
    if (profile === PYTHON && node.type === 'call') {
        const fn = node.childForFieldName?.('function');
        if (fn?.text === 'isinstance' || fn?.text === 'type')
            return true;
    }
    return false;
}
/** Case count plus the two refactoring-relevant shapes. */
function describeSwitch(node, profile) {
    const discriminantNode = unwrapGrouping(node.childForFieldName?.('value')
        ?? node.childForFieldName?.('condition')
        ?? node.childForFieldName?.('subject')
        ?? namedChildren(node)[0]);
    const body = fieldOf(node, profile.bodyField) ?? node;
    const cases = [];
    let hasDefault = false;
    function collect(current) {
        for (const child of allChildren(current)) {
            if (profile.switchCase.includes(child.type)) {
                cases.push(child);
                // A C# switch_section can carry a default label; check before recursing.
                if (child.text.trimStart().startsWith('default'))
                    hasDefault = true;
            }
            else if (profile.switchDefault.includes(child.type) || child.type === 'default') {
                hasDefault = true;
            }
            collect(child);
        }
    }
    collect(body);
    let behaviorDispatch = false;
    let typeConstruction = false;
    for (const caseNode of cases) {
        if (profile.newExpr.length > 0 && containsType(caseNode, profile.newExpr))
            typeConstruction = true;
        if (containsType(caseNode, profile.call) || containsType(caseNode, ['return_statement'])) {
            behaviorDispatch = true;
        }
    }
    return {
        line: node.startPosition.row + 1,
        discriminant: discriminantNode ? normalizeText(discriminantNode.text) : '',
        caseCount: cases.length,
        hasDefault,
        behaviorDispatch,
        typeConstruction,
    };
}
function containsType(node, types) {
    if (types.includes(node.type))
        return true;
    return allChildren(node).some(child => containsType(child, types));
}
/**
 * Numeric literals that are not 0, 1 or -1 and are not initializing a named
 * constant.
 *
 * The const exemption is what separates "magic number" from "declared
 * constant": `const RETRY_LIMIT = 5` is the fix for `if (n > 5)`, so counting
 * the 5 in both would score the fixed code exactly as badly as the broken code.
 */
function extractMagicNumbers(body, profile) {
    const magic = [];
    walkOwnBody(body, profile, node => {
        if (!profile.numberLit.includes(node.type))
            return;
        if (isInsideNamedConstant(node))
            return;
        const negated = node.parent?.type === 'unary_expression' && operatorText(node.parent) === '-';
        const raw = node.text.trim();
        const value = negated ? `-${raw}` : raw;
        if (value === '0' || value === '1' || value === '-1')
            return;
        magic.push({ value, line: node.startPosition.row + 1 });
    });
    return magic;
}
function isInsideNamedConstant(node) {
    let current = node.parent;
    let hops = 0;
    // Bounded: an initializer sits within a few levels of its declarator, and an
    // unbounded climb would walk out to the file root and exempt everything.
    while (current && hops < 4) {
        if (current.type === 'variable_declarator' && declarationKind(current) === 'const')
            return true;
        if (current.type === 'enum_member' || current.type === 'enum_member_declaration')
            return true;
        current = current.parent;
        hops++;
    }
    return false;
}
/** Catch blocks with zero statements — the classic swallowed error. */
function extractEmptyCatches(body, profile) {
    let empty = 0;
    walkOwnBody(body, profile, node => {
        if (!profile.catchClause.includes(node.type))
            return;
        const block = fieldOf(node, profile.bodyField)
            ?? namedChildren(node).find(c => profile.blocks.includes(c.type));
        if (!block)
            return;
        const statements = namedChildren(block).filter(c => isStatementNode(c, profile));
        // `except: pass` has one statement that does nothing; treat it as empty.
        const meaningful = statements.filter(s => normalizeText(s.text) !== 'pass');
        if (meaningful.length === 0)
            empty++;
    });
    return empty;
}
// ── Member and unit assembly ─────────────────────────────────────────────────
function memberKind(node, profile) {
    if (profile.constructorDecl.includes(node.type))
        return 'constructor';
    if (profile.lambda.includes(node.type))
        return 'arrow';
    if (profile.method.includes(node.type)) {
        const leading = allChildren(node).filter(c => !c.isNamed).map(c => c.text);
        if (leading.includes('get'))
            return 'getter';
        if (leading.includes('set'))
            return 'setter';
        const name = fieldOf(node, profile.nameField)?.text;
        if (name === 'constructor' || name === '__init__')
            return 'constructor';
        return 'method';
    }
    const name = fieldOf(node, profile.nameField)?.text;
    if (name === '__init__')
        return 'constructor';
    return 'function';
}
function memberName(node, profile, fallbackIndex) {
    const nameNode = fieldOf(node, profile.nameField);
    if (nameNode?.text)
        return normalizeText(nameNode.text);
    // C-family functions carry the name inside a declarator subtree.
    const declarator = node.childForFieldName?.('declarator');
    if (declarator) {
        const identifier = findFirstIdentifier(declarator);
        if (identifier)
            return identifier;
    }
    // An anonymous lambda still needs a stable, deterministic identity — its
    // position in the file is the only thing that qualifies.
    return `<anonymous:${node.startPosition.row + 1}:${fallbackIndex}>`;
}
function findFirstIdentifier(node) {
    if (/identifier$/.test(node.type))
        return node.text;
    for (const child of namedChildren(node)) {
        const found = findFirstIdentifier(child);
        if (found)
            return found;
    }
    return null;
}
function isStaticMember(node) {
    return allChildren(node).some(c => !c.isNamed && c.text === 'static')
        || node.text.trimStart().startsWith('static ');
}
function bodyOf(node, profile) {
    return fieldOf(node, profile.bodyField)
        ?? node.childForFieldName?.('expression_body')
        ?? namedChildren(node).find(c => profile.blocks.includes(c.type) || c.type === 'arrow_expression_clause')
        ?? null;
}
function returnTypeOf(node) {
    const explicit = node.childForFieldName?.('return_type') ?? node.childForFieldName?.('type');
    if (!explicit)
        return null;
    return normalizeText(explicit.text).replace(/^:\s*/, '');
}
function callsSuperIn(body, profile) {
    let found = false;
    walkOwnBody(body, profile, node => {
        if (found)
            return;
        if (node.type === 'super' || node.type === 'base_expression')
            found = true;
        if (profile.call.includes(node.type)) {
            const fn = node.childForFieldName?.('function');
            if (fn && (fn.type === 'super' || fn.text?.startsWith('super') || fn.text?.startsWith('base.'))) {
                found = true;
            }
        }
    });
    return found;
}
/**
 * Extract every callable body in a file, with its owning unit.
 *
 * `onBody` receives each member's identity and its body node as the walk finds
 * it. That callback is how the coarse CALLS surface is driven: one traversal
 * decides what a member IS, and both the fact surface and the call surface
 * read that same decision. The alternative — a second walk with its own idea
 * of which bodies count — is exactly the arrangement that let `call` vs
 * `call_expression` diverge unnoticed across two parsers.
 */
export function extractMembers(rootNode, language, onBody) {
    const profile = profileFor(language);
    const members = [];
    const units = [];
    const declaredClassNames = new Set();
    let anonymousCounter = 0;
    // First pass: every class name declared in this file, so `new X()` can be
    // told apart from `new SomethingImported()` without guessing.
    (function collectClasses(node) {
        if (profile.klass.includes(node.type)) {
            const name = fieldOf(node, profile.nameField)?.text;
            if (name)
                declaredClassNames.add(name);
        }
        for (const child of namedChildren(node))
            collectClasses(child);
    })(rootNode);
    const callableSet = callableTypes(profile);
    function visit(node, owner, exported) {
        const type = node.type;
        if (type === 'export_statement') {
            for (const child of namedChildren(node))
                visit(child, owner, true);
            return;
        }
        if (profile.klass.includes(type)) {
            const unit = buildUnit(node, profile, exported, declaredClassNames);
            units.push(unit);
            const body = fieldOf(node, profile.bodyField)
                ?? namedChildren(node).find(c => profile.blocks.includes(c.type));
            for (const child of namedChildren(body ?? node))
                visit(child, unit, exported);
            return;
        }
        if (callableSet.has(type)) {
            const member = buildMember(node, profile, owner, exported, anonymousCounter++);
            members.push(member);
            if (owner)
                owner.memberNames.push(member.name);
            const body = bodyOf(node, profile);
            if (body)
                onBody?.(member, body);
            // Nested callables are members in their own right — recurse into the
            // body so a closure gets its own facts rather than being folded in.
            if (body) {
                for (const child of namedChildren(body))
                    visit(child, null, false);
            }
            return;
        }
        for (const child of namedChildren(node))
            visit(child, owner, exported);
    }
    for (const child of namedChildren(rootNode))
        visit(child, null, false);
    return { members, units };
}
function buildMember(node, profile, owner, exported, fallbackIndex) {
    const body = bodyOf(node, profile);
    const { declaredNames, paramCount } = extractDeclaredNames(node, body, profile);
    const { statementCount, statementTexts } = extractStatements(body, profile);
    const callFacts = extractCallFacts(body, profile);
    const branchFacts = extractBranchFacts(body, profile);
    return {
        name: memberName(node, profile, fallbackIndex),
        owner: owner?.name ?? null,
        kind: memberKind(node, profile),
        exported: exported || Boolean(owner?.exported),
        isStatic: isStaticMember(node),
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        return_type: returnTypeOf(node),
        paramCount,
        declaredNames,
        statementCount,
        statementTexts,
        fieldAccess: extractFieldAccess(body, profile),
        calleeNames: callFacts.calleeNames,
        deepChainCallCount: callFacts.deepChainCallCount,
        constructorNewCallTargets: extractNewTargets(body, profile),
        branchHits: branchFacts.branchHits,
        switchStatements: branchFacts.switchStatements,
        complexConditionals: branchFacts.complexConditionals,
        nullChecks: branchFacts.nullChecks,
        magicNumbers: extractMagicNumbers(body, profile),
        emptyCatches: extractEmptyCatches(body, profile),
        deadConditionals: branchFacts.deadConditionals,
        override: {
            callsSuper: callsSuperIn(body, profile),
            baseClass: owner?.baseClass ?? null,
            // Resolved in a later pass, once every file in the batch is parsed.
            baseParamCount: null,
            paramCountDrift: null,
            baseReturnType: null,
            returnTypeDrift: null,
        },
    };
}
function buildUnit(node, profile, exported, declaredClassNames) {
    const name = fieldOf(node, profile.nameField)?.text ?? `<class:${node.startPosition.row + 1}>`;
    const baseClass = baseClassOf(node, profile);
    const staticPropertyNames = new Set();
    const newTargets = [];
    const externalNames = new Set();
    const ownMemberNames = new Set();
    // Unit-level facts read the WHOLE class subtree, nested members included —
    // a dependency introduced three methods deep is still the class's dependency.
    (function scan(current) {
        if (profile.fieldDecl.includes(current.type) && isStaticMember(current)) {
            const fieldName = fieldOf(current, profile.nameField)?.text ?? findFirstIdentifier(current);
            if (fieldName)
                staticPropertyNames.add(fieldName);
        }
        if (profile.newExpr.includes(current.type)) {
            const typeNode = fieldOf(current, profile.newTypeField) ?? namedChildren(current)[0];
            if (typeNode?.text)
                newTargets.push(normalizeText(typeNode.text));
        }
        if (profile.method.includes(current.type) || profile.func.includes(current.type)) {
            const memberNameText = fieldOf(current, profile.nameField)?.text;
            if (memberNameText)
                ownMemberNames.add(memberNameText);
        }
        if (profile.call.includes(current.type)) {
            const fn = current.childForFieldName?.('function') ?? current.childForFieldName?.('expression');
            if (fn) {
                const depth = receiverDepth(fn, profile);
                if (depth >= 1) {
                    const object = fn.childForFieldName?.(profile.memberObjectField);
                    const isSelf = object
                        && (profile.selfNodes.includes(object.type) || profile.selfWords.includes(object.text));
                    if (object?.text && !isSelf)
                        externalNames.add(normalizeText(object.text));
                }
                else {
                    const callee = calleeNameOf(fn, profile);
                    if (callee)
                        externalNames.add(callee);
                }
            }
        }
        for (const child of namedChildren(current))
            scan(child);
    })(node);
    for (const target of newTargets)
        externalNames.add(target);
    // A call to the unit's own method is not an external dependency.
    for (const own of ownMemberNames)
        externalNames.delete(own);
    const hasGetInstanceMethod = [...ownMemberNames].some(m => m === 'getInstance' || m === 'get_instance' || m === 'Instance' || m === 'instance');
    return {
        name,
        kind: 'class',
        exported,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        baseClass,
        hasBaseClass: baseClass !== null,
        concreteInstantiations: newTargets.filter(t => declaredClassNames.has(t)).length,
        totalDependencies: externalNames.size,
        staticPropertyNames: [...staticPropertyNames].sort(),
        hasGetInstanceMethod,
        memberNames: [],
    };
}
function baseClassOf(node, profile) {
    const heritage = namedChildren(node).find(c => c.type === 'class_heritage'
        || c.type === 'base_list'
        || c.type === 'superclasses'
        || c.type === 'base_class_clause');
    if (!heritage)
        return null;
    // `implements` clauses also live under class_heritage in TS; only the
    // `extends` arm names a base class, and reporting an interface as a base
    // would make hasBaseClass true for a class that inherits no behaviour.
    const clauses = namedChildren(heritage);
    const extendsClause = clauses.find(c => c.type === 'extends_clause');
    if (!extendsClause) {
        // An implements-only heritage names interfaces, not a base class. Falling
        // through to the heritage node here would return the first interface and
        // report every interface implementer as inheriting behaviour.
        if (clauses.some(c => c.type === 'implements_clause'))
            return null;
        if (/^\s*implements\b/.test(heritage.text))
            return null;
    }
    const source = extendsClause ?? heritage;
    const candidate = namedChildren(source).find(c => /identifier$/.test(c.type) || c.type === 'member_expression' || c.type === 'generic_name');
    if (candidate?.text)
        return normalizeText(candidate.text);
    const raw = normalizeText(source.text).replace(/^(extends|:)\s*/, '');
    return raw ? raw.split(/[,\s]/)[0] : null;
}
// ── Batch passes: override resolution + cross-file references ───────────────
/**
 * Fill in override drift for members whose base class was parsed in the same
 * batch. Mutates in place; members whose base is not in the batch keep their
 * `null` drift fields, which is the "not determinable" signal, not "no drift".
 */
export function resolveOverrideShapes(perFile) {
    const byClassAndMember = new Map();
    for (const file of perFile) {
        for (const member of file.members) {
            if (member.owner)
                byClassAndMember.set(`${member.owner}#${member.name}`, member);
        }
    }
    for (const file of perFile) {
        for (const member of file.members) {
            const base = member.override.baseClass;
            if (!base)
                continue;
            const baseMember = byClassAndMember.get(`${base}#${member.name}`);
            if (!baseMember)
                continue;
            member.override.baseParamCount = baseMember.paramCount;
            member.override.paramCountDrift = member.paramCount - baseMember.paramCount;
            member.override.baseReturnType = baseMember.return_type;
            member.override.returnTypeDrift =
                member.return_type !== null && baseMember.return_type !== null
                    ? member.return_type !== baseMember.return_type
                    : null;
        }
    }
}
/**
 * Count references to each file's exported symbols across the rest of the
 * batch — the equivalent of ts-morph `findReferencesAsNodes()`, minus the
 * shared-`Project` state that made its counts drift after ~113 files.
 *
 * Identifier occurrences are collected per file ONCE, then counted. That is
 * O(files + names), not O(files x names), so a large batch does not degrade.
 */
export function buildReferenceGraph(files) {
    const byPath = new Map();
    for (const file of files) {
        const references = [];
        for (const name of file.exportedNames) {
            let count = 0;
            const referencingFiles = [];
            for (const other of files) {
                if (other.path === file.path)
                    continue;
                const hits = other.identifierCounts.get(name) ?? 0;
                if (hits > 0) {
                    count += hits;
                    referencingFiles.push(other.path);
                }
            }
            references.push({ name, count, files: referencingFiles.sort() });
        }
        references.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        byPath.set(file.path, references);
    }
    return byPath;
}
/**
 * Every identifier occurrence in a tree, counted by name.
 *
 * Declaration-site occurrences are excluded by the caller subtracting the
 * declaring file, which is why this stays a dumb frequency map: a
 * declaration-aware version would need scope resolution the grammar does not
 * give us, and a half-correct one would be worse than an honest count.
 */
export function countIdentifiers(rootNode) {
    const counts = new Map();
    (function walk(node) {
        if (/identifier$/.test(node.type)) {
            const name = node.text;
            counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        for (const child of allChildren(node))
            walk(child);
    })(rootNode);
    return counts;
}
//# sourceMappingURL=memberFacts.js.map