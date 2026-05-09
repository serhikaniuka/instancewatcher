# Security Group Management

The frontend includes a **Security Group** panel that lets you view, add, and remove inbound rules on a named EC2 security group — without touching the AWS Console.

## Configuration

The target security group is set via the `SG_NAME` environment variable on the API Lambda. It defaults to `minecraft-ssh`.

**Terraform:** set `sg_name` in `terraform.tfvars`:
```hcl
sg_name = "minecraft-ssh"
```

**SAM:** pass `SgName` as a parameter override:
```bash
sam deploy --parameter-overrides SgName=minecraft-ssh ...
```

The group is looked up **by name** at runtime using `ec2:DescribeSecurityGroups`. The Lambda role needs:
- `ec2:DescribeSecurityGroups`
- `ec2:AuthorizeSecurityGroupIngress`
- `ec2:RevokeSecurityGroupIngress`

These are already included in the Terraform and SAM templates.

## Frontend Usage

After signing in, the **Security Group** section appears below the Instances table.

### Viewing rules

The panel shows all current inbound rules as a table:

| Protocol | Port range | Source | |
|---|---|---|---|
| TCP | 25565 | 1.2.3.4/32 | Remove |
| UDP | 19132 | 0.0.0.0/0 | Remove |

### Adding a rule

Fill in the **Add Inbound Rule** form:

| Field | Example | Notes |
|---|---|---|
| IP / CIDR | `1.2.3.4` or `10.0.0.0/24` | `/32` is added automatically for bare IPs |
| Port / Range | `25565` or `22-63000` | Single port or hyphen-separated range |
| Protocol | TCP / UDP | Select from dropdown |

Click **My IP** to auto-fill your current public IP address.

Click **Add Rule** to apply. The table refreshes immediately.

### Removing a rule

Click **Remove** on any row. The rule is revoked from the security group immediately.

## API Endpoints

See [api.md](api.md#security-group) for the full API reference.

Quick reference:

```bash
TOKEN="<google-id-token>"
BASE="https://xxx.execute-api.eu-central-1.amazonaws.com"

# List rules
curl -H "Authorization: Bearer $TOKEN" $BASE/security-group/rules

# Add a rule
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ip":"1.2.3.4","port":"25565","protocol":"tcp"}' \
  $BASE/security-group/rules

# Remove a rule
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ip":"1.2.3.4/32","port":"25565","protocol":"tcp"}' \
  $BASE/security-group/rules
```

## Port range format

Both single ports and ranges are supported:

| Input | From port | To port |
|---|---|---|
| `25565` | 25565 | 25565 |
| `22-63000` | 22 | 63000 |
| `19132` | 19132 | 19132 |

Valid range: 0–65535. `from_port` must be ≤ `to_port`.
