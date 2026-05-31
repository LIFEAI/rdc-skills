#!/usr/bin/env node
/**
 * rdc:brochure — zip/folder/html/url/markdown → PDF via Puppeteer.
 * See skills/brochure/SKILL.md for the contract.
 */
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, basename, extname, join, resolve, relative, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const AUTO_FIT_CSS = `
/* rdc:brochure --auto-fit corrective stylesheet
   Generic print-overflow safety net. Applied AFTER document stylesheets. */
@media print, screen {
  html, body { overflow: visible !important; }
  body { max-width: 100% !important; }
  *, *::before, *::after { box-sizing: border-box; }

  img, svg, video, canvas, iframe, object, embed {
    max-width: 100% !important;
    height: auto !important;
    object-fit: contain;
  }
  figure, .figure, picture { break-inside: avoid; page-break-inside: avoid; max-width: 100%; }

  table {
    table-layout: fixed !important;
    width: 100% !important;
    max-width: 100% !important;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    border-collapse: collapse;
  }
  th, td { word-wrap: break-word; overflow-wrap: anywhere; max-width: 100%; }
  thead { display: table-header-group; }
  tr, td, th { break-inside: avoid; page-break-inside: avoid; }

  pre, code, kbd, samp { white-space: pre-wrap !important; word-break: break-word; overflow-wrap: anywhere; max-width: 100%; }
  pre { break-inside: avoid; page-break-inside: avoid; }

  h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }
  h1 + *, h2 + *, h3 + *, h4 + * { break-before: avoid; }
  p, li { orphans: 3; widows: 3; }

  /* Generic wide-content sentinels */
  .wide, .full-bleed, .panorama { max-width: 100% !important; }

  /* Avoid blank-page artifacts from oversized flex/grid containers */
  [style*="position: fixed"], [style*="position:fixed"] { position: static !important; }
}
`;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const TEMPLATES_DIR = join(REPO_ROOT, 'scaffold', 'templates');

// --- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const opts = { template: 'studio-default', format: 'Letter', printEmulate: true, keepWorkdir: false, autoFit: false, scale: 1 };
let input;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') opts.out = argv[++i];
  else if (a === '--template') opts.template = argv[++i];
  else if (a === '--format') opts.format = argv[++i];
  else if (a === '--margin') opts.margin = argv[++i];
  else if (a === '--no-print-emulate') opts.printEmulate = false;
  else if (a === '--keep-workdir') opts.keepWorkdir = true;
  else if (a === '--auto-fit') opts.autoFit = true;
  else if (a === '--scale') opts.scale = parseFloat(argv[++i]);
  else if (!input) input = a;
}
if (!input) {
  console.error('usage: rdc-brochure.mjs <zip|folder|html|md|url> [--out path] [--template name] [--format Letter|A4]');
  process.exit(2);
}

// --- helpers ---------------------------------------------------------------
const isUrl = /^https?:\/\//i.test(input);
const hash = createHash('sha1').update(input).digest('hex').slice(0, 10);
const workRoot = join(tmpdir(), 'rdc-brochure', hash);
mkdirSync(workRoot, { recursive: true });

const log = (...a) => console.log('[brochure]', ...a);

