/**
 * TypeScript/JavaScript language plugin — the Day-1 implementation of the
 * language-plugin contract (see ../language-plugin.mjs). This is the ONLY
 * file in the scorer allowed to import ts-morph or reason about its AST.
 */

import { Project, SyntaxKind, VariableDeclarationKind } from 'ts-morph';

const STDLIB_WHITELIST = new Set([
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Array', 'Object', 'Date', 'Error',
  'TypeError', 'RangeError', 'RegExp', 'Promise', 'URL', 'URLSearchParams',
  'AbortController', 'Buffer', 'Headers', 'Request', 'Response',
]);

function fieldsOf(m) {
  return m.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
    .filter((p) => p.getExpression().getKind() === SyntaxKind.ThisKeyword)
    .map((p) => p.getName());
}

function callsOf(m) {
  return m.getDescendantsOfKind(SyntaxKind.CallExpression)
    .map((c) => c.getExpression().getText().replace(/^this\./, ''));
}

function branchHitsOf(m) {
  let n = 0;
  n += m.getDescendantsOfKind(SyntaxKind.SwitchStatement)
    .reduce((s, sw) => s + sw.getClauses().filter((c) => c.getKind() === SyntaxKind.CaseClause).length, 0);
  n += m.getDescendantsOfKind(SyntaxKind.BinaryExpression).filter((b) => b.getOperatorToken().getText() === 'instanceof').length;
  n += m.getDescendantsOfKind(SyntaxKind.TypeOfExpression).length;
  n += m.getDescendantsOfKind(SyntaxKind.IfStatement).filter((s) => s.getElseStatement()?.getKind() === SyntaxKind.IfStatement).length;
  return n;
}

// ── Clean Code facts (N1/N2/N4/F1/E1/G9's unreachable-code half) ──────────
// Real detection logic ported from architecture-toolkit's src/agents/
// clean-code-analyzer/tools (MIT, github.com/OnSightTeam/architecture-toolkit,
// explicit reuse approval from the operator) — its own checks run whole-file
// text regexes against `code.match(...)` with an occurrence-count threshold,
// which is why it needs ">3 single-letter assignments" as noise suppression
// instead of just flagging one. Ours walks the real AST per declared binding,
// so context (a for-loop counter, a const-declared magic number) is known
// directly and every occurrence is its own finding — no threshold needed to
// separate signal from regex false-positives.

const STATEMENT_KINDS = [
  SyntaxKind.ExpressionStatement, SyntaxKind.VariableStatement, SyntaxKind.IfStatement,
  SyntaxKind.ForStatement, SyntaxKind.ForInStatement, SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement, SyntaxKind.DoStatement, SyntaxKind.SwitchStatement,
  SyntaxKind.ReturnStatement, SyntaxKind.ThrowStatement, SyntaxKind.TryStatement,
  SyntaxKind.BreakStatement, SyntaxKind.ContinueStatement, SyntaxKind.LabeledStatement,
];
// F1 (long method, threshold 20) — architecture-toolkit's own real threshold
// at src/agents/clean-code-analyzer/tools/function-validator.ts:52
// (`if (avgLinesPerFunction > 20)`) independently lands on the same number
// our task spec names; corroborated, not just copied.
function statementCountOf(m) {
  return STATEMENT_KINDS.reduce((n, k) => n + m.getDescendantsOfKind(k).length, 0);
}

// N1/N2 raw material — every simple (non-destructured) local binding name:
// parameters plus `let`/`const`/`var` declarations, with its declaration
// line. Destructuring patterns are skipped (getName() on a binding pattern
// isn't a single identifier) rather than mis-flagged.
function declaredNamesOf(paramsNode, bodyNode) {
  const names = [];
  for (const p of paramsNode.getParameters()) {
    if (p.getNameNode().getKind() === SyntaxKind.Identifier) names.push({ name: p.getName(), line: p.getStartLineNumber() });
  }
  for (const decl of bodyNode.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (decl.getNameNode().getKind() === SyntaxKind.Identifier) names.push({ name: decl.getName(), line: decl.getStartLineNumber() });
  }
  return names;
}

