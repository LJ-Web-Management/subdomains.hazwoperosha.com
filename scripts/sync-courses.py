"""Check every site's course against its live hazwoper-osha.com page.

Usage:
  python3 -I scripts/sync-courses.py           # check data/courses.json, exit 1 on any difference
  python3 -I scripts/sync-courses.py --write   # also write the live values to data/courses.json
  python3 -I scripts/sync-courses.py --write <site>...  # only these sites (any queue status)

For each "done" entry in loop/queue.json it fetches the course page and reads:
  lmsId  the page's own course id: "course_id" in `var cat = {...}`, which is
         also the data-id of the page's Enroll (add_to_cart) buttons. Checkout
         sends this number to the add_order API as course_id.
  price  the LMS single-seat price, from the LMS's own pricing API
         (POST /api/roi_tier_price, quantity 1). The page's Enroll buttons and
         Product JSON-LD must show the same price, or the course is reported.
  name   the Enroll buttons' data-title, and sku their data-sku.

The LMS sets the amount charged; checkout only shows `price` (and the live
seat-tier price from roi_tier_price). After --write, run
`python3 -I scripts/build-checkout.py` to regenerate the checkout files.
"""
import html
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUEUE = ROOT / "loop" / "queue.json"
OUT = ROOT / "data" / "courses.json"
UA = "Mozilla/5.0 (subdomains-course-sync)"
API = "https://hazwoper-osha.com/api"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.read().decode("utf-8", "ignore")
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"{url}: {err}")


def lms_price(lms_id):
    body = json.dumps({"course_id": lms_id, "quantity": 1}).encode()
    req = urllib.request.Request(f"{API}/roi_tier_price", data=body, method="POST",
                                 headers={"User-Agent": UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    return float(data["success"]["price"])


def parse(page):
    m = re.search(r"var cat = (\{.*?\});?\s*$", page, re.M)
    if not m:
        raise ValueError("no `var cat` block (not a course page?)")
    cat = json.loads(m.group(1))
    if cat.get("code") != "OnlineCourse" or not cat.get("course_id"):
        raise ValueError(f"not an online course page (code={cat.get('code')!r})")
    lms_id = int(cat["course_id"])
    # The page's own Enroll buttons carry its course id; related-course cards carry others.
    buttons = []
    for tag in re.findall(r"<[^>]*\badd_to_cart_button\b[^>]*>", page):
        attrs = dict(re.findall(r'\b(data-[a-z]+|class)="([^"]*)"', tag))
        if attrs.get("data-id") == str(lms_id):
            buttons.append(attrs)
    if not buttons:
        raise ValueError(f"no Enroll button with data-id={lms_id}")
    price = lms_price(lms_id)
    # The main Enroll buttons and the Product JSON-LD show the price buyers see.
    shown = {float(b["data-price"]) for b in buttons if b.get("data-price") and "action-btn" not in b.get("class", "")}
    shown |= {float(x) for x in re.findall(r'"price":\s*"([0-9.]+)"', page)}
    if shown != {price}:
        raise ValueError(f"LMS price {price} but the page shows {sorted(shown)}")
    title = next((b["data-title"] for b in buttons if b.get("data-title")), cat.get("title", ""))
    title = re.sub(r"<[^>]+>", "", html.unescape(title)).strip()
    sku = next((b["data-sku"] for b in buttons if b.get("data-sku")), "")
    return {"lmsId": lms_id, "price": price, "name": title, "sku": sku}


def main(argv):
    write = "--write" in argv
    only = [a for a in argv if not a.startswith("--")]
    queue = json.loads(QUEUE.read_text())
    current = json.loads(OUT.read_text()) if OUT.exists() else {}
    result, problems = dict(current), []
    for entry in queue:
        site = entry.get("subdomain")
        # Named sites are synced whatever their status, so the loop can sync a
        # page it is still building (subdomain set, status not yet "done").
        if not site or (only and site not in only) or (not only and entry.get("status") != "done"):
            continue
        try:
            status, page = fetch(entry["url"])
            live = parse(page)
        except Exception as e:  # noqa: BLE001
            problems.append(f"{site}: {e}")
            continue
        live = {"url": entry["url"], **live}
        old = current.get(site)
        if old != live:
            changed = sorted(k for k in live if not old or old.get(k) != live[k])
            problems.append(f"{site}: differs from data/courses.json in {', '.join(changed)}: {json.dumps(live)}")
        result[site] = live
        print(f"{site:40} LMS {live['lmsId']:>5}  ${live['price']:>8.2f}  {live['name']}")
        time.sleep(0.3)
    if write:
        OUT.parent.mkdir(exist_ok=True)
        OUT.write_text(json.dumps(dict(sorted(result.items())), indent=2) + "\n")
        print(f"wrote {OUT.relative_to(ROOT)} ({len(result)} courses)")
    for p in problems:
        print("PROBLEM", p, file=sys.stderr)
    return 1 if problems and not write else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
