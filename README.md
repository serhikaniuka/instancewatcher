# EC2 Instance Watcher

Time-boxed EC2 start/stop with Google sign-in. API and scheduler run on AWS (Lambda + API Gateway + DynamoDB). You can deploy with **Terraform** or **SAM**.

## Prerequisites

- AWS CLI configured (credentials and region)
- Python 3.12 (for local testing)
- For **SAM** deploy: AWS SAM CLI (`sam --version`)
- For **Terraform** deploy: Terraform >= 1.0, `pip` for building Lambda packages

## Deploy with Terraform

1. Copy the example vars and set your values:
   ```bash
   cp terraform/terraform.tfvars.example terraform/terraform.tfvars
   # Edit terraform/terraform.tfvars: project_name, allowed_email, google_client_id, frontend_bucket_name (globally unique)
   ```
2. From the project root, run:
   ```bash
   ./scripts/deploy-terraform.sh
   ```
   The script builds Lambda zips, runs `terraform init`, `terraform plan -out tfplan`, prompts for confirmation, then `terraform apply tfplan`. After apply it prints **api_base_url** and **frontend_url**. The frontend is uploaded automatically from `frontend/` to S3 and served via CloudFront; the script runs a CloudFront invalidation when AWS CLI is available.
3. Optional: run Terraform yourself:
   ```bash
   cd terraform
   # Ensure build exists: run the build block from scripts/deploy-terraform.sh if needed
   terraform init
   terraform plan -out tfplan
   terraform apply tfplan
   terraform output api_base_url
   terraform output frontend_url
   ```

## Deploy with SAM

1. From the project root:
   ```bash
   ./scripts/deploy.sh
   ```
   Or manually:
   ```bash
   sam build
   sam deploy --no-confirm-changeset --capabilities CAPABILITY_IAM \
     --parameter-overrides AllowedEmail=your@email.com GoogleClientId=xxx.apps.googleusercontent.com
   ```
2. Optional env vars for `deploy.sh`: `ALLOWED_EMAIL`, `GOOGLE_CLIENT_ID`.
3. Note the stack outputs: **ApiBaseUrl** (HTTP API base URL).

## Usage

1. **Frontend**
   - Open `frontend/index.html` in a browser (or serve the `frontend/` folder via any static server).
   - Enter **API base URL** (e.g. `https://xxxx.execute-api.region.amazonaws.com`) and **Google Client ID** (OAuth 2.0 Web client).
   - Sign in with Google (use the same email as `AllowedEmail`).
   - List shows running/stopped instances; **Start 1h/2h/3h** for stopped instances, **Set 1h/2h/3h** for running to reset the timer. Remaining time is shown for running instances.

2. **API**
   - `GET /health` — no auth.
   - `GET /instances` — returns running and stopped instances; running include `remaining_minutes` from `stop_at`. Requires `Authorization: Bearer <Google ID token>`.
   - `POST /instances/{id}/start` — body `{ "hours": 1|2|3 }`. Effective minutes: 1→50, 2→110, 3→170. If stopped, starts EC2; if already running/pending, only resets timer.
   - `POST /instances/{id}/set-duration` — body `{ "hours": 1|2|3 }`. Instance must be running or pending; updates `stop_at` only.

3. **Scheduler**
   - Runs every 5 minutes. Stops EC2 instances whose state row has `stop_at` ≤ now, deletes the state row, and logs an `auto_stop` action.

## Tables

- **instanceec2_state**: `instance_id` (S), `started_at` (N), `stop_at` (N), `updated_at` (N) — epoch seconds.
- **instanceec2_action**: `action_id` (S), `instance_id` (S), `action_type` (S), `requested_hours` (N), `effective_minutes` (N), `action_time` (N), `actor_email` (S).