// N4 magic numbers — numeric literal other than 0/1/-1, excluded only when
// it is the DIRECT initializer of a `const` variable declaration or an enum
// member (the two AST-visible "this number has already been named" shapes).
function magicNumbersOf(m) {
  const found = [];
  for (const lit of m.getDescendantsOfKind(SyntaxKind.NumericLiteral)) {
    let node = lit;
    let value = Number(lit.getText());
    const parent = lit.getParent();
    if (parent?.getKind() === SyntaxKind.PrefixUnaryExpression && parent.getOperatorToken() === SyntaxKind.MinusToken) {
      value = -value;
      node = parent;
    }
    if (value === 0 || value === 1 || value === -1) continue;

    const initParent = node.getParent();
    let excluded = false;
    if (initParent?.getKind() === SyntaxKind.VariableDeclaration && initParent.getInitializer() === node) {
      const declList = initParent.getParent();
      if (declList?.getKind() === SyntaxKind.VariableDeclarationList && declList.getDeclarationKind() === VariableDeclarationKind.Const) excluded = true;
    }
    if (initParent?.getKind() === SyntaxKind.EnumMember) excluded = true;
    if (excluded) continue;

    found.push({ value, line: lit.getStartLineNumber() });
  }
  return found;
}

// E1 empty catch blocks — real pattern is architecture-toolkit's
// src/agents/clean-code-analyzer/tools/code-smell-validator.ts:160
// (`/catch\s*\([^)]+\)\s*{\s*}/i`). AST form: zero statements in the block —
// strictly stronger than their regex, which a `catch(e) { /* ignored */ }`
// comment-only block would NOT match (comment text isn't whitespace) but is
// exactly as empty in intent.
function emptyCatchesOf(m) {
  const found = [];
  for (const cc of m.getDescendantsOfKind(SyntaxKind.CatchClause)) {
    if (cc.getBlock().getStatements().length === 0) found.push({ line: cc.getStartLineNumber() });
  }
  return found;
}

// E2 unguarded risky operations — new rule, not ported from architecture-
// toolkit (checked: no E2/E3/E4 exist anywhere in that source or in this
// repo's own clean-code-analyzer/SKILL.md "not implemented" table — this is
// genuinely new scope, not previously deferred with a documented reason).
// Conservative by design: only `await` expressions and a small named list of
// known-throwing sync calls (JSON.parse, fs.readFileSync/writeFileSync)
// count as "risky" — flagging every function call as risky would swamp
// real findings in noise. "Guarded" means textually inside a TryStatement's
// TRY block specifically (not its catch/finally) — computed by walking each
// try block's own descendants first, so a risky op inside a catch/finally
// of one try but not wrapped by any try of its own still reports correctly.
const RISKY_SYNC_CALL_NAMES = ['JSON.parse', 'readFileSync', 'writeFileSync'];
function unguardedRiskyOpsOf(m) {
  const guarded = new Set();
  for (const tryStmt of m.getDescendantsOfKind(SyntaxKind.TryStatement)) {
    const tryBlock = tryStmt.getTryBlock();
    for (const node of [
      ...tryBlock.getDescendantsOfKind(SyntaxKind.AwaitExpression),
      ...tryBlock.getDescendantsOfKind(SyntaxKind.CallExpression),
    ]) {
      guarded.add(node);
    }
  }
  const found = [];
  for (const awaitExpr of m.getDescendantsOfKind(SyntaxKind.AwaitExpression)) {
    if (!guarded.has(awaitExpr)) found.push({ line: awaitExpr.getStartLineNumber(), kind: 'await' });
  }
  for (const call of m.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (guarded.has(call)) continue;
    const exprText = call.getExpression().getText();
    if (RISKY_SYNC_CALL_NAMES.some((name) => exprText === name || exprText.endsWith(`.${name}`))) {
      found.push({ line: call.getStartLineNumber(), kind: exprText });
    }
  }
  return found;
}

// G9 unreachable-code half — architecture-toolkit's actual G9 implementation
// (src/agents/clean-code-analyzer/tools/code-smell-validator.ts:115,
// `/if\s*\(\s*false\s*\)|if\s*\(\s*true\s*\)/`) is constant-conditional dead
// code, NOT unused-export dead code — both are legitimate readings of
// Clean Code's G9 "Dead Code". We ship both: this AST half plus the
// cross-file export-usage half in `deadExportsOf` below.
function deadConditionalsOf(m) {
  const found = [];
  for (const ifStmt of m.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    const kind = ifStmt.getExpression().getKind();
    if (kind === SyntaxKind.TrueKeyword) found.push({ line: ifStmt.getStartLineNumber(), kind: 'if-true' });
    else if (kind === SyntaxKind.FalseKeyword) found.push({ line: ifStmt.getStartLineNumber(), kind: 'if-false' });
  }
  for (const whileStmt of m.getDescendantsOfKind(SyntaxKind.WhileStatement)) {
    if (whileStmt.getExpression().getKind() === SyntaxKind.FalseKeyword) found.push({ line: whileStmt.getStartLineNumber(), kind: 'while-false' });
  }
  return found;
}

