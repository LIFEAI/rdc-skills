/**
 * Tree-sitter language plugin — the multi-language-capable, in-process AST
 * backend for the LanguagePlugin contract (see ../language-plugin.mjs).
 *
 * Direct operator instruction (Dave, 2026-08-20): stop depending on a
 * third-party TS-only parser (ts-morph, scripts/lib/plugins/typescript.mjs)
 * when the fleet already owns a standalone, in-process, multi-language
 * tree-sitter parser — CodeFlow's own `packages/codeflow-parser/src/
 * nativeParser.ts` in the separate `regen-root` monorepo.
 *
 * UPDATE (2026-08-20/21, same night): `nativeParser.ts` shipped a real
 * `members[]`/`units[]` surface (via the new `src/memberFacts.ts`) that
 * walks EVERY callable body — not just top-level exported functions — and
 * computes almost exactly the per-member/per-unit facts this file used to
 * duplicate from scratch. This plugin now VENDORS the compiled
 * `memberFacts.js` (plus `nativeParser.js`/`grammars.js`/`xmlParser.js`, for
 * fidelity and any future use) into `../vendor/codeflow-parser/` and calls
 * its exported `extractMembers(rootNode, language)` DIRECTLY against this
 * plugin's OWN tree-sitter parse of the file — not through
 * `createNativeParser().parse()`'s async service wrapper. That wrapper's
 * `parse()` is `async` (it exists to front an XML branch and a batch
 * override/reference pass this plugin doesn't use) and therefore cannot be
 * called from `extractUnits()`, which the LanguagePlugin contract
 * (../language-plugin.mjs) requires to stay SYNCHRONOUS. `extractMembers`
 * itself has no `await` anywhere in it — it is a plain, pure, synchronous
 * function of `(rootNode, language)` — so calling it directly is both the
 * correct fix for the sync/async mismatch and a smaller surface to vendor.
 *
 * WHAT THIS PLUGIN NOW GETS FROM THE VENDORED EXTRACTOR (native-sourced,
 * per member, when a correlated entry is found — see `nativeMemberKey`
 * below): `paramCount`, `fieldAccess`, `calleeNames`, `deepChainCallCount`,
 * `constructorNewCallTargets`, `branchHits`, `statementCount`,
 * `declaredNames` (destructured-pattern entries filtered — see
 * `filterDeclaredNames`), `magicNumbers` (value coerced string→number). Per
 * unit (class only — the vendored extractor has no "module" unit concept,
 * see below): `concreteInstantiations`, `totalDependencies`,
 * `staticPropertyNames`, `hasGetInstanceMethod`, `hasBaseClass`.
 *
 * WHAT STAYS LOCALLY COMPUTED, AND WHY — this is a real, disclosed residual,
 * not a "small gap": the vendored `ParsedMember` shape reports several
 * clean-code/refactoring facts as either a bare COUNT (`nullChecks`,
 * `emptyCatches`, `deadConditionals` are `number`, not an array) or as
 * LINE-LESS text (`statementTexts`, `complexConditionals` are `string[]`,
 * not `{text/length, line}[]`). This repo's clean-code-scoring.mjs and
 * refactoring-scoring.mjs read `.line` (and, for `deadConditionals`,
 * `.kind`; for `complexConditionals`, `.length`) on every one of those to
 * build a findable location — so all five stay a local per-item CST walk on
 * the member's own `bodyNode`, same functions as before this change.
 * `switchStatements[].hasBehaviorCall/hasTypeCreation`,
 * `switchBehaviorCallLine`, and `conditionalFeatureCallLine` also stay
 * local: the vendored `SwitchFact.behaviorDispatch`/`.typeConstruction` use
 * a DIFFERENT, broader test (any call-or-return in a case; any `new` in a
 * type-discriminant-named switch) than this repo's specific
 * architecture-toolkit-derived word lists
 * (calculate/process/validate/format, and separately
 * calculate/process/execute/validate/format for the pattern-advisor's
 * Strategy signal, and wrap/add/extend/enhance for Decorator) — reusing the
 * vendored flags would silently change which findings fire. `calls` also
 * stays local: this repo's contract keeps a receiver-qualified-except-`this.`
 * form (`obj.method()` → `"obj.method"`) for solid-scoring.mjs's SRP
 * same-component test; the vendored `calleeNames` strips EVERY receiver,
 * which is the right fact for pattern-scoring.mjs's keyword scans but the
 * wrong one for SRP's sibling-method-call detection. `isPublic` stays
 * local: the vendored `ParsedMember.exported` is the OWNING CLASS's export
 * status propagated to every member, not an accessibility check — it has no
 * `private`/`protected`/`#`-prefix signal at all, so this plugin still reads
 * `accessibility_modifier` off the located CST node itself. `override`
 * (LSP base-method drift) stays local for a different reason: the vendored
 * resolver (`resolveOverrideShapes`) is BATCH-scoped over one `parse()` call
 * across every file handed to it at once, but this plugin's `extractUnits`
 * is called incrementally, one file at a time — re-running a whole-project
 * batch parse on every single-file call would be a real performance
 * regression, so cross-file override resolution keeps using this plugin's
 * own existing `fileCache`-backed base-class lookup (unchanged).
 * `deadExportsOf`/`referenceSitesOf` (cross-file dead-export / reference-site
 * scanning) are UNCHANGED and fully local for the same reason, plus SOLID
 * itself never calls either.
 *
 * CORRELATION: `extractMembers` returns a FLAT `members[]` array that
 * includes every nested closure as its own entry with `owner: null` — not
 * just top-level/class members — because a callback passed to `.map()` is
 * genuinely its own member with its own facts (see memberFacts.js's own
 * header comment). This plugin still needs to know WHICH callable node is a
 * "member" per its own NormalizedUnit contract (a class's own methods, or a
 * file's own top-level declarations — never an inner closure folded into
 * one of those). So this plugin keeps its OWN existing identity walk
 * (`memberEntriesOf` for a class body, the top-level declaration scan for a
 * module) to decide what counts as a member and to locate each one's
 * `bodyNode` for the local residual facts above, and uses that identity
 * walk's own `(owner, name, start_line)` to look up the matching entry in
 * the vendored extractor's flat list (`nativeMemberKey`/
 * `buildNativeMemberIndex`) for the native-sourced fields. A correlation
 * miss (should not happen for a real class method or top-level declaration;
 * kept as a safety net for a grammar edge case this plugin's own detection
 * and memberFacts.js's disagree on) falls back to this plugin's original,
 * fully-local computation for that one member's mappable fields, unchanged
 * from before this pass — a miss degrades to old-but-correct, never to a
 * silently dropped or wrong fact.
 *
 * nativeParser.ts's top-level CST-walking functions (`extractTsJsSymbols`,
 * `extractCallsFromBody`, `extractTsJsImports`) were the ORIGINAL cited
 * foundation for this file's now-superseded from-scratch member/unit
 * assembly and remain the model for `importsOf`/`deadExportsOf`/
 * `referenceSitesOf` below, which this plugin still computes itself.
 *
 * Every node-type name and field name used below (e.g. `public_field_
 * definition`, `method_definition`'s `parameters`/`body`/`return_type`
 * fields, `if_statement`'s `condition`/`consequence`/`alternative` fields,
 * `else_clause` wrapping an `else if` as a nested `if_statement`, `super()`
 * as function-field type `super` vs `super.method()` as a `member_expression`
 * whose `object` field is `super`, single-param parenless arrow functions
 * exposing a bare `parameter` field instead of `formal_parameters`, TS
 * `enum_assignment` nodes) was VERIFIED empirically this session by parsing
 * representative TypeScript source with the installed
 * `tree-sitter-wasms@0.1.13` grammar and inspecting the resulting CST —
 * not guessed from memory of the grammar.
 *
 * WASM grammar resolution mirrors `packages/codeflow-parser/src/
 * grammars.ts`'s approach for THIS plugin's own tree-sitter Parser/Language
 * setup below (kept separate from the vendored `grammars.js`, which backs
 * only the unused async `createNativeParser()` wrapper): `require.resolve(
 * 'tree-sitter-wasms/out/tree-sitter-<lang>.wasm')`, confirmed against the
 * real installed package layout (`node_modules/tree-sitter-wasms/out/*.wasm`).
 *
 * Scope this pass: TypeScript, TSX, and JavaScript — parity with
 * typescript.mjs, the only two source extensions that plugin ever handled
 * (`.tsx` is new; ts-morph's single plugin already accepted `.tsx` files but
 * parsed them with the same TS-family checker, so this plugin routes `.tsx`
 * to the dedicated `tree-sitter-tsx` grammar for correctness rather than
 * matching that shortcut). Python is explicitly NOT implemented here.
 * nativeParser.ts has real, working Python extraction logic
 * (`extractPythonSymbols`) that could be ported in a follow-up pass, but no
 * scoring CLI in this repo has ever targeted Python — shipping an unproven,
 * un-dogfooded third language in the same pass as the TS/JS swap is scope
 * creep this task explicitly called out as optional and skippable. C/C++/C#
 * are out of scope entirely for the same reason.
 */

