#!/usr/bin/env bash
#
# Compute Android network_security_config pin values (SHA-256 of the
# SubjectPublicKeyInfo) for every cert in the TLS chain of a given host.
#
# Usage:  scripts/compute-cert-pins.sh api.diyhelper.org [port]
# Output: one line per chain depth with the base64 pin digest, suitable for
#   pasting into <pin digest="SHA-256">…</pin> inside network_security_config.
#
# Rotation procedure:
#   1. Run this before every release; note the current leaf + intermediate pins.
#   2. Replace the <pin> values in res/xml/network_security_config.xml.
#   3. Keep two pins in the <pin-set> at all times — the primary (current
#      cert) and a backup (next intermediate in the chain). Rotating the
#      backup forward at every release prevents a single cert rotation from
#      stranding existing installs with a broken TLS handshake.
#
set -euo pipefail

HOST="${1:-api.diyhelper.org}"
PORT="${2:-443}"

command -v openssl >/dev/null || { echo "openssl not found"; exit 2; }

echo "Chain for ${HOST}:${PORT} (depth 0 = leaf)"
echo "------------------------------------------"

echo | openssl s_client -servername "$HOST" -connect "${HOST}:${PORT}" -showcerts 2>/dev/null \
  | awk '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/' \
  | awk 'BEGIN { depth=0; buf="" }
         /-----BEGIN CERTIFICATE-----/ { buf=""; }
         { buf = buf $0 "\n" }
         /-----END CERTIFICATE-----/ {
           cmd = "echo \""buf"\" | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64"
           cmd | getline pin; close(cmd)
           printf("depth=%d  pin-sha256=%s\n", depth, pin)
           depth++
         }'