// ── Refactoring facts (extract-method/class/param-object/magic-number,
// consolidate-duplicate-code, decompose-conditional, strategy/factory/
// null-object transforms) — ADDED for refactoring-scoring.mjs (2026-08-20),
// additive-only. Real detection logic ported from architecture-toolkit's
// src/agents/pattern-refactoring-guide/tools/{refactoring-analyzer,
// code-smell-refactoring-guide,pattern-transformation-guide}.ts (MIT,
// github.com/OnSightTeam/architecture-toolkit) — same discipline as the
// Clean Code facts above: their checks are whole-file text regexes, ours
// walk the real AST so context is known directly. extract-method/extract-
// class/introduce-parameter-object reuse statementCount/members.length/
// paramCount already on the contract; magic-number reuses `magicNumbers`.
// Only the facts below are genuinely new.

// consolidate-duplicate-code raw material — architecture-toolkit's real
// check (code-smell-refactoring-guide.ts:41,49) is whole-FILE line-text
// repetition (trimmed line length > 10 chars, repeated > 3 times, > 3 such
// patterns). Ours captures the same shape (normalized statement text, same
// length filter) per real statement NODE instead of per raw source line, so
// a duplicate spread across multiple physical lines by formatting still
// matches. Grouping/threshold logic lives in refactoring-scoring.mjs, which
// is the pure-function layer — this only supplies the raw per-member facts.
function statementTextsOf(m) {
  const found = [];
  for (const k of STATEMENT_KINDS) {
    for (const node of m.getDescendantsOfKind(k)) {
      const text = node.getText().replace(/\s+/g, ' ').trim();
      if (text.length > 10) found.push({ text, line: node.getStartLineNumber() });
    }
  }
  return found;
}

// null-object-transform raw material — architecture-toolkit's real pattern
// (pattern-transformation-guide.ts:158, `/if\s*\(\s*\w+\s*[!=]==\s*null/g`)
// is a whole-file regex counting occurrences of the text shape. AST form:
// an `if` whose condition contains a top-level `===`/`!==` comparison
// against the `null` keyword, counted once per `if` (matches the regex's
// per-match count for the common one-comparison-per-if case).
function nullChecksOf(m) {
  const found = [];
  for (const ifStmt of m.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    const expr = ifStmt.getExpression();
    // Walk every BinaryExpression in the condition, not just a lone
    // top-level one — a chained `a === null && b === null` condition's own
    // top-level node is the `&&` BinaryExpression, so a self-or-descendants
    // walk is required to reach the `=== null` comparisons nested inside it.
    const bins = [expr, ...expr.getDescendantsOfKind(SyntaxKind.BinaryExpression)].filter((n) => n.getKind() === SyntaxKind.BinaryExpression);
    for (const b of bins) {
      const op = b.getOperatorToken().getText();
      if (op !== '===' && op !== '!==') continue;
      if (b.getLeft().getKind() === SyntaxKind.NullKeyword || b.getRight().getKind() === SyntaxKind.NullKeyword) {
        found.push({ line: ifStmt.getStartLineNumber() });
        break;
      }
    }
  }
  return found;
}

// strategy-transform / factory-transform raw material — architecture-
// toolkit's real patterns are whole-file regexes: switch-on-behavior
// (pattern-transformation-guide.ts:42, `/switch\s*\([^)]*\)\s*{[^}]*
// (calculate|process|validate|format)/i`) and switch-on-type-creating
// (`:100`, `/switch\s*\([^)]*type[^)]*\)\s*{[^}]*new\s+/i`). AST form: per
// real SwitchStatement node, test the same word list against the switch's
// own text (not the whole file), so a match is attributable to a specific
// switch instead of "somewhere in this file".
const STRATEGY_BEHAVIOR_RE = /(calculate|process|validate|format)/i;
function switchStatementsOf(m) {
  const found = [];
  for (const sw of m.getDescendantsOfKind(SyntaxKind.SwitchStatement)) {
    const discriminantText = sw.getExpression().getText();
    const swText = sw.getText();
    found.push({
      line: sw.getStartLineNumber(),
      hasBehaviorCall: STRATEGY_BEHAVIOR_RE.test(swText),
      hasTypeCreation: /type/i.test(discriminantText) && /\bnew\s+/.test(swText),
    });
  }
  return found;
}