import { extractMembers } from '../vendor/codeflow-parser/memberFacts.js';

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const require = createRequire(import.meta.url);

// ── Runtime init ────────────────────────────────────────────────────────
// web-tree-sitter's Parser.init() and Language.load() are inherently async
// (WASM instantiation). The LanguagePlugin contract's extractUnits/importsOf
// are synchronous (see the JSDoc in ../language-plugin.mjs). Top-level await
// closes that gap: ESM blocks the whole module graph on this module's own
// top-level await before ANY importer's code can run — so by the time
// solid-score.mjs's `main()` calls `plugin.extractUnits(...)`, both the
// runtime and both grammars below are already loaded, and every exported
// method is genuinely synchronous. No call site anywhere else changes.

const mod = await import('web-tree-sitter');
const Parser = mod.default ?? mod.Parser;
await Parser.init();
const Language = mod.Language ?? Parser.Language;

const GRAMMAR_FILES = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
};

async function loadGrammar(name) {
  const wasmPath = require.resolve(`tree-sitter-wasms/out/${GRAMMAR_FILES[name]}`);
  return Language.load(wasmPath);
}

const TS_LANG = await loadGrammar('typescript');
const TSX_LANG = await loadGrammar('tsx');
const JS_LANG = await loadGrammar('javascript');

function grammarFor(filePath) {
  if (/\.tsx$/.test(filePath)) return TSX_LANG;
  if (/\.(ts|mjs|cjs)$/.test(filePath)) return TS_LANG; // TS grammar syntactically supersets plain JS — same "one plugin, both languages" shape as typescript.mjs's ts-morph `allowJs`
  return JS_LANG; // plain .js
}

/**
 * memberFacts.js's `LANGUAGE_PROFILES` table (vendored) has no separate
 * 'tsx' entry — only 'typescript'/'javascript'/'python'/'csharp'/'c'/'cpp'.
 * A `.tsx` file's node-type vocabulary for class/method/call/etc. is the
 * SAME TS-family grammar as `.ts` (only JSX-specific node types like
 * `jsx_element` differ, none of which this plugin's facts touch), so
 * passing 'tsx' through would silently fall back to the C-like default
 * profile (whose `klass`/`method` node types are wrong for TS) rather than
 * erroring — 'typescript' is the correct language string for both.
 */
function nativeLanguageFor(filePath) {
  if (/\.(ts|tsx|mjs|cjs)$/.test(filePath)) return 'typescript';
  return 'javascript';
}

/**
 * Correlation key between this plugin's own member-identity walk
 * (`memberEntriesOf` / the module-level top-declaration scan) and
 * `extractMembers`'s flat `members[]` output. `owner` is the class name (or
 * `null` at module scope); `startLine` is the callable node's OWN start
 * line — for a `method_definition` that's the method node itself, for an
 * arrow-valued class field or a `const foo = () => {}` it's the
 * `arrow_function`/`function_expression` node's start line, not the
 * enclosing field-definition/declarator's — matching exactly what
 * `extractMembers`'s own `visit()` uses as `node.startPosition.row + 1`
 * (see memberFacts.js's `buildMember`). This plugin's own entries already
 * carry that exact node as `entry.typeSourceNode` for every entry shape
 * (method, arrow field, top-level function, top-level arrow const) — see
 * `memberEntriesOf` and `unitsFromModuleLevel` below.
 */
function nativeMemberKey(owner, name, startLine) {
  return `${owner ?? ''}::${name}::${startLine}`;
}

