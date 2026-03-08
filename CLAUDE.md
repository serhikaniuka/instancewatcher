# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

**EC2 Instance Watcher** — time-boxes EC2 start/stop with Google sign-in. A user signs in with Google, selects 1/2/3 hours, and the backend starts the instance and automatically stops it after the chosen duration (mapped to 50/110/170 effective minutes). Auth is restricted to a single allowed email address.

## Deployment

Two independent deploy paths exist — **SAM** and **Terraform**. Both produce the same resources; choose one.

### Terraform (recommended, includes frontend hosting)
```bash
# 1. Configure variables
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# Edit: project_name, allowed_email, google_client_id, frontend_bucket_name, frontend_domain, domain_zone

# 2. Build Lambda ZIPs + run terraform plan/apply interactively
./scripts/deploy-terraform.sh
```
The script builds `build/api.zip` and `build/scheduler.zip`, runs `terraform init`, `terraform plan`, prompts for confirmation, applies, then invalidates the CloudFront cache.

Manual build only (without running Terraform):
```bash
mkdir -p build
pip install -t build/api_pkg -r lambdas/requirements.txt
cp lambdas/api/app.py build/api_pkg/
(cd build/api_pkg && zip -r ../api.zip .)
(cd lambdas/scheduler && zip -o ../../build/scheduler.zip app.py)
```

### SAM
```bash
# Uses ALLOWED_EMAIL and GOOGLE_CLIENT_ID env vars or defaults in template.yaml
./scripts/deploy.sh

# Or manually
sam build
sam deploy --no-confirm-changeset --capabilities CAPABILITY_IAM \
  --parameter-overrides AllowedEmail=your@email.com GoogleClientId=xxx.apps.googleusercontent.com
```

## Architecture

```
frontend/ (static HTML/JS/CSS)
    ↓ Google ID token in Authorization header
lambdas/api/app.py  (Lambda: instancewatcher-api)
    ↓ boto3
  EC2 (start/stop/describe) + DynamoDB (state + action tables)

lambdas/scheduler/app.py  (Lambda: instancewatcher-scheduler)
    → triggered every 5 min via EventBridge
    → scans instanceec2_state, stops overdue instances, deletes rows
```

**Lambda runtime:** Python 3.12. Only the API Lambda needs the `google-auth` pip dependency (`lambdas/requirements.txt`). The scheduler has no external deps and is zipped as a single file.

**Terraform** provisions: DynamoDB tables, IAM roles, Lambda functions, API Gateway v2 (HTTP API), EventBridge schedule, S3 bucket, CloudFront distribution with custom domain (Route53 + ACM in us-east-1).

**SAM** (`template.yaml`) provisions the same minus frontend hosting (no S3/CloudFront/Route53).

## Key Files

| Path | Purpose |
|---|---|
| `lambdas/api/app.py` | API Lambda — auth, `/health`, `/instances`, `/instances/{id}/start`, `/instances/{id}/set-duration` |
| `lambdas/scheduler/app.py` | Scheduler Lambda — auto-stop loop |
| `lambdas/requirements.txt` | Only `google-auth>=2.0.0` (API Lambda only) |
| `terraform/main.tf` | All AWS infrastructure |
| `terraform/variables.tf` | Terraform input variables |
| `terraform/terraform.tfvars.example` | Template for local vars (copy to `terraform.tfvars`) |
| `template.yaml` | SAM template (alternative to Terraform) |
| `scripts/deploy-terraform.sh` | Build + Terraform deploy script |
| `scripts/deploy.sh` | SAM deploy script |
| `frontend/` | Static frontend (vanilla JS, no framework) |

## DynamoDB Tables

- **instanceec2_state** — keyed by `instance_id`; stores `started_at`, `stop_at`, `updated_at` (epoch seconds). Row exists only while instance is being time-watched.
- **instanceec2_action** — audit log; keyed by `action_id` (UUID); `action_type` is `start_or_reset`, `set_duration`, or `auto_stop`.

## Auth Model

Google ID tokens are verified in the API Lambda using `google.oauth2.id_token.verify_oauth2_token`. If `GOOGLE_CLIENT_ID` is set, audience is validated. `ALLOWED_EMAIL` restricts access to one email. The `/health` endpoint is unauthenticated.

## Hours-to-Minutes Mapping

| hours param | effective minutes |
|---|---|
| 1 | 50 |
| 2 | 110 |
| 3 | 170 |

This mapping is defined in `HOURS_TO_MINUTES` in `lambdas/api/app.py:27`.
