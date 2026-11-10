// One Worker serves every folder in sites/ as <folder>.hazwoperosha.com.
//
// https://ics-200.hazwoperosha.com/styles.css is answered with the static
// asset sites/ics-200/styles.css. Each site's own _headers file is applied to
// its responses, as Cloudflare Pages did. Which hostnames reach this Worker is
// decided by the routes that scripts/deploy.sh attaches, one per site.

const ROOT_DOMAIN = 'hazwoperosha.com';
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// Site configuration files: read by the Worker, never served.
const HIDDEN = new Set(['/_headers', '/_redirects', '/_routes.json']);

// Parsed _headers rules per site, kept for the life of the isolate.
const rulesCache = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const site = siteFor(url.hostname);
    if (!site || HIDDEN.has(url.pathname)) return notFound();

    const assetUrl = new URL(url);
    assetUrl.pathname = `/${site}${url.pathname}`;
    // "/%2e%2e/other-site/" would normalise out of this site's folder.
    if (!assetUrl.pathname.startsWith(`/${site}/`)) return notFound();

    const asset = await env.ASSETS.fetch(new Request(assetUrl, request));
    const response = new Response(asset.body, asset);
    fixRedirect(response, site, url);
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
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
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
// [name, value] pairs; a null value removes the header ("! Name").
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
    for (const [name, value] of rule.set) {
      const current = result.get(name);
      result.set(name, current ? `${current}, ${value}` : value);
    }
    for (const name of rule.detach) result.set(name, null);
  }
  return result;
}

// Cloudflare Pages _headers format:
//   /path/*            a path pattern (* matches anything, :name one segment)
//     Name: value      a header for paths matching the pattern
//     ! Name           remove a header set by an earlier rule
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
