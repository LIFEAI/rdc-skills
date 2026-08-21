/**
 * Pattern-advisor scoring — pure functions over a `NormalizedUnit` (see
 * language-plugin.mjs), same discipline as solid-scoring.mjs and
 * clean-code-scoring.mjs: no ts-morph, no language-specific parser. Every
 * fact these detectors read was computed once, in `lib/plugins/typescript.mjs`,
 * from the real AST.
 *
 * Detection heuristics (thresholds, word lists, structural shapes) are
 * ported from architecture-toolkit's REAL implementation —
 * github.com/OnSightTeam/architecture-toolkit (MIT), specifically
 * `src/agents/pattern-advisor/tools/{creational,structural,behavioral}-
 * pattern-analyzer.ts` — raw source fetched from
 * raw.githubusercontent.com/OnSightTeam/architecture-toolkit/main/... and
 * read in full this task (2026-08-20), reuse explicitly approved by the
 * operator for this scorer family. Their checks are whole-file text regexes
 * with zero scoping to which switch/if/call the signal actually came from
 * (e.g. `/switch\s*\([^)]*type[^)]*\)\s*{[^}]*new\s+/i` matches if "new"
 * appears ANYWHERE after a type-switch's opening brace, even three
 * unrelated statements later). Ours walks the real AST per switch-case /
 * if-block / call-expression via facts computed in typescript.mjs
 * (switchStatements[].hasTypeCreation, switchBehaviorCallLine,
 * constructorNewCallTargets, conditionalFeatureCallLine, deepChainCallCount,
 * calleeNames, staticPropertyNames, hasGetInstanceMethod) — every finding is
 * attributable to the real member/unit and (where the toolkit's own signal
 * is node-scoped) the real line it was found in.
 *
 * Confidence and priority numbers below are HARD-CODED, not computed — they
 * are the LITERAL values architecture-toolkit's own analyzers return (see
 * per-detector citation comment). skills/pattern-advisor/SKILL.md's existing
 * "70-90% confidence calibration table" (written before this scorer existed,
 * itself already citing the same toolkit source lines) was checked against
 * every number below: NO discrepancy found — Factory Method 90/75, Builder
 * 85, Singleton 70, Decorator 75, Adapter 80, Facade 70, Strategy 90,
 * Observer 75, Command 80, Template Method 70 all match exactly.
 *
 * One deliberate narrowing from the source: Adapter's original regex is
 * `/convert|transform|adapt|wrap.*interface/i` (structural-pattern-
 * analyzer.ts:74) — the `wrap.*interface` alternative is dropped here
 * because it is a `.*`-spanning whole-file text match with no AST-scoped
 * equivalent that wouldn't just re-derive Decorator's own "wrap" signal
 * under a different name; `convert|transform|adapt` (the unambiguous three
 * words) is kept in full.
 */

function loc(unit, memberName, line) {
  if (!memberName) return unit.name;
  return line != null ? `${unit.name}#${memberName}:${line}` : `${unit.name}#${memberName}`;
}

// ── Creational ───────────────────────────────────────────────────────────

// Factory Method — TWO independent toolkit signals, each its own finding:
//  (a) switch-on-type constructs via `new` (creational-pattern-analyzer.ts:
//      43-64) — reuses the EXISTING `switchStatements[].hasTypeCreation`
//      fact (added for refactoring-scoring.mjs's factory-transform; the
//      identical regex shape appears independently at both
//      creational-pattern-analyzer.ts:43 and pattern-transformation-guide.ts:
//      100 in the real toolkit source, so this is a genuine, not coincidental, reuse).
//  (b) >5 total `new` calls with >3 unique constructor names scattered in
//      one member (creational-pattern-analyzer.ts:67-84).
export function detectFactoryMethod(unit) {
  const findings = [];
  for (const m of unit.members) {
    for (const sw of m.switchStatements ?? []) {
      if (sw.hasTypeCreation) {
        findings.push({
          location: loc(unit, m.name, sw.line), line: sw.line,
          problem: 'switch statement on a "type" discriminant constructs objects via `new` within the switch',
          solution: 'Use Factory Method pattern to encapsulate object creation logic',
          reasoning: 'Factory Method eliminates switch statements and follows Open/Closed Principle',
          confidence: 90, priority: 'high',
          alternatives: ['Abstract Factory (if multiple product families)', 'Strategy (if behavior varies)'],
          tradeoffs: { pros: ['Open/Closed compliant', 'Easy to add new types', 'Single Responsibility'], cons: ['More classes', 'Slight complexity increase'] },
          source: 'creational-pattern-analyzer.ts:39-65',
        });
      }
    }
    const targets = m.constructorNewCallTargets ?? [];
    const unique = new Set(targets);
    if (targets.length > 5 && unique.size > 3) {
      findings.push({
        location: loc(unit, m.name), line: null,
        problem: `${targets.length} object instantiation(s) (${unique.size} different type(s)) scattered in one member`,
        solution: 'Centralize object creation in Factory Method',
        reasoning: 'Reduces coupling and makes code more maintainable',
        confidence: 75, priority: 'medium',
        alternatives: ['Abstract Factory (if multiple product families)'],
        tradeoffs: { pros: ['Centralized creation', 'Reduced coupling'], cons: ['More classes', 'Indirection'] },
        source: 'creational-pattern-analyzer.ts:67-86',
      });
    }
  }
  return { pattern: 'Factory Method', findings };
}

