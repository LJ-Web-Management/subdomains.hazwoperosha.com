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
2. Add its course to `data/courses.json` and write its checkout (see
   [Checkout](#checkout)): `python3 -I scripts/sync-courses.py --write <name>`,
   then `python3 -I scripts/build-checkout.py`.
3. Commit and push to `main`.

The **Deploy subdomain sites** GitHub Action then runs `scripts/deploy.sh`,
which:

1. checks that `<name>.hazwoperosha.com` is free, or already belongs to this repo,
2. deploys the Worker with every site's files and a route for each site, and
3. creates a proxied DNS record `AAAA <name> -> 100::` for any new site
   (`100::` is the usual placeholder for a hostname that only a Worker answers).

Every run deploys all sites; only changed files are uploaded. To redeploy by
hand, run the workflow from the Actions tab (**Run workflow**).

https://hub.hazwoperosha.com lists the sitemap of every hazwoperosha.com
site, and https://hub.hazwoperosha.com/sitemap.xml is a sitemap index of all of
them. Submit that index in Google Search Console (and Bing Webmaster Tools)
under the Domain property for hazwoperosha.com: only a Domain property may list
sitemaps on other subdomains. `scripts/build-hub.sh` writes the hub to
`sites/hub/` (git-ignored, so don't create a `hub` folder yourself) at the start
of every deploy, so new sites are listed on their own. The hazwoperosha.us
sites have their own hub: https://hub.hazwoperosha.us/sitemap.xml and the page
https://hub.hazwoperosha.us/sitemaps/ (in
`LJ-Web-Management/subdomains.hazwoperosha.us`).

`sites/_shared/` is not a site: the Worker serves it to every site at
`/_shared/` (the checkout script and styles), and the deploy skips it.

Folder names must be valid subdomains: lowercase letters, digits and hyphens,
not starting or ending with a hyphen. If a subdomain already has a DNS record
that this repo didn't create (e.g. `www`, `mail`), that site is skipped
instead of overwriting the record, and the run is marked as failed so you see
it. The other sites still deploy.

Deleting a folder takes the site offline on the next deploy, because its files
are no longer uploaded. Its DNS record is left behind; delete it in the
Cloudflare dashboard if you like.

## Checkout

Every site sells its one course at `https://<name>.hazwoperosha.com/checkout`,
and all its Enroll buttons link there. The checkout works the same way as
datacentertraining.us (`js/checkout.js`) and hazwoper-osha.com's own checkout,
so orders land in the hazwoper-osha.com LMS:

1. Stripe.js turns the card into a PaymentMethod. The card number stays in
   Stripe's iframe and never touches these sites.
2. `POST https://hazwoper-osha.com/api/add_new_user` returns the customer id.
3. `POST https://hazwoper-osha.com/api/add_order` with `course_id` (the
   course's LMS id), `quantity` (seats) and `order_from:
   <name>.hazwoperosha.com`. If the LMS answers with a `clientSecret`, Stripe
   confirms the payment (3-D Secure if the bank asks); if that fails, the order
   is marked with `failed_status`.

The LMS prices the order from `course_id` and `quantity`; the page never sends
an amount. The seat price on the page comes from the LMS too
(`/api/roi_tier_price`): 1% off from 2 seats, 2% from 11, 3% from 21, 5% from
51, 7% from 101 to 250, list price above that (as of 2026-11-11).

| File | What it is |
|------|------------|
| `data/courses.json` | Each site's course: hazwoper-osha.com URL, LMS id (`lmsId`), LMS price, name, SKU |
| `scripts/sync-courses.py` | Reads those from each live course page and the LMS price API. Without `--write` it only checks and exits 1 on any difference |
| `scripts/build-checkout.py` | Writes each site's `checkout.html` and `_headers`, and points its Enroll links, JSON-LD Offer and `llms.txt` at `/checkout`. `--check` only reports out-of-date files |
| `sites/_shared/config.js` | Stripe publishable key, API URL, `CHECKOUT_DISABLED`, attempt limits |
| `sites/_shared/checkout.js`, `checkout.css` | The checkout itself, shared by every site |
| `scripts/check-sites.mjs` | Checks every site's course, links, headers and security; the deploy runs it first |

`lmsId` is the `"course_id"` in the course page's `var cat = {...}` block (also
the `data-id` of its Enroll buttons). Never take it from a spreadsheet row
number: that enrolls buyers in a different course. If a course's id or price
changes on hazwoper-osha.com:

```bash
python3 -I scripts/sync-courses.py --write
python3 -I scripts/build-checkout.py
node scripts/check-sites.mjs
```

Then update any price written in that site's `index.html` and `llms.txt`, and
commit. To take card payments offline, set `CHECKOUT_DISABLED: true` in
`sites/_shared/config.js`: checkout then composes an enrollment-request email
to info@hazwoper-osha.com instead.

### Security

- **Content Security Policy.** Landing pages run no scripts but their own and
  can't connect anywhere. `/checkout` may load scripts and frames only from
  Stripe and connect only to Stripe and hazwoper-osha.com, so injected code
  can't load a card skimmer or send data elsewhere. Neither allows inline
  scripts, `eval` or framing (`frame-ancestors 'none'`, against clickjacking).
  Both are in `HEADERS` in `scripts/build-checkout.py`.
- **Other headers.** HSTS, `nosniff`, `X-Frame-Options: DENY`, a strict
  Referrer-Policy and Permissions-Policy, COOP and CORP on every site;
  `Cache-Control: no-store` and `noindex` on checkout. The Worker adds the
  basic ones even to 404s, and answers anything but GET and HEAD with 405.
- **Checkout code.** Values reach the page only through `textContent` (never
  `innerHTML`), inputs are length-capped and checked, the only third-party
  script is Stripe.js, and nothing is logged. A hidden honeypot field, a
  minimum fill time and a limit of 5 failed attempts per browser tab slow
  down card-testing bots.
- **What only the LMS can do.** Anyone can call the hazwoper-osha.com API
  directly, so real protection against card testing has to live there:
  Stripe Radar rules and rate limits on `add_new_user` and `add_order`.
- **Deploys.** The workflows have read-only repo permissions, pin their actions
  to commit SHAs and pin wrangler to an exact version.

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

To try the Worker locally: `npx wrangler@4.151.3 dev --local-protocol https`,
then request `https://localhost:8787/` with a `Host: <name>.hazwoperosha.com`
header. Use HTTPS: the CSP's `upgrade-insecure-requests` would turn the
page's own http requests into https ones.
