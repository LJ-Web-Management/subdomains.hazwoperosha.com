#!/usr/bin/env bash
# Write sites/hub/, a plain list of every hazwoperosha.com and hazwoperosha.us
# subdomain, served at https://hub.hazwoperosha.com. scripts/deploy.sh runs
# this before each deploy, so the lists are as of the last deploy. The folder
# is generated and git-ignored; don't edit it by hand.
#
#   .com: the folders in this repo's sites/ (except hub itself)
#   .us:  the folders in sites/ of LJ-Web-Management/subdomains.hazwoperosha.us
#         (main), where every folder is a subdomain
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."

US_REPO="https://github.com/LJ-Web-Management/subdomains.hazwoperosha.us.git"
OUT="sites/hub"
LABEL='^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'

com=()
for dir in sites/*/; do
  name="$(basename "$dir")"
  if [[ "$name" != hub && "$name" =~ $LABEL && -f "$dir/index.html" ]]; then com+=("$name"); fi
done

us=()
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Folder names only: no file contents are downloaded.
if GIT_TERMINAL_PROMPT=0 git clone -q --depth 1 --branch main --filter=blob:none --no-checkout "$US_REPO" "$tmp/us" 2>"$tmp/err"; then
  while IFS= read -r path; do
    name="${path#sites/}"
    if [[ "$name" =~ $LABEL ]]; then us+=("$name"); fi
  done < <(git -C "$tmp/us" ls-tree -d --name-only HEAD sites/)
else
  echo "::warning::hub: could not read the hazwoperosha.us sites: $(tr '\n' ' ' <"$tmp/err")"
fi

items() { # items DOMAIN NAME...
  local domain="$1" name
  shift
  for name in "$@"; do echo "<li><a href=\"https://$name.$domain/\">$name.$domain</a></li>"; done
}

mkdir -p "$OUT"
{
  cat <<'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Subdomains</title>
</head>
<body>
<h1>Subdomains</h1>
EOF
  echo "<h2>hazwoperosha.com (${#com[@]})</h2>"
  echo "<ul>"
  items hazwoperosha.com "${com[@]}"
  echo "</ul>"
  echo "<h2>hazwoperosha.us (${#us[@]})</h2>"
  if (( ${#us[@]} )); then
    echo "<ul>"
    items hazwoperosha.us "${us[@]}"
    echo "</ul>"
  else
    echo "<p>The hazwoperosha.us list could not be loaded on this deploy.</p>"
  fi
  echo "</body>"
  echo "</html>"
} >"$OUT/index.html"

cat >"$OUT/_headers" <<'EOF'
/*
  Content-Security-Policy: default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Strict-Transport-Security: max-age=31536000; includeSubDomains
EOF

echo "hub: listed ${#com[@]} .com and ${#us[@]} .us subdomains"
