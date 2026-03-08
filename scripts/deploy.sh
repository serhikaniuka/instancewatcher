#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
sam build
sam deploy --no-confirm-changeset --capabilities CAPABILITY_IAM --parameter-overrides AllowedEmail="${ALLOWED_EMAIL:-serhikaniuka@gmail.com}" GoogleClientId="${GOOGLE_CLIENT_ID:-}"
