#!/usr/bin/env bash
# Runs `npm audit signatures`, trying up to 3 times.
#
# Why retry: the npm registry now and then answers a CI runner with incomplete attestation
# data for a package, and npm reports "has attestations but no corresponding public key(s)
# can be found". In November 2026 that failed about one CI run in six, always on a package
# that verified fine a minute later.
#
# Why retrying is safe: a pass still means npm verified every registry signature and every
# attestation for the installed packages. Trying again can't turn a bad package into a pass.
#
# After each failed try this prints what the registry returns for the package npm named, so
# the log shows whether the registry or the package is at fault.
set -u

tries=3
wait_seconds="${AUDIT_SIGNATURES_WAIT:-20}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for attempt in $(seq 1 "$tries"); do
  if npm audit signatures > "$tmp/out.log" 2>&1; then
    cat "$tmp/out.log"
    exit 0
  fi
  cat "$tmp/out.log"
  echo "audit-signatures: try $attempt of $tries failed"

  # npm names the package as name@version. Only that shape is put into the URL below
  # (a scoped name's slash is sent as %2f, the way the registry expects it).
  pkg="$(grep -oE '(@[a-z0-9._-]+/)?[a-z0-9._-]+@[0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.+-]* has attestations' "$tmp/out.log" | head -n 1 | sed 's/ has attestations$//')"
  if [ -n "$pkg" ]; then
    echo "audit-signatures: what the registry returns for $pkg right now:"
    if curl -sS --max-time 20 -D "$tmp/headers" -o "$tmp/attestations.json" "https://registry.npmjs.org/-/npm/v1/attestations/${pkg/\//%2f}"; then
      grep -iE '^(HTTP/|date:|age:|etag:|last-modified:|cf-ray:|cf-cache-status:|x-served-by:)' "$tmp/headers" | tr -d '\r' | sed 's/^/  /'
      node -e '
        const { attestations = [] } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        console.log(`  ${attestations.length} attestation(s)`);
        for (const a of attestations) {
          console.log(`  - ${a.predicateType}  signed with key: ${a.bundle?.dsseEnvelope?.signatures?.[0]?.keyid || "(none: keyless)"}`);
        }
      ' "$tmp/attestations.json" || echo "  (the response was not the JSON this script expects)"
    else
      echo "  (could not reach the registry)"
    fi
  fi

  if [ "$attempt" -lt "$tries" ]; then
    echo "audit-signatures: waiting ${wait_seconds}s before trying again"
    sleep "$wait_seconds"
  fi
done

echo "audit-signatures: failed $tries times in a row. This is not the usual one-off registry hiccup: read the output above before re-running."
exit 1
