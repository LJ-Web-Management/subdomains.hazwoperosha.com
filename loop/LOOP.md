# Landing-page loop

Each run of this loop builds **one** landing page for one hazwoper-osha.com
training and deploys it to `https://<subdomain>.hazwoperosha.com` (any folder
in `sites/` is deployed automatically when pushed to `main`; see README).

State files (commit them every iteration):

- `loop/queue.json`: every `https://hazwoper-osha.com/online-courses/*` URL.
  `status` is one of `pending`, `done` or `skipped`. Done entries also have
  `subdomain`, `title`, `style` and `date`. Skipped entries have `reason`.
- `loop/styles-used.json`: one entry per page built, recording its visual style
  (`name`, `palette`, `fonts`, `layout`), so that no two pages look alike.

## Steps for one iteration

### 1. Pick a new training
- Take the first entry in `loop/queue.json` whose status is `pending`.
- Fetch the URL and read the real details: course name, hours, price,
  regulation (CFR), audience, format, certificate, language, and the
  enroll/buy link.
- (57 category pages were already found and marked `skipped` in one batch. A real course page has a `Product` JSON-LD block, and `extract-course.py` prints none for a category page.)
- If the page is a **category or listing page** (several courses with no
  single course to enroll in), or it is gone or empty, mark it `skipped` with
  a `reason` and go straight on to the next pending entry within the same
  iteration.
- Choose the `subdomain`: a short, keyword-rich DNS label (lowercase letters,
  digits and hyphens, 40 characters or fewer, e.g. `40-hour-hazwoper`). It
  must not already be a folder in `sites/` or any entry in the queue.
  Never use `www`, `mail`, `api`, `admin`, `app` or similar.
- Write the `subdomain` into the queue entry now (status still `pending`), then
  run `python3 -I scripts/sync-courses.py --write <subdomain>`. It reads the
  course's LMS id (`course_id`) and the LMS price from hazwoper-osha.com into
  `data/courses.json`; checkout sells the course with those. Use that price on
  the page. If it reports a problem (no course id, prices that disagree), skip
  the course with that `reason`.

### 2. Find a new, unique style
- Read `loop/styles-used.json`. Pick a visual direction that differs from
  **every** earlier entry in palette, font pairing and layout (for example
  brutalist, Swiss grid, editorial magazine, field-manual or blueprint,
  retro industrial poster, dark terminal, warm hand-drawn, bold split-screen
  or glassmorphism). Make sure it still fits a safety-training brand.
- Fonts: system font stacks, or Google Fonts through a single `<link>`. The
  CSP that `scripts/build-checkout.py` writes already allows
  `fonts.googleapis.com` and `fonts.gstatic.com`; don't edit `_headers` by hand.

### 3. Generate the page in `sites/<subdomain>/`
Required files:
- `index.html`: a self-contained static page. Use semantic HTML (`header`,
  `main`, `section`, `footer`) with a single `h1`. Sections: a hero that
  names the course and its benefit, who needs it, what you'll learn (from the
  real outline), course facts (hours, format, certificate, regulation), FAQ,
  and a final call to action. Every Enroll CTA links to `/checkout`, the
  site's own card checkout (not to hazwoper-osha.com). In the JSON-LD, the
  `Course` `url` is the real course URL on hazwoper-osha.com and its `offers`
  `url` is `https://<subdomain>.hazwoperosha.com/checkout`.
- Then run `python3 -I scripts/build-checkout.py`. It writes `checkout.html`
  (the shared Stripe checkout, `sites/_shared/`, for this course's LMS id and
  price) and `_headers`, and points any leftover links to the course page, and
  the `- Enroll:` line in `llms.txt`, at `/checkout`. Never edit
  `checkout.html` or `_headers` by hand.
- `styles.css`: all styles go here, with no inline `style=""` attributes.
  Layout is mobile-first and works at 320px with no horizontal scroll.
- Only add `script.js` if the page truly needs it, with no inline `<script>`
  except the JSON-LD.
- **Never invent facts.** Prices, hours, accreditations and reviews must come
  from the fetched page. If a fact is unknown, leave it out.

### 4. Optimize for SEO
- `<title>` of 60 characters or fewer, `<meta name="description">` of 155
  characters or fewer, `<link rel="canonical" href="https://<subdomain>.hazwoperosha.com/">`,
  `lang="en"`, and a viewport meta.
- Open Graph and Twitter card tags.
- JSON-LD: `Course` (provider `Organization` "HAZWOPER OSHA Training",
  url https://hazwoper-osha.com), `FAQPage` matching the visible FAQ, and
  `BreadcrumbList`.
- Use headings in order. Image `alt` text is required, and `width`/`height`
  must be set. Use descriptive link text.
- `robots.txt` (allow all, with a `Sitemap:` line) and `sitemap.xml`.

### 5. Optimize for AI discovery
- `llms.txt` at the site root: a plain-language summary of the course, key
  facts, who it's for, and the enroll URL.
- In `robots.txt`, explicitly allow GPTBot, ClaudeBot, PerplexityBot,
  Google-Extended and CCBot.
- The page states clear, quotable facts in plain text (not only in images).
  FAQ answers are self-contained. The regulation is named explicitly, e.g.
  "29 CFR 1910.120".

### 6–11. Check and fix (run until a full pass finds nothing)
Run these checks, fix everything they find, then **repeat the whole 6–11
block if any fix was made**. Stop after a clean pass (or after 3 passes, and
record anything still left in the commit message).

6/7. Run `node loop/check-site.mjs sites/<subdomain> <scratchpad>` first (it covers most of the checks below and saves screenshots), then review the screenshots by eye. Then run `node scripts/check-sites.mjs` and `python3 -I scripts/build-checkout.py --check`: the deploy fails if either finds a problem.

6/7. **Bugs**: every link and asset path resolves, and every `href` to
   hazwoper-osha.com returns 200 (`curl -sIL`). The JSON-LD parses
   (`jq`/`python -m json.tool`). Render the page with Playwright at 375px
   and 1280px, then check for console errors, missing assets, horizontal
   overflow (`scrollWidth > innerWidth`) and broken layout. Look at the
   screenshots.

8/9. **Formatting**: `npx --yes html-validate@9 sites/<subdomain>/index.html`
   reports no errors. Check for consistent indentation, no trailing
   whitespace, no broken entities, the canonical/og URLs match the subdomain,
   and the title and description lengths are within limits.

10/11. **Security**: `_headers` (Cloudflare Pages format; the Worker applies
   it to every response of the site) is written by `scripts/build-checkout.py`
   from `HEADERS` in that script: a strict CSP for the landing page (no
   scripts but the site's own, no connections), and for `/checkout` a CSP that
   allows only Stripe.js and the hazwoper-osha.com API. Change headers there,
   for every site at once, never in one site's `_headers`. Check: no inline
   event handlers, no `javascript:` URLs, no forms on the landing page,
   `rel="noopener noreferrer"` on every `target="_blank"`, all URLs are https,
   no third-party scripts, and no secrets or email addresses in the files.

### 13. Deploy
- Update `loop/queue.json` (status `done`, subdomain, title, style, date)
  and append the style to `loop/styles-used.json`. Commit `data/courses.json`
  and the site's `checkout.html` too.
- Commit with the message `Add <subdomain>.hazwoperosha.com landing page (<course>)`.
  Push to `claude/lucid-hawking-ss5pkp` **and** to `main`
  (`git push origin HEAD:main`). Pushing to `main` triggers the deploy.
- If the queue has no `pending` entries left, stop the loop.
