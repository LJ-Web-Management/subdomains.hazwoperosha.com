#!/usr/bin/env bash
# Write sites/hub/, served at https://hub.hazwoperosha.com: the sitemaps of
# every hazwoperosha.com site. scripts/deploy.sh runs this before each deploy,
# so it always lists the sites being deployed. The folder is generated and
# git-ignored; don't edit it by hand.
#
#   sitemap.xml  a sitemap index of every site's own sitemap.xml. Submit
#                https://hub.hazwoperosha.com/sitemap.xml in Google Search
#                Console (and Bing Webmaster Tools) under the Domain property
#                for hazwoperosha.com, which may list sitemaps on every
#                subdomain.
#   index.html   the same list as a page: each site with its sitemap.
#   robots.txt   points crawlers at the sitemap index.
#
# The hazwoperosha.us sites have their own hub, with the same index at
# https://hub.hazwoperosha.us/sitemap.xml and the page at /sitemaps/
# (tools/hub.mjs in LJ-Web-Management/subdomains.hazwoperosha.us).
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."

DOMAIN="hazwoperosha.com"
HUB="https://hub.$DOMAIN"
OUT="sites/hub"
LABEL='^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'

sites=()   # every site (a folder with index.html; not hub or _shared)
mapped=()  # the sites that have a sitemap.xml
for dir in sites/*/; do
  name="$(basename "$dir")"
  [[ "$name" != hub && "$name" =~ $LABEL && -f "$dir/index.html" ]] || continue
  sites+=("$name")
  if [[ -f "$dir/sitemap.xml" ]]; then mapped+=("$name"); fi
done

# The newest <lastmod> in a site's sitemap, so search engines know which changed.
lastmod() {
  grep -o '<lastmod>[^<]*</lastmod>' "sites/$1/sitemap.xml" | sed 's/<[^>]*>//g' | sort | tail -n 1 || true
}

mkdir -p "$OUT"

{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  for name in "${mapped[@]}"; do
    mod="$(lastmod "$name")"
    echo "  <sitemap><loc>https://$name.$DOMAIN/sitemap.xml</loc>${mod:+<lastmod>$mod</lastmod>}</sitemap>"
  done
  echo '</sitemapindex>'
} >"$OUT/sitemap.xml"

printf 'User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n' "$HUB" >"$OUT/robots.txt"

{
  cat <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<title>$DOMAIN sitemaps</title>
<link rel="canonical" href="$HUB/">
<link rel="stylesheet" href="/hub.css">
</head>
<body>
<main>
<h1>$DOMAIN sitemaps</h1>
<p>Every $DOMAIN site and its sitemap: ${#mapped[@]} of ${#sites[@]} sites have one.
The sitemap index <a href="/sitemap.xml">$HUB/sitemap.xml</a> lists them all;
submit it in Google Search Console under the Domain property for $DOMAIN.</p>
<p>The hazwoperosha.us sites are on <a href="https://hub.hazwoperosha.us/sitemaps/">hub.hazwoperosha.us/sitemaps/</a>.</p>
<table>
<thead><tr><th scope="col">Site</th><th scope="col">Sitemap</th><th scope="col">Last updated</th></tr></thead>
<tbody>
EOF
  for name in "${sites[@]}"; do
    if [[ -f "sites/$name/sitemap.xml" ]]; then
      cell="<a href=\"https://$name.$DOMAIN/sitemap.xml\">sitemap.xml</a>"
      mod="$(lastmod "$name")"
    else
      cell="none"
      mod=""
    fi
    echo "<tr><td><a href=\"https://$name.$DOMAIN/\">$name.$DOMAIN</a></td><td>$cell</td><td>${mod:-&ndash;}</td></tr>"
  done
  cat <<'EOF'
</tbody>
</table>
</main>
</body>
</html>
EOF
} >"$OUT/index.html"

cat >"$OUT/hub.css" <<'EOF'
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #171717; background: #fafafa; }
main { max-width: 960px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 26px; margin: 0 0 8px; }
p { line-height: 1.5; margin: 0 0 12px; }
table { width: 100%; border-collapse: collapse; background: #fff; font-size: 14px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e5e5; }
th { background: #f4f4f5; }
td:first-child { overflow-wrap: anywhere; }
td:last-child, th:last-child { white-space: nowrap; }
a { color: #1d4ed8; }
EOF

cat >"$OUT/_headers" <<'EOF'
/*
  Content-Security-Policy: default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Strict-Transport-Security: max-age=31536000; includeSubDomains
EOF

echo "hub: ${#mapped[@]} of ${#sites[@]} $DOMAIN sites in the sitemap index"
