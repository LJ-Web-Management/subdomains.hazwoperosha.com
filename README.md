# subdomains.hazwoperosha.com

Every folder inside `sites/` is automatically deployed to Cloudflare Pages
as a subdomain with the folder's name:

```
sites/training/index.html  ->  https://training.hazwoperosha.com
sites/spanish/index.html   ->  https://spanish.hazwoperosha.com
```

## Adding a site

1. Create `sites/<name>/` with an `index.html` (plain static HTML/CSS/JS).
2. Commit and push to `main`.

The **Deploy subdomain sites** GitHub Action then:

1. creates a Cloudflare Pages project `sub-<name>` if it doesn't exist,
2. uploads the folder's files,
3. attaches `<name>.hazwoperosha.com` to the project, and
4. creates a proxied DNS `CNAME <name> -> sub-<name>.pages.dev`.

Pushes only redeploy the folders that changed. To redeploy everything, run
the workflow by hand from the Actions tab (**Run workflow**).

Folder names must be valid subdomains: lowercase letters, digits and hyphens,
not starting or ending with a hyphen. If a subdomain already has a DNS record
that this repo didn't create (e.g. `www`, `mail`), the deploy for that folder
stops instead of overwriting the record.

Deleting a folder does **not** take the site down. Remove the Pages project and
DNS record in the Cloudflare dashboard yourself.

## One-time setup

Add these under **Settings → Secrets and variables → Actions**:

| Secret                  | Value |
|-------------------------|-------|
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (shown in the dashboard sidebar / URL) |
| `CLOUDFLARE_API_TOKEN`  | API token with **Account → Cloudflare Pages → Edit**, **Zone → DNS → Edit** and **Zone → Zone → Read** for `hazwoperosha.com` |

The `hazwoperosha.com` DNS zone must be on Cloudflare.

## Manual deploy

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... scripts/deploy-site.sh <name>
```