/**
 * A get/set pair declared on the exact same source line (same owner, same
 * name, same start line) would collide in this index — the second one wins
 * and the first falls back to local computation via the correlation-miss
 * path in `normalizedMember`. Real code essentially never writes get/set
 * accessors on one line, so this is an accepted, disclosed edge case rather
 * than a bug worth a more expensive per-kind key.
 */
function buildNativeMemberIndex(nativeMembers) {
  const map = new Map();
  for (const nm of nativeMembers) {
    map.set(nativeMemberKey(nm.owner, nm.name, nm.start_line), nm);
  }
  return map;
}

const parserCache = new Map(); // grammar object -> reusable Parser instance
function parserFor(grammar) {
  let p = parserCache.get(grammar);
  if (!p) {
    p = new Parser();
    p.setLanguage(grammar);
    parserCache.set(grammar, p);
  }
  return p;
}

function parseText(filePath, sourceText) {
  return parserFor(grammarFor(filePath)).parse(sourceText);
}

// ── File cache (mirrors typescript.mjs's `sharedProject()`) ───────────────
// One shared cache per process. A file is added to it the first time
// extractUnits/importsOf/deadExportsOf/referenceSitesOf touches it, exactly
// mirroring ts-morph's incremental Project: solid-score.mjs's own directory
// walk calls extractUnits() on every file before the boundary/dead-export
// checks run, so by the time cross-file resolution (base-class lookup,
// local-class-name set, reference counting) is needed, every file already
// scanned this run is present.

const fileCache = new Map(); // absolute path -> { rootNode, sourceText }

function cacheEntryFor(filePath, sourceText) {
  if (sourceText !== undefined) {
    // Ephemeral parse (e.g. a file's content at a git ref via `--diff`) —
    // its own one-shot parse, never mixed into the shared cross-file cache,
    // matching typescript.mjs's ephemeral in-memory Project branch.
    const tree = parseText(filePath, sourceText);
    return { rootNode: tree.rootNode, sourceText };
  }
  const cached = fileCache.get(filePath);
  if (cached) return cached;
  const text = readFileSync(filePath, 'utf8');
  const tree = parseText(filePath, text);
  const entry = { rootNode: tree.rootNode, sourceText: text };
  fileCache.set(filePath, entry);
  return entry;
}

function ensureCached(paths) {
  for (const p of paths) {
    if (fileCache.has(p)) continue;
    try {
      const text = readFileSync(p, 'utf8');
      const tree = parseText(p, text);
      fileCache.set(p, { rootNode: tree.rootNode, sourceText: text });
    } catch {
      // unreadable/binary/non-source file — not a TS/JS file, skip (matches
      // typescript.mjs's identical try/catch around addSourceFileAtPath)
    }
  }
}

// ── Generic CST walk helpers ────────────────────────────────────────────

function lineOf(node) {
  return node.startPosition.row + 1;
}

/**
 * Depth-first, self-INCLUSIVE, ALL nesting levels (no boundary stop at
 * nested function/class) — matches ts-morph's getDescendantsOfKind
 * semantics for the "all nesting depths" part (the NormalizedMember JSDoc
 * calls this out explicitly), but is deliberately SELF-inclusive where
 * ts-morph's own getDescendantsOfKind is not.
 *
 * Real bug found and fixed this session: a concise-body arrow class
 * property — `model = () => new PhaseModel({...})` (verified against
 * `packages/phases/test/phase-model.test.mjs:21` in rdc-harness, found via
 * a `constructorNewCallTargets` parity diff against ts-morph) — has its
 * ENTIRE body AS the `new_expression`/`call_expression`/`member_expression`
 * node itself (arrow_function's `body` field for a concise body is the
 * expression directly, not a `statement_block` wrapping it; verified by
 * parsing `x => x * 2` and inspecting the CST). A self-exclusive walk
 * starting at that body node only visits ITS CHILDREN (the `new` call's
 * arguments), never testing the body node's own type — so `new PhaseModel`
 * itself was invisible to constructorNewCallTargetsOf/callsOf/fieldsOf/
 * branchHitsOf/calleeNamesOf/deepChainCallCountOf for every concise-body
 * arrow member. ts-morph's typescript.mjs does not hit this because
 * ts-morph's own body/expression node distinction differs internally; the
 * gap here is a tree-sitter-CST-specific consequence of `body` sometimes
 * being a bare expression rather than a block. Self-inclusion is safe
 * everywhere ELSE in this file: every other target type this file searches
 * for (if_statement, switch_statement, catch_clause, variable_declarator,
 * class_declaration, identifier, …) can never structurally BE the root node
 * passed in (a `statement_block`, `class_declaration`, or `program`), so
 * testing the root is a harmless no-op there and a real fix here.
 */
function walkSelfAndDescendants(node, visit) {
  visit(node);
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walkSelfAndDescendants(c, visit);
  }
}

function descendantsOfType(root, types) {
  const set = types instanceof Set ? types : new Set(types);
  const out = [];
  walkSelfAndDescendants(root, (n) => { if (set.has(n.type)) out.push(n); });
  return out;
}

function hasAnonChild(node, text) {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && !c.isNamed && c.text === text) return true;
  }
  return false;
}

function isStaticNode(node) {
  return hasAnonChild(node, 'static');
}

function accessibilityOf(node) {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && c.type === 'accessibility_modifier') return c.text; // 'private' | 'protected' | 'public'
  }
  return null;
}

function unwrapParen(node) {
  return node && node.type === 'parenthesized_expression' ? node.namedChild(0) : node;
}

function normalizeText(t) {
  return t.replace(/\s+/g, ' ').trim();
}

/** `required_parameter`/`optional_parameter` wrap the binding in a `pattern` field; a parenless single-param arrow's own parameter node IS the binding. */
function patternOf(paramNode) {
  if (paramNode.type === 'required_parameter' || paramNode.type === 'optional_parameter') {
    return paramNode.childForFieldName('pattern');
  }
  return paramNode;
}

/** `formal_parameters` holds 0+ params as named children; a parenless single-param arrow's `parameter` field IS the one param, not a list. */
function paramListOf(paramsNode) {
  if (!paramsNode) return [];
  if (paramsNode.type === 'formal_parameters') {
    const out = [];
    for (let i = 0; i < paramsNode.namedChildCount; i++) out.push(paramsNode.namedChild(i));
    return out;
  }
  return [paramsNode];
}

