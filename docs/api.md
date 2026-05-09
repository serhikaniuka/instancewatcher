# API Reference

Base URL: `https://<api-id>.execute-api.<region>.amazonaws.com`

All endpoints except `/health` require a Google ID token:

```
Authorization: Bearer <google-id-token>
```

CORS is enabled for all origins. Supported methods: `GET`, `POST`, `DELETE`, `OPTIONS`.

---

## Health

### `GET /health`

No auth required.

**Response `200`**
```json
{ "status": "ok" }
```

---

## Config

### `GET /config`

Returns the saved per-user config for the authenticated account.

**Response `200`**
```json
{
  "api_url": "https://xxx.execute-api.eu-central-1.amazonaws.com",
  "google_client_id": "xxx.apps.googleusercontent.com",
  "updated_at": 1746000000
}
```

Returns `{}` if no config has been saved yet.

---

### `POST /config`

Saves per-user config to DynamoDB.

**Request body**
```json
{
  "api_url": "https://xxx.execute-api.eu-central-1.amazonaws.com",
  "google_client_id": "xxx.apps.googleusercontent.com"
}
```

Both fields are required.

**Response `200`**
```json
{ "message": "Config saved" }
```

**Response `400`** — missing fields.

---

## Instances

### `GET /instances`

Returns all EC2 instances in the account. Running/pending instances include time-watch fields if a state record exists.

**Response `200`**
```json
{
  "instances": [
    {
      "instance_id": "i-0abc123",
      "name": "minecraft",
      "state": "running",
      "instance_type": "t3.medium",
      "started_at": 1746000000,
      "stop_at": 1746003000,
      "remaining_minutes": 47
    },
    {
      "instance_id": "i-0def456",
      "name": "build-server",
      "state": "stopped",
      "instance_type": "t3.small",
      "started_at": null,
      "stop_at": null,
      "remaining_minutes": null
    }
  ]
}
```

`remaining_minutes` is `null` when the instance is running but has no active time-watch record.

---

### `POST /instances/{instance_id}/start`

Starts a stopped instance with a time limit, or resets the timer on an already-running instance.

**Request body**
```json
{ "hours": 1 }
```

`hours` must be `1`, `2`, or `3`.

| hours | effective minutes |
|---|---|
| 1 | 50 |
| 2 | 110 |
| 3 | 170 |

**Response `200`**
```json
{ "message": "Start or reset initiated", "stop_at": 1746003000 }
```

**Response `400`** — invalid `hours` value.
**Response `404`** — instance not found.

---

### `POST /instances/{instance_id}/set-duration`

Updates the stop time on an already-running or pending instance. Does not restart a stopped instance.

**Request body**
```json
{ "hours": 2 }
```

`hours` must be `1`, `2`, or `3`.

**Response `200`**
```json
{ "message": "Duration updated", "stop_at": 1746006600 }
```

**Response `400`** — invalid `hours` or instance is not running/pending.
**Response `404`** — instance not found.

---

## Security Group

Manages inbound rules on the security group configured via the `SG_NAME` environment variable (default: `minecraft-ssh`).

### `GET /security-group/rules`

Returns current inbound rules.

**Response `200`**
```json
{
  "sg_name": "minecraft-ssh",
  "sg_id": "sg-0abc123",
  "rules": [
    {
      "protocol": "tcp",
      "from_port": 25565,
      "to_port": 25565,
      "cidr": "1.2.3.4/32"
    },
    {
      "protocol": "udp",
      "from_port": 19132,
      "to_port": 19132,
      "cidr": "5.6.7.8/32"
    }
  ]
}
```

**Response `404`** — security group not found.

---

### `POST /security-group/rules`

Adds an inbound rule.

**Request body**
```json
{
  "ip": "1.2.3.4",
  "port": "25565",
  "protocol": "tcp"
}
```

| Field | Type | Notes |
|---|---|---|
| `ip` | string | IP address or CIDR block. `/32` is appended automatically if no prefix given. |
| `port` | string or number | Single port (`25565`) or range (`22-63000`). |
| `protocol` | string | `tcp` or `udp`. |

**Response `200`**
```json
{ "message": "Rule added" }
```

**Response `400`** — missing/invalid fields.
**Response `404`** — security group not found.
**Response `409`** — rule already exists.

---

### `DELETE /security-group/rules`

Removes an inbound rule. Body format is identical to `POST`.

**Request body**
```json
{
  "ip": "1.2.3.4/32",
  "port": "25565",
  "protocol": "tcp"
}
```

**Response `200`**
```json
{ "message": "Rule removed" }
```

**Response `400`** — missing/invalid fields.
**Response `404`** — security group or rule not found.

---

## Error format

All error responses use the same shape:

```json
{ "error": "Human-readable message" }
```

## Auth errors

| Status | Meaning |
|---|---|
| `401` | Missing or invalid `Authorization` header / expired token |
| `403` | Valid token but email not in `ALLOWED_EMAIL` |
| `500` | Google auth library unavailable in Lambda environment |
