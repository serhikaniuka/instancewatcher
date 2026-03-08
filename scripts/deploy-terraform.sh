#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/build"

# Build Lambda packages so Terraform can hash them at plan time
echo "Building Lambda packages..."
mkdir -p "$BUILD_DIR"
API_PKG="$BUILD_DIR/api_pkg"
rm -rf "$API_PKG"
mkdir -p "$API_PKG"
pip install -q -t "$API_PKG" -r "$PROJECT_ROOT/lambdas/requirements.txt"
cp "$PROJECT_ROOT/lambdas/api/app.py" "$API_PKG/"
(cd "$API_PKG" && zip -q -r "$BUILD_DIR/api.zip" .)
rm -rf "$API_PKG"
(cd "$PROJECT_ROOT/lambdas/scheduler" && zip -q -o "$BUILD_DIR/scheduler.zip" app.py)
echo "Build done."

cd "$PROJECT_ROOT/terraform"
terraform init
terraform plan -out tfplan

read -r -p "Apply this plan? [y/N] " response
if [[ "$response" =~ ^[yY]$ ]]; then
  terraform apply tfplan
  rm -f tfplan
  echo ""
  echo "API base URL: $(terraform output -raw api_base_url)"
  echo "Frontend URL: $(terraform output -raw frontend_url)"
  DIST_ID="$(terraform output -raw cloudfront_distribution_id 2>/dev/null)" || true
  if [[ -n "$DIST_ID" ]] && command -v aws &>/dev/null; then
    echo "Invalidating CloudFront cache..."
    aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" --output text --query 'Invalidation.Id' 2>/dev/null || true
  fi
else
  echo "Apply cancelled. Plan saved in terraform/tfplan; run 'terraform apply tfplan' to apply later."
fi