// decompose-conditional raw material — architecture-toolkit's real pattern
// (code-smell-refactoring-guide.ts:111, `/if\s*\([^)]{50,}\)/g`) is a
// whole-file regex on parenthesized condition length. AST form: the real
// `if` condition expression's own source text length, per `if`.
function complexConditionalsOf(m) {
  const found = [];
  for (const ifStmt of m.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    const condText = ifStmt.getExpression().getText();
    if (condText.length >= 50) found.push({ line: ifStmt.getStartLineNumber(), length: condText.length });
  }
  return found;
}

// ── pattern-advisor facts (Factory Method/Builder/Singleton/Decorator/
// Adapter/Facade/Strategy/Observer/Command/Template Method) — ADDED for
// pattern-scoring.mjs (2026-08-20), additive-only. Real detection heuristics
// ported from architecture-toolkit's src/agents/pattern-advisor/tools/
// {creational,structural,behavioral}-pattern-analyzer.ts (MIT,
// github.com/OnSightTeam/architecture-toolkit, raw source fetched and read in
// full this task) — same discipline as every other fact block in this file:
// their checks are whole-file text regexes with no scoping to which
// switch/if/call the signal came from; ours walk the real AST per node.
//
// Factory Method's switch-on-type-constructs-new signal
// (creational-pattern-analyzer.ts:43-44, `/switch\s*\([^)]*type[^)]*\)\s*{
// [^}]*new\s+/i`) is the IDENTICAL regex shape already captured by
// `switchStatements[].hasTypeCreation` above (added for
// refactoring-scoring.mjs's factory-transform, itself ported from
// pattern-transformation-guide.ts:100 — the same regex, different toolkit
// tool) — pattern-scoring.mjs reuses that existing field directly rather
// than duplicating the switch walk. Strategy's behavior-call word list
// (behavioral-pattern-analyzer.ts:44) is `calculate|process|execute|
// validate|format` — a SUPERSET of `switchStatements[].hasBehaviorCall`'s
// list (`calculate|process|validate|format`, no "execute", ported from a
// different toolkit file, pattern-transformation-guide.ts:42) — rather than
// editing that shared field's regex (refactoring-scoring.mjs already
// consumes it), `switchBehaviorCallLine` below is a small separate fact with
// the exact word list this task's source citation requires.
const PATTERN_ADVISOR_BEHAVIOR_RE = /(calculate|process|execute|validate|format)/i;
function switchBehaviorCallLineOf(m) {
  for (const sw of m.getDescendantsOfKind(SyntaxKind.SwitchStatement)) {
    if (PATTERN_ADVISOR_BEHAVIOR_RE.test(sw.getText())) return sw.getStartLineNumber();
  }
  return null;
}

// Factory Method's "scattered instantiation" signal
// (creational-pattern-analyzer.ts:68-83): >5 total `new` calls, >3 unique
// constructor names. UNFILTERED (includes stdlib targets), matching the
// original's blind regex — deliberately NOT the same as `concreteInstantiations`
// (computed elsewhere in this file), which counts only project-local classes
// for DIP and would under-count this check.
function constructorNewCallTargetsOf(m) {
  return m.getDescendantsOfKind(SyntaxKind.NewExpression).map((n) => n.getExpression().getText());
}

// Decorator's conditional-feature-addition signal
// (structural-pattern-analyzer.ts:39-43, `/if\s*\([^)]*\)\s*{[^}]*(wrap|add|
// extend|enhance)/i`): an if-statement whose THEN block calls a function
// named wrap/add/extend/enhance. AST form scopes the keyword search to the
// if's own consequent block, not "anywhere after an if in the file".
const FEATURE_CALL_RE = /(wrap|add|extend|enhance)/i;
function trailingCallName(callExpr) {
  const expr = callExpr.getExpression();
  return expr.getKind() === SyntaxKind.PropertyAccessExpression ? expr.getName() : expr.getText().replace(/^this\./, '');
}
function conditionalFeatureCallLineOf(m) {
  for (const ifStmt of m.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    const then = ifStmt.getThenStatement();
    if (!then) continue;
    if (then.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) => FEATURE_CALL_RE.test(trailingCallName(c)))) {
      return ifStmt.getStartLineNumber();
    }
  }
  return null;
}

