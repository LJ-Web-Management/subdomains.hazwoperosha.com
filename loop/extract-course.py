"""Print the useful facts from a hazwoper-osha.com course page.

Usage: python3 -I loop/extract-course.py <course-url>
Prints: HTTP status, page title, Course/Product JSON-LD, and the main body
text (overview, syllabus, FAQ, objectives, pricing formats) without the
site-wide navigation menu.
"""
import html
import json
import re
import sys
import urllib.request

url = sys.argv[1]
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (landing-page-builder)"})
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        status, page = r.status, r.read().decode("utf-8", "ignore")
except Exception as e:  # noqa: BLE001
    print(f"STATUS ERROR {e}")
    sys.exit(1)

print("STATUS", status)
print("TITLE", (re.findall(r"<title>(.*?)</title>", page, re.S) or [""])[0].strip())

for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S):
    try:
        data = json.loads(block)
    except ValueError:
        continue
    for node in data.get("@graph", [data]):
        if node.get("@type") in ("Course", "Product"):
            print("JSONLD", json.dumps(node)[:1500])

text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", page, flags=re.S)
text = html.unescape(re.sub(r"<[^>]+>", "\n", text))
text = re.sub(r"[ \t]+", " ", text)
text = re.sub(r"\n\s*\n+", "\n", text)

# Course facts box + main body sit between "Tailor for My Team"/"Single-Seat Price"
# and the testimonials after "Choose Your".
start = max(text.find("Single-Seat Price"), 0)
start = text.rfind("Overview", 0, start) if start else text.find("Overview\nSyllabus")
end = text.find("Chris Bauer", start)
body = text[start:end if end > 0 else start + 20000]
print("BODY")
print(body[:16000])