function human(n) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${u[i]}`;
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// --- ensure puppeteer ------------------------------------------------------
async function loadPuppeteer() {
  try { return (await import('puppeteer')).default; } catch {}
  // Try a local cache install.
  const cacheDir = join(homedir(), '.cache', 'rdc-brochure');
  mkdirSync(cacheDir, { recursive: true });
  if (!existsSync(join(cacheDir, 'package.json'))) {
    writeFileSync(join(cacheDir, 'package.json'), JSON.stringify({ name: 'rdc-brochure-cache', private: true }, null, 2));
  }
  if (!existsSync(join(cacheDir, 'node_modules', 'puppeteer'))) {
    log('installing puppeteer into', cacheDir);
    execSync('npm install puppeteer --no-audit --no-fund --loglevel=error', { cwd: cacheDir, stdio: 'inherit' });
  }
  const req = createRequire(join(cacheDir, 'package.json'));
  const mod = req('puppeteer');
  return mod.default || mod;
}

// --- cross-platform unzip --------------------------------------------------
// Pure-Node first (adm-zip — works on every platform, no external binary).
// If the lib cannot be resolved or installed, fall back to a platform-native
// extractor: `unzip` on POSIX, PowerShell `Expand-Archive` on win32.
function loadAdmZip() {
  try { return createRequire(import.meta.url)('adm-zip'); } catch {}
  // Reuse the puppeteer on-demand cache dir for an isolated local install.
  const cacheDir = join(homedir(), '.cache', 'rdc-brochure');
  mkdirSync(cacheDir, { recursive: true });
  if (!existsSync(join(cacheDir, 'package.json'))) {
    writeFileSync(join(cacheDir, 'package.json'), JSON.stringify({ name: 'rdc-brochure-cache', private: true }, null, 2));
  }
  if (!existsSync(join(cacheDir, 'node_modules', 'adm-zip'))) {
    try {
      log('installing adm-zip into', cacheDir);
      execSync('npm install adm-zip --no-audit --no-fund --loglevel=error', { cwd: cacheDir, stdio: 'inherit' });
    } catch { return null; }
  }
  try { return createRequire(join(cacheDir, 'package.json'))('adm-zip'); } catch { return null; }
}

// Reject any archive member that resolves outside destDir (zip-slip / path
// traversal). Returns the validated absolute destination path. Throws on escape.
function safeJoinOrThrow(destDir, entryName) {
  const root = resolve(destDir);
  const dest = resolve(root, entryName);
  if (dest !== root && !dest.startsWith(root + sep)) {
    throw new Error(`zip-slip: entry "${entryName}" escapes destination directory`);
  }
  return dest;
}

function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  const root = resolve(destDir);
  const AdmZip = loadAdmZip();
  if (AdmZip) {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    // First pass: validate every entry resolves inside destDir. A brochure
    // source zip must never contain `..` or absolute members — reject the whole
    // archive rather than silently skipping (fail-closed).
    for (const entry of entries) {
      safeJoinOrThrow(root, entry.entryName);
    }
    // Second pass: extract validated entries individually. Do NOT use the
    // blanket extractAllTo — adm-zip does not sanitize entry paths.
    for (const entry of entries) {
      if (entry.isDirectory) {
        mkdirSync(safeJoinOrThrow(root, entry.entryName), { recursive: true });
        continue;
      }
      const dest = safeJoinOrThrow(root, entry.entryName);
      mkdirSync(dirname(dest), { recursive: true });
      zip.extractEntryTo(entry, root, /* maintainEntryPath */ true, /* overwrite */ true);
    }
    return;
  }
  // Fallback: platform-native extractor. Validate members via a listing pass
  // BEFORE extracting, since the bulk extract commands cannot apply per-entry
  // guards. Reject any `..` segment or absolute/leading-slash member.
  log('adm-zip unavailable — falling back to platform unzip');
  assertNativeZipSafe(zipPath);
  let r;
  if (process.platform === 'win32') {
    r = spawnSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`], { stdio: 'inherit' });
  } else {
    r = spawnSync('unzip', ['-o', '-q', zipPath, '-d', destDir], { stdio: 'inherit' });
  }
  if (!r || r.status !== 0) throw new Error('unzip failed (no pure-Node lib and platform extractor failed)');
}

// List archive members with a native tool and reject any traversal/absolute
// entry. Throws if a member is unsafe or the listing cannot be produced.
function assertNativeZipSafe(zipPath) {
  let names = [];
  if (process.platform === 'win32') {
    const ps = spawnSync('powershell', ['-NoProfile', '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
      `[System.IO.Compression.ZipFile]::OpenRead('${zipPath}').Entries | ForEach-Object { $_.FullName }`],
      { encoding: 'utf8' });
    if (ps.status !== 0) throw new Error('cannot list zip members for traversal check (PowerShell)');
    names = String(ps.stdout || '').split(/\r?\n/);
  } else {
    const zi = spawnSync('zipinfo', ['-1', zipPath], { encoding: 'utf8' });
    if (zi.status === 0) {
      names = String(zi.stdout || '').split(/\r?\n/);
    } else {
      const ul = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
      if (ul.status !== 0) throw new Error('cannot list zip members for traversal check (unzip -Z1)');
      names = String(ul.stdout || '').split(/\r?\n/);
    }
  }
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const norm = name.replace(/\\/g, '/');
    if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm) || norm.split('/').some((seg) => seg === '..')) {
      throw new Error(`zip-slip: entry "${name}" escapes destination directory`);
    }
  }
}