// ── Clean Code / Refactoring / Pattern-advisor facts ───────────────────
// Same detection intent as typescript.mjs's block of the same name (real
// logic ported from architecture-toolkit, MIT, explicit reuse approval —
// see typescript.mjs's own citations for the original source); only the
// AST-walk mechanics differ (tree-sitter CST vs ts-morph wrapper API).

const STATEMENT_TYPES = new Set([
  'expression_statement', 'lexical_declaration', 'variable_declaration',
  'if_statement', 'for_statement', 'for_in_statement', 'while_statement',
  'do_statement', 'switch_statement', 'return_statement', 'throw_statement',
  'try_statement', 'break_statement', 'continue_statement', 'labeled_statement',
]);
// Tree-sitter's grammar unifies `for...in` and `for...of` into ONE node type
// (`for_in_statement`, disambiguated only by an anonymous `in`/`of` child
// token) — verified by parsing both forms and inspecting the CST. ts-morph
// keeps ForInStatement/ForOfStatement as two SyntaxKinds; STATEMENT_TYPES
// above counts `for_in_statement` once, which already covers both source
// forms — no separate entry needed or possible.

function statementCountOf(bodyNode) {
  return descendantsOfType(bodyNode, STATEMENT_TYPES).length;
}

function fieldsOf(bodyNode) {
  const out = [];
  walkSelfAndDescendants(bodyNode, (n) => {
    if (n.type !== 'member_expression') return;
    const obj = n.childForFieldName('object');
    if (obj && obj.type === 'this') {
      const prop = n.childForFieldName('property');
      if (prop) out.push(prop.text);
    }
  });
  return out;
}

function callsOf(bodyNode) {
  const out = [];
  walkSelfAndDescendants(bodyNode, (n) => {
    if (n.type !== 'call_expression') return;
    const fn = n.childForFieldName('function');
    if (fn) out.push(fn.text.replace(/^this\./, ''));
  });
  return out;
}

/** `else if` is `else_clause` wrapping a nested `if_statement` as its sole child — verified by parsing an `if/else if/else` chain and inspecting the CST (NOT assumed from the plain-JS/TS spec, which some grammars implement differently). */
function isElseIfChain(ifStmt) {
  const alt = ifStmt.childForFieldName('alternative');
  if (!alt) return false;
  if (alt.type === 'if_statement') return true;
  if (alt.type === 'else_clause') return alt.namedChild(0)?.type === 'if_statement';
  return false;
}

function branchHitsOf(bodyNode) {
  let n = 0;
  walkSelfAndDescendants(bodyNode, (node) => {
    if (node.type === 'switch_statement') {
      const body = node.childForFieldName('body');
      if (body) {
        for (let i = 0; i < body.namedChildCount; i++) {
          if (body.namedChild(i).type === 'switch_case') n++;
        }
      }
    } else if (node.type === 'binary_expression') {
      if (node.childForFieldName('operator')?.text === 'instanceof') n++;
    } else if (node.type === 'unary_expression') {
      if (node.childForFieldName('operator')?.text === 'typeof') n++;
    } else if (node.type === 'if_statement' && isElseIfChain(node)) {
      n++;
    }
  });
  return n;
}

function declaredNamesOf(paramsNode, bodyNode) {
  const names = [];
  for (const p of paramListOf(paramsNode)) {
    const pat = patternOf(p);
    if (pat && pat.type === 'identifier') names.push({ name: pat.text, line: lineOf(p) });
  }
  for (const decl of descendantsOfType(bodyNode, ['variable_declarator'])) {
    const nameNode = decl.childForFieldName('name');
    if (nameNode && nameNode.type === 'identifier') names.push({ name: nameNode.text, line: lineOf(decl) });
  }
  return names;
}

function magicNumbersOf(bodyNode) {
  const found = [];
  for (const lit of descendantsOfType(bodyNode, ['number'])) {
    let node = lit;
    let value = Number(lit.text);
    const parent = lit.parent;
    if (parent?.type === 'unary_expression' && parent.childForFieldName('operator')?.text === '-') {
      value = -value;
      node = parent;
    }
    if (value === 0 || value === 1 || value === -1) continue;

    const initParent = node.parent;
    let excluded = false;
    if (initParent?.type === 'variable_declarator' && initParent.childForFieldName('value') === node) {
      const declList = initParent.parent;
      if (declList?.type === 'lexical_declaration' && declList.child(0)?.type === 'const') excluded = true;
    }
    // TS enum members (`enum_assignment`, e.g. `Red = 1`) — verified node
    // type by parsing a real `enum` declaration and inspecting the CST.
    if (initParent?.type === 'enum_assignment') excluded = true;
    if (excluded) continue;

    found.push({ value, line: lineOf(lit) });
  }
  return found;
}

function emptyCatchesOf(bodyNode) {
  const found = [];
  for (const cc of descendantsOfType(bodyNode, ['catch_clause'])) {
    const block = cc.childForFieldName('body');
    if (block && block.namedChildCount === 0) found.push({ line: lineOf(cc) });
  }
  return found;
}

function deadConditionalsOf(bodyNode) {
  const found = [];
  for (const ifStmt of descendantsOfType(bodyNode, ['if_statement'])) {
    const cond = unwrapParen(ifStmt.childForFieldName('condition'));
    if (cond?.type === 'true') found.push({ line: lineOf(ifStmt), kind: 'if-true' });
    else if (cond?.type === 'false') found.push({ line: lineOf(ifStmt), kind: 'if-false' });
  }
  for (const whileStmt of descendantsOfType(bodyNode, ['while_statement'])) {
    const cond = unwrapParen(whileStmt.childForFieldName('condition'));
    if (cond?.type === 'false') found.push({ line: lineOf(whileStmt), kind: 'while-false' });
  }
  return found;
}

function statementTextsOf(bodyNode) {
  const found = [];
  for (const node of descendantsOfType(bodyNode, STATEMENT_TYPES)) {
    const text = normalizeText(node.text);
    if (text.length > 10) found.push({ text, line: lineOf(node) });
  }
  return found;
}

function nullChecksOf(bodyNode) {
  const found = [];
  for (const ifStmt of descendantsOfType(bodyNode, ['if_statement'])) {
    const cond = ifStmt.childForFieldName('condition');
    if (!cond) continue;
    for (const b of descendantsOfType(cond, ['binary_expression'])) {
      const op = b.childForFieldName('operator')?.text;
      if (op !== '===' && op !== '!==') continue;
      const left = b.childForFieldName('left');
      const right = b.childForFieldName('right');
      if (left?.type === 'null' || right?.type === 'null') { found.push({ line: lineOf(ifStmt) }); break; }
    }
  }
  return found;
}