// Facade's complex-subsystem-interaction signal
// (structural-pattern-analyzer.ts:104-105, `code.match(/\w+\.\w+\.\w+\(/g)`,
// threshold >5): a call shaped `a.b.c(...)` — the callee is a property
// access whose OWN receiver is itself a property access (two dots before the
// paren). AST form counts real call expressions of that shape instead of a
// regex that also matches inside strings/comments.
function deepChainCallCountOf(m) {
  let n = 0;
  for (const c of m.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = c.getExpression();
    if (expr.getKind() === SyntaxKind.PropertyAccessExpression && expr.getExpression().getKind() === SyntaxKind.PropertyAccessExpression) n++;
  }
  return n;
}

// General-purpose bare trailing call name for every call in this member —
// used by pattern-scoring.mjs for Adapter (convert/transform/adapt),
// Observer (notify/update/inform/broadcast), Command (undo/redo/history/
// queue/execute), and Template Method (initialize/process/cleanup) keyword
// scans. Distinct from the existing `calls` fact (which keeps the
// `this.`-stripped but otherwise full receiver-qualified text, e.g.
// "obj.notify") — these callers need just the trailing method/function name
// regardless of receiver, matching the original regexes'
// `\.(notify|update|...)\w*\(` shape (any receiver, bare trailing name).
function calleeNamesOf(m) {
  return m.getDescendantsOfKind(SyntaxKind.CallExpression).map((c) => trailingCallName(c));
}

/**
 * `cls.getMethods()` alone misses constructors, getters/setters, and
 * arrow-function property members ("class ArrowGod { greet = () => {} }") —
 * a mainstream TS/JS style. A class scored on methods alone with none
 * present reads as `members.length === 0`, which scores 100 at 'high'
 * confidence on SRP/ISP/DIP: a silent perfect score on a class the scorer
 * never actually looked inside. Reviewer-confirmed live: an ArrowGod fixture
 * with 3 constructor-injected deps and 3 arrow methods scored 100/100.
 *
 * @returns {{name: string, paramsNode: object, bodyNode: object, isPublicNode: object|null}[]}
 */
function memberEntries(cls) {
  const entries = [];
  for (const c of cls.getConstructors()) entries.push({ name: 'constructor', paramsNode: c, bodyNode: c, isPublicNode: null });
  for (const m of cls.getMethods()) entries.push({ name: m.getName(), paramsNode: m, bodyNode: m, isPublicNode: m });
  for (const g of cls.getGetAccessors()) entries.push({ name: g.getName(), paramsNode: g, bodyNode: g, isPublicNode: g });
  for (const s of cls.getSetAccessors()) entries.push({ name: s.getName(), paramsNode: s, bodyNode: s, isPublicNode: s });
  for (const p of cls.getProperties()) {
    const init = p.getInitializer();
    if (init && (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression)) {
      entries.push({ name: p.getName(), paramsNode: init, bodyNode: init, isPublicNode: p });
    }
  }
  return entries;
}

