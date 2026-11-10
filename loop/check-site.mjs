// Checks one site folder for bugs, formatting and security problems.
// Usage: node loop/check-site.mjs sites/<subdomain> [screenshot-dir]
// Exits non-zero and prints every problem found.
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, resolve, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dir = resolve(process.argv[2] || '');
const shots = process.argv[3];
const sub = basename(dir);
const origin = `https://${sub}.hazwoperosha.com/`;
const problems = [];
const bad = (area, msg) => problems.push(`[${area}] ${msg}`);

for (const f of ['index.html', 'styles.css', 'robots.txt', 'sitemap.xml', 'llms.txt', '_headers'])
  if (!existsSync(join(dir, f))) bad('bug', `missing ${f}`);
const html = readFileSync(join(dir, 'index.html'), 'utf8');

// ---- formatting / SEO -----------------------------------------------------
try {
  execSync(`npx --yes html-validate@9 --config "${new URL('./htmlvalidate.json', import.meta.url).pathname}" "${join(dir, 'index.html')}"`, { stdio: 'pipe' });
} catch (e) { bad('format', 'html-validate:\n' + (e.stdout?.toString() || e.message)); }
const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
if (!title || title.length > 60) bad('seo', `title length ${title.length} (max 60)`);
const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
if (!desc || desc.length > 155) bad('seo', `description length ${desc.length} (max 155)`);
for (const [re, name] of [[/rel="canonical" href="([^"]+)"/, 'canonical'], [/property="og:url" content="([^"]+)"/, 'og:url']]) {
  const v = (html.match(re) || [])[1];
  if (v !== origin) bad('seo', `${name} is ${v}, expected ${origin}`);
}
if ((html.match(/<h1[\s>]/g) || []).length !== 1) bad('seo', 'must have exactly one h1');
for (const f of readdirSync(dir)) {
  const p = join(dir, f);
  if (!statSync(p).isFile()) continue;
  readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
    if (/[ \t]+$/.test(l)) bad('format', `${f}:${i + 1} trailing whitespace`);
    if (/\t/.test(l)) bad('format', `${f}:${i + 1} tab indentation`);
  });
}
const robots = existsSync(join(dir, 'robots.txt')) ? readFileSync(join(dir, 'robots.txt'), 'utf8') : '';
for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'])
  if (!robots.includes(bot)) bad('ai', `robots.txt does not mention ${bot}`);
if (!robots.includes(`Sitemap: ${origin}sitemap.xml`)) bad('seo', 'robots.txt Sitemap line wrong');

// JSON-LD
const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
if (!ld.length) bad('seo', 'no JSON-LD');
const types = [];
for (const [, j] of ld) {
  try {
    const o = JSON.parse(j);
    (o['@graph'] || [o]).forEach((n) => types.push(n['@type']));
  } catch (e) { bad('bug', 'JSON-LD does not parse: ' + e.message); }
}
for (const t of ['Course', 'FAQPage', 'BreadcrumbList']) if (!types.includes(t)) bad('seo', `JSON-LD missing ${t}`);

// ---- security -------------------------------------------------------------
if (/\son[a-z]+\s*=/i.test(html)) bad('security', 'inline event handler');
if (/javascript:/i.test(html)) bad('security', 'javascript: URL');
if (/<form[\s>]/i.test(html)) bad('security', 'form present');
if (/\sstyle\s*=/i.test(html)) bad('security', 'inline style attribute (blocked by CSP)');
if (/<script(?![^>]*application\/ld\+json)[^>]*>[^<]+<\/script>/i.test(html)) bad('security', 'inline script');
for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) if (/^https?:/.test(m[1])) bad('security', `third-party script ${m[1]}`);
for (const m of html.matchAll(/<a\s[^>]*target="_blank"[^>]*>/g)) if (!/noopener/.test(m[0])) bad('security', 'target=_blank without noopener');
for (const m of html.matchAll(/(?:href|src)="(http:[^"]+)"/g)) bad('security', `insecure URL ${m[1]}`);
if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(html)) bad('security', 'email address in page');
const headers = existsSync(join(dir, '_headers')) ? readFileSync(join(dir, '_headers'), 'utf8') : '';
for (const h of ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Strict-Transport-Security'])
  if (!headers.includes(h)) bad('security', `_headers missing ${h}`);

// ---- links ----------------------------------------------------------------
const ext = new Set([...html.matchAll(/(?:href|content)="(https:\/\/(?:media\.)?hazwoper-osha\.com[^"#]*)"/g)].map((m) => m[1]));
for (const u of ext) {
  try {
    const code = execSync(`curl -sSL -o /dev/null -w '%{http_code}' --max-time 20 "${u}"`).toString();
    if (code !== '200') bad('bug', `${u} returned ${code}`);
  } catch { bad('bug', `${u} unreachable`); }
}
for (const m of html.matchAll(/(?:href|src)="([^"#:]+)"/g)) {
  const p = m[1].replace(/^\.?\//, '');
  if (p && !existsSync(join(dir, p))) bad('bug', `local asset not found: ${m[1]}`);
}
for (const m of html.matchAll(/href="#([^"]+)"/g)) if (!html.includes(`id="${m[1]}"`)) bad('bug', `anchor #${m[1]} has no target`);

// ---- render with real headers (CSP enforced) ------------------------------
const csp = (headers.match(/Content-Security-Policy:\s*(.+)/) || [])[1];
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain', '.xml': 'application/xml' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(dir, p);
  if (!f.startsWith(dir) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': mime[extname(f)] || 'application/octet-stream', ...(csp ? { 'Content-Security-Policy': csp } : {}) });
  res.end(readFileSync(f));
}).listen(0);
const port = server.address().port;
const { chromium } = require('playwright');
const browser = await chromium.launch();
for (const width of [320, 375, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') bad('bug', `console error @${width}: ${m.text()}`); });
  page.on('pageerror', (e) => bad('bug', `page error @${width}: ${e.message}`));
  page.on('requestfailed', (r) => bad('bug', `request failed @${width}: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) bad('bug', `HTTP ${r.status()} @${width}: ${r.url()}`); });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 0) bad('bug', `horizontal overflow of ${over}px at ${width}px`);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,p,li,a,dt,dd,summary')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; }).map((e) => e.tagName + ':' + e.textContent.trim().slice(0, 30)));
  if (clipped.length) bad('bug', `text extends past viewport at ${width}px (clipped by overflow:hidden?): ${clipped.slice(0, 3).join(' | ')}`);
  const noAlt = await page.$$eval('img:not([alt])', (e) => e.length);
  if (noAlt) bad('seo', `${noAlt} images without alt`);
  if (shots) await page.screenshot({ path: join(shots, `${sub}-${width}.png`), fullPage: true });
  await page.close();
}
await browser.close();
server.close();

if (problems.length) { console.log(problems.join('\n')); console.log(`\n${problems.length} problem(s)`); process.exit(1); }
console.log('clean: no problems found');