// Builder — constructor with >4 parameters (telescoping constructor).
// creational-pattern-analyzer.ts:92-119. `paramCount` is already part of the
// base NormalizedMember contract; no new fact needed.
export function detectBuilder(unit) {
  const findings = [];
  for (const m of unit.members) {
    if (m.name === 'constructor' && m.paramCount > 4) {
      findings.push({
        location: loc(unit, m.name), line: null,
        problem: `constructor has ${m.paramCount} parameters (telescoping constructor anti-pattern)`,
        solution: 'Use Builder pattern for step-by-step object construction',
        reasoning: 'Builder provides fluent interface and handles optional parameters elegantly',
        confidence: 85, priority: 'high',
        alternatives: ['Named-options object (if construction has no ordering constraints — do not reach for Builder when a plain object literal does the job)'],
        tradeoffs: { pros: ['Clear object construction', 'Handles optional parameters', 'Immutable objects'], cons: ['More code', 'Additional builder class needed'] },
        source: 'creational-pattern-analyzer.ts:89-122',
      });
    }
  }
  return { pattern: 'Builder', findings };
}

// Singleton — `private static instance` field OR a `getInstance()` method/
// call-site. creational-pattern-analyzer.ts:124-146
// (`/private\s+static\s+instance|getInstance\s*\(\)/i` — an OR, not an AND).
export function detectSingleton(unit) {
  const staticInstanceField = (unit.staticPropertyNames ?? []).some((n) => /instance/i.test(n));
  const getInstanceCallSite = unit.members.some((m) => (m.calleeNames ?? []).includes('getInstance'));
  if (!unit.hasGetInstanceMethod && !staticInstanceField && !getInstanceCallSite) {
    return { pattern: 'Singleton', findings: [] };
  }
  return {
    pattern: 'Singleton',
    findings: [{
      location: unit.name, line: null,
      problem: 'Singleton pattern detected (often overused anti-pattern)',
      solution: 'Consider dependency injection instead of Singleton',
      reasoning: 'Singletons create hidden dependencies and make testing difficult',
      confidence: 70, priority: 'medium',
      alternatives: ['Dependency Injection', 'Monostate pattern'],
      tradeoffs: { pros: ['Global access', 'Single instance guaranteed'], cons: ['Hidden dependencies', 'Hard to test', 'Violates SRP', 'Global state'] },
      source: 'creational-pattern-analyzer.ts:124-146',
    }],
  };
}

// ── Structural ───────────────────────────────────────────────────────────

// Decorator — conditional logic adds features via a wrap/add/extend/enhance
// call. structural-pattern-analyzer.ts:39-68.
export function detectDecorator(unit) {
  const findings = [];
  for (const m of unit.members) {
    if (m.conditionalFeatureCallLine != null) {
      findings.push({
        location: loc(unit, m.name, m.conditionalFeatureCallLine), line: m.conditionalFeatureCallLine,
        problem: 'conditional logic adds a feature/responsibility dynamically (an if-block calls a wrap/add/extend/enhance-named function)',
        solution: 'Use Decorator pattern to add responsibilities without inheritance',
        reasoning: 'Decorator provides flexible alternative to subclassing for extending functionality',
        confidence: 75, priority: 'medium',
        alternatives: ['Chain of Responsibility'],
        tradeoffs: { pros: ['Flexible composition', 'Open/Closed compliant', 'Single Responsibility'], cons: ['Many small objects', 'Complexity in configuration'] },
        source: 'structural-pattern-analyzer.ts:39-68',
      });
    }
  }
  return { pattern: 'Decorator', findings };
}

