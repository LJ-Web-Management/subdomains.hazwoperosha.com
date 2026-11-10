# subdomains.hazwoperosha.com

Every folder inside `sites/` is automatically deployed as a subdomain with the
folder's name:

```
sites/training/index.html  ->  https://training.hazwoperosha.com
sites/spanish/index.html   ->  https://spanish.hazwoperosha.com
```

All sites are served by one Cloudflare Worker (`worker/index.js`, configured in
`wrangler.json`), so there is no per-site project to hit an account limit. The
Worker looks at the hostname and answers with that folder's files, applying the
folder's `_headers` file to every response.

## Adding a site

1. Create `sites/<name>/` with an `index.html` (plain static HTML/CSS/JS).
2. Commit and push to `main`.

The **Deploy subdomain sites** GitHub Action then runs `scripts/deploy.sh`,
which:

1. checks that `<name>.hazwoperosha.com` is free, or already belongs to this repo,
2. deploys the Worker with every site's files and a route for each site, and
3. creates a proxied DNS record `AAAA <name> -> 100::` for any new site
   (`100::` is the usual placeholder for a hostname that only a Worker answers).

Every run deploys all sites; only changed files are uploaded. To redeploy by
hand, run the workflow from the Actions tab (**Run workflow**).

Folder names must be valid subdomains: lowercase letters, digits and hyphens,
not starting or ending with a hyphen. If a subdomain already has a DNS record
that this repo didn't create (e.g. `www`, `mail`), that site is skipped
instead of overwriting the record, and the run is marked as failed so you see
it. The other sites still deploy.

Deleting a folder takes the site offline on the next deploy, because its files
are no longer uploaded. Its DNS record is left behind; delete it in the
Cloudflare dashboard if you like.

## One-time setup

Add these under **Settings → Secrets and variables → Actions**:

| Secret                  | Value |
|-------------------------|-------|
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (shown on the domain's Overview page, right sidebar) |
| `CLOUDFLARE_API_TOKEN`  | API token with the permissions below |

API token permissions:

| Scope   | Permission       | Access | Used for |
|---------|------------------|--------|----------|
| Account | Workers Scripts  | Edit   | deploying the Worker and the site files |
| Zone    | Workers Routes   | Edit   | pointing each subdomain at the Worker |
| Zone    | DNS              | Edit   | creating the subdomains' DNS records |
| Zone    | Zone             | Read   | finding the `hazwoperosha.com` zone |
| Account | Cloudflare Pages | Edit   | only for the one-off cleanup below |

The `hazwoperosha.com` DNS zone must be on Cloudflare.

## Moving from one Pages project per site

The sites used to be deployed as one Cloudflare Pages project each
(`sub-<name>`). The first Worker deploy moves their DNS records to the Worker.
After that, run **Remove old Pages projects** from the Actions tab once. It
deletes the old `sub-<name>` projects, but only those whose subdomain no
longer points at them.

## Manual deploy

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... scripts/deploy.sh
```

To try the Worker locally: `npx wrangler@4 dev`, then request
`http://localhost:8787/` with a `Host: <name>.hazwoperosha.com` header.
