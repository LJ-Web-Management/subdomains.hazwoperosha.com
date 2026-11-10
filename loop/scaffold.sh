#!/usr/bin/env bash
# Write robots.txt, sitemap.xml and _headers for sites/<subdomain>.
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
cat > "$DIR/_headers" <<'EOF'
/*
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
EOF
echo "scaffolded $DIR"