function normalizedMember({ name, paramsNode, bodyNode, isPublicNode }, { baseMethods = null } = {}) {
  const isPublic = isPublicNode
    ? !(isPublicNode.hasModifier?.(SyntaxKind.PrivateKeyword) || isPublicNode.hasModifier?.(SyntaxKind.ProtectedKeyword))
      && !(name ?? '').startsWith('#')
    : false; // constructor: not counted toward ISP's public behavioral surface

  const base = name && baseMethods ? baseMethods.get(name) : null;
  const override = base ? {
    baseParamCount: base.getParameters().length,
    // `super(...)` is a CallExpression whose own expression IS the super
    // keyword; `super.method()` is a CallExpression whose expression is a
    // PropertyAccessExpression on the super keyword. The original check
    // matched only the first form, so `super.method(...)` — the ONLY form
    // that appears in a real method override — never matched, penalizing
    // every correctly-written override by one third of its LSP score.
    callsSuper: bodyNode.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) => {
      const expr = c.getExpression();
      if (expr.getKind() === SyntaxKind.SuperKeyword) return true;
      if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
        return expr.getExpression().getKind() === SyntaxKind.SuperKeyword;
      }
      return false;
    }),
    returnType: bodyNode.getReturnTypeNode?.()?.getText() ?? null,
    baseReturnType: base.getReturnTypeNode?.()?.getText() ?? null,
  } : null;

  return {
    name: name ?? '(anonymous)',
    paramCount: paramsNode.getParameters().length,
    fieldAccess: fieldsOf(bodyNode),
    calls: callsOf(bodyNode),
    branchHits: branchHitsOf(bodyNode),
    isPublic,
    override,
    statementCount: statementCountOf(bodyNode),
    declaredNames: declaredNamesOf(paramsNode, bodyNode),
    magicNumbers: magicNumbersOf(bodyNode),
    emptyCatches: emptyCatchesOf(bodyNode),
    deadConditionals: deadConditionalsOf(bodyNode),
    unguardedRiskyOps: unguardedRiskyOpsOf(bodyNode),
    // ADDED for refactoring-scoring.mjs (2026-08-20), additive-only:
    statementTexts: statementTextsOf(bodyNode),
    nullChecks: nullChecksOf(bodyNode),
    switchStatements: switchStatementsOf(bodyNode),
    complexConditionals: complexConditionalsOf(bodyNode),
    // ADDED for pattern-scoring.mjs (2026-08-20), additive-only:
    switchBehaviorCallLine: switchBehaviorCallLineOf(bodyNode),
    constructorNewCallTargets: constructorNewCallTargetsOf(bodyNode),
    conditionalFeatureCallLine: conditionalFeatureCallLineOf(bodyNode),
    deepChainCallCount: deepChainCallCountOf(bodyNode),
    calleeNames: calleeNamesOf(bodyNode),
  };
}

/**
 * @param {object|null} constructorNode  the class's constructor, if it has one —
 *   a constructor-injected dependency is the actual subject of DIP and was
 *   never counted before because constructors were never visited at all.
 */
function concreteDependencyCounts(scopeNode, sourceFile, localClassNames, constructorNode = null) {
  const newExprs = scopeNode.getDescendantsOfKind(SyntaxKind.NewExpression);
  let concrete = 0;
  for (const n of newExprs) {
    const name = n.getExpression().getText();
    if (STDLIB_WHITELIST.has(name)) continue;
    if (localClassNames.has(name)) concrete++;
  }
  const imports = sourceFile.getImportDeclarations().flatMap((d) => d.getNamedImports().map((i) => i.getName()));
  const injected = constructorNode
    ? constructorNode.getParameters().filter((p) => {
        const t = p.getTypeNode()?.getText();
        return t && !['string', 'number', 'boolean', 'any', 'unknown'].includes(t);
      }).length
    : 0;
  return { concreteInstantiations: concrete, totalDependencies: concrete + imports.length + injected };
}

