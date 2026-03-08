"""
EC2 instance watcher API: list instances, start with duration, set duration.
Google ID token auth; CORS enabled.
"""
import os
import json
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

import boto3
from botocore.exceptions import ClientError

_google_auth_error = None
try:
    from google.oauth2 import id_token
    from google.auth.transport import requests as google_requests
except Exception as e:
    id_token = None
    google_requests = None
    _google_auth_error = str(e)

STATE_TABLE = os.environ.get("STATE_TABLE", "instanceec2_state")
ACTION_TABLE = os.environ.get("ACTION_TABLE", "instanceec2_action")
USER_CONFIG_TABLE = os.environ.get("USER_CONFIG_TABLE", "instanceec2_user_config")
ALLOWED_EMAIL = os.environ.get("ALLOWED_EMAIL", "").strip()
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()

# hours -> effective minutes (1h=50, 2h=110, 3h=170)
HOURS_TO_MINUTES = {1: 50, 2: 110, 3: 170}

dynamo = boto3.resource("dynamodb")
ec2 = boto3.client("ec2")


def _cors_headers(origin: Optional[str] = None) -> dict:
    return {
        "Access-Control-Allow-Origin": origin or "*",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    }


def _parse_origin(event: dict) -> Optional[str]:
    headers = event.get("headers") or {}
    if isinstance(headers, dict):
        return headers.get("origin") or headers.get("Origin")
    return None


def _json_serial(obj: Any) -> Any:
    """Convert Decimal and other non-JSON-serializable types."""
    if isinstance(obj, Decimal):
        return int(obj) if obj == int(obj) else float(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _response(
    status: int,
    body: Any,
    event: dict,
    headers: Optional[dict] = None,
) -> dict:
    origin = _parse_origin(event)
    h = _cors_headers(origin)
    if headers:
        h.update(headers)
    body_str = json.dumps(body, default=_json_serial) if not isinstance(body, str) else body
    return {
        "statusCode": status,
        "headers": h,
        "body": body_str,
    }


def _verify_token(event: dict):
    """Returns (error_response, None) or (None, claims)."""
    auth = (event.get("headers") or {}).get("authorization") or (event.get("headers") or {}).get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        return _response(401, {"error": "Missing or invalid Authorization header"}, event), None
    token = auth[7:].strip()
    if not token:
        return _response(401, {"error": "Empty Bearer token"}, event), None

    if not id_token or not google_requests:
        err_msg = "Google auth not available"
        if _google_auth_error:
            err_msg += f": {_google_auth_error}"
        return _response(500, {"error": err_msg}, event), None

    try:
        audience = GOOGLE_CLIENT_ID if GOOGLE_CLIENT_ID else None
        claims = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            audience=audience,
        )
    except Exception as e:
        return _response(401, {"error": f"Invalid token: {e!s}"}, event), None

    email = (claims.get("email") or "").strip()
    if not email:
        return _response(403, {"error": "Token has no email"}, event), None
    if ALLOWED_EMAIL and email.lower() != ALLOWED_EMAIL.lower():
        return _response(403, {"error": "Email not allowed"}, event), None
    return None, claims


def _record_action(
    action_type: str,
    instance_id: str,
    actor_email: str,
    requested_hours: int,
    effective_minutes: int,
) -> None:
    now_epoch = int(datetime.now(timezone.utc).timestamp())
    table = dynamo.Table(ACTION_TABLE)
    table.put_item(
        Item={
            "action_id": str(uuid.uuid4()),
            "instance_id": instance_id,
            "action_type": action_type,
            "requested_hours": requested_hours,
            "effective_minutes": effective_minutes,
            "action_time": now_epoch,
            "actor_email": actor_email,
        }
    )


def _get_state(instance_id: str) -> Optional[dict]:
    table = dynamo.Table(STATE_TABLE)
    r = table.get_item(Key={"instance_id": instance_id})
    return r.get("Item")


def _put_state(
    instance_id: str,
    started_at: int,
    stop_at: int,
    updated_at: Optional[int] = None,
) -> None:
    now_epoch = int(datetime.now(timezone.utc).timestamp())
    table = dynamo.Table(STATE_TABLE)
    table.put_item(
        Item={
            "instance_id": instance_id,
            "started_at": started_at,
            "stop_at": stop_at,
            "updated_at": updated_at if updated_at is not None else now_epoch,
        }
    )


def _delete_state(instance_id: str) -> None:
    table = dynamo.Table(STATE_TABLE)
    table.delete_item(Key={"instance_id": instance_id})