// Adapter — a member name or a call it makes names an interface conversion.
// structural-pattern-analyzer.ts:70-98 (see file header for the deliberate
// `wrap.*interface` narrowing).
const ADAPTER_RE = /(convert|transform|adapt)/i;
export function detectAdapter(unit) {
  const findings = [];
  for (const m of unit.members) {
    const nameMatch = ADAPTER_RE.test(m.name);
    const callMatch = (m.calleeNames ?? []).some((n) => ADAPTER_RE.test(n));
    if (nameMatch || callMatch) {
      findings.push({
        location: loc(unit, m.name), line: null,
        problem: nameMatch
          ? `member name '${m.name}' names an interface conversion (convert/transform/adapt)`
          : 'member calls a function named for an interface conversion (convert/transform/adapt)',
        solution: 'Use Adapter pattern to make interfaces compatible',
        reasoning: 'Adapter allows collaboration between classes with incompatible interfaces',
        confidence: 80, priority: 'medium',
        alternatives: [],
        tradeoffs: { pros: ['Reuses existing code', 'Single Responsibility', 'Open/Closed'], cons: ['Additional class', 'Potential performance overhead'] },
        source: 'structural-pattern-analyzer.ts:70-98',
      });
    }
  }
  return { pattern: 'Adapter', findings };
}

// Facade — >5 calls shaped `a.b.c(...)` in one member.
// structural-pattern-analyzer.ts:100-128.
export function detectFacade(unit) {
  const findings = [];
  for (const m of unit.members) {
    if ((m.deepChainCallCount ?? 0) > 5) {
      findings.push({
        location: loc(unit, m.name), line: null,
        problem: `${m.deepChainCallCount} call(s) shaped 'a.b.c(...)' — complex interactions with multiple subsystem objects`,
        solution: 'Use Facade pattern to provide a simplified interface to the complex subsystem',
        reasoning: 'Facade reduces coupling and provides an easier-to-use interface',
        confidence: 70, priority: 'medium',
        alternatives: [],
        tradeoffs: { pros: ['Simplified interface', 'Loose coupling', 'Easier to use'], cons: ['May hide useful subsystem features', 'Additional layer'] },
        source: 'structural-pattern-analyzer.ts:100-128',
      });
    }
  }
  return { pattern: 'Facade', findings };
}

// ── Behavioral ───────────────────────────────────────────────────────────

// Strategy — a switch statement selects behavior via a calculate/process/
// execute/validate/format-named call. behavioral-pattern-analyzer.ts:40-68.
export function detectStrategy(unit) {
  const findings = [];
  for (const m of unit.members) {
    if (m.switchBehaviorCallLine != null) {
      findings.push({
        location: loc(unit, m.name, m.switchBehaviorCallLine), line: m.switchBehaviorCallLine,
        problem: 'switch statement selects a different algorithm/behavior at runtime (case body calls a calculate/process/execute/validate/format-named function)',
        solution: 'Use Strategy pattern to encapsulate interchangeable algorithms',
        reasoning: 'Strategy allows algorithm selection at runtime while maintaining Open/Closed Principle',
        confidence: 90, priority: 'high',
        alternatives: [],
        tradeoffs: { pros: ['Open/Closed compliant', 'Runtime algorithm selection', 'Testable strategies'], cons: ['More classes', 'Client must know strategies'] },
        source: 'behavioral-pattern-analyzer.ts:40-68',
      });
    }
  }
  return { pattern: 'Strategy', findings };
}

// Observer — >3 calls (aggregated across the whole unit, matching the
// toolkit's own whole-file count) named notify/update/inform/broadcast.
// behavioral-pattern-analyzer.ts:70-101.
const OBSERVER_RE = /^(notify|update|inform|broadcast)/i;
export function detectObserver(unit) {
  const matches = unit.members.flatMap((m) => m.calleeNames ?? []).filter((n) => OBSERVER_RE.test(n));
  if (matches.length <= 3) return { pattern: 'Observer', findings: [] };
  return {
    pattern: 'Observer',
    findings: [{
      location: unit.name, line: null,
      problem: `${matches.length} manual notification call(s) (notify/update/inform/broadcast) suggest tight coupling between objects`,
      solution: 'Use Observer pattern for loose coupling and automatic notifications',
      reasoning: 'Observer decouples objects and allows dynamic subscription',
      confidence: 75, priority: 'medium',
      alternatives: ['Event Bus', 'Pub/Sub'],
      tradeoffs: { pros: ['Loose coupling', 'Dynamic subscription', 'Broadcast capability'], cons: ['Potential memory leaks', 'Unexpected updates', 'Update order unclear'] },
      source: 'behavioral-pattern-analyzer.ts:70-101',
    }],
  };
}