// --- stage input -----------------------------------------------------------
function stageInput() {
  const stageDir = join(workRoot, 'src');
  mkdirSync(stageDir, { recursive: true });
  if (isUrl) return { kind: 'url', url: input, stageDir };
  const abs = resolve(input);
  if (!existsSync(abs)) throw new Error(`not found: ${abs}`);
  const st = statSync(abs);
  if (st.isDirectory()) return { kind: 'folder', root: abs, stageDir: abs };
  const ext = extname(abs).toLowerCase();
  if (ext === '.zip') {
    log('extracting zip to', stageDir);
    extractZip(abs, stageDir);
    return { kind: 'folder', root: stageDir, stageDir };
  }
  if (ext === '.html' || ext === '.htm') return { kind: 'html', file: abs, stageDir: dirname(abs) };
  if (ext === '.md' || ext === '.markdown') return { kind: 'md', file: abs, stageDir: dirname(abs) };
  throw new Error(`unsupported input: ${ext || '(no extension)'}`);
}

// --- pick HTML in render mode ----------------------------------------------
function pickHtml(rootDir) {
  const htmls = walk(rootDir).filter((p) => /\.html?$/i.test(p));
  if (!htmls.length) return null;
  const scored = htmls.map((p) => {
    const text = readFileSync(p, 'utf8');
    const size = statSync(p).size;
    let score = 0;
    if (/@page\b/.test(text)) score += 1000;
    if (/@media\s+print/i.test(text)) score += 500;
    if (/-print\.html?$/i.test(p)) score += 300;
    if (/brochure\.html?$/i.test(p)) score += 250;
    if (/(^|[\\/])print\.html?$/i.test(p)) score += 250;
    if (/standalone/i.test(basename(p))) score -= 50; // usually huge embedded duplicate
    score += Math.min(size / 1024, 200); // size as tiebreaker, capped
    return { p, score, size };
  }).sort((a, b) => b.score - a.score);
  return scored[0].p;
}

// --- compose mode ----------------------------------------------------------
function listTemplates() {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR)
    .map((f) => /^brochure-(.+)\.html$/i.exec(f))
    .filter(Boolean)
    .map((m) => m[1])
    .sort();
}

