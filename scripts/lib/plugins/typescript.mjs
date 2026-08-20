/**
 * TypeScript/JavaScript language plugin — the Day-1 implementation of the
 * language-plugin contract (see ../language-plugin.mjs). This is the ONLY
 * file in the scorer allowed to import ts-morph or reason about its AST.
 */

import { Project, SyntaxKind } from 'ts-morph';

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

  const fns = sourceFile.getFunctions().filter((f) => f.isExported());
  if (!fns.length) return [];
  const members = fns.map((f) => normalizedMember({ name: f.getName() ?? '(anonymous)', paramsNode: f, bodyNode: f, isPublicNode: f }));
  const dep = concreteDependencyCounts(sourceFile, sourceFile, localClassNames);
  return [{ name: sourceFile.getBaseName(), kind: 'module', members, hasBaseClass: false, ...dep }];
}

const projectCache = new Map();
function projectFor(filePath) {
  // One shared project per process keeps cross-file base-class resolution
  // working without re-parsing the whole tree per file.
  if (!projectCache.has('shared')) projectCache.set('shared', new Project({ skipAddingFilesFromTsConfig: true }));
  const project = projectCache.get('shared');
  const existing = project.getSourceFile(filePath);
  return existing ? { project, sourceFile: existing } : { project, sourceFile: project.addSourceFileAtPath(filePath) };
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
};