// Command — >4 occurrences of undo/redo/history/queue/execute as EXACT
// identifier/call names (matches the source regex's `\b(...)\b` word-
// boundary behavior: "executeCommand" does not match, a bare "execute" does)
// across the unit's own name, member names, callee names, declared
// local-binding names, AND `this.x` field references (`fieldAccess`,
// already on the base contract) — the toolkit's own regex is a blind
// whole-file text match, so a bare property reference like `this.queue`
// is exactly as real an occurrence to it as a call or a declaration; a
// scan that skipped fieldAccess under-counted a real fixture case
// (`this.queue`/`this.history` used only as property reads, never called
// or declared) below the >4 threshold during dogfooding. behavioral-
// pattern-analyzer.ts:103-133.
const COMMAND_RE = /^(undo|redo|history|queue|execute)$/i;
export function detectCommand(unit) {
  let count = COMMAND_RE.test(unit.name) ? 1 : 0;
  for (const m of unit.members) {
    if (COMMAND_RE.test(m.name)) count++;
    count += (m.calleeNames ?? []).filter((n) => COMMAND_RE.test(n)).length;
    count += (m.declaredNames ?? []).filter((d) => COMMAND_RE.test(d.name)).length;
    count += (m.fieldAccess ?? []).filter((n) => COMMAND_RE.test(n)).length;
  }
  if (count <= 4) return { pattern: 'Command', findings: [] };
  return {
    pattern: 'Command',
    findings: [{
      location: unit.name, line: null,
      problem: `${count} occurrence(s) of undo/redo/history/queue/execute across names and calls suggest a need for undo/redo, queuing, or operation logging`,
      solution: 'Use Command pattern to encapsulate requests as objects',
      reasoning: 'Command enables undo/redo, queuing, and logging of operations',
      confidence: 80, priority: 'high',
      alternatives: [],
      tradeoffs: { pros: ['Undo/redo support', 'Macro commands', 'Queuing operations', 'Logging'], cons: ['Many small classes', 'Increased complexity'] },
      source: 'behavioral-pattern-analyzer.ts:103-133',
    }],
  };
}

// Template Method — >2 members that each call an initialize/process/
// cleanup-named function (similar algorithm structure, varying details).
// behavioral-pattern-analyzer.ts:135-165.
const TEMPLATE_RE = /(initialize|process|cleanup)/i;
export function detectTemplateMethod(unit) {
  const matchingMembers = unit.members.filter((m) => (m.calleeNames ?? []).some((n) => TEMPLATE_RE.test(n)));
  if (matchingMembers.length <= 2) return { pattern: 'Template Method', findings: [] };
  return {
    pattern: 'Template Method',
    findings: [{
      location: unit.name, line: null,
      problem: `${matchingMembers.length} member(s) call initialize/process/cleanup-named functions — similar algorithm structure repeated with varying details`,
      solution: 'Use Template Method to define the algorithm skeleton with customizable steps',
      reasoning: 'Template Method eliminates duplication while allowing customization',
      confidence: 70, priority: 'medium',
      alternatives: ['Straight composition (if there is no shared "how" worth abstracting)'],
      tradeoffs: { pros: ['Reuses common code', 'Controls algorithm structure', 'Easy to extend'], cons: ['Inheritance-based', 'Less flexible than Strategy'] },
      source: 'behavioral-pattern-analyzer.ts:135-165',
    }],
  };
}

export const PATTERN_NAMES = [
  'Factory Method', 'Builder', 'Singleton',
  'Decorator', 'Adapter', 'Facade',
  'Strategy', 'Observer', 'Command', 'Template Method',
];

const DETECTORS = [
  detectFactoryMethod, detectBuilder, detectSingleton,
  detectDecorator, detectAdapter, detectFacade,
  detectStrategy, detectObserver, detectCommand, detectTemplateMethod,
];

/**
 * @param {import('./language-plugin.mjs').NormalizedUnit} unit
 *
 * Runs all 9 detectors and returns their findings, each pattern's own
 * findings array sorted by (line ?? last, then location) so ATF's
 * byte-identical-JSON requirement holds regardless of any incidental AST
 * traversal-order variance.
 */
export function patternScore(unit) {
  const patterns = {};
  let totalFindings = 0;
  for (const detector of DETECTORS) {
    const { pattern, findings } = detector(unit);
    findings.sort((a, b) => {
      const la = a.line ?? Number.MAX_SAFE_INTEGER;
      const lb = b.line ?? Number.MAX_SAFE_INTEGER;
      return la - lb || a.location.localeCompare(b.location);
    });
    patterns[pattern] = { findings };
    totalFindings += findings.length;
  }
  return { unit: unit.name, kind: unit.kind, patterns, totalFindings };
}
