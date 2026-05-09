# Deployment

Two independent deploy paths exist: **Terraform** (recommended) and **SAM**. Both produce the same Lambda functions, API Gateway, and DynamoDB tables. Terraform additionally provisions the S3 + CloudFront frontend hosting with a custom domain.

---

## Prerequisites

| Tool | Required for |
|---|---|
| AWS CLI (configured) | Both paths; CloudFront invalidation |
| Python 3.12 + pip | Building Lambda ZIPs (non-Docker fallback) |
| Docker | Recommended for API Lambda build (correct `manylinux` wheels) |
| Terraform >= 1.0 | Terraform path |
| AWS SAM CLI | SAM path |

---

## Terraform (recommended)

### First-time setup

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
```

Edit `terraform/terraform.tfvars`:

```hcl
project_name         = "instancewatcher"
allowed_email        = "you@example.com"
google_client_id     = "xxx.apps.googleusercontent.com"
frontend_bucket_name = "instancewatcher-frontend-yourname-unique"
frontend_domain      = "iw.yourdomain.com"
domain_zone          = "yourdomain.com"
sg_name              = "minecraft-ssh"   # security group to manage (optional, default shown)
```

`frontend_bucket_name` must be globally unique across all of S3.
`domain_zone` must be a Route53 hosted zone in your account.

### Deploy

```bash
./scripts/deploy-terraform.sh
```

The script:
1. Builds `build/api.zip` (with `google-auth` dependency via Docker or pip)
2. Builds `build/scheduler.zip` (single-file, no deps)
3. Runs `terraform init` + `terraform plan`, prompts for confirmation
4. Applies the plan, prints `api_base_url` and `frontend_url`
5. Invalidates the CloudFront cache

### Subsequent deploys

Re-run `./scripts/deploy-terraform.sh` — Terraform detects changed files via hash and updates only what changed.

For a Lambda-only change (no infra changes):

```bash
# Build
mkdir -p build
(cd lambdas/scheduler && zip -o ../../build/scheduler.zip app.py)
# ... or use the Docker build for API

# Push directly
aws lambda update-function-code \
  --function-name instancewatcher-api \
  --zip-file fileb://build/api.zip
```

### Terraform variables

| Variable | Default | Description |
|---|---|---|
| `aws_region` | `eu-central-1` | AWS region |
| `project_name` | — | Prefix for Lambda names and IAM roles |
| `allowed_email` | — | Google account email allowed to use the API |
| `google_client_id` | — | Google OAuth 2.0 Web client ID |
| `frontend_bucket_name` | — | S3 bucket name (globally unique) |
| `frontend_domain` | `iw.kanyuka.info` | Custom domain for CloudFront |
| `domain_zone` | `kanyuka.info` | Route53 hosted zone name |
| `cloudfront_price_class` | `PriceClass_100` | CloudFront price class |
| `sg_name` | `minecraft-ssh` | Security group name for rule management |

### Terraform outputs

```bash
cd terraform
terraform output api_base_url          # API Gateway endpoint
terraform output frontend_url          # https://<frontend_domain>
terraform output frontend_cloudfront_url  # https://<cloudfront-domain>
terraform output cloudfront_distribution_id
terraform output frontend_bucket_name
```

---

## SAM

SAM deploys Lambdas, API Gateway, and DynamoDB — no frontend hosting.

### Deploy

```bash
./scripts/deploy.sh
```

Optional environment variables:

```bash
ALLOWED_EMAIL=you@example.com GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com ./scripts/deploy.sh
```

Or manually:

```bash
sam build
sam deploy --no-confirm-changeset --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    AllowedEmail=you@example.com \
    GoogleClientId=xxx.apps.googleusercontent.com \
    SgName=minecraft-ssh
```

### SAM parameters

| Parameter | Default | Description |
|---|---|---|
| `AllowedEmail` | `serhikaniuka@gmail.com` | Allowed Google account email |
| `GoogleClientId` | `""` | Google OAuth client ID (optional) |
| `SgName` | `minecraft-ssh` | Security group name |

After deploy, note the stack output `ApiBaseUrl` and enter it in the frontend Settings panel.

---

## Frontend (standalone)

If not using Terraform, serve `frontend/` from any static host and set `config.json`:

```json
{
  "api_base_url": "https://xxx.execute-api.eu-central-1.amazonaws.com",
  "google_client_id": "xxx.apps.googleusercontent.com"
}
```

The file is loaded at page startup. Users can also override the API URL in the Settings panel, which saves it to DynamoDB per account.

---

## Google OAuth setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Create an **OAuth 2.0 Client ID** of type **Web application**.
3. Add your frontend domain to **Authorised JavaScript origins** (e.g. `https://iw.yourdomain.com`).
4. Copy the **Client ID** — use it as `google_client_id` / `GoogleClientId`.

---

## IAM permissions granted to the API Lambda

| Service | Actions |
|---|---|
| EC2 | `DescribeInstances`, `DescribeRegions`, `StartInstances`, `StopInstances`, `DescribeSecurityGroups`, `AuthorizeSecurityGroupIngress`, `RevokeSecurityGroupIngress` |
| DynamoDB | `GetItem`, `PutItem`, `DeleteItem`, `Scan`, `BatchGetItem` on the 3 tables |
| CloudWatch Logs | `CreateLogGroup`, `CreateLogStream`, `PutLogEvents` |
