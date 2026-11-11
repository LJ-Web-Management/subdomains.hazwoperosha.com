#!/usr/bin/env bash
# Write robots.txt and sitemap.xml for sites/<subdomain>. _headers and
# checkout.html come from scripts/build-checkout.py once index.html exists.
# Usage: loop/scaffold.sh <subdomain>
set -euo pipefail
S="${1:?usage: scaffold.sh <subdomain>}"
DIR="sites/$S"
D="https://$S.hazwoperosha.com"
TODAY="$(date -u +%F)"
mkdir -p "$DIR"
{
  echo "User-agent: *"; echo "Allow: /"
  for b in GPTBot ClaudeBot PerplexityBot Google-Extended CCBot; do
    echo; echo "User-agent: $b"; echo "Allow: /"
  done
  echo; echo "Sitemap: $D/sitemap.xml"
} > "$DIR/robots.txt"
cat > "$DIR/sitemap.xml" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>$D/</loc>
    <lastmod>$TODAY</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
EOF
echo "scaffolded $DIR"
