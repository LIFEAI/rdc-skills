/**
 * Shared literal fixtures for scripts/lib/*.mjs unit tests.
 *
 * `makeMember` / `makeUnit` construct minimal, fully-shaped
 * `NormalizedMember` / `NormalizedUnit` objects per the contract documented
 * in scripts/lib/language-plugin.mjs's JSDoc — every field the contract
 * declares is present with a safe default, so a scoring function's `?? []`
 * guards are never exercising an accidentally-missing field instead of the
 * real default. Individual tests override only the fields relevant to the
 * rule under test.
 *
 * These are hand-built literal objects passed DIRECTLY to the pure scoring
 * functions — no ts-morph, no real parse. This is the correct unit-test
 * boundary: it tests the scoring LOGIC in isolation from the AST layer.
 */

/** @returns {import('../../scripts/lib/language-plugin.mjs').NormalizedMember} */
export function makeMember(overrides = {}) {
  return {
    name: 'method',
    paramCount: 0,
    fieldAccess: [],
    calls: [],
    branchHits: 0,
    isPublic: true,
    override: null,
    statementCount: 0,
    declaredNames: [],
    magicNumbers: [],
    emptyCatches: [],
    deadConditionals: [],
    statementTexts: [],
    nullChecks: [],
    switchStatements: [],
    complexConditionals: [],
    switchBehaviorCallLine: null,
    constructorNewCallTargets: [],
    conditionalFeatureCallLine: null,
    deepChainCallCount: 0,
    calleeNames: [],
    ...overrides,
  };
}

/** @returns {import('../../scripts/lib/language-plugin.mjs').NormalizedUnit} */
export function makeUnit(overrides = {}) {
  return {
    name: 'Unit',
    kind: 'class',
    members: [],
    hasBaseClass: false,
    concreteInstantiations: 0,
    totalDependencies: 0,
    staticPropertyNames: [],
    hasGetInstanceMethod: false,
    ...overrides,
  };
}
