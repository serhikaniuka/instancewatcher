"""
Scheduler: every 5 min, stop EC2 instances whose stop_at <= now;
delete state row; write auto_stop action.
"""
import os
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

STATE_TABLE = os.environ.get("STATE_TABLE", "instanceec2_state")
ACTION_TABLE = os.environ.get("ACTION_TABLE", "instanceec2_action")

dynamo = boto3.resource("dynamodb")
ec2 = boto3.client("ec2")


def _record_action(instance_id: str) -> None:
    now_epoch = int(datetime.now(timezone.utc).timestamp())
    table = dynamo.Table(ACTION_TABLE)
    table.put_item(
        Item={
            "action_id": str(uuid.uuid4()),
            "instance_id": instance_id,
            "action_type": "auto_stop",
            "requested_hours": 0,
            "effective_minutes": 0,
            "action_time": now_epoch,
            "actor_email": "system",
        }
    )


def lambda_handler(event, context):
    now_epoch = int(datetime.now(timezone.utc).timestamp())
    state_table = dynamo.Table(STATE_TABLE)

    scan = state_table.scan()
    to_stop = []
    for item in scan.get("Items", []):
        stop_at = item.get("stop_at")
        if stop_at is None:
            continue
        stop_epoch = int(stop_at) if isinstance(stop_at, (int, float)) else None
        if stop_epoch is not None and stop_epoch <= now_epoch:
            to_stop.append(item.get("instance_id"))

    while scan.get("LastEvaluatedKey"):
        scan = state_table.scan(ExclusiveStartKey=scan["LastEvaluatedKey"])
        for item in scan.get("Items", []):
            stop_at = item.get("stop_at")
            if stop_at is None:
                continue
            stop_epoch = int(stop_at) if isinstance(stop_at, (int, float)) else None
            if stop_epoch is not None and stop_epoch <= now_epoch:
                to_stop.append(item.get("instance_id"))

    for instance_id in to_stop:
        if not instance_id:
            continue
        try:
            desc = ec2.describe_instances(InstanceIds=[instance_id])
        except ClientError:
            state_table.delete_item(Key={"instance_id": instance_id})
            _record_action(instance_id)
            continue
        state_name = None
        for res in desc.get("Reservations", []):
            for inst in res.get("Instances", []):
                if inst.get("InstanceId") == instance_id:
                    state_name = (inst.get("State", {}).get("Name") or "").lower()
                    break
        if state_name in ("running", "pending"):
            try:
                ec2.stop_instances(InstanceIds=[instance_id])
            except ClientError:
                pass
        state_table.delete_item(Key={"instance_id": instance_id})
        _record_action(instance_id)

    return {"stopped": len(to_stop)}
