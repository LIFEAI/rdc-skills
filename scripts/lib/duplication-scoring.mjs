/**
 * G5 — Duplicate Code detection via token-shingle Rabin-Karp matching.
 *
 * This is the rule the original Clean Code port (2026-08-20, commit e159ada)
 * incorrectly filed as "needs judgment, not mechanical" — see
 * clean-code-scoring.mjs's own header, and skills/clean-code-analyzer/SKILL.md's
 * "Not implemented" table, row G5: "a per-unit, per-file scorer is the wrong
 * shape for a cross-file structural-clone problem." That reasoning is correct
 * about WHY clean-code-scoring.mjs's per-unit shape can't do this — it is
 * wrong that the problem itself needs judgment. It has a well-established
 * deterministic solution: token-based clone detection via Rabin-Karp rolling
 * hash, the same algorithm jscpd (github.com/kucherenko/jscpd) and PMD's CPD
 * (pmd.github.io/pmd/pmd_userdocs_cpd.html) both use in production, 20+ years
 * of prior art. This file is a real, independent implementation of that
 * algorithm — not a wrapper around either tool — operating at REPO scope
 * (across every file passed in), not per-file, which is why it lives here as
 * its own module rather than as an eighth rule inside clean-code-scoring.mjs's
 * per-unit contract.
 *
 * No ts-morph, no NormalizedUnit dependency — plain text tokenization, same
 * discipline as package-metrics.mjs and architecture-scoring.mjs. Works on
 * any language whose comments/whitespace can be stripped by a language-aware
 * comment-stripping table (below); token SHAPE (identifiers, literals,
 * operators) is language-agnostic once comments are stripped.
 */

import { readFileSync } from 'node:fs';

/** Comment-stripping regexes, keyed by extension. Line + block comments only —
 *  string/template literals are deliberately NOT stripped, since a literal's
 *  content is real duplicated text if it repeats. */