def _get_user_config(email: str) -> Optional[dict]:
    table = dynamo.Table(USER_CONFIG_TABLE)
    r = table.get_item(Key={"email": email})
    item = r.get("Item")
    if not item:
        return None
    return {
        "api_url": item.get("api_url"),
        "google_client_id": item.get("google_client_id"),
        "updated_at": item.get("updated_at"),
    }


def _put_user_config(email: str, api_url: str, google_client_id: str) -> None:
    now_epoch = int(datetime.now(timezone.utc).timestamp())
    table = dynamo.Table(USER_CONFIG_TABLE)
    table.put_item(
        Item={
            "email": email,
            "api_url": (api_url or "").strip(),
            "google_client_id": (google_client_id or "").strip(),
            "updated_at": now_epoch,
        }
    )


def _effective_minutes(hours: int) -> int:
    return HOURS_TO_MINUTES.get(hours, 50)


def get_health(event: dict) -> dict:
    return _response(200, {"status": "ok"}, event)


def get_config(event: dict) -> dict:
    err_resp, claims = _verify_token(event)
    if err_resp is not None:
        return err_resp
    email = (claims.get("email") or "").strip()
    cfg = _get_user_config(email)
    return _response(200, cfg if cfg else {}, event)


def post_config(event: dict) -> dict:
    err_resp, claims = _verify_token(event)
    if err_resp is not None:
        return err_resp
    email = (claims.get("email") or "").strip()

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"]) if isinstance(event["body"], str) else event["body"]
        except Exception:
            pass
    api_url = (body.get("api_url") or "").strip()
    google_client_id = (body.get("google_client_id") or "").strip()
    if not api_url or not google_client_id:
        return _response(400, {"error": "api_url and google_client_id are required"}, event)

    _put_user_config(email, api_url, google_client_id)
    return _response(200, {"message": "Config saved"}, event)