const STRATEGY_BEHAVIOR_RE = /(calculate|process|validate|format)/i;
function switchStatementsOf(bodyNode) {
  const found = [];
  for (const sw of descendantsOfType(bodyNode, ['switch_statement'])) {
    const discriminant = sw.childForFieldName('value');
    const discriminantText = discriminant ? discriminant.text : '';
    const swText = sw.text;
    found.push({
      line: lineOf(sw),
      hasBehaviorCall: STRATEGY_BEHAVIOR_RE.test(swText),
      hasTypeCreation: /type/i.test(discriminantText) && /\bnew\s+/.test(swText),
    });
  }
  return found;
}

function complexConditionalsOf(bodyNode) {
  const found = [];
  for (const ifStmt of descendantsOfType(bodyNode, ['if_statement'])) {
    const inner = unwrapParen(ifStmt.childForFieldName('condition'));
    const condText = inner ? inner.text : '';
    if (condText.length >= 50) found.push({ line: lineOf(ifStmt), length: condText.length });
  }
  return found;
}

const PATTERN_ADVISOR_BEHAVIOR_RE = /(calculate|process|execute|validate|format)/i;
function switchBehaviorCallLineOf(bodyNode) {
  for (const sw of descendantsOfType(bodyNode, ['switch_statement'])) {
    if (PATTERN_ADVISOR_BEHAVIOR_RE.test(sw.text)) return lineOf(sw);
  }
  return null;
}

function constructorNewCallTargetsOf(bodyNode) {
  const out = [];
  for (const n of descendantsOfType(bodyNode, ['new_expression'])) {
    const ctor = n.childForFieldName('constructor');
    if (ctor) out.push(ctor.text);
  }
  return out;
}

const FEATURE_CALL_RE = /(wrap|add|extend|enhance)/i;
function trailingCallName(callExpr) {
  const fn = callExpr.childForFieldName('function');
  if (!fn) return '';
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property');
    return prop ? prop.text : fn.text;
  }
  return fn.text.replace(/^this\./, '');
}

function conditionalFeatureCallLineOf(bodyNode) {
  for (const ifStmt of descendantsOfType(bodyNode, ['if_statement'])) {
    const then = ifStmt.childForFieldName('consequence');
    if (!then) continue;
    const calls = descendantsOfType(then, ['call_expression']);
    if (calls.some((c) => FEATURE_CALL_RE.test(trailingCallName(c)))) return lineOf(ifStmt);
  }
  return null;
}

function deepChainCallCountOf(bodyNode) {
  let n = 0;
  for (const c of descendantsOfType(bodyNode, ['call_expression'])) {
    const fn = c.childForFieldName('function');
    if (fn?.type === 'member_expression' && fn.childForFieldName('object')?.type === 'member_expression') n++;
  }
  return n;
}

function calleeNamesOf(bodyNode) {
  return descendantsOfType(bodyNode, ['call_expression']).map(trailingCallName);
}

// ── Member/unit assembly ────────────────────────────────────────────────

const STDLIB_WHITELIST = new Set([
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Array', 'Object', 'Date', 'Error',
  'TypeError', 'RangeError', 'RegExp', 'Promise', 'URL', 'URLSearchParams',
  'AbortController', 'Buffer', 'Headers', 'Request', 'Response',
]);
const PRIMITIVE_TYPES = new Set(['string', 'number', 'boolean', 'any', 'unknown']);

function isPublicOf(isPublicNode, name) {
  if (!isPublicNode) return false;
  const access = accessibilityOf(isPublicNode);
  if (access === 'private' || access === 'protected') return false;
  if ((name ?? '').startsWith('#')) return false;
  return true;
}

/**
 * `cls.getMethods()`-equivalent alone would miss constructors, get/set
 * accessors, and arrow-function class properties ("class ArrowGod { greet =
 * () => {} }") — a mainstream TS/JS style. Mirrors typescript.mjs's
 * `memberEntries()` for the same reason: a class scored on methods alone
 * with none present reads as `members.length === 0`, a silent perfect score
 * on a class the scorer never actually looked inside.
 */
function memberEntriesOf(classBody) {
  const entries = [];
  for (let i = 0; i < classBody.namedChildCount; i++) {
    const node = classBody.namedChild(i);
    if (!node) continue;
    if (node.type === 'method_definition') {
      const nameNode = node.childForFieldName('name');
      const name = nameNode ? nameNode.text : '(anonymous)';
      const bodyNode = node.childForFieldName('body');
      if (!bodyNode) continue; // abstract/overload signature — no body to analyze
      const isCtor = name === 'constructor';
      entries.push({
        name,
        paramsNode: node.childForFieldName('parameters'),
        bodyNode,
        isPublicNode: isCtor ? null : node, // constructor: not counted toward ISP's public behavioral surface, matching typescript.mjs
        isStatic: isStaticNode(node),
        typeSourceNode: node,
        defNode: node,
      });
    } else if (node.type === 'public_field_definition') {
      const valueNode = node.childForFieldName('value');
      if (valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression' || valueNode.type === 'generator_function')) {
        const nameNode = node.childForFieldName('name');
        const name = nameNode ? nameNode.text : '(anonymous)';
        entries.push({
          name,
          paramsNode: valueNode.childForFieldName('parameters') ?? valueNode.childForFieldName('parameter'),
          bodyNode: valueNode.childForFieldName('body'),
          isPublicNode: node,
          isStatic: isStaticNode(node),
          typeSourceNode: valueNode,
          defNode: node,
        });
      }
    }
  }
  return entries;
}

function findConstructorNode(bodyNode) {
  if (!bodyNode) return null;
  for (let i = 0; i < bodyNode.namedChildCount; i++) {
    const c = bodyNode.namedChild(i);
    if (c && c.type === 'method_definition' && c.childForFieldName('name')?.text === 'constructor') return c;
  }
  return null;
}

function callsSuperIn(bodyNode) {
  return descendantsOfType(bodyNode, ['call_expression']).some((c) => {
    const fn = c.childForFieldName('function');
    if (!fn) return false;
    // `super(...)` — function field IS a `super` node (verified: distinct
    // from `super.method(...)`, whose function field is a `member_expression`
    // with `object` field of type `super`).
    if (fn.type === 'super') return true;
    if (fn.type === 'member_expression') return fn.childForFieldName('object')?.type === 'super';
    return false;
  });
}