function unitsFromSourceFile(sourceFile) {
  const localClassNames = new Set(
    sourceFile.getProject().getSourceFiles().flatMap((sf) => sf.getClasses()).map((c) => c.getName()).filter(Boolean),
  );

  const classes = sourceFile.getClasses();
  if (classes.length) {
    return classes.map((cls) => {
      const heritage = cls.getExtends();
      const baseName = heritage?.getExpression().getText();
      const baseDecl = baseName
        ? sourceFile.getProject().getSourceFiles().flatMap((sf) => sf.getClasses()).find((c) => c.getName() === baseName)
        : null;
      const baseMethods = baseDecl ? new Map(baseDecl.getMethods().map((m) => [m.getName(), m])) : null;

      const members = memberEntries(cls).map((e) => normalizedMember(e, { baseMethods }));
      const [ctor] = cls.getConstructors();
      const dep = concreteDependencyCounts(cls, sourceFile, localClassNames, ctor ?? null);
      // Singleton signal (creational-pattern-analyzer.ts:124-146,
      // `/private\s+static\s+instance|getInstance\s*\(\)/i`) — ADDED for
      // pattern-scoring.mjs (2026-08-20), additive-only. A real static
      // property (not a text match) plus a real method named 'getInstance'.
      const staticPropertyNames = cls.getProperties().filter((p) => p.isStatic()).map((p) => p.getName());
      return {
        name: cls.getName() ?? '(anonymous)', kind: 'class', members,
        hasBaseClass: Boolean(heritage), ...dep,
        staticPropertyNames,
        hasGetInstanceMethod: members.some((mm) => mm.name === 'getInstance'),
      };
    });
  }

  // ALL top-level functions, not just exported ones. A library module's
  // unexported helpers are implementation detail another module can't see —
  // filtering to exports made sense there. A SCRIPT (tools/*.mjs, a CLI) has
  // no consumers importing it at all; its real logic routinely lives in
  // unexported helpers plus an unexported main(). The old filter scored these
  // as `[]` — not a low score, no measurement whatsoever — for every script
  // in a codebase. Confirmed live: 5 of 6 files in rdc-harness's tools/
  // scored zero units this way; only the one file with an exported function
  // was measured at all.
  const fns = sourceFile.getFunctions();

  // Top-level `const x = (...) => {}` / `const x = function() {}` — a
  // FunctionDeclaration query alone never sees these; same blind spot as
  // class arrow-property methods, one level up. `tools/ladder.mjs`'s entire
  // helper surface (`arg`, `flagPresent`, …) is written this way and scored
  // zero units without this.
  const arrowFns = [];
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (init && (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression)) {
        arrowFns.push({ name: decl.getName(), node: init, exported: stmt.isExported() });
      }
    }
  }

  if (!fns.length && !arrowFns.length) return [];
  const members = [
    ...fns.map((f) => normalizedMember({
      name: f.getName() ?? '(anonymous)', paramsNode: f, bodyNode: f,
      // ISP still means "public surface" — an exported function is genuinely
      // public API; an unexported script helper is not, even though it's
      // scored for SRP/OCP/LSP/DIP the same as everything else.
      isPublicNode: f.isExported() ? f : null,
    })),
    ...arrowFns.map(({ name, node, exported }) => normalizedMember({
      name, paramsNode: node, bodyNode: node, isPublicNode: exported ? node : null,
    })),
  ];
  const dep = concreteDependencyCounts(sourceFile, sourceFile, localClassNames);
  // ADDED for pattern-scoring.mjs (2026-08-20), additive-only — a module has
  // no static properties; hasGetInstanceMethod still checked for a top-level
  // `getInstance` function, the module-shaped analog of the class case above.
  return [{
    name: sourceFile.getBaseName(), kind: 'module', members, hasBaseClass: false, ...dep,
    staticPropertyNames: [],
    hasGetInstanceMethod: members.some((mm) => mm.name === 'getInstance'),
  }];
}

const projectCache = new Map();
// One shared project per process keeps cross-file base-class resolution (and,
// below, cross-file dead-export reference resolution) working without
// re-parsing the whole tree per file.
function sharedProject() {
  if (!projectCache.has('shared')) {
    // `allowJs: true` is REQUIRED for the type-checker to bind exports on a
    // .mjs/.js file at all — without it `sourceFile.getExportedDeclarations()`
    // / `.getExportSymbols()` silently return an empty result for every plain
    // JS file (confirmed live: every export in this very package's own .mjs
    // files scanned as zero until this option was added). Every OTHER
    // extraction path in this file (extractUnits, importsOf) is purely
    // syntactic — `f.isExported()`, `getFunctions()`, `getImportDeclarations()`
    // — and never needed the checker, which is why this bug shipped invisibly
    // until deadExportsOf (the first checker-backed feature) was added.
    projectCache.set('shared', new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true } }));
  }
  return projectCache.get('shared');
}
function projectFor(filePath) {
  const project = sharedProject();
  const existing = project.getSourceFile(filePath);
  return existing ? { project, sourceFile: existing } : { project, sourceFile: project.addSourceFileAtPath(filePath) };
}

/**
 * G9 export-usage half. A REAL reference-graph walk via ts-morph's own
 * `findReferencesAsNodes()` (language-service-backed, resolves imports/
 * re-exports/aliases) — not a text grep, which would count a same-named
 * local variable in an unrelated file as a "use" and miss a renamed import.
 *
 * `projectFilePaths` MUST include every file a real usage could live in
 * (tests included — a symbol only called from a test is still used). A
 * name matching zero files in that set is reported at `referenceCount: 0`,
 * same as a name with no callers at all — the caller is responsible for
 * having actually scanned the whole project, per the positive-control rule
 * in clean-code-scoring.mjs's dead-code check.
 */
