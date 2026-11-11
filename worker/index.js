// One Worker serves every folder in sites/ as <folder>.hazwoperosha.com.
//
// https://ics-200.hazwoperosha.com/styles.css is answered with the static
// asset sites/ics-200/styles.css. Each site's own _headers file is applied to
// its responses, as Cloudflare Pages did. Which hostnames reach this Worker is
// decided by the routes that scripts/deploy.sh attaches, one per site.
//
// sites/_shared/ (the checkout script and styles) is served to every site at
// /_shared/: https://ics-200.hazwoperosha.com/_shared/checkout.js is
// sites/_shared/checkout.js. "_shared" is not a valid hostname label, so it is
// never a site of its own.

const ROOT_DOMAIN = 'hazwoperosha.com';
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const SHARED = '_shared';

// Site configuration files: read by the Worker, never served from any folder.
const HIDDEN = new Set(['_headers', '_redirects', '_routes.json']);

// Sent with every response, including 404s; a site's _headers can override them.
const BASE_HEADERS = [
  ['x-content-type-options', 'nosniff'],
  ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  ['x-frame-options', 'DENY'],
];

// Parsed _headers rules per site, kept for the life of the isolate.
const rulesCache = new Map();

export default {
  async fetch(request, env) {
    // Static sites: nothing here accepts a POST, PUT or DELETE.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return plain(405, 'Method not allowed', { Allow: 'GET, HEAD' });
    }
    const url = new URL(request.url);
    const site = siteFor(url.hostname);
    const file = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
    if (!site || HIDDEN.has(file)) return notFound();

    // /_shared/... comes from sites/_shared/, everything else from the site's folder.
    const folder = url.pathname.startsWith(`/${SHARED}/`) ? SHARED : site;
    const assetUrl = new URL(url);
    assetUrl.pathname = folder === SHARED ? url.pathname : `/${site}${url.pathname}`;
    // "/%2e%2e/other-site/" would normalise out of the folder.
    if (!assetUrl.pathname.startsWith(`/${folder}/`)) return notFound();

    const asset = await env.ASSETS.fetch(new Request(assetUrl, { method: request.method, headers: request.headers }));
    const response = new Response(asset.body, asset);
    if (folder === site) fixRedirect(response, site, url);
    for (const [header, value] of BASE_HEADERS) response.headers.set(header, value);
    for (const [name, value] of await headersFor(env, site, url)) {
      if (value === null) response.headers.delete(name);
      else response.headers.set(name, value);
    }
    return response;
  },
};

function siteFor(hostname) {
  const suffix = `.${ROOT_DOMAIN}`;
  if (!hostname.endsWith(suffix)) return null;
  const label = hostname.slice(0, -suffix.length);
  return LABEL.test(label) ? label : null;
}

function notFound() {
  return plain(404, 'Not found');
}

function plain(status, text, extra = {}) {
  const headers = new Headers({ 'Content-Type': 'text/plain; charset=utf-8', ...extra });
  for (const [name, value] of BASE_HEADERS) headers.set(name, value);
  return new Response(text, { status, headers });
}

// The asset handler redirects /x/index.html to /x/ and so on, using the
// folder path. Strip the folder so the visitor stays on the site's own paths.
function fixRedirect(response, site, url) {
  const location = response.headers.get('Location');
  if (!location) return;
  const target = new URL(location, url);
  if (target.origin !== url.origin) return;
  const prefix = `/${site}`;
  if (target.pathname === prefix || target.pathname.startsWith(`${prefix}/`)) {
    const path = target.pathname.slice(prefix.length) || '/';
    response.headers.set('Location', path + target.search + target.hash);
  }
}

// Headers from the site's _headers file that apply to this path, as
// [name, value] pairs; a null value removes the header ("! Name"). A rule's
// "! Name" lines drop what earlier rules set before the rule's own headers are
// added, so a later, narrower rule can replace a header:
//   /*
//     Content-Security-Policy: strict
//   /checkout
//     ! Content-Security-Policy
//     Content-Security-Policy: allows Stripe
async function headersFor(env, site, url) {
  let rules = rulesCache.get(site);
  if (!rules) {
    const file = await env.ASSETS.fetch(new Request(`${url.origin}/${site}/_headers`));
    rules = parseHeadersFile(file.ok ? await file.text() : '');
    rulesCache.set(site, rules);
  }
  const result = new Map();
  for (const rule of rules) {
    if (!rule.pattern.test(url.pathname)) continue;
    for (const name of rule.detach) result.set(name, null);
    for (const [name, value] of rule.set) {
      const current = result.get(name);
      result.set(name, current ? `${current}, ${value}` : value);
    }
  }
  return result;
}

// Cloudflare Pages _headers format:
//   /path/*            a path pattern (* matches anything, :name one segment)
//     Name: value      a header for paths matching the pattern
//     ! Name           remove a header set by an earlier rule (or by BASE_HEADERS)
// Lines starting with # are comments.
function parseHeadersFile(text) {
  const rules = [];
  let rule = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      // Only path patterns; full-URL patterns are not supported here.
      rule = line.startsWith('/')
        ? { pattern: patternToRegExp(line), set: [], detach: [] }
        : null;
      if (rule) rules.push(rule);
    } else if (rule) {
      if (line.startsWith('!')) {
        rule.detach.push(line.slice(1).trim().toLowerCase());
      } else {
        const colon = line.indexOf(':');
        if (colon > 0) {
          rule.set.push([
            line.slice(0, colon).trim().toLowerCase(),
            line.slice(colon + 1).trim(),
          ]);
        }
      }
    }
  }
  return rules;
}

function patternToRegExp(pattern) {
  const source = pattern
    .split(/(\*|:[A-Za-z]\w*)/)
    .map((part) => {
      if (part === '*') return '.*';
      if (part.startsWith(':')) return '[^/]+';
      return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`);
}