def get_instances(event: dict) -> dict:
    try:
        err_resp, claims = _verify_token(event)
        if err_resp is not None:
            return err_resp
        actor_email = (claims.get("email") or "").strip()

        try:
            desc = ec2.describe_instances()
        except ClientError as e:
            return _response(500, {"error": f"EC2 error: {e}"}, event)

        now = datetime.now(timezone.utc)
        now_epoch = int(now.timestamp())
        instances = []
        for res in desc.get("Reservations") or []:
            for inst in res.get("Instances") or []:
                iid = inst.get("InstanceId")
                if not iid:
                    continue
                state_name = (inst.get("State", {}).get("Name") or "unknown").lower()
                name = ""
                for tag in (inst.get("Tags") or []):
                    if (tag.get("Key") or "").lower() == "name":
                        name = tag.get("Value") or ""
                        break
                row = {
                    "instance_id": iid,
                    "name": name,
                    "state": state_name,
                    "instance_type": inst.get("InstanceType"),
                }
                if state_name in ("running", "pending"):
                    try:
                        state_row = _get_state(iid)
                    except Exception as e:
                        state_row = None
                    if state_row:
                        row["started_at"] = state_row.get("started_at")
                        row["stop_at"] = state_row.get("stop_at")
                        stop_at_val = state_row.get("stop_at")
                        if stop_at_val is not None:
                            try:
                                stop_epoch = int(stop_at_val)
                                row["remaining_minutes"] = max(0, (stop_epoch - now_epoch) // 60)
                            except (TypeError, ValueError):
                                row["remaining_minutes"] = None
                        else:
                            row["remaining_minutes"] = None
                    else:
                        row["started_at"] = None
                        row["stop_at"] = None
                        row["remaining_minutes"] = None
                instances.append(row)

        return _response(200, {"instances": instances}, event)
    except Exception as e:
        return _response(500, {"error": f"get_instances error: {e}"}, event)


def post_start(event: dict, instance_id: str) -> dict:
    err_resp, claims = _verify_token(event)
    if err_resp is not None:
        return err_resp
    actor_email = (claims.get("email") or "").strip()

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"]) if isinstance(event["body"], str) else event["body"]
        except Exception:
            pass
    hours = body.get("hours")
    if hours not in (1, 2, 3):
        return _response(400, {"error": "body must include hours: 1, 2, or 3"}, event)

    effective_mins = _effective_minutes(hours)
    now = datetime.now(timezone.utc)
    now_epoch = int(now.timestamp())
    stop_at_epoch = now_epoch + effective_mins * 60

    try:
        desc = ec2.describe_instances(InstanceIds=[instance_id])
    except ClientError as e:
        return _response(404 if "InvalidInstanceID" in str(e) else 500, {"error": str(e)}, event)

    inst = None
    for res in desc.get("Reservations", []):
        for i in res.get("Instances", []):
            if i.get("InstanceId") == instance_id:
                inst = i
                break
    if not inst:
        return _response(404, {"error": "Instance not found"}, event)

    state_name = (inst.get("State", {}).get("Name") or "unknown").lower()
    state_row = _get_state(instance_id)
    if state_row and state_row.get("started_at") is not None:
        sa = state_row["started_at"]
        started_at_epoch = int(sa) if isinstance(sa, (int, float)) else now_epoch
    else:
        started_at_epoch = now_epoch

    if state_name in ("stopped", "stopping", "terminated", "shutting-down"):
        # stopped => start EC2
        ec2.start_instances(InstanceIds=[instance_id])
    # if already running/pending => do not fail; just reset timer
    _put_state(instance_id, started_at_epoch, stop_at_epoch)
    _record_action("start_or_reset", instance_id, actor_email, hours, effective_mins)
    return _response(200, {"message": "Start or reset initiated", "stop_at": stop_at_epoch}, event)


def post_set_duration(event: dict, instance_id: str) -> dict:
    err_resp, claims = _verify_token(event)
    if err_resp is not None:
        return err_resp
    actor_email = (claims.get("email") or "").strip()

    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"]) if isinstance(event["body"], str) else event["body"]
        except Exception:
            pass
    hours = body.get("hours")
    if hours not in (1, 2, 3):
        return _response(400, {"error": "body must include hours: 1, 2, or 3"}, event)

    try:
        desc = ec2.describe_instances(InstanceIds=[instance_id])
    except ClientError as e:
        return _response(404 if "InvalidInstanceID" in str(e) else 500, {"error": str(e)}, event)

    inst = None
    for res in desc.get("Reservations", []):
        for i in res.get("Instances", []):
            if i.get("InstanceId") == instance_id:
                inst = i
                break
    if not inst:
        return _response(404, {"error": "Instance not found"}, event)

    state_name = (inst.get("State", {}).get("Name") or "unknown").lower()
    if state_name not in ("running", "pending"):
        return _response(400, {"error": "Instance must be running or pending to set duration"}, event)

    effective_mins = _effective_minutes(hours)
    now = datetime.now(timezone.utc)
    now_epoch = int(now.timestamp())
    stop_at_epoch = now_epoch + effective_mins * 60

    state_row = _get_state(instance_id)
    if state_row and state_row.get("started_at") is not None:
        sa = state_row["started_at"]
        started_at_epoch = int(sa) if isinstance(sa, (int, float)) else now_epoch
    else:
        started_at_epoch = now_epoch
    _put_state(instance_id, started_at_epoch, stop_at_epoch)
    _record_action("set_duration", instance_id, actor_email, hours, effective_mins)
    return _response(200, {"message": "Duration updated", "stop_at": stop_at_epoch}, event)


def handle_options(event: dict) -> dict:
    return _response(204, "", event)


def lambda_handler(event: dict, context: Any) -> dict:
    request_context = event.get("requestContext", {}) or {}
    http = request_context.get("http", {}) or {}
    method = (http.get("method") or event.get("httpMethod") or "GET").upper()
    path = (http.get("path") or event.get("path") or event.get("rawPath") or "").strip() or "/"

    if method == "OPTIONS":
        return handle_options(event)

    if path == "/health" and method == "GET":
        return get_health(event)
    if path == "/config" and method == "GET":
        return get_config(event)
    if path == "/config" and method == "POST":
        return post_config(event)
    if path == "/instances" and method == "GET":
        return get_instances(event)

    # /instances/{instance_id}/start
    if path.startswith("/instances/") and "/start" in path and method == "POST":
        parts = path.strip("/").split("/")
        if len(parts) >= 3 and parts[0] == "instances" and parts[2] == "start":
            return post_start(event, parts[1])
    # /instances/{instance_id}/set-duration
    if path.startswith("/instances/") and "/set-duration" in path and method == "POST":
        parts = path.strip("/").split("/")
        if len(parts) >= 3 and parts[0] == "instances" and parts[2] == "set-duration":
            return post_set_duration(event, parts[1])

    return _response(404, {"error": "Not found"}, event)
