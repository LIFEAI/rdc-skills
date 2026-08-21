import assert from 'node:assert/strict';
import test from 'node:test';

import { tokenizeSource, findDuplicates } from '../../scripts/lib/duplication-scoring.mjs';

/** N distinct single-token identifiers, space-separated -> exactly N real tokens. */
function tokenBlock(n, prefix = 'shared') {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');
}

// ── empty / trivial input ───────────────────────────────────────────────

test('tokenizeSource: empty text returns zero tokens, never throws', () => {
  assert.deepEqual(tokenizeSource('', '.mjs'), []);
});

test('findDuplicates: zero files returns zero duplicates, never throws', () => {
  const r = findDuplicates([]);
  assert.deepEqual(r.duplicates, []);
  assert.equal(r.filesScanned, 0);
  assert.equal(r.minTokens, 50); // documented default
});

test('findDuplicates: a single trivial file (below minTokens) produces zero duplicates', () => {
  const r = findDuplicates([{ file: 'a.mjs', text: 'const x = 1;', ext: '.mjs' }], 50);
  assert.deepEqual(r.duplicates, []);
  assert.equal(r.filesScanned, 0); // filtered out: fewer tokens than minTokens
});

// ── tokenization — comment stripping, string literals, line tracking ────

test('tokenizeSource: // line comments (.js/.mjs) are stripped, not tokenized', () => {
  const text = `// ${tokenBlock(3)}\n${tokenBlock(3, 'real')}`;
  const tokens = tokenizeSource(text, '.js');
  assert.equal(tokens.length, 3);
  assert.equal(tokens[0].token, 'real0');
  assert.equal(tokens[0].line, 2);
});

test('tokenizeSource: /* block comments */ (.ts) are stripped, not tokenized', () => {
  const text = `/* ${tokenBlock(3)} */\n${tokenBlock(3, 'real')}`;
  const tokens = tokenizeSource(text, '.ts');
  assert.equal(tokens.length, 3);
  assert.equal(tokens[0].token, 'real0');
});

test('tokenizeSource: # comments (.py) are stripped using the Python comment table', () => {
  const text = `# ${tokenBlock(3)}\n${tokenBlock(3, 'real')}`;
  const tokens = tokenizeSource(text, '.py');
  assert.equal(tokens.length, 3);
  assert.equal(tokens[0].token, 'real0');
});

test('tokenizeSource: an unknown extension applies no comment stripping (raw tokenization)', () => {
  const tokens = tokenizeSource('a b c', '.xyz');
  assert.equal(tokens.length, 3);
});

test('tokenizeSource: a string literal collapses to ONE token, content preserved (not a placeholder)', () => {
  const tokens = tokenizeSource(`"hello world"`, '.mjs');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].token, '"hello world"');
});

test('tokenizeSource: line numbers track correctly across a multi-line file', () => {
  const tokens = tokenizeSource('a\nb\nc', '.mjs');
  assert.deepEqual(tokens.map((t) => t.line), [1, 2, 3]);
});

// ── findDuplicates — cross-file duplicate detection, boundary at minTokens ─

test('findDuplicates: known violation — an identical 10-token block shared across two files fires one finding', () => {
  const shared = tokenBlock(10);
  const files = [
    { file: 'a.mjs', text: `${shared} uniqueA0 uniqueA1 uniqueA2 uniqueA3 uniqueA4 uniqueA5`, ext: '.mjs' },
    { file: 'b.mjs', text: `${shared} uniqueB0 uniqueB1 uniqueB2 uniqueB3 uniqueB4 uniqueB5`, ext: '.mjs' },
  ];
  const r = findDuplicates(files, 10);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0].tokenCount, 10);
  assert.equal(r.duplicates[0].occurrences.length, 2);
  const filesFound = r.duplicates[0].occurrences.map((o) => o.file).sort();
  assert.deepEqual(filesFound, ['a.mjs', 'b.mjs']);
});

test('findDuplicates: boundary — a shared block of exactly minTokens-1 (9) tokens does not fire', () => {
  const shared = tokenBlock(9);
  const files = [
    { file: 'a.mjs', text: `${shared} uniqueA0 uniqueA1 uniqueA2 uniqueA3 uniqueA4 uniqueA5 uniqueA6`, ext: '.mjs' },
    { file: 'b.mjs', text: `${shared} uniqueB0 uniqueB1 uniqueB2 uniqueB3 uniqueB4 uniqueB5 uniqueB6`, ext: '.mjs' },
  ];
  const r = findDuplicates(files, 10);
  assert.deepEqual(r.duplicates, []);
});

test('findDuplicates: known-clean — two files with no shared minTokens-length window fire nothing', () => {
  const files = [
    { file: 'a.mjs', text: tokenBlock(15, 'alpha'), ext: '.mjs' },
    { file: 'b.mjs', text: tokenBlock(15, 'beta'), ext: '.mjs' },
  ];
  assert.deepEqual(findDuplicates(files, 10).duplicates, []);
});

test('findDuplicates: a duplicate block LONGER than minTokens is merged into one maximal finding, not one per slide', () => {
  const shared = tokenBlock(20); // 20 shared tokens, minTokens=10 -> 11 sliding-window hits, must merge to 1
  const files = [
    { file: 'a.mjs', text: `${shared} uniqueA0 uniqueA1 uniqueA2 uniqueA3 uniqueA4 uniqueA5`, ext: '.mjs' },
    { file: 'b.mjs', text: `${shared} uniqueB0 uniqueB1 uniqueB2 uniqueB3 uniqueB4 uniqueB5`, ext: '.mjs' },
  ];
  const r = findDuplicates(files, 10);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0].tokenCount, 20);
});

test('findDuplicates: a genuine SAME-FILE duplicate (well-separated occurrences) is still detected', () => {
  const shared = tokenBlock(10);
  const padding = tokenBlock(15, 'pad'); // separates the two occurrences by 25 tokens, well over minTokens
  const files = [{ file: 'a.mjs', text: `${shared} ${padding} ${shared}`, ext: '.mjs' }];
  const r = findDuplicates(files, 10);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0].occurrences.length, 2);
  assert.ok(r.duplicates[0].occurrences.every((o) => o.file === 'a.mjs'));
});

test('findDuplicates: a single occurrence with no real repetition produces no self-referential phantom duplicate', () => {
  const files = [{ file: 'a.mjs', text: tokenBlock(30, 'unique'), ext: '.mjs' }];
  assert.deepEqual(findDuplicates(files, 10).duplicates, []);
});

test('findDuplicates: string-literal content that repeats verbatim across files IS real duplication (not collapsed to a placeholder)', () => {
  const sharedLiteral = Array.from({ length: 10 }, (_, i) => `"literal text number ${i}"`).join(' ');
  const files = [
    { file: 'a.mjs', text: `${sharedLiteral} tailA0 tailA1 tailA2 tailA3 tailA4 tailA5`, ext: '.mjs' },
    { file: 'b.mjs', text: `${sharedLiteral} tailB0 tailB1 tailB2 tailB3 tailB4 tailB5`, ext: '.mjs' },
  ];
  const r = findDuplicates(files, 10);
  assert.equal(r.duplicates.length, 1);
});

test('findDuplicates: minTokens is respected as a real parameter, not hardcoded to the default 50', () => {
  const r = findDuplicates([{ file: 'a.mjs', text: tokenBlock(20), ext: '.mjs' }], 30);
  assert.equal(r.filesScanned, 0); // 20 tokens < minTokens(30) -> filtered before scanning
  assert.equal(r.minTokens, 30);
});
