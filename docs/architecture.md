# Architecture

## Overview

EC2 Instance Watcher is a serverless application that time-boxes EC2 start/stop via Google sign-in. A user authenticates, picks a duration (1/2/3 hours), and the backend starts the instance and automatically stops it after the chosen duration. Access is restricted to a single allowed Google account.

## Component Diagram

```
Browser (frontend/)
  │  Google ID token in Authorization header
  ▼
API Gateway v2 (HTTP API)
  │
  ▼
Lambda: instancewatcher-api          Lambda: instancewatcher-scheduler
  │  boto3                             │  boto3 (every 5 min via EventBridge)
  ├──▶ EC2 (start / stop / describe)   ├──▶ DynamoDB: instanceec2_state (scan)
  ├──▶ EC2 (security group rules)      └──▶ EC2 (stop overdue instances)
  └──▶ DynamoDB
         ├── instanceec2_state
         ├── instanceec2_action
         └── instanceec2_user_config
```

## Components

### Frontend (`frontend/`)

Static HTML/CSS/JS — no framework, no build step. Served from S3 via CloudFront. Loads `config.json` at startup to get the API Gateway URL and Google Client ID. Sends Google ID tokens in the `Authorization: Bearer` header on every API call.

### API Lambda (`lambdas/api/app.py`)

Python 3.12. Handles all user-facing requests:

- Verifies Google ID tokens using `google-auth`
- Restricts access to `ALLOWED_EMAIL`
- Reads/writes DynamoDB state and action tables
- Calls EC2 to start/stop instances and manage security group rules

### Scheduler Lambda (`lambdas/scheduler/app.py`)

Python 3.12, no external dependencies. Triggered every 5 minutes by EventBridge. Scans `instanceec2_state` for rows where `stop_at ≤ now`, stops those EC2 instances, deletes the state rows, and writes `auto_stop` action records.

### DynamoDB Tables

| Table | Hash key | Purpose |
|---|---|---|
| `instanceec2_state` | `instance_id` (S) | Active time-watch records. Row exists only while an instance is being watched. Fields: `started_at`, `stop_at`, `updated_at` (epoch seconds). |
| `instanceec2_action` | `action_id` (S) | Audit log. Every start, duration change, and auto-stop is recorded. |
| `instanceec2_user_config` | `email` (S) | Per-user config (API URL, Google Client ID). Written when user saves Settings in the frontend. |

### Infrastructure (Terraform)

Terraform provisions everything: DynamoDB, IAM roles, both Lambda functions, API Gateway v2, EventBridge schedule, S3 bucket, CloudFront distribution with a custom domain (Route53 + ACM in `us-east-1`).

SAM (`template.yaml`) is an alternative that provisions the same minus frontend hosting.

## Request Flow

1. User opens the frontend, signs in with Google — browser receives a signed ID token.
2. Frontend calls `GET /config` to load the saved API URL (if any), then `GET /instances`.
3. API Lambda verifies the token, checks the allowed email, queries EC2 and DynamoDB, returns instance list with remaining time.
4. User clicks **Start Xh** — frontend calls `POST /instances/{id}/start` with `{ "hours": X }`.
5. Lambda starts EC2, writes a row to `instanceec2_state` with `stop_at = now + effective_minutes * 60`.
6. Every 5 minutes the scheduler scans the state table. When `stop_at ≤ now` it stops the instance, deletes the row, and logs an `auto_stop` action.

## Hours-to-Minutes Mapping

| UI hours | Effective minutes |
|---|---|
| 1 | 50 |
| 2 | 110 |
| 3 | 170 |

## Auth Model

Google ID tokens are verified with `google.oauth2.id_token.verify_oauth2_token`. If `GOOGLE_CLIENT_ID` is set, token audience is validated. `ALLOWED_EMAIL` gates access to a single email. The `/health` endpoint is unauthenticated.
