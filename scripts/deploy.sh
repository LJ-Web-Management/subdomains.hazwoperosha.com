#!/usr/bin/env bash
# Deploy every folder in sites/ to <folder>.hazwoperosha.com. All sites are
# served by one Cloudflare Worker (worker/index.js, configured in wrangler.json):
#
#   1. checks each site's DNS name, and skips any name that already has a DNS
#      record this repo didn't create (www, mail, ...),
#   2. deploys the Worker with every site's files and one route per site,
#   3. makes sure each site has a proxied DNS record: AAAA 100::, the usual
#      placeholder for a hostname that only a Worker answers. Records left by
#      the old one-Pages-project-per-site setup are replaced.
#
# Usage: scripts/deploy.sh
#
# Required env:
#   CLOUDFLARE_API_TOKEN   token with: Account > Workers Scripts > Edit,
#                          Zone > Workers Routes > Edit, Zone > DNS > Edit,
#                          Zone > Zone > Read
#   CLOUDFLARE_ACCOUNT_ID  Cloudflare account ID
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is not set}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is not set}"

ROOT_DOMAIN="hazwoperosha.com"           # must match ROOT_DOMAIN in worker/index.js
MARK="managed by subdomains repo"        # comment on DNS records this repo creates
OLD_PROJECT_PREFIX="sub-"                # Pages projects of the old setup
API="${CF_API:-https://api.cloudflare.com/client/v4}"
read -ra WRANGLER <<<"${WRANGLER:-npx --yes wrangler@4}"

problems=()

cf() { # cf METHOD PATH [JSON] -> JSON body (a failure is reported as success:false)
  local method="$1" path="$2" data="${3:-}" resp
  local args=(-sS -X "$method" "$API$path"
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
    -H "Content-Type: application/json")
  [[ -n "$data" ]] && args+=(--data "$data")
  resp="$(curl "${args[@]}" 2>&1)" || true
  jq -e 'type == "object"' >/dev/null 2>&1 <<<"$resp" \
    || resp="$(jq -nc --arg m "${resp:0:300}" '{success:false, errors:[{message:("bad response: " + $m)}]}')"
  printf '%s' "$resp"
}
ok()   { [[ "$(jq -r .success <<<"$1")" == "true" ]]; }
errs() { jq -c '.errors' <<<"$1"; }
fail() { echo "::error::$*" >&2; exit 1; }

# --- 1. sites --------------------------------------------------------------
sites=()
for dir in sites/*/; do
  name="$(basename "$dir")"
  if [[ ! "$name" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || (( ${#name} > 63 )); then
    problems+=("sites/$name: the folder name is not a valid subdomain (lowercase letters, digits and hyphens, not starting or ending with a hyphen, at most 63 characters); skipped")
  elif [[ ! -f "$dir/index.html" ]]; then
    problems+=("sites/$name: has no index.html; skipped")
  else
    sites+=("$name")
  fi
done

# --- 2. DNS check ----------------------------------------------------------
resp="$(cf GET "/zones?name=$ROOT_DOMAIN")"
ZONE_ID="$(jq -r '.result[0].id // empty' <<<"$resp")"
[[ -n "$ZONE_ID" ]] || fail "zone $ROOT_DOMAIN not found (is its DNS on Cloudflare, and can the token read it?) $(errs "$resp")"

records='[]'
page=1
while :; do
  resp="$(cf GET "/zones/$ZONE_ID/dns_records?per_page=100&page=$page")"
  ok "$resp" || fail "could not list DNS records: $(errs "$resp")"
  records="$(jq -c --argjson acc "$records" '$acc + .result' <<<"$resp")"
  (( page < $(jq '.result_info.total_pages // 1' <<<"$resp") )) || break
  page=$((page + 1))
done

routed=()   # sites the Worker will answer
create=()   # sites that need a DNS record
replace=()  # sites whose old records (ours) are swapped for the Worker record
for name in "${sites[@]}"; do
  fqdn="$name.$ROOT_DOMAIN"
  status="$(jq -r --arg f "$fqdn" --arg m "$MARK" --arg old "$OLD_PROJECT_PREFIX$name.pages.dev" '
    [.[] | select(.name == $f)] as $r
    | if ($r | length) == 0 then "create"
      elif any($r[]; (.comment == $m or (.type == "CNAME" and .content == $old)) | not)
        then "conflict " + ([$r[] | "\(.type) \(.content)"] | join(", "))
      elif ($r | length) == 1 and $r[0].type == "AAAA" and $r[0].content == "100::" and $r[0].proxied
        then "ok"
      else "replace" end' <<<"$records")"
  case "$status" in
    ok)      routed+=("$name") ;;
    create)  routed+=("$name"); create+=("$name") ;;
    replace) routed+=("$name"); replace+=("$name") ;;
    *) problems+=("$fqdn already has a DNS record that this repo didn't create (${status#conflict }); rename the folder or remove that record. Skipped.") ;;
  esac
done

(( ${#routed[@]} )) || fail "no sites to deploy. ${problems[*]:-}"

# --- 3. Worker -------------------------------------------------------------
routes="$(printf '%s\n' "${routed[@]}" | jq -Rnc --arg z "$ROOT_DOMAIN" \
  '[inputs | select(length > 0) | {pattern: "\(.).\($z)/*", zone_name: $z}]')"
config=".wrangler.deploy.json"
trap 'rm -f "$config"' EXIT
jq --argjson routes "$routes" '.routes = $routes' wrangler.json > "$config"

echo "Deploying ${#routed[@]} sites to the Worker $(jq -r .name wrangler.json)"
"${WRANGLER[@]}" deploy --config "$config"

# --- 4. DNS records --------------------------------------------------------
dns_failed=()
add_record() { # add_record NAME
  local fqdn="$1.$ROOT_DOMAIN" resp
  resp="$(cf POST "/zones/$ZONE_ID/dns_records" "$(jq -nc --arg n "$fqdn" --arg m "$MARK" \
    '{type:"AAAA", name:$n, content:"100::", proxied:true, ttl:1, comment:$m}')")"
  if ok "$resp"; then
    echo "DNS: $fqdn -> Worker"
  else
    problems+=("$fqdn: creating the DNS record failed: $(errs "$resp")")
    dns_failed+=("$1")
  fi
}

for name in "${replace[@]}"; do
  fqdn="$name.$ROOT_DOMAIN"
  removed=1
  for id in $(jq -r --arg f "$fqdn" '.[] | select(.name == $f) | .id' <<<"$records"); do
    resp="$(cf DELETE "/zones/$ZONE_ID/dns_records/$id")"
    ok "$resp" || { removed=0; problems+=("$fqdn: removing the old DNS record failed: $(errs "$resp")"); }
  done
  if (( removed )); then add_record "$name"; else dns_failed+=("$name"); fi
done
for name in "${create[@]}"; do add_record "$name"; done

# --- 5. summary ------------------------------------------------------------
echo
echo "Sites served by the Worker:"
for name in "${routed[@]}"; do
  [[ " ${dns_failed[*]} " == *" $name "* ]] || echo "  https://$name.$ROOT_DOMAIN"
done
if (( ${#problems[@]} )); then
  for p in "${problems[@]}"; do echo "::error::$p"; done
  exit 1
fi
