#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'rdc-brochure.mjs');

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  }
}

function runBrochure(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      RDC_BROCHURE_COMPOSE_ONLY: '1',
      ...env,
    },
  });
}

function composedHtmlPath(stdout) {
  const m = String(stdout || '').match(/^HTML:\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

function writeStoredZip(zipPath, entryName, content) {
  const name = Buffer.from(entryName);
  const body = Buffer.from(content);
  const crc = crc32(body);
  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
    u32(crc), u32(body.length), u32(body.length), u16(name.length), u16(0),
    name, body,
  ]);
  const centralOffset = local.length;
  const central = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
    u32(crc), u32(body.length), u32(body.length), u16(name.length), u16(0),
    u16(0), u16(0), u16(0), u32(0), u32(0), name,
  ]);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(1), u16(1),
    u32(central.length), u32(centralOffset), u16(0),
  ]);
  writeFileSync(zipPath, Buffer.concat([local, central, end]));
}

const root = mkdtempSync(join(tmpdir(), 'rdc-brochure-test-'));

try {
  console.log('Test 1: folder compose suppresses synthetic headings after YAML front matter');
  const folder = join(root, 'frontmatter-folder');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, '01-overview.md'), '---\ntitle: Overview\n---\n\n# Real Title\n\nBody.\n', 'utf8');
  writeFileSync(join(folder, '02-h6.md'), '###### Small Heading\n\nTiny body.\n', 'utf8');
  const composed = runBrochure([folder]);
  assert(composed.status === 0, `compose-only folder exits 0 (got ${composed.status})`);
  const htmlPath = composedHtmlPath(composed.stdout);
  assert(htmlPath && existsSync(htmlPath), 'compose-only prints a readable HTML path');
  const html = htmlPath ? readFileSync(htmlPath, 'utf8') : '';
  assert(!html.includes('<h2>01-overview</h2>'), 'front-matter-led # heading has no duplicate filename h2');
  assert(!html.includes('<h2>02-h6</h2>'), 'ATX h6 heading has no duplicate filename h2');
  assert(html.includes('<h1>Real Title</h1>'), 'front-matter body still renders the real h1');

  console.log('Test 2: invalid templates fail for folder and markdown compose paths');
  const folderBad = runBrochure([folder, '--template', 'missing-template']);
  assert(folderBad.status !== 0, 'folder compose with invalid template exits non-zero');
  assert(/unknown template "missing-template"/.test(folderBad.stderr), 'folder compose reports unknown template');
  assert(/Available template\(s\): studio-default/.test(folderBad.stderr), 'folder compose lists available templates');
  const mdFile = join(root, 'single.md');
  writeFileSync(mdFile, '# Single\n\nBody.\n', 'utf8');
  const mdBad = runBrochure([mdFile, '--template', 'missing-template']);
  assert(mdBad.status !== 0, 'single markdown compose with invalid template exits non-zero');
  assert(/unknown template "missing-template"/.test(mdBad.stderr), 'single markdown compose reports unknown template');

  console.log('Test 3: native unzip fallback rejects zip-slip entries before extraction');
  const zipPath = join(root, 'zip-slip.zip');
  writeStoredZip(zipPath, '../evil.md', '# Evil\n');
  const badZip = runBrochure([zipPath], { RDC_BROCHURE_DISABLE_ADM_ZIP: '1' });
  assert(badZip.status !== 0, 'zip-slip archive exits non-zero');
  assert(/zip-slip: entry/.test(badZip.stderr), 'zip-slip error is reported');
  assert(!existsSync(join(root, 'evil.md')), 'zip-slip member was not extracted outside the destination');
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} assertion(s)`);
  process.exit(1);
}
console.log('\nALL PASS');
