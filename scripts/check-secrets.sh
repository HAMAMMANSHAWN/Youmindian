#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v rg >/dev/null 2>&1; then
  echo "ripgrep (rg) is required for secret scanning."
  exit 1
fi

PATTERN='ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]+|sk-ym-[A-Za-z0-9]{10,}|AIza[0-9A-Za-z\-_]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]+PRIVATE KEY|_authToken|NPM_TOKEN|client_secret|password=|x-api-key:[[:space:]]*[A-Za-z0-9_\-]{10,}|Authorization:[[:space:]]*Bearer[[:space:]]+[A-Za-z0-9._\-]+'

echo "Scanning tracked files for likely secrets..."

if git grep -n -I -E "$PATTERN" -- . ':(exclude)package-lock.json' ':(exclude)scripts/check-secrets.sh'; then
  echo
  echo "Potential sensitive content found. Remove or redact it before commit/push."
  exit 1
fi

echo "No likely secrets found in tracked files."