function returnTypeTextOf(typeSourceNode) {
  const n = typeSourceNode?.childForFieldName?.('return_type');
  return n ? n.text.replace(/^:\s*/, '') : null;
}

/**
 * `declaredNames` entries whose name contains a destructuring bracket are a
 * known wrinkle in the vendored extractor: a destructured parameter
 * (`{ handle, target, snapshot }`) or local (`const { a, b } = x`) has no
 * single bound identifier at the grammar's `name`/`pattern` field, so
 * `memberFacts.js`'s `parameterName()`/declarator handling falls back to
 * the whole pattern's normalized source text as ONE combined "name" — verified
 * empirically this session (`{ handle, target, snapshot }` as a single
 * `declaredNames` entry). This repo's N1/N2 naming rules (clean-code-
 * scoring.mjs) want simple, non-destructured bindings only, so any entry
 * shaped like a pattern is dropped rather than reported as a single
 * cryptic/noise-word "name".
 */
function filterDeclaredNames(declaredNames) {
  const out = [];
  for (const d of declaredNames) {
    if (/[{}[\]]/.test(d.name)) continue;
    out.push({ name: d.name, line: d.line });
  }
  return out;
}

function normalizedMember(entry, baseMethodsMap, nativeMember) {
  const { name, paramsNode, bodyNode, isPublicNode, typeSourceNode } = entry;
  const isPublic = isPublicOf(isPublicNode, name);
  const base = name && baseMethodsMap ? baseMethodsMap.get(name) : null;
  let override = null;
  if (base) {
    const baseParamCount = paramListOf(base.childForFieldName('parameters')).length;
    override = {
      baseParamCount,
      callsSuper: callsSuperIn(bodyNode),
      returnType: returnTypeTextOf(typeSourceNode),
      baseReturnType: returnTypeTextOf(base),
    };
  }

  // Facts that stay local regardless of correlation — see the file header
  // ("WHAT STAYS LOCALLY COMPUTED, AND WHY") for why each of these cannot
  // be sourced from the vendored extractor's ParsedMember shape.
  const localFacts = {
    calls: callsOf(bodyNode),
    emptyCatches: emptyCatchesOf(bodyNode),
    deadConditionals: deadConditionalsOf(bodyNode),
    statementTexts: statementTextsOf(bodyNode),
    nullChecks: nullChecksOf(bodyNode),
    switchStatements: switchStatementsOf(bodyNode),
    complexConditionals: complexConditionalsOf(bodyNode),
    switchBehaviorCallLine: switchBehaviorCallLineOf(bodyNode),
    conditionalFeatureCallLine: conditionalFeatureCallLineOf(bodyNode),
  };

  if (nativeMember) {
    return {
      name: name ?? '(anonymous)',
      paramCount: nativeMember.paramCount,
      fieldAccess: nativeMember.fieldAccess,
      branchHits: nativeMember.branchHits,
      isPublic,
      override,
      statementCount: nativeMember.statementCount,
      declaredNames: filterDeclaredNames(nativeMember.declaredNames),
      magicNumbers: nativeMember.magicNumbers.map((n) => ({ value: Number(n.value), line: n.line })),
      constructorNewCallTargets: nativeMember.constructorNewCallTargets,
      deepChainCallCount: nativeMember.deepChainCallCount,
      calleeNames: nativeMember.calleeNames,
      ...localFacts,
    };
  }

  // Correlation miss — see the file header's CORRELATION section. Compute
  // every field locally, exactly as this plugin did before the native
  // extractor existed, so a miss degrades to old-but-correct rather than a
  // dropped or wrong fact.
  return {
    name: name ?? '(anonymous)',
    paramCount: paramListOf(paramsNode).length,
    fieldAccess: fieldsOf(bodyNode),
    branchHits: branchHitsOf(bodyNode),
    isPublic,
    override,
    statementCount: statementCountOf(bodyNode),
    declaredNames: declaredNamesOf(paramsNode, bodyNode),
    magicNumbers: magicNumbersOf(bodyNode),
    constructorNewCallTargets: constructorNewCallTargetsOf(bodyNode),
    deepChainCallCount: deepChainCallCountOf(bodyNode),
    calleeNames: calleeNamesOf(bodyNode),
    ...localFacts,
  };
}

function namedImportSpecifiersOf(rootNode) {
  const out = [];
  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const node = rootNode.namedChild(i);
    if (!node || node.type !== 'import_statement') continue;
    for (let j = 0; j < node.namedChildCount; j++) {
      const clause = node.namedChild(j);
      if (!clause || clause.type !== 'import_clause') continue;
      for (let k = 0; k < clause.namedChildCount; k++) {
        const cc = clause.namedChild(k);
        if (cc && cc.type === 'named_imports') {
          for (let m = 0; m < cc.namedChildCount; m++) {
            const spec = cc.namedChild(m);
            if (spec && spec.type === 'import_specifier') {
              const nameNode = spec.childForFieldName('name');
              if (nameNode) out.push(nameNode.text);
            }
          }
        }
      }
    }
  }
  return out;
}

function concreteDependencyCounts(scopeNode, rootNode, localClassNames, constructorNode) {
  let concrete = 0;
  for (const n of descendantsOfType(scopeNode, ['new_expression'])) {
    const ctor = n.childForFieldName('constructor');
    const name = ctor ? ctor.text : '';
    if (STDLIB_WHITELIST.has(name)) continue;
    if (localClassNames.has(name)) concrete++;
  }
  const importNames = namedImportSpecifiersOf(rootNode);
  let injected = 0;
  if (constructorNode) {
    for (const p of paramListOf(constructorNode.childForFieldName('parameters'))) {
      if (p.type !== 'required_parameter' && p.type !== 'optional_parameter') continue;
      const typeNode = p.childForFieldName('type');
      const t = typeNode ? typeNode.text.replace(/^:\s*/, '').trim() : null;
      if (t && !PRIMITIVE_TYPES.has(t)) injected++;
    }
  }
  return { concreteInstantiations: concrete, totalDependencies: concrete + importNames.length + injected };
}