export function deadExportsOf(filePath, projectFilePaths = []) {
  const project = sharedProject();
  for (const p of new Set([filePath, ...projectFilePaths])) {
    if (!project.getSourceFile(p)) {
      try { project.addSourceFileAtPath(p); } catch { /* unreadable/binary — not a TS/JS file, skip */ }
    }
  }
  const sourceFile = project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
  const results = [];
  for (const [name, decls] of sourceFile.getExportedDeclarations()) {
    const decl = decls[0];
    if (!decl) continue;
    const referable = typeof decl.findReferencesAsNodes === 'function' ? decl : (decl.getNameNode?.() ?? null);
    if (!referable || typeof referable.findReferencesAsNodes !== 'function') {
      results.push({ name, line: decl.getStartLineNumber(), referenceCount: -1, kind: decl.getKindName() });
      continue;
    }
    let refs = [];
    try { refs = referable.findReferencesAsNodes(); } catch { refs = []; }
    // `findReferencesAsNodes()` includes the declaration's own name
    // occurrence — exclude exactly that node (same file, same start
    // position) so a symbol with genuinely zero callers reads as 0, not 1.
    const usageRefs = refs.filter((r) => !(r.getSourceFile() === sourceFile && r.getStart() === referable.getStart()));
    results.push({ name, line: decl.getStartLineNumber(), referenceCount: usageRefs.length, kind: decl.getKindName() });
  }
  return results;
}

/**
 * refactoring effort estimation's call-site-count / package-boundary
 * criteria — ADDED for refactoring-scoring.mjs (2026-08-20), additive-only.
 * Same `findReferencesAsNodes()` mechanism as `deadExportsOf` above (same
 * shared project, same declaration-node-vs-name-node resolution, same
 * "exclude the declaration's own occurrence" dedup) — deliberately NOT a
 * second implementation, just targeted at one named export and returning
 * file paths alongside the count so a caller can test package-boundary
 * crossing without a second AST walk.
 */
export function referenceSitesOf(filePath, exportName, projectFilePaths = []) {
  const project = sharedProject();
  for (const p of new Set([filePath, ...projectFilePaths])) {
    if (!project.getSourceFile(p)) {
      try { project.addSourceFileAtPath(p); } catch { /* unreadable/binary — not a TS/JS file, skip */ }
    }
  }
  const sourceFile = project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
  const decls = sourceFile.getExportedDeclarations().get(exportName);
  const decl = decls?.[0];
  if (!decl) return { referenceCount: -1, files: [], kind: null };
  const referable = typeof decl.findReferencesAsNodes === 'function' ? decl : (decl.getNameNode?.() ?? null);
  if (!referable || typeof referable.findReferencesAsNodes !== 'function') {
    return { referenceCount: -1, files: [], kind: decl.getKindName() };
  }
  let refs = [];
  try { refs = referable.findReferencesAsNodes(); } catch { refs = []; }
  const usageRefs = refs.filter((r) => !(r.getSourceFile() === sourceFile && r.getStart() === referable.getStart()));
  const files = [...new Set(usageRefs.map((r) => r.getSourceFile().getFilePath()))];
  return { referenceCount: usageRefs.length, files, kind: decl.getKindName() };
}

export const typescriptPlugin = {
  id: 'typescript',
  canHandle: (filePath) => /\.(mjs|ts|tsx|js|cjs)$/.test(filePath),
  extractUnits(filePath, sourceText) {
    if (sourceText !== undefined) {
      // Ephemeral parse (e.g. a file's content at a git ref) — its own
      // one-shot project, never mixed into the shared cross-file project.
      const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
      const sourceFile = project.createSourceFile(filePath.replace(/^[A-Za-z]:/, ''), sourceText);
      return unitsFromSourceFile(sourceFile);
    }
    const { sourceFile } = projectFor(filePath);
    return unitsFromSourceFile(sourceFile);
  },
  importsOf(filePath, sourceText) {
    const { sourceFile } = sourceText !== undefined
      ? { sourceFile: (() => {
          const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
          return project.createSourceFile(filePath.replace(/^[A-Za-z]:/, ''), sourceText);
        })() }
      : projectFor(filePath);
    return sourceFile.getImportDeclarations().map((d) => d.getModuleSpecifierValue());
  },
  deadExportsOf,
  referenceSitesOf, // ADDED for refactoring-scoring.mjs (2026-08-20), additive-only
};
