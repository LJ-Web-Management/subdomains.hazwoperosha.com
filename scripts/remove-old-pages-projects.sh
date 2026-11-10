#!/usr/bin/env bash
# Delete the Cloudflare Pages projects (sub-<folder>) left over from the old
# one-project-per-site setup, now that one Worker serves every site.
#
# Only projects named sub-<folder> for a folder in sites/ are touched, and a
# project is kept while its site's DNS record still points at it (run
# scripts/deploy.sh first; it moves the DNS records to the Worker).
#
# Usage: scripts/remove-old-pages-projects.sh
#
# Required env:
#   CLOUDFLARE_API_TOKEN   token with: Account > Cloudflare Pages > Edit,
#                          Zone > DNS > Read (or Edit), Zone > Zone > Read
#   CLOUDFLARE_ACCOUNT_ID  Cloudflare account ID
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is not set}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is not set}"

ROOT_DOMAIN="hazwoperosha.com"
PREFIX="sub-"
PAGES_PROJECT_NOT_FOUND=8000007
API="${CF_API:-https://api.cloudflare.com/client/v4}"
ACC="$CLOUDFLARE_ACCOUNT_ID"

cf() { # cf METHOD PATH -> JSON body (a failure is reported as success:false)
  local resp
  resp="$(curl -sS -X "$1" "$API$2" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" 2>&1)" || true
  jq -e 'type == "object"' >/dev/null 2>&1 <<<"$resp" \
    || resp="$(jq -nc --arg m "${resp:0:300}" '{success:false, errors:[{message:("bad response: " + $m)}]}')"
  printf '%s' "$resp"
}
ok()   { [[ "$(jq -r .success <<<"$1")" == "true" ]]; }
errs() { jq -c '.errors' <<<"$1"; }

resp="$(cf GET "/zones?name=$ROOT_DOMAIN")"
ZONE_ID="$(jq -r '.result[0].id // empty' <<<"$resp")"
[[ -n "$ZONE_ID" ]] || { echo "::error::zone $ROOT_DOMAIN not found: $(errs "$resp")"; exit 1; }

deleted=0 kept=0 problems=0
for dir in sites/*/; do
  name="$(basename "$dir")"
  project="$PREFIX$name"

  resp="$(cf GET "/accounts/$ACC/pages/projects/$project")"
  if ! ok "$resp"; then
    [[ "$(jq -r '.errors[0].code // empty' <<<"$resp")" == "$PAGES_PROJECT_NOT_FOUND" ]] && continue
    echo "::error::[$project] could not look up the project: $(errs "$resp")"; problems=$((problems + 1)); continue
  fi

  resp="$(cf GET "/zones/$ZONE_ID/dns_records?name=$name.$ROOT_DOMAIN")"
  if ! ok "$resp"; then
    echo "::error::[$project] could not read DNS for $name.$ROOT_DOMAIN: $(errs "$resp")"; problems=$((problems + 1)); continue
  fi
  if jq -e --arg t "$project.pages.dev" 'any(.result[]; .content == $t)' >/dev/null <<<"$resp"; then
    echo "[$project] kept: $name.$ROOT_DOMAIN still points at it (run the deploy first)"
    kept=$((kept + 1)); continue
  fi

  # Detach custom domains first, then delete the project.
  for domain in $(cf GET "/accounts/$ACC/pages/projects/$project/domains" | jq -r '.result[]?.name'); do
    cf DELETE "/accounts/$ACC/pages/projects/$project/domains/$domain" >/dev/null
  done
  resp="$(cf DELETE "/accounts/$ACC/pages/projects/$project")"
  if ok "$resp"; then
    echo "[$project] deleted"; deleted=$((deleted + 1))
  else
    echo "::error::[$project] delete failed: $(errs "$resp")"; problems=$((problems + 1))
  fi
done

echo "Deleted $deleted, kept $kept, problems $problems."
(( problems == 0 ))
