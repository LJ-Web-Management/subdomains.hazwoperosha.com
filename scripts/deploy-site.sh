#!/usr/bin/env bash
# Deploy one folder under sites/ to Cloudflare Pages as <folder>.<ROOT_DOMAIN>.
#
# Usage: scripts/deploy-site.sh <folder-name>
#
# Required env:
#   CLOUDFLARE_API_TOKEN   token with: Account > Cloudflare Pages > Edit,
#                          Zone > DNS > Edit, Zone > Zone > Read
#   CLOUDFLARE_ACCOUNT_ID  Cloudflare account ID
# Optional env:
#   ROOT_DOMAIN            default: hazwoperosha.com
#   PROJECT_PREFIX         default: sub-   (Pages project = <prefix><folder>)
#   SITES_DIR              default: sites
set -euo pipefail

NAME="${1:?usage: deploy-site.sh <folder-name>}"
ROOT_DOMAIN="${ROOT_DOMAIN:-hazwoperosha.com}"
PROJECT_PREFIX="${PROJECT_PREFIX:-sub-}"
SITES_DIR="${SITES_DIR:-sites}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is not set}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is not set}"

API="https://api.cloudflare.com/client/v4"
ACC="$CLOUDFLARE_ACCOUNT_ID"
DIR="$SITES_DIR/$NAME"
SUBDOMAIN="$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]')"
DOMAIN="$SUBDOMAIN.$ROOT_DOMAIN"
PROJECT="$PROJECT_PREFIX$SUBDOMAIN"

log()  { echo "[$NAME] $*"; }
fail() { echo "::error::[$NAME] $*" >&2; exit 1; }

cf() { # cf METHOD PATH [JSON]
  local method="$1" path="$2" data="${3:-}"
  local args=(-sS -X "$method" "$API$path"
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
    -H "Content-Type: application/json")
  [[ -n "$data" ]] && args+=(--data "$data")
  curl "${args[@]}"
}

# --- validate -------------------------------------------------------------
[[ -d "$DIR" ]] || fail "folder $DIR does not exist"
[[ "$SUBDOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] \
  || fail "folder name must be a valid subdomain: letters, digits and hyphens, not starting/ending with a hyphen"
(( ${#PROJECT} <= 58 )) || fail "name too long (Pages project '$PROJECT' exceeds 58 chars)"
[[ -n "$(find "$DIR" -type f -not -name '.*' -print -quit)" ]] || fail "$DIR has no files to deploy"

# --- 1. Pages project -----------------------------------------------------
if [[ "$(cf GET "/accounts/$ACC/pages/projects/$PROJECT" | jq -r .success)" != "true" ]]; then
  log "creating Pages project $PROJECT"
  resp="$(cf POST "/accounts/$ACC/pages/projects" \
    "$(jq -nc --arg n "$PROJECT" '{name:$n, production_branch:"main"}')")"
  [[ "$(jq -r .success <<<"$resp")" == "true" ]] || fail "project create failed: $(jq -c .errors <<<"$resp")"
fi

# --- 2. Upload files ------------------------------------------------------
log "deploying $DIR to $PROJECT"
npx --yes wrangler@4 pages deploy "$DIR" \
  --project-name "$PROJECT" --branch main --commit-dirty=true

# --- 3. Custom domain on the project -------------------------------------
if [[ "$(cf GET "/accounts/$ACC/pages/projects/$PROJECT/domains/$DOMAIN" | jq -r .success)" != "true" ]]; then
  log "attaching custom domain $DOMAIN"
  resp="$(cf POST "/accounts/$ACC/pages/projects/$PROJECT/domains" \
    "$(jq -nc --arg n "$DOMAIN" '{name:$n}')")"
  [[ "$(jq -r .success <<<"$resp")" == "true" ]] || fail "domain attach failed: $(jq -c .errors <<<"$resp")"
fi

# --- 4. DNS record --------------------------------------------------------
ZONE_ID="$(cf GET "/zones?name=$ROOT_DOMAIN" | jq -r '.result[0].id // empty')"
[[ -n "$ZONE_ID" ]] || fail "zone $ROOT_DOMAIN not found (is its DNS on Cloudflare, and can the token read it?)"

TARGET="$PROJECT.pages.dev"
existing="$(cf GET "/zones/$ZONE_ID/dns_records?name=$DOMAIN")"
count="$(jq '.result | length' <<<"$existing")"
if [[ "$count" == "0" ]]; then
  log "creating DNS CNAME $DOMAIN -> $TARGET"
  resp="$(cf POST "/zones/$ZONE_ID/dns_records" \
    "$(jq -nc --arg n "$DOMAIN" --arg c "$TARGET" \
      '{type:"CNAME", name:$n, content:$c, proxied:true, comment:"managed by subdomains repo"}')")"
  [[ "$(jq -r .success <<<"$resp")" == "true" ]] || fail "DNS create failed: $(jq -c .errors <<<"$resp")"
else
  current="$(jq -r '.result[0] | "\(.type) \(.content)"' <<<"$existing")"
  # Never overwrite a record this repo didn't create (protects www, mail, etc.)
  [[ "$current" == "CNAME $TARGET" ]] \
    || fail "$DOMAIN already has a DNS record ($current) that is not this site; rename the folder or remove that record"
fi

log "done: https://$DOMAIN"