function getDeclarationNode(topNode) {
  if (topNode.type === 'export_statement') {
    for (let i = 0; i < topNode.namedChildCount; i++) {
      const child = topNode.namedChild(i);
      if (child && child.type !== 'comment') return child;
    }
    return null;
  }
  return topNode;
}

function classHeritageBaseName(cls) {
  for (let i = 0; i < cls.namedChildCount; i++) {
    const c = cls.namedChild(i);
    if (c && c.type === 'class_heritage') {
      for (let j = 0; j < c.namedChildCount; j++) {
        const cc = c.namedChild(j);
        if (cc && cc.type === 'extends_clause') {
          const target = cc.namedChild(0);
          return target ? target.text : null;
        }
      }
    }
  }
  return null;
}

function allClassDeclarationsAcrossCache(extraRoot) {
  const out = [];
  const roots = new Set([...[...fileCache.values()].map((e) => e.rootNode), extraRoot]);
  for (const root of roots) {
    for (const cls of descendantsOfType(root, ['class_declaration'])) out.push(cls);
  }
  return out;
}

function findClassDeclByName(name, extraRoot) {
  for (const cls of allClassDeclarationsAcrossCache(extraRoot)) {
    if (cls.childForFieldName('name')?.text === name) return cls;
  }
  return null;
}

function unitFromClass(cls, rootNode, localClassNames, nativeUnitsByName, nativeIndex) {
  const nameNode = cls.childForFieldName('name');
  const bodyNode = cls.childForFieldName('body');
  const baseName = classHeritageBaseName(cls);
  const baseDecl = baseName ? findClassDeclByName(baseName, rootNode) : null;
  const className = nameNode ? nameNode.text : '(anonymous)';

  let baseMethodsMap = null;
  if (baseDecl) {
    const baseBody = baseDecl.childForFieldName('body');
    baseMethodsMap = new Map();
    if (baseBody) {
      for (let i = 0; i < baseBody.namedChildCount; i++) {
        const m = baseBody.namedChild(i);
        if (m && m.type === 'method_definition') {
          const mn = m.childForFieldName('name');
          if (mn) baseMethodsMap.set(mn.text, m);
        }
      }
    }
  }

  const entries = bodyNode ? memberEntriesOf(bodyNode) : [];
  const members = entries.map((e) => {
    const nativeStartLine = e.typeSourceNode.startPosition.row + 1;
    const nm = nativeIndex.get(nativeMemberKey(className, e.name, nativeStartLine));
    return normalizedMember(e, baseMethodsMap, nm);
  });

  const nativeUnit = nativeUnitsByName.get(className);

  let dep;
  let staticPropertyNames;
  let hasBaseClassFlag;
  if (nativeUnit) {
    dep = { concreteInstantiations: nativeUnit.concreteInstantiations, totalDependencies: nativeUnit.totalDependencies };
    staticPropertyNames = nativeUnit.staticPropertyNames;
    hasBaseClassFlag = nativeUnit.hasBaseClass;
  } else {
    // Correlation miss (e.g. two classes sharing a name in one file) — fall
    // back to this plugin's original local computation, unchanged.
    const ctorNode = findConstructorNode(bodyNode);
    dep = concreteDependencyCounts(cls, rootNode, localClassNames, ctorNode);
    staticPropertyNames = [];
    if (bodyNode) {
      for (let i = 0; i < bodyNode.namedChildCount; i++) {
        const c = bodyNode.namedChild(i);
        if (c && c.type === 'public_field_definition' && isStaticNode(c)) {
          const n = c.childForFieldName('name');
          if (n) staticPropertyNames.push(n.text);
        }
      }
    }
    hasBaseClassFlag = Boolean(baseName);
  }

  return {
    name: className,
    kind: 'class',
    members,
    hasBaseClass: hasBaseClassFlag,
    ...dep,
    staticPropertyNames,
    hasGetInstanceMethod: nativeUnit ? nativeUnit.hasGetInstanceMethod : members.some((m) => m.name === 'getInstance'),
  };
}

function unitsFromModuleLevel(rootNode, localClassNames, filePath, nativeIndex) {
  const fnDecls = [];
  const arrowFns = [];
  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const top = rootNode.namedChild(i);
    const exported = top.type === 'export_statement';
    const decl = getDeclarationNode(top);
    if (!decl) continue;
    if (decl.type === 'function_declaration') {
      fnDecls.push({ decl, exported });
    } else if (decl.type === 'lexical_declaration' || decl.type === 'variable_declaration') {
      for (let j = 0; j < decl.namedChildCount; j++) {
        const declarator = decl.namedChild(j);
        if (!declarator || declarator.type !== 'variable_declarator') continue;
        const nameNode = declarator.childForFieldName('name');
        const valueNode = declarator.childForFieldName('value');
        if (!nameNode || nameNode.type !== 'identifier') continue;
        if (valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression')) {
          arrowFns.push({ name: nameNode.text, node: valueNode, exported });
        }
      }
    }
  }

  if (!fnDecls.length && !arrowFns.length) return [];

  const members = [
    ...fnDecls.map(({ decl, exported }) => {
      const entry = {
        name: decl.childForFieldName('name')?.text ?? '(anonymous)',
        paramsNode: decl.childForFieldName('parameters'),
        bodyNode: decl.childForFieldName('body'),
        isPublicNode: exported ? decl : null,
        typeSourceNode: decl,
      };
      const nativeStartLine = decl.startPosition.row + 1;
      const nm = nativeIndex.get(nativeMemberKey(null, entry.name, nativeStartLine));
      return normalizedMember(entry, null, nm);
    }),
    ...arrowFns.map(({ name, node, exported }) => {
      const entry = {
        name,
        paramsNode: node.childForFieldName('parameters') ?? node.childForFieldName('parameter'),
        bodyNode: node.childForFieldName('body'),
        isPublicNode: exported ? node : null,
        typeSourceNode: node,
      };
      const nativeStartLine = node.startPosition.row + 1;
      const nm = nativeIndex.get(nativeMemberKey(null, name, nativeStartLine));
      return normalizedMember(entry, null, nm);
    }),
  ];

  const dep = concreteDependencyCounts(rootNode, rootNode, localClassNames, null);
  return [{
    name: basename(filePath),
    kind: 'module',
    members,
    hasBaseClass: false,
    ...dep,
    staticPropertyNames: [],
    hasGetInstanceMethod: members.some((m) => m.name === 'getInstance'),
  }];
}