async function composeFromFolder(root, file) {
  const tpl = join(TEMPLATES_DIR, `brochure-${opts.template}.html`);
  if (!existsSync(tpl)) {
    const available = listTemplates();
    const list = available.length ? available.join(', ') : '(none found)';
    throw new Error(`unknown template "${opts.template}". Available template(s): ${list}`);
  }
  let html = readFileSync(tpl, 'utf8');

  let mdFiles = [];
  if (file) mdFiles = [file];
  else mdFiles = walk(root).filter((p) => /\.(md|markdown)$/i.test(p)).sort();

  const title = (() => {
    for (const p of mdFiles) {
      const m = readFileSync(p, 'utf8').match(/^#\s+(.+)$/m);
      if (m) return m[1].trim();
    }
    return basename(file || root);
  })();

  const sections = mdFiles.map((p) => {
    const md = readFileSync(p, 'utf8');
    // Only prepend the filename heading when the markdown has no leading ATX heading
    // of its own. Avoids a redundant <h2>filename</h2> stacked above a "# Title".
    const firstNonEmpty = md.replace(/\r\n/g, '\n').split('\n').find((l) => l.trim() !== '') || '';
    const hasLeadingHeading = /^#{1,6}\s+\S/.test(firstNonEmpty.trim());
    const heading = hasLeadingHeading ? '' : `<h2>${escapeHtml(basename(p, extname(p)))}</h2>`;
    return `<section class="brochure-section">${heading}${mdToHtml(md, dirname(p))}</section>`;
  }).join('\n');

  html = html.replace(/\{\{TITLE\}\}/g, escapeHtml(title)).replace(/\{\{SECTIONS\}\}/g, sections);

  const tokensCss = findSibling(root || dirname(file), 'tokens.css');
  if (tokensCss) html = html.replace('/* TOKENS_INJECT */', readFileSync(tokensCss, 'utf8'));

  const outHtml = join(workRoot, 'composed.html');
  writeFileSync(outHtml, html);
  return outHtml;
}

function findSibling(dir, name) {
  if (!dir) return null;
  const p = join(dir, name);
  return existsSync(p) ? p : null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Minimal markdown — headings, paragraphs, lists, bold/italic, inline code, fenced code, images.
function mdToHtml(md, baseDir) {
  let out = md.replace(/\r\n/g, '\n');
  out = out.replace(/```([a-z]*)\n([\s\S]*?)```/g, (_, lang, body) => `<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(body)}</code></pre>`);
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img alt="${escapeHtml(alt)}" src="${resolveImg(src, baseDir)}"/>`);
  out = out.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
           .replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
           .replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
           .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
           .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
           .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/(?:^|\n)((?:[-*]\s+.+\n?)+)/g, (_, block) => `\n<ul>${block.trim().split(/\n/).map((l) => `<li>${l.replace(/^[-*]\s+/, '')}</li>`).join('')}</ul>\n`);
  out = out.split(/\n{2,}/).map((b) => /^<(h\d|ul|ol|pre|img|section|div)/.test(b.trim()) ? b : `<p>${b.trim()}</p>`).join('\n');
  return out;
}

function resolveImg(src, baseDir) {
  if (/^https?:|^data:/.test(src)) return src;
  const p = resolve(baseDir, src);
  if (!existsSync(p)) return src;
  return pathToFileURL(p).href;
}

// --- render ----------------------------------------------------------------
async function render(htmlSource) {
  const puppeteer = await loadPuppeteer();
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => log('pageerror:', e.message));
    const url = htmlSource.startsWith('http') ? htmlSource : pathToFileURL(htmlSource).href;
    log('loading', url);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 180_000 });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise((r) => setTimeout(r, 1500));
    if (opts.printEmulate) await page.emulateMediaType('print');

    if (opts.autoFit) {
      await page.addStyleTag({ content: AUTO_FIT_CSS });
      const report = await page.evaluate(() => {
        const issues = [];
        const all = document.body.querySelectorAll('*');
        const pageWidthPx = document.documentElement.clientWidth;
        for (const el of all) {
          const r = el.getBoundingClientRect();
          if (r.width > pageWidthPx + 4) {
            issues.push({ tag: el.tagName, cls: el.className?.toString().slice(0, 60) || '', width: Math.round(r.width), pageWidth: pageWidthPx });
            if (issues.length >= 25) break;
          }
        }
        return issues;
      });
      if (report.length) {
        log(`auto-fit: ${report.length} overflow element(s) detected — corrective CSS applied`);
        for (const r of report.slice(0, 8)) log(`  · ${r.tag}${r.cls ? '.' + r.cls : ''} width=${r.width}px (page=${r.pageWidth}px)`);
      } else {
        log('auto-fit: no overflow detected after corrective CSS');
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    const outPath = resolve(opts.out || defaultOutPath());
    mkdirSync(dirname(outPath), { recursive: true });

    const pdfOpts = {
      path: outPath,
      format: opts.format,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      scale: opts.scale && opts.scale !== 1 ? opts.scale : undefined,
    };
    if (opts.margin) {
      const m = opts.margin;
      pdfOpts.margin = { top: m, bottom: m, left: m, right: m };
      pdfOpts.preferCSSPageSize = false;
    } else if (!htmlSource.startsWith('http')) {
      const text = readFileSync(htmlSource, 'utf8');
      if (!/@page\b/.test(text)) {
        pdfOpts.margin = { top: '0.6in', bottom: '0.6in', left: '0.7in', right: '0.7in' };
        pdfOpts.preferCSSPageSize = false;
      }
    }

    await page.pdf(pdfOpts);
    return outPath;
  } finally {
    await browser.close();
  }
}

function defaultOutPath() {
  if (isUrl) return resolve('brochure.pdf');
  const abs = resolve(input);
  const base = basename(abs, extname(abs));
  return resolve(dirname(abs), `${base}.pdf`);
}

// --- main ------------------------------------------------------------------
(async () => {
  const staged = stageInput();
  let htmlSource;

  if (staged.kind === 'url') {
    htmlSource = staged.url;
  } else if (staged.kind === 'html') {
    htmlSource = staged.file;
  } else if (staged.kind === 'md') {
    htmlSource = await composeFromFolder(null, staged.file);
  } else { // folder
    const picked = pickHtml(staged.stageDir);
    if (picked) {
      log('picked html:', relative(staged.stageDir, picked));
      htmlSource = picked;
    } else {
      log('no html found — composing from markdown');
      htmlSource = await composeFromFolder(staged.stageDir);
    }
  }

  const outPath = await render(htmlSource);
  const size = statSync(outPath).size;
  let pages = '?';
  try {
    const buf = readFileSync(outPath);
    const m = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
    if (m) pages = String(m.length);
  } catch {}

  console.log('');
  console.log(`PDF:    ${outPath}`);
  console.log(`Pages:  ${pages}`);
  console.log(`Size:   ${human(size)}`);
  console.log(`Source: ${input} → ${htmlSource.startsWith('http') ? htmlSource : relative(process.cwd(), htmlSource)}`);
})().catch((err) => { console.error('[brochure] error:', err.message); process.exit(1); });