const COMMENT_STRIP = {
  '.js': [/\/\/.*$/gm, /\/\*[\s\S]*?\*\//g],
  '.mjs': [/\/\/.*$/gm, /\/\*[\s\S]*?\*\//g],
  '.cjs': [/\/\/.*$/gm, /\/\*[\s\S]*?\*\//g],
  '.ts': [/\/\/.*$/gm, /\/\*[\s\S]*?\*\//g],
  '.tsx': [/\/\/.*$/gm, /\/\*[\s\S]*?\*\//g],
  '.jsx': [/\/\/.*$/gm, /\/\*[\s\S]*?\*\//g],
  '.py': [/#.*$/gm],
};

/** Token pattern: identifiers/keywords, numbers, string literals (as one
 *  opaque token — content ignored, only "a string literal was here" matters,
 *  matching CPD's own "ignore literals" default OFF-by-default behavior; we
 *  keep literal content since a repeated literal string IS real duplication),
 *  and single-char operators/punctuation. */
const TOKEN_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|[{}()[\];,.<>=+\-*/%!&|^~?:]/g;

/**
 * Tokenize one file's text into {token, line}[] — comments stripped, string
 * literals collapsed to their raw text (not a placeholder — real content
 * still counts as duplication if it repeats), whitespace/newlines used only
 * to track line numbers, not as tokens themselves.
 */
export function tokenizeSource(text, ext) {
  const strips = COMMENT_STRIP[ext] || [];
  let stripped = text;
  for (const re of strips) stripped = stripped.replace(re, (m) => m.replace(/[^\n]/g, ' '));

  const tokens = [];
  let line = 1;
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = TOKEN_RE.exec(stripped)) !== null) {
    // count newlines between lastIndex and match.index to keep line tracking accurate
    for (let i = lastIndex; i < match.index; i++) if (stripped[i] === '\n') line++;
    lastIndex = match.index;
    tokens.push({ token: match[0], line });
  }
  return tokens;
}

/**
 * Rabin-Karp rolling hash over a token-shingle window of length k.
 * Base/modulus chosen to keep hashes in safe-integer range for k up to ~200.
 */
const BASE = 257n;
const MOD = 1_000_000_007n;

function hashWindow(tokens, start, k) {
  let h = 0n;
  for (let i = 0; i < k; i++) {
    h = (h * BASE + BigInt(simpleStringHash(tokens[start + i].token))) % MOD;
  }
  return h.toString();
}

function simpleStringHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Rolling update: given the hash of window [start, start+k), compute the
 * hash of window [start+1, start+1+k) in O(1) using the outgoing/incoming
 * token — the actual Rabin-Karp technique (not re-hashing the whole window
 * each slide, which would make this O(n*k) instead of O(n)).
 */
function rollHash(prevHash, outgoingTok, incomingTok, k) {
  const highOrder = powMod(BASE, BigInt(k - 1));
  let h = (prevHash - BigInt(simpleStringHash(outgoingTok)) * highOrder % MOD + MOD * MOD) % MOD;
  h = (h * BASE + BigInt(simpleStringHash(incomingTok))) % MOD;
  return h;
}

function powMod(base, exp) {
  let r = 1n, b = base % MOD, e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % MOD;
    b = (b * b) % MOD;
    e >>= 1n;
  }
  return r;
}

/**
 * Find duplicate token-shingle windows of length >= minTokens across all
 * supplied files. Matches jscpd/CPD's default shape: a "duplicate" is
 * >= minTokens contiguous matching tokens appearing in 2+ distinct
 * (file, position) locations, with overlapping windows from the SAME
 * location merged into one finding rather than reported once per slide.
 *
 * @param {{file: string, text: string, ext: string}[]} files
 * @param {number} minTokens - default 50, matches CPD's default token threshold
 * @returns {{duplicates: Array<{tokenCount: number, occurrences: Array<{file:string, startLine:number, endLine:number}>}>}}
 */
export function findDuplicates(files, minTokens = 50) {
  const fileTokens = files.map((f) => ({
    file: f.file,
    tokens: tokenizeSource(f.text, f.ext),
  })).filter((f) => f.tokens.length >= minTokens);

  // hash -> [{fileIdx, start}]
  const hashIndex = new Map();

  for (let fi = 0; fi < fileTokens.length; fi++) {
    const { tokens } = fileTokens[fi];
    if (tokens.length < minTokens) continue;
    let h = hashWindow(tokens, 0, minTokens);
    recordHash(hashIndex, h, fi, 0);
    for (let start = 1; start <= tokens.length - minTokens; start++) {
      h = rollHash(BigInt(h), tokens[start - 1].token, tokens[start + minTokens - 1].token, minTokens).toString();
      recordHash(hashIndex, h, fi, start);
    }
  }

  // Every hash bucket with >=2 occurrences is a matching WINDOW pair, not a
  // duplicate BLOCK yet — a real duplicated region of length L > minTokens
  // produces (L - minTokens + 1) consecutive matching window-pairs, one per
  // slide position, all at the SAME offset between the two locations. The
  // real algorithm (same technique CPD/jscpd use) is to pair up occurrences,
  // group pairs by (fileA, fileB, start diff constant), then merge
  // consecutive starts within each group into ONE maximal match — that
  // collapses N sliding-window hits into 1 real finding.
  //
  // pairKey -> { fileA, fileB, starts: Set<number> } where starts holds the
  // fileA-side start of every matching window against a fixed fileB anchor
  // at the SAME relative offset.
  const pairGroups = new Map();
  for (const [, occ] of hashIndex) {
    if (occ.length < 2) continue;
    const sorted = occ.slice().sort((a, b) => a.fileIdx - b.fileIdx || a.start - b.start);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j];
        if (a.fileIdx === b.fileIdx && a.start === b.start) continue;
        const key = `${a.fileIdx}:${b.fileIdx}:${b.start - a.start}`;
        if (!pairGroups.has(key)) pairGroups.set(key, { fileA: a.fileIdx, fileB: b.fileIdx, delta: b.start - a.start, starts: new Set() });
        pairGroups.get(key).starts.add(a.start);
      }
    }
  }

  // Within each (fileA, fileB, delta) group, merge consecutive fileA starts
  // into maximal runs. A run [s, e] of consecutive starts (step 1) means a
  // real duplicated block spanning tokens [s, e + minTokens - 1].
  const rawFindings = [];
  for (const { fileA, fileB, delta, starts } of pairGroups.values()) {
    const sortedStarts = [...starts].sort((a, b) => a - b);
    let runStart = sortedStarts[0];
    let prev = sortedStarts[0];
    const flush = (end) => {
      // Skip a same-file, zero-offset-adjacent run entirely inside itself
      // (fileA === fileB, delta < minTokens means the two "occurrences" are
      // really the same physical block overlapping its own rolling window,
      // not a second copy).
      if (fileA === fileB && Math.abs(delta) < minTokens) return;
      rawFindings.push({ fileA, fileB, aStart: runStart, aEnd: end, bStart: runStart + delta, bEnd: end + delta });
    };
    for (let i = 1; i < sortedStarts.length; i++) {
      if (sortedStarts[i] === prev + 1) {
        prev = sortedStarts[i];
        continue;
      }
      flush(prev);
      runStart = sortedStarts[i];
      prev = sortedStarts[i];
    }
    flush(prev);
  }

  // Dedupe (a finding and its mirror-image (fileB,fileA,-delta) are the same
  // physical duplicate reported twice) and convert to file:line.
  const seen = new Set();
  const duplicates = [];
  for (const f of rawFindings) {
    const tokenCount = f.aEnd - f.aStart + minTokens;
    const locA = { fileIdx: f.fileA, start: f.aStart, end: f.aEnd + minTokens - 1 };
    const locB = { fileIdx: f.fileB, start: f.bStart, end: f.bEnd + minTokens - 1 };
    const sig = [locA, locB].map((l) => `${l.fileIdx}:${l.start}:${l.end}`).sort().join('|');
    if (seen.has(sig)) continue;
    seen.add(sig);
    const occurrences = [locA, locB].map((l) => {
      const { file, tokens } = fileTokens[l.fileIdx];
      return { file, startLine: tokens[l.start].line, endLine: tokens[Math.min(l.end, tokens.length - 1)].line };
    });
    duplicates.push({ tokenCount, occurrences });
  }

  // Sort deterministically: by first occurrence file, then line — required
  // for ATF golden-capture (byte-identical output across runs).
  for (const d of duplicates) {
    d.occurrences.sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine);
  }
  duplicates.sort((a, b) => {
    const fa = a.occurrences[0], fb = b.occurrences[0];
    return fa.file.localeCompare(fb.file) || fa.startLine - fb.startLine || b.tokenCount - a.tokenCount;
  });

  return { duplicates, filesScanned: fileTokens.length, minTokens };
}

function recordHash(index, hash, fileIdx, start) {
  if (!index.has(hash)) index.set(hash, []);
  index.get(hash).push({ fileIdx, start });
}
