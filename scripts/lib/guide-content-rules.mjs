// guide-content-rules.mjs — the one home for the guide-content validator's rules.
//
// Imported by scripts/self-test.mjs (the validator) and scripts/test-guide-validator.mjs
// (its test). Both used to carry their own copy of these constants, because
// self-test.mjs runs on import and exports nothing. The copies drifted TOGETHER,
// so the test kept passing while the validator was wrong: the corrections-table
// exemption named `@regen/brand-studio`, the package scope was renamed to
// `@lifeai`, and `.claude/rules/naming-corrections.md` — the table whose whole
// purpose is to say that name is WRONG — failed every strict run as a "positive
// instruction" to use it (found 2026-09-16, failing on unmodified master too).

/** Terms that must NOT appear in guide/rule files as positive instructions. */
export const GUIDE_BANNED_TERMS = Object.freeze([
  "@masonator/coolify-mcp",
  "@masonator",
  "coolify-mcp",
  "@regen/brand-studio",
  "brand-studio",
]);

/**
 * A line matching one of these is an explicit "don't use" statement, not an
 * instruction, and a banned term on it is not flagged.
 */
export const GUIDE_NEGATION_PATTERNS = Object.freeze([
  /\bdo not\b/i,
  /\bnever\b/i,
  /\bno such\b/i,
  /\bdoes not exist\b/i,
  /\bbanned\b/i,
  /\bnot reference\b/i,
  /\bnot use\b/i,
  /\bavoid\b/i,
  /\bremoved\b/i,
  /\bdeprecated\b/i,
  // The header row of a WRONG → CORRECT table.
  /^\|[^|]*WRONG[^|]*\|/i,
  // A data row of a corrections table: the banned term sits in the FIRST cell and
  // the next cell is the bold correction. STRUCTURAL on purpose — any scope or
  // prefix before the term (`@regen/`, `@lifeai/`, the next rename) still matches.
  // The previous form listed exact spellings, which is how one scope rename turned
  // a correct row into a strict-mode failure.
  /^\|\s*[^|]*?(?:brand-studio|Brand Studio|@masonator|coolify-mcp)[^|]*\|\s*\*\*/,
]);

/** True when a banned term on this line is a warning or a correction, not an instruction. */
export function isNegatedBannedLine(line) {
  return GUIDE_NEGATION_PATTERNS.some((re) => re.test(line));
}
