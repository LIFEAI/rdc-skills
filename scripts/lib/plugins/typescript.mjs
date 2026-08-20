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
      return {
        name: cls.getName() ?? '(anonymous)', kind: 'class', members,
        hasBaseClass: Boolean(heritage), ...dep,
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
  return [{ name: sourceFile.getBaseName(), kind: 'module', members, hasBaseClass: false, ...dep }];
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
};