function unitsFromParsedFile(rootNode, filePath) {
  const localClassNames = new Set();
  for (const cls of allClassDeclarationsAcrossCache(rootNode)) {
    const n = cls.childForFieldName('name');
    if (n) localClassNames.add(n.text);
  }

  const classDecls = [];
  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const top = rootNode.namedChild(i);
    const decl = getDeclarationNode(top);
    if (decl && decl.type === 'class_declaration') classDecls.push(decl);
  }

  // One synchronous call to the vendored extractor per file. `extractMembers`
  // is a pure function of (rootNode, language) — see the file header — so
  // this is safe to call from this plugin's synchronous extractUnits(). A
  // throw here (grammar/extractor mismatch this plugin has not seen) must
  // never take down the whole scorer: every member/unit falls back to fully
  // local computation via an empty index, same as a correlation miss.
  let native;
  try {
    native = extractMembers(rootNode, nativeLanguageFor(filePath));
  } catch {
    native = { members: [], units: [] };
  }
  const nativeIndex = buildNativeMemberIndex(native.members);
  const nativeUnitsByName = new Map(native.units.map((u) => [u.name, u]));

  if (classDecls.length) {
    return classDecls.map((cls) => unitFromClass(cls, rootNode, localClassNames, nativeUnitsByName, nativeIndex));
  }
  return unitsFromModuleLevel(rootNode, localClassNames, filePath, nativeIndex);
}

// ── Cross-file dead-export / reference-site scanning ──────────────────
// tree-sitter has no language-service `findReferencesAsNodes()` — this is a
// real identifier-text walk over every cached parsed file (declaration's
// own name-node occurrence excluded), not a semantic resolver. It will
// count a same-named unrelated identifier in another file as a "reference"
// where ts-morph's type-aware resolver would not — a real, disclosed
// precision tradeoff of the syntactic approach, not a bug. See
// VALIDATOR-ARCHITECTURE.md's parity write-up for the practical impact
// (SOLID does not call either of these two functions, so it does not affect
// the parity numbers reported there).

function exportedDeclarationsOf(rootNode) {
  const out = [];
  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const top = rootNode.namedChild(i);
    if (top.type !== 'export_statement') continue;
    const decl = getDeclarationNode(top);
    if (decl) {
      if (decl.type === 'function_declaration' || decl.type === 'class_declaration'
        || decl.type === 'interface_declaration' || decl.type === 'type_alias_declaration') {
        const n = decl.childForFieldName('name');
        if (n) out.push({ name: n.text, line: lineOf(decl), kind: decl.type, nameNode: n });
      } else if (decl.type === 'lexical_declaration' || decl.type === 'variable_declaration') {
        for (const d of descendantsOfType(decl, ['variable_declarator'])) {
          const n = d.childForFieldName('name');
          if (n && n.type === 'identifier') out.push({ name: n.text, line: lineOf(d), kind: 'variable_declarator', nameNode: n });
        }
      }
    }
    // `export { a, b }` named-export-list form
    for (let j = 0; j < top.namedChildCount; j++) {
      const c = top.namedChild(j);
      if (c.type === 'export_clause') {
        for (let k = 0; k < c.namedChildCount; k++) {
          const spec = c.namedChild(k);
          if (spec.type === 'export_specifier') {
            const n = spec.childForFieldName('name');
            if (n) out.push({ name: n.text, line: lineOf(spec), kind: 'export_specifier', nameNode: n });
          }
        }
      }
    }
  }
  return out;
}

function countReferencesAcrossFiles(name, declNode, declFilePath) {
  let count = 0;
  const files = [];
  for (const [path, entry] of fileCache.entries()) {
    walkSelfAndDescendants(entry.rootNode, (n) => {
      if (n.type !== 'identifier' && n.type !== 'type_identifier') return;
      if (n.text !== name) return;
      if (path === declFilePath && n.startIndex === declNode.startIndex) return; // exclude the declaration's own name occurrence
      count++;
      if (!files.includes(path)) files.push(path);
    });
  }
  return { count, files };
}

/**
 * G9 export-usage half — cross-file identifier scan (see comment block
 * above). `projectFilePaths` MUST include every file a real usage could
 * live in; a name matching zero files in that set reports `referenceCount:
 * 0`, same as a name with no callers at all.
 */
export function deadExportsOf(filePath, projectFilePaths = []) {
  ensureCached(new Set([filePath, ...projectFilePaths]));
  const entry = fileCache.get(filePath);
  if (!entry) return [];
  return exportedDeclarationsOf(entry.rootNode).map(({ name, line, kind, nameNode }) => {
    const { count } = countReferencesAcrossFiles(name, nameNode, filePath);
    return { name, line, referenceCount: count, kind };
  });
}

/**
 * refactoring effort estimation's call-site-count / package-boundary
 * criteria — same cross-file identifier scan as deadExportsOf above,
 * targeted at ONE named export, also returning the deduplicated file list.
 */
export function referenceSitesOf(filePath, exportName, projectFilePaths = []) {
  ensureCached(new Set([filePath, ...projectFilePaths]));
  const entry = fileCache.get(filePath);
  if (!entry) return { referenceCount: -1, files: [], kind: null };
  const exported = exportedDeclarationsOf(entry.rootNode).find((e) => e.name === exportName);
  if (!exported) return { referenceCount: -1, files: [], kind: null };
  const { count, files } = countReferencesAcrossFiles(exportName, exported.nameNode, filePath);
  return { referenceCount: count, files, kind: exported.kind };
}

// ── Plugin surface ──────────────────────────────────────────────────────

export const treesitterPlugin = {
  id: 'tree-sitter',
  canHandle: (filePath) => /\.(mjs|ts|tsx|js|cjs)$/.test(filePath),
  extractUnits(filePath, sourceText) {
    const entry = cacheEntryFor(filePath, sourceText);
    return unitsFromParsedFile(entry.rootNode, filePath);
  },
  importsOf(filePath, sourceText) {
    const entry = cacheEntryFor(filePath, sourceText);
    const out = [];
    for (let i = 0; i < entry.rootNode.namedChildCount; i++) {
      const node = entry.rootNode.namedChild(i);
      if (node.type !== 'import_statement') continue;
      const source = node.childForFieldName('source');
      if (source) out.push(source.text.replace(/^['"]|['"]$/g, ''));
    }
    return out;
  },
  deadExportsOf,
  referenceSitesOf,
};
