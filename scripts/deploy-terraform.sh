#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/build"

# Build Lambda packages so Terraform can hash them at plan time
echo "Building Lambda packages..."
mkdir -p "$BUILD_DIR"
API_PKG="$BUILD_DIR/api_pkg"

# Use Docker (SAM build image) for correct Lambda Python 3.12 compatibility
if command -v docker &>/dev/null; then
  echo "Using Docker (SAM Python 3.12 image) for API build..."
  docker run --rm \
    -v "$PROJECT_ROOT:/var/task:ro" \
    -v "$BUILD_DIR:/var/output" \
    public.ecr.aws/sam/build-python3.12:latest \
    bash -c 'pip install -q -r /var/task/lambdas/requirements.txt -t /tmp/api_pkg && cp /var/task/lambdas/api/app.py /tmp/api_pkg/ && find /tmp/api_pkg -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true && (cd /tmp/api_pkg && zip -q -r /var/output/api.zip .)'
else
  echo "Docker not found, using pip with --platform (may have compatibility issues)..."
  rm -rf "$API_PKG"
  mkdir -p "$API_PKG"
  pip install -q --platform manylinux2014_x86_64 --implementation cp --python-version 3.12 -t "$API_PKG" -r "$PROJECT_ROOT/lambdas/requirements.txt" --only-binary=:all:
  cp "$PROJECT_ROOT/lambdas/api/app.py" "$API_PKG/"
  find "$API_PKG" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
  (cd "$API_PKG" && zip -q -r "$BUILD_DIR/api.zip" .)
  rm -rf "$API_PKG"
fi
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
