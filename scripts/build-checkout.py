"""Write every site's checkout and point its Enroll links at it.

Usage: python3 -I scripts/build-checkout.py          # write the files
       python3 -I scripts/build-checkout.py --check  # change nothing; exit 1 if any file is out of date

For each site in sites/ (a folder with index.html; _shared and hub are not
sites) it uses the site's course in data/courses.json (see
scripts/sync-courses.py) to:

  sites/<site>/checkout.html  the checkout page, served at /checkout. Its form
                              carries the course's LMS id, price and name for
                              /_shared/checkout.js.
  sites/<site>/_headers       the security headers (HEADERS below), including
                              the Stripe-only CSP for /checkout.
  sites/<site>/index.html     every link to the course's hazwoper-osha.com page
                              (all of them are Enroll buttons) goes to /checkout,
                              and so does the JSON-LD Offer url. Course.url keeps
                              pointing at the hazwoper-osha.com course page.
  sites/<site>/llms.txt       "- Enroll:" points at /checkout.

Safe to run again: files already up to date are left alone.
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITES = ROOT / "sites"
COURSES = ROOT / "data" / "courses.json"
ROOT_DOMAIN = "hazwoperosha.com"
LABEL = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
NOT_SITES = {"hub"}

LANDING_CSP = (
    "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'none'; base-uri 'none'; "
    "form-action 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests"
)
# Stripe.js and its iframes (https://docs.stripe.com/security/guide), the
# hazwoper-osha.com LMS API, and nothing else.
CHECKOUT_CSP = (
    "default-src 'self'; script-src 'self' https://js.stripe.com https://*.js.stripe.com; "
    "frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com; "
    "connect-src https://hazwoper-osha.com https://api.stripe.com; img-src 'self' data: https://*.stripe.com; "
    "style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; "
    "object-src 'none'; upgrade-insecure-requests"
)
HEADERS = f"""# Written by scripts/build-checkout.py; edit HEADERS there, not here.
/*
  Content-Security-Policy: {LANDING_CSP}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-site
/checkout*
  ! Content-Security-Policy
  ! Permissions-Policy
  ! Cross-Origin-Opener-Policy
  Content-Security-Policy: {CHECKOUT_CSP}
  Permissions-Policy: camera=(), microphone=(), geolocation=(), usb=(), payment=(self "https://js.stripe.com")
  Cross-Origin-Opener-Policy: same-origin-allow-popups
  Cache-Control: no-store
  X-Robots-Tag: noindex
"""

US_STATES = [
    ("AL", "Alabama"), ("AK", "Alaska"), ("AZ", "Arizona"), ("AR", "Arkansas"), ("CA", "California"),
    ("CO", "Colorado"), ("CT", "Connecticut"), ("DE", "Delaware"), ("DC", "District of Columbia"),
    ("FL", "Florida"), ("GA", "Georgia"), ("HI", "Hawaii"), ("ID", "Idaho"), ("IL", "Illinois"),
    ("IN", "Indiana"), ("IA", "Iowa"), ("KS", "Kansas"), ("KY", "Kentucky"), ("LA", "Louisiana"),
    ("ME", "Maine"), ("MD", "Maryland"), ("MA", "Massachusetts"), ("MI", "Michigan"), ("MN", "Minnesota"),
    ("MS", "Mississippi"), ("MO", "Missouri"), ("MT", "Montana"), ("NE", "Nebraska"), ("NV", "Nevada"),
    ("NH", "New Hampshire"), ("NJ", "New Jersey"), ("NM", "New Mexico"), ("NY", "New York"),
    ("NC", "North Carolina"), ("ND", "North Dakota"), ("OH", "Ohio"), ("OK", "Oklahoma"), ("OR", "Oregon"),
    ("PA", "Pennsylvania"), ("RI", "Rhode Island"), ("SC", "South Carolina"), ("SD", "South Dakota"),
    ("TN", "Tennessee"), ("TX", "Texas"), ("UT", "Utah"), ("VT", "Vermont"), ("VA", "Virginia"),
    ("WA", "Washington"), ("WV", "West Virginia"), ("WI", "Wisconsin"), ("WY", "Wyoming"),
    ("PR", "Puerto Rico"), ("GU", "Guam"), ("VI", "U.S. Virgin Islands"),
]
CA_PROVINCES = [
    ("AB", "Alberta"), ("BC", "British Columbia"), ("MB", "Manitoba"), ("NB", "New Brunswick"),
    ("NL", "Newfoundland and Labrador"), ("NS", "Nova Scotia"), ("NT", "Northwest Territories"),
    ("NU", "Nunavut"), ("ON", "Ontario"), ("PE", "Prince Edward Island"), ("QC", "Quebec"),
    ("SK", "Saskatchewan"), ("YT", "Yukon"),
]

LOCK_SVG = ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            'aria-hidden="true" focusable="false"><rect x="4" y="11" width="16" height="10" rx="2"/>'
            '<path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>')
INFO_SVG = ('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            'aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>'
            '<line x1="12" y1="16" x2="12.01" y2="16"/></svg>')
SHIELD_SVG = ('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
              'aria-hidden="true" focusable="false"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'
              '<polyline points="9 12 11 14 15 10"/></svg>')
CHECK_SVG = ('<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
             'aria-hidden="true" focusable="false"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>'
             '<polyline points="22 4 12 14.01 9 11.01"/></svg>')


def esc(s):
    return html.escape(str(s), quote=True)


def options(items, indent):
    pad = " " * indent
    return "\n".join(f'{pad}<option value="{code}">{esc(name)}</option>' for code, name in items)


def checkout_page(site, c):
    name, price, lms_id = c["name"], c["price"], c["lmsId"]
    host = f"https://{site}.{ROOT_DOMAIN}"
    p = f"${price:,.2f}"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Checkout | HAZWOPER OSHA Training</title>
  <meta name="description" content="Secure checkout for {esc(name)}.">
  <meta name="robots" content="noindex, follow">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <link rel="canonical" href="{host}/checkout">
  <link rel="stylesheet" href="/_shared/checkout.css">
  <script src="/_shared/config.js" defer></script>
  <script src="/_shared/checkout.js" defer></script>
</head>
<body>
  <a class="co-skip" href="#main">Skip to checkout</a>
  <header class="co-top">
    <div class="co-top-inner">
      <a class="co-back" href="/">&larr; {esc(name)}</a>
      <span class="co-secure">{LOCK_SVG} Secure checkout</span>
    </div>
  </header>

  <main id="main" class="co-main">
    <div id="checkoutIntro" class="co-intro">
      <h1>Checkout</h1>
      <p>Choose your seats and add your details. Learner logins are emailed right after payment.</p>
      <p class="co-note">{INFO_SVG}<span id="modeNote">Pay by card below. Card details go straight to Stripe and never touch this site. For purchase-order billing, call <a href="tel:+18664296742">1&#8209;866&#8209;429&#8209;6742</a> or email <a href="mailto:info@hazwoper-osha.com">info@hazwoper-osha.com</a>.</span></p>
    </div>

    <noscript>
      <div class="co-view">
        <h2>Checkout needs JavaScript</h2>
        <p>Turn on JavaScript to pay here, or enroll on <a href="{esc(c["url"])}">hazwoper-osha.com</a>, or call <a href="tel:+18664296742">1&#8209;866&#8209;429&#8209;6742</a>.</p>
      </div>
    </noscript>

    <section id="successView" class="co-view" tabindex="-1" aria-labelledby="successTitle" hidden>
      <div class="co-view-icon">{CHECK_SVG}</div>
      <h2 id="successTitle">Order confirmed</h2>
      <p>Thank you. Your payment went through.</p>
      <div class="co-details">
        <div><span>Order</span><strong id="successOrderId">Confirmed</strong></div>
        <div><span>Confirmation sent to</span><strong id="successEmail"></strong></div>
      </div>
      <p>Check your inbox for your receipt and your login details to start the course.</p>
      <a class="co-btn" href="/">Back to the course page</a>
    </section>

    <section id="requestView" class="co-view" tabindex="-1" aria-labelledby="requestTitle" hidden>
      <h2 id="requestTitle">Your enrollment request is ready</h2>
      <p>Your email app should have opened with the request below, addressed to info@hazwoper-osha.com. Press send and we&rsquo;ll reply with your order confirmation and payment options.</p>
      <p>If it didn&rsquo;t open, copy the request and email it to <a href="mailto:info@hazwoper-osha.com">info@hazwoper-osha.com</a>, or call <a href="tel:+18664296742">1&#8209;866&#8209;429&#8209;6742</a>.</p>
      <pre id="requestText" class="co-pre" tabindex="0"></pre>
      <div class="co-actions">
        <button type="button" id="copyRequestBtn" class="co-btn co-btn-ghost">Copy request</button>
        <a id="reopenEmailLink" class="co-btn" href="mailto:info@hazwoper-osha.com">Open email again</a>
      </div>
    </section>

    <section id="lockedView" class="co-view" tabindex="-1" aria-labelledby="lockedTitle" hidden>
      <h2 id="lockedTitle">Let&rsquo;s finish this by phone</h2>
      <p>There have been too many unsuccessful payment attempts from this browser tab, so card checkout is paused. Call <a href="tel:+18664296742">1&#8209;866&#8209;429&#8209;6742</a> or email <a href="mailto:info@hazwoper-osha.com">info@hazwoper-osha.com</a> and we&rsquo;ll set up your order.</p>
    </section>

    <form id="checkoutForm" class="co-grid" novalidate
          data-site="{esc(site)}" data-lms-id="{lms_id}" data-price="{price:.2f}" data-name="{esc(name)}">
      <div class="co-main-col">
        <section class="co-section" aria-labelledby="seatsTitle">
          <h2 id="seatsTitle">Seats and contact</h2>
          <div class="co-field">
            <label for="seatCount">Number of learners (seats) <span class="co-req" aria-hidden="true">*</span></label>
            <input class="co-input" type="number" id="seatCount" name="seats" required min="1" max="999" step="1" value="1" inputmode="numeric" aria-describedby="seatHelp">
            <p id="seatHelp" class="co-hint">Volume pricing applies automatically from 2 seats. Add learner names after the order.</p>
            <p id="seatHint" class="co-hint co-hint-warn" hidden>For more than 999 seats, call 1-866-429-6742 for a quote.</p>
          </div>
          <div class="co-row co-row-2">
            <div class="co-field">
              <label for="firstName">First name <span class="co-req" aria-hidden="true">*</span></label>
              <input class="co-input" type="text" id="firstName" name="firstName" required maxlength="50" autocomplete="given-name">
            </div>
            <div class="co-field">
              <label for="lastName">Last name <span class="co-req" aria-hidden="true">*</span></label>
              <input class="co-input" type="text" id="lastName" name="lastName" required maxlength="50" autocomplete="family-name">
            </div>
          </div>
          <div class="co-field">
            <label for="company">Company or organization</label>
            <input class="co-input" type="text" id="company" name="company" maxlength="100" autocomplete="organization">
          </div>
          <div class="co-row co-row-2">
            <div class="co-field">
              <label for="email">Email <span class="co-req" aria-hidden="true">*</span></label>
              <input class="co-input" type="email" id="email" name="email" required maxlength="254" autocomplete="email" spellcheck="false">
            </div>
            <div class="co-field">
              <label for="phone">Phone <span class="co-req" aria-hidden="true">*</span></label>
              <input class="co-input" type="tel" id="phone" name="phone" required maxlength="25" autocomplete="tel" placeholder="(555) 555-0123">
            </div>
          </div>
          <div id="addressFields">
            <div class="co-row co-row-2">
              <div class="co-field">
                <label for="address1">Billing street address <span class="co-req" aria-hidden="true">*</span></label>
                <input class="co-input" type="text" id="address1" name="address1" required maxlength="100" autocomplete="billing address-line1">
              </div>
              <div class="co-field">
                <label for="address2">Suite, unit or building</label>
                <input class="co-input" type="text" id="address2" name="address2" maxlength="100" autocomplete="billing address-line2">
              </div>
            </div>
            <div class="co-row co-row-2">
              <div class="co-field">
                <label for="city">City <span class="co-req" aria-hidden="true">*</span></label>
                <input class="co-input" type="text" id="city" name="city" required maxlength="60" autocomplete="billing address-level2">
              </div>
              <div class="co-field">
                <label for="state">State or province <span class="co-req" aria-hidden="true">*</span></label>
                <select class="co-input" id="state" name="state" required autocomplete="billing address-level1">
                  <option value="">Choose one</option>
                  <optgroup label="United States" data-country="US">
{options(US_STATES, 20)}
                  </optgroup>
                  <optgroup label="Canada" data-country="CA">
{options(CA_PROVINCES, 20)}
                  </optgroup>
                </select>
              </div>
            </div>
            <div class="co-row co-row-2">
              <div class="co-field">
                <label for="zip">ZIP or postal code <span class="co-req" aria-hidden="true">*</span></label>
                <input class="co-input" type="text" id="zip" name="zip" required maxlength="10" autocomplete="billing postal-code" pattern="^\\d{{5}}(-\\d{{4}})?$">
              </div>
              <div class="co-field">
                <label for="country">Country <span class="co-req" aria-hidden="true">*</span></label>
                <select class="co-input" id="country" name="country" required autocomplete="billing country">
                  <option value="US" selected>United States</option>
                  <option value="CA">Canada</option>
                </select>
              </div>
            </div>
          </div>
          <div class="co-hp" aria-hidden="true">
            <label for="coWebsite">Leave this field empty</label>
            <input type="text" id="coWebsite" name="website" tabindex="-1" autocomplete="off">
          </div>
        </section>

        <section id="requestSection" class="co-section" aria-labelledby="requestSectionTitle" hidden>
          <h2 id="requestSectionTitle">Notes for our team</h2>
          <div class="co-field">
            <label for="requestNotes">Anything we should know? (optional)</label>
            <textarea class="co-input" id="requestNotes" name="notes" rows="3" maxlength="1000"></textarea>
          </div>
          <p class="co-fine">No payment is taken here, and sending a request doesn&rsquo;t commit you to buy.</p>
          <button type="submit" class="co-btn co-btn-block">Send enrollment request</button>
        </section>

        <section id="paymentSection" class="co-section" aria-labelledby="paymentTitle">
          <h2 id="paymentTitle">Payment</h2>
          <div class="co-field">
            <label for="cardElement">Card</label>
            <div id="cardElement" class="co-card-el"></div>
            <p id="cardError" class="co-hint co-hint-warn" role="alert" hidden></p>
          </div>
          <p id="payError" class="co-error" role="alert" tabindex="-1" hidden></p>
          <button type="submit" id="payBtn" class="co-btn co-btn-block">
            <span id="payBtnText">Pay {p}</span>
            <span id="payBtnSpinner" class="co-spinner" hidden></span>
          </button>
          <p class="co-fine">Payments are processed by Stripe. By placing your order you agree to the <a href="https://hazwoper-osha.com/refund-policy">refund policy</a>.</p>
        </section>
      </div>

      <aside class="co-summary" aria-labelledby="summaryTitle">
        <h2 id="summaryTitle">Order summary</h2>
        <div class="co-line">
          <div>
            <span id="sumName" class="co-line-name">{esc(name)}</span>
            <span class="co-line-meta">Course #{lms_id}</span>
            <span id="sumQty" class="co-line-meta">1 seat &times; {p}</span>
          </div>
          <span id="sumAmount">{p}</span>
        </div>
        <hr class="co-divider">
        <div class="co-sum-row"><span>Subtotal</span><span id="sumSubtotal">{p}</span></div>
        <div id="sumDiscountRow" class="co-sum-row co-sum-discount" hidden><span id="sumDiscountLabel">Volume discount</span><span id="sumDiscount">-$0.00</span></div>
        <div class="co-sum-row co-sum-total" aria-live="polite"><span>Total</span><span id="sumTotal">{p}</span></div>
        <div class="co-callout">{SHIELD_SVG}<p>Each learner gets their own login and a certificate of completion. Team managers can track progress from the dashboard.</p></div>
        <ol class="co-steps">
          <li>Pay by card on this page.</li>
          <li>Get your receipt and login by email.</li>
          <li>Start the course online, any time.</li>
        </ol>
      </aside>
    </form>
  </main>

  <footer class="co-foot">
    <div class="co-foot-inner">
      <p>&copy; 2026 <a href="https://hazwoper-osha.com/">HAZWOPER OSHA Training</a> &middot; <a href="tel:+18664296742">1&#8209;866&#8209;429&#8209;6742</a> &middot; <a href="mailto:info@hazwoper-osha.com">info@hazwoper-osha.com</a></p>
      <p><a href="https://hazwoper-osha.com/privacy-policy">Privacy policy</a> &middot; <a href="https://hazwoper-osha.com/refund-policy">Refund policy</a></p>
    </div>
  </footer>
</body>
</html>
"""


def relink_index(text, site, c):
    url = c["url"]
    checkout = f"https://{site}.{ROOT_DOMAIN}/checkout"
    text = text.replace(f'href="{url}"', 'href="/checkout"')
    text = re.sub(r'("offers"\s*:\s*\{[^{}]*?"url"\s*:\s*")' + re.escape(url) + '"',
                  lambda m: m.group(1) + checkout + '"', text)
    return text


def relink_llms(text, site, c):
    checkout = f"https://{site}.{ROOT_DOMAIN}/checkout"
    return text.replace(f"- Enroll: {c['url']}\n",
                        f"- Enroll (secure card checkout): {checkout}\n- Course page on hazwoper-osha.com: {c['url']}\n")


def main(argv):
    check = "--check" in argv
    courses = json.loads(COURSES.read_text())
    stale, problems = [], []

    def put(path, content):
        old = path.read_text() if path.exists() else None
        if old == content:
            return
        stale.append(str(path.relative_to(ROOT)))
        if not check:
            path.write_text(content)

    for d in sorted(SITES.iterdir()):
        site = d.name
        if not d.is_dir() or site in NOT_SITES or not LABEL.match(site) or not (d / "index.html").exists():
            continue
        c = courses.get(site)
        if not c:
            problems.append(f"sites/{site}: no course in data/courses.json (run scripts/sync-courses.py --write)")
            continue
        put(d / "checkout.html", checkout_page(site, c))
        put(d / "_headers", HEADERS)
        index = (d / "index.html").read_text()
        new_index = relink_index(index, site, c)
        if c["url"] in new_index.replace(f'"url": "{c["url"]}"', ""):
            problems.append(f"sites/{site}/index.html: still links to {c['url']} outside Course.url")
        put(d / "index.html", new_index)
        llms = d / "llms.txt"
        if llms.exists():
            put(llms, relink_llms(llms.read_text(), site, c))

    for s in stale:
        print(("out of date: " if check else "wrote ") + s)
    for p in problems:
        print("PROBLEM", p, file=sys.stderr)
    if problems or (check and stale):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
