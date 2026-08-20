/**
 * SOLID scoring — pure functions over a `NormalizedUnit` (see language-plugin.mjs).
 *
 * No import of ts-morph, no Python bridge, no language-specific parser. If a
 * new metric needs a fact this file doesn't have, the fix is to add the fact
 * to `NormalizedUnit` and every plugin that produces it — never to reach past
 * the contract for one language's convenience.
 */

export function srp(unit) {
  const members = unit.members;
  // Zero members is a real, measured fact now that the TS plugin visits
  // constructors/accessors/arrow-property methods, not just cls.getMethods().
  // Before that fix, "no members" usually meant "the scanner didn't look
  // inside this class", not "this class has none" — a class with 3
  // constructor-injected deps and 3 arrow methods scored 100 at 'high'
  // confidence while genuinely unmeasured. `confidence: 'none'` marks that
  // state so scoreUnit can exclude it from the weighted total instead of
  // reporting a perfect score for evidence that was never gathered.
  if (members.length === 0) return { score: 100, confidence: 'none', detail: 'no members found — unmeasured, not clean' };
  if (members.length === 1) return { score: 100, confidence: 'high', detail: '1 member' };

  const parent = members.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const sharedField = members[i].fieldAccess.some((f) => members[j].fieldAccess.includes(f));
      const callsEachOther = members[j].calls.includes(members[i].name) || members[i].calls.includes(members[j].name);
      if (sharedField || callsEachOther) union(i, j);
    }
  }
  const components = new Set(members.map((_, i) => find(i))).size;
  const score = components === 1 ? 100 : components === 2 ? 70 : components === 3 ? 40 : 10;
  return { score, confidence: 'high', detail: `${components} connected component(s) across ${members.length} member(s)` };
}

export function ocp(unit) {
  const members = unit.members;
  if (!members.length) return { score: 100, confidence: 'none', detail: 'no members found — unmeasured, not clean' };
  const hits = members.reduce((n, m) => n + m.branchHits, 0);
  const density = hits / members.length;
  const score = Math.max(0, Math.round(100 - density * 25));
  return { score, confidence: 'low', detail: `${hits} branch/type-check hit(s) across ${members.length} member(s), density ${density.toFixed(2)}` };
}

export function lsp(unit) {
  if (!unit.hasBaseClass) return { score: 100, confidence: 'low-medium', detail: 'no base class — nothing to violate' };
  const overridden = unit.members.filter((m) => m.override);
  if (!overridden.length) return { score: 100, confidence: 'low-medium', detail: 'no overridden methods' };

  let drift = 0;
  for (const m of overridden) {
    const o = m.override;
    if (m.paramCount !== o.baseParamCount) drift++;
    if (!o.callsSuper) drift++;
    if (o.returnType && o.baseReturnType && o.returnType !== o.baseReturnType) drift++;
  }
  const score = Math.max(0, Math.round(100 - (drift / (overridden.length * 3)) * 100));
  return { score, confidence: 'low-medium', detail: `${drift} drift signal(s) across ${overridden.length} overridden member(s)` };
}

export function isp(unit) {
  if (!unit.members.length) return { score: 100, confidence: 'none', detail: 'no members found — unmeasured, not clean' };
  const publicMembers = unit.members.filter((m) => m.isPublic);
  if (!publicMembers.length) return { score: 100, confidence: 'medium-high', detail: 'no public members' };
  const avgParams = publicMembers.reduce((n, m) => n + m.paramCount, 0) / publicMembers.length;
  const countScore = publicMembers.length <= 5 ? 100 : publicMembers.length <= 10 ? 75 : publicMembers.length <= 20 ? 45 : 15;
  const paramScore = avgParams <= 2 ? 100 : avgParams <= 4 ? 75 : 40;
  const score = Math.round((countScore + paramScore) / 2);
  return { score, confidence: 'medium-high', detail: `${publicMembers.length} public member(s), avg ${avgParams.toFixed(1)} param(s)` };
}

export function dip(unit) {
  if (!unit.totalDependencies) return { score: 100, confidence: 'high', detail: 'no dependencies' };
  const ratio = unit.concreteInstantiations / unit.totalDependencies;
  const score = Math.max(0, Math.round(100 - ratio * 100));
  return { score, confidence: 'high', detail: `${unit.concreteInstantiations} concrete instantiation(s) of ${unit.totalDependencies} total dependenc(y/ies)` };
}

/**
 * @param {import('./language-plugin.mjs').NormalizedUnit} unit
 *
 * A criterion at `confidence: 'none'` was never actually measured (an empty
 * unit — nothing the plugin could find to look inside). Folding its default
 * 100 into the weighted total the same as a real 'high'-confidence 100
 * reports a meaningless number as if it were evidence. It is excluded and
 * the remaining weights renormalized instead. `total` is `null` — not 0,
 * not 100 — when EVERY criterion is unmeasured; a caller must not treat
 * `null` as a passing or failing number.
 */
export function scoreUnit(unit, weights) {
  const criteria = { srp: srp(unit), ocp: ocp(unit), lsp: lsp(unit), isp: isp(unit), dip: dip(unit) };
  const measured = Object.entries(weights).filter(([k]) => criteria[k].confidence !== 'none');
  const measuredWeight = measured.reduce((sum, [, w]) => sum + w, 0);
  const total = measuredWeight === 0
    ? null
    : Math.round((measured.reduce((sum, [k, w]) => sum + criteria[k].score * w, 0) / measuredWeight) * 10) / 10;
  return { unit: unit.name, kind: unit.kind, criteria, total, unmeasured: Object.keys(weights).filter((k) => criteria[k].confidence === 'none') };
}
