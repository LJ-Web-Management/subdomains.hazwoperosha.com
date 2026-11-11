#!/usr/bin/env node
// Checks every site in sites/ before a deploy (the workflow runs it), with no
// dependencies: node scripts/check-sites.mjs
//
// Checkout: each site sells its course from data/courses.json through
//   /checkout (its form carries that LMS id and price), and its Enroll links and
//   JSON-LD Offer go there instead of to hazwoper-osha.com.
// Security: no inline scripts but JSON-LD, no inline event handlers or style
//   attributes, no javascript: URLs, no plain-http links, noopener on new tabs,
//   no forms or iframes outside checkout, CSPs without 'unsafe-*', the shared
//   checkout never writes HTML from strings, and no secret keys in the repo.
// Exits 1 and lists every problem it finds.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SITES = join(ROOT, 'sites');
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const problems = [];
const fail = (where, what) => problems.push(`${where}: ${what}`);
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => relative(ROOT, p);

const courses = JSON.parse(read(join(ROOT, 'data', 'courses.json')));
const sites = readdirSync(SITES).filter((d) =>
  LABEL.test(d) && d !== 'hub' && statSync(join(SITES, d)).isDirectory() && existsSync(join(SITES, d, 'index.html')));

// ---- course catalog ---------------------------------------------------------
for (const [site, c] of Object.entries(courses)) {
  if (!sites.includes(site)) fail('data/courses.json', `${site} has no folder in sites/`);
  if (!Number.isInteger(c.lmsId) || c.lmsId <= 0) fail('data/courses.json', `${site}: lmsId must be a positive integer`);
  if (!(typeof c.price === 'number' && c.price > 0 && Math.abs(c.price * 100 - Math.round(c.price * 100)) < 1e-6)) fail('data/courses.json', `${site}: bad price ${c.price}`);
  if (!/^https:\/\/hazwoper-osha\.com\/online-courses\/[a-z0-9-]+$/.test(c.url || '')) fail('data/courses.json', `${site}: bad url ${c.url}`);
  if (!c.name) fail('data/courses.json', `${site}: no name`);
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ---- each site ----------------------------------------------------------------
for (const site of sites) {
  const dir = join(SITES, site);
  const c = courses[site];
  if (!c) { fail(`sites/${site}`, 'no course in data/courses.json'); continue; }
  const host = `https://${site}.hazwoperosha.com`;

  // checkout page carries exactly this course
  const checkoutPath = join(dir, 'checkout.html');
  if (!existsSync(checkoutPath)) { fail(`sites/${site}`, 'no checkout.html (run scripts/build-checkout.py)'); continue; }
  const checkout = read(checkoutPath);
  const formTag = (checkout.match(/<form\b[^>]*id="checkoutForm"[^>]*>/s) || [''])[0];
  if (attr(formTag, 'data-site') !== site) fail(rel(checkoutPath), 'data-site is not the folder name');
  if (Number(attr(formTag, 'data-lms-id')) !== c.lmsId) fail(rel(checkoutPath), `data-lms-id is not ${c.lmsId}`);
  if (Number(attr(formTag, 'data-price')) !== c.price) fail(rel(checkoutPath), `data-price is not ${c.price}`);
  if (unescape(attr(formTag, 'data-name') || '') !== c.name) fail(rel(checkoutPath), 'data-name differs from data/courses.json');
  for (const src of ['/_shared/config.js', '/_shared/checkout.js']) {
    if (!checkout.includes(`<script src="${src}" defer></script>`)) fail(rel(checkoutPath), `does not load ${src}`);
  }
  if (!checkout.includes(`<link rel="canonical" href="${host}/checkout">`)) fail(rel(checkoutPath), 'wrong canonical');
  if (!/<meta name="robots" content="noindex/.test(checkout)) fail(rel(checkoutPath), 'checkout must be noindex');

  // landing page sells through /checkout
  const indexPath = join(dir, 'index.html');
  const index = read(indexPath);
  if (index.includes(`href="${c.url}"`)) fail(rel(indexPath), `still links to ${c.url} instead of /checkout`);
  if (!index.includes('href="/checkout"')) fail(rel(indexPath), 'has no Enroll link to /checkout');
  const ld = [...index.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
  if (!ld.length) fail(rel(indexPath), 'no JSON-LD');
  for (const [, block] of ld) {
    let data;
    try { data = JSON.parse(block); } catch (e) { fail(rel(indexPath), `JSON-LD does not parse: ${e.message}`); continue; }
    for (const node of data['@graph'] || [data]) {
      if (node['@type'] === 'Course' && node.offers && node.offers.url !== `${host}/checkout`) fail(rel(indexPath), `Course offers.url is ${node.offers.url}`);
      if (node['@type'] === 'Course' && node.offers && Number(node.offers.price) !== c.price) fail(rel(indexPath), `Course offers.price ${node.offers.price} is not the LMS price ${c.price}`);
    }
  }
  const llms = join(dir, 'llms.txt');
  if (existsSync(llms) && !read(llms).includes(`${host}/checkout`)) fail(rel(llms), 'does not give the checkout URL');

  // security headers
  const headers = read(join(dir, '_headers'));
  const csps = [...headers.matchAll(/Content-Security-Policy:\s*(.+)/g)].map((m) => m[1]);
  if (csps.length !== 2) fail(`sites/${site}/_headers`, 'expected a site CSP and a /checkout CSP');
  for (const csp of csps) {
    if (/unsafe-(inline|eval|hashes)|\s\*\s|\s\*;|data:\s*;?\s*script|http:/.test(csp)) fail(`sites/${site}/_headers`, `weak CSP: ${csp}`);
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) if (!csp.includes(d)) fail(`sites/${site}/_headers`, `CSP lacks ${d}`);
  }
  for (const h of ['Strict-Transport-Security', 'X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY', 'Referrer-Policy']) {
    if (!headers.includes(h)) fail(`sites/${site}/_headers`, `missing ${h}`);
  }
}

// ---- every HTML file ----------------------------------------------------------
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? (n === 'hub' && d === SITES ? [] : walk(p)) : [p];
});
const files = walk(SITES);
for (const file of files.filter((f) => f.endsWith('.html'))) {
  const html = read(file);
  const where = rel(file);
  const isCheckout = file.endsWith('checkout.html');
  for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
    const src = attr(m[0], 'src');
    if (src === null && attr(m[0], 'type') !== 'application/ld+json') fail(where, 'inline <script> (only JSON-LD may be inline)');
    if (src !== null && !src.startsWith('/')) fail(where, `third-party script ${src}`);
  }
  if (/\son[a-z]+\s*=/i.test(html.replace(/<script type="application\/ld\+json">.*?<\/script>/gs, ''))) fail(where, 'inline event handler (on...=)');
  if (/\sstyle\s*=\s*["']/i.test(html)) fail(where, 'style="" attribute (blocked by the CSP)');
  if (/javascript:/i.test(html)) fail(where, 'javascript: URL');
  if (/<iframe\b/i.test(html)) fail(where, '<iframe>');
  if (/<form\b/i.test(html) && !isCheckout) fail(where, '<form> outside checkout');
  for (const m of html.matchAll(/\s(?:href|src|action|content)="(http:\/\/[^"]*)"/g)) fail(where, `plain-http URL ${m[1]}`);
  for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    const r = attr(m[0], 'rel') || '';
    if (!/noopener/.test(r) || !/noreferrer/.test(r)) fail(where, 'target="_blank" without rel="noopener noreferrer"');
  }
}

// ---- shared checkout code ---------------------------------------------------------
const shared = join(SITES, '_shared');
const expected = ['checkout.css', 'checkout.js', 'config.js'];
const present = readdirSync(shared).sort();
if (present.join() !== expected.join()) fail('sites/_shared', `expected only ${expected.join(', ')}, found ${present.join(', ')}`);
const checkoutJs = read(join(shared, 'checkout.js'));
for (const [re, what] of [
  [/\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/, 'writes HTML from strings'],
  [/\beval\s*\(|new Function\s*\(|setTimeout\(\s*['"`]|setInterval\(\s*['"`]/, 'evaluates strings as code'],
  [/console\.(log|info|debug)\(/, 'logs to the console (could leak buyer details)'],
]) if (re.test(checkoutJs)) fail('sites/_shared/checkout.js', what);
if (/\b(amount|order_total|total_price)\s*:/.test(checkoutJs)) fail('sites/_shared/checkout.js', 'sends an amount to the API; the LMS must price the order');
const config = read(join(shared, 'config.js'));
const keys = [...config.matchAll(/pk_(live|test)_[A-Za-z0-9]+/g)].map((m) => m[0]);
if (keys.length !== 1 || !keys[0].startsWith('pk_live_')) fail('sites/_shared/config.js', 'needs exactly one live publishable key');
if (!config.includes("API_BASE_URL: 'https://hazwoper-osha.com/api'")) fail('sites/_shared/config.js', 'API_BASE_URL is not https://hazwoper-osha.com/api');

// ---- secrets anywhere in the repo ---------------------------------------------------
const SECRET = /\b(sk_(live|test)_[A-Za-z0-9]{8,}|rk_(live|test)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abp]-[A-Za-z0-9-]{10,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const repoFiles = (d) => readdirSync(d).flatMap((n) => {
  if (['.git', 'node_modules', '.wrangler'].includes(n)) return [];
  const p = join(d, n);
  return statSync(p).isDirectory() ? repoFiles(p) : [p];
});
for (const f of repoFiles(ROOT)) {
  if (/\.(png|jpe?g|webp|gif|ico|woff2?)$/i.test(f)) continue;
  const m = read(f).match(SECRET);
  if (m) fail(rel(f), `looks like a secret key (${m[0].slice(0, 12)}...)`);
}

if (problems.length) {
  for (const p of problems) console.error(`PROBLEM ${p}`);
  console.error(`\n${problems.length} problem(s) in ${sites.length} sites.`);
  process.exit(1);
}
console.log(`OK: ${sites.length} sites, ${files.length} files checked.`);
