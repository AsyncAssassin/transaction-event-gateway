# AWS Deployment Runbook

Procedure for a first, short-lived deployment of the Terraform scaffold in `infra/terraform`, from an empty environment to a smoke-tested one and back to nothing. The design and its trade-offs are in [AWS deployment design](aws-deployment-design.md); resources, variables, and secret formats are in [Terraform scaffold notes](../infra/terraform/README.md).

## Status and Scope

- The scaffold has never been applied, and this procedure has not been run end to end; expect to adjust it on the first run.
- An apply creates an ECR repository, an internet-facing ALB with an HTTP listener, an ECS cluster with API and worker services and API, worker, and migration task definitions, a single-AZ RDS PostgreSQL instance (`db.t4g.micro`), a one-node ElastiCache Redis replication group (`cache.t4g.micro`), three Secrets Manager secrets without values, three CloudWatch log groups, the task execution role, security groups, and by default four interface VPC endpoints and an S3 gateway endpoint. It creates no VPC, subnets, NAT gateway, DNS records, certificates, alarms, or autoscaling.
- From the first apply until the destroy finishes, the ALB, RDS, ElastiCache, and interface endpoints bill by the hour even without traffic, Fargate bills for running tasks, and storage, backups, logs, and secrets add smaller amounts. Check current prices for the region and plan the lifetime in hours. Every command from [Create the infrastructure](#create-the-infrastructure) onward creates, changes, or deletes billable resources.
- Read [Known gaps before the first apply](aws-deployment-design.md#known-gaps-before-the-first-apply) first. Two of them stop a first deployment outright: the PostgreSQL engine version (set it in the tfvars file below) and the missing RDS CA bundle in the image (needs an image change). The steps below handle the image architecture and the migration order.

## Prerequisites

- Terraform `>= 1.6, < 2.0`, AWS CLI v2, Docker with Buildx, `jq`, `curl`, `openssl`, Node.js 22, and credentials for the target account. Run every command from the repository root of a clean checkout of the commit to deploy.
- A budget in AWS Budgets with actual and forecast alerts to a monitored address, and a named owner and deadline for the teardown.
- Shell setup for the later blocks. `AWS_REGION` must equal `aws_region` in the tfvars file, `TFVARS` is that file's name inside `infra/terraform`, and `PRIVATE_SUBNETS` repeats its `private_subnet_ids`, comma-separated:

  ```bash
  export AWS_REGION=eu-central-1
  TFVARS=dev.tfvars
  PRIVATE_SUBNETS=subnet-aaaa,subnet-bbbb
  tf_out() { terraform -chdir=infra/terraform output -raw "$1"; }
  ```

- Remote state: `versions.tf` has an empty `backend "s3" {}` block, so the state bucket must exist before `init`. Create a versioned bucket (drop `--create-bucket-configuration` in `us-east-1`), copy the template, fill in the bucket, key, region, and exactly one locking option, and initialize:

  ```bash
  STATE_BUCKET="<state-bucket-name>"
  aws s3api create-bucket --bucket "$STATE_BUCKET" --create-bucket-configuration LocationConstraint="$AWS_REGION"
  aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" --versioning-configuration Status=Enabled
  cp infra/terraform/backend.hcl.example infra/terraform/backend.hcl
  terraform -chdir=infra/terraform init -backend-config=backend.hcl
  ```

Required before the first apply: copy `infra/terraform/example.tfvars` to `infra/terraform/$TFVARS` (git ignores every tfvars file except the example) and set at least:

- `aws_region`, `project_name`, and `environment`; `<project_name>-<environment>` names the ALB and target group and must stay within 32 characters.
- `vpc_id`; `public_subnet_ids` in at least two Availability Zones for the ALB; `private_subnet_ids` with exactly one subnet per Availability Zone in at least two zones, used by the tasks, RDS, Redis, and interface endpoints; `private_route_table_ids`, the route tables of those private subnets.
- A VPC with DNS hostnames and DNS support enabled. If it already has interface endpoints with private DNS for ECR, CloudWatch Logs, or Secrets Manager, or an S3 gateway endpoint on those route tables, set `create_private_egress_endpoints = false`: the task security group then allows HTTPS to any address, and the existing endpoints (their security groups must admit the tasks) or a NAT route carry the traffic.
- `postgres_engine_version`: a 16.x version that RDS can create for the instance class:

  ```bash
  aws rds describe-orderable-db-instance-options --engine postgres --db-instance-class db.t4g.micro \
    --query 'OrderableDBInstanceOptions[].EngineVersion' --output text | tr '\t' '\n' | grep '^16\.' | sort -u
  ```

- `allowed_http_cidrs = ["<your-ip>/32"]` instead of the open default.
- `api_desired_count = 0` and `worker_desired_count = 0`; they are raised after the migration.
- If `app_environment_variables` sets `PORT`, keep it equal to `app_port`.

The runtime secrets are populated after the first apply, which creates them.

## Create the Infrastructure

```bash
terraform -chdir=infra/terraform apply -var-file="$TFVARS"
NAME_PREFIX="$(tf_out name_prefix)"
CLUSTER="$(tf_out ecs_cluster_name)"
```

Check the plan before confirming. RDS and ElastiCache take several minutes each. No task starts yet: the desired counts are `0` and the task definitions still reference the placeholder image, so the ALB answers `503`.

## Build and Push the Image

Build from a commit whose CI run passed. The task definitions set no `runtime_platform`, so Fargate runs X86_64 images: build for `linux/amd64` on every machine, because on ARM machines such as Apple silicon the default is `arm64`.

```bash
REPO_URL="$(tf_out ecr_repository_url)"
IMAGE_TAG="git-$(git rev-parse HEAD)"
docker build --platform linux/amd64 -t "$REPO_URL:$IMAGE_TAG" .
docker image inspect --format '{{.Os}}/{{.Architecture}}' "$REPO_URL:$IMAGE_TAG"
aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO_URL%%/*}"
docker push "$REPO_URL:$IMAGE_TAG"
aws ecr describe-images --repository-name "$(tf_out ecr_repository_name)" \
  --image-ids imageTag="$IMAGE_TAG" --query 'imageDetails[0].imageDigest' --output text
```

The inspect command must print `linux/amd64`. In the tfvars file, set `container_image` to the repository URL, `@`, and the digest printed by the last command, which already starts with `sha256:` (`<repository-url>@sha256:<hex>`). The repository rejects overwriting an existing tag; never use `latest` or a branch name.

## Populate the Runtime Secrets

Terraform created `<name_prefix>/runtime/database-url`, `.../redis-url`, and `.../webhook-secret` without values. The block below writes each value into a file readable only by you, stores it, and deletes the file, so no secret appears in shell history or process arguments. `DATABASE_URL` follows the [format in the Terraform notes](../infra/terraform/README.md#database_url-secret-format); set `RDS_CA_BUNDLE` to the path of the Amazon RDS CA bundle inside the image, which the current image does not ship (see the known gaps). With `redis_transit_encryption_enabled = true`, write `rediss://` instead of `redis://`.

```bash
RDS_CA_BUNDLE="<path-of-the-rds-ca-bundle-inside-the-image>"
(
  umask 077
  aws secretsmanager get-secret-value --secret-id "$(tf_out postgres_master_user_secret_arn)" \
    --query SecretString --output text \
    | jq -j --arg host "$(tf_out postgres_address)" --arg port "$(tf_out postgres_port)" \
        --arg db "$(tf_out postgres_database_name)" --arg ca "$RDS_CA_BUNDLE" \
        '"postgresql://\(.username | @uri):\(.password | @uri)@\($host):\($port)/\($db)?sslmode=verify-full&sslrootcert=\($ca)"' \
    > database-url.txt
  printf 'redis://%s:%s' "$(tf_out redis_primary_endpoint_address)" "$(tf_out redis_port)" > redis-url.txt
  openssl rand -hex 32 | tr -d '\n' > webhook-secret.txt
  for name in database-url redis-url webhook-secret; do
    aws secretsmanager put-secret-value --secret-id "$NAME_PREFIX/runtime/$name" --secret-string "file://$name.txt"
  done
  rm -f database-url.txt redis-url.txt webhook-secret.txt
)
aws secretsmanager describe-secret --secret-id "$(tf_out postgres_master_user_secret_arn)" \
  --query '{enabled: RotationEnabled, rules: RotationRules, next: NextRotationDate}'
```

The last command shows when RDS next rotates the master password. Plan the teardown before that date; otherwise rebuild `database-url` after the rotation and force a new deployment of both services.

## Migrate and Start the Services

An apply that changes `container_image` also moves both services to the new task definitions, so a migration cannot run in between (see the known gaps). With both desired counts still `0`, the first release avoids this:

1. Register the new image; no task starts:

   ```bash
   terraform -chdir=infra/terraform apply -var-file="$TFVARS"
   ```

2. Run the migration task (`npm run migration:run:prod`, with only `DATABASE_URL` injected) and wait for it to stop:

   ```bash
   TASK_ARN="$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
     --task-definition "$(tf_out migration_task_definition_arn)" \
     --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNETS],securityGroups=[$(tf_out ecs_tasks_security_group_id)],assignPublicIp=DISABLED}" \
     --query 'tasks[0].taskArn' --output text)"
   aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"
   aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
     --query 'tasks[0].{exitCode: containers[0].exitCode, reason: stoppedReason}'
   aws logs tail "/ecs/$NAME_PREFIX/migration" --since 30m
   ```

   Continue only when `exitCode` is `0`. TypeORM runs all pending migrations in one transaction and logs every statement, so a failed run leaves the schema unchanged and the log shows where it stopped. Without an exit code, `reason` says why the container never ran, for example `ResourceInitializationError` (a secret without a value, or no path to Secrets Manager) or `CannotPullContainerError` (image, architecture, or ECR access).

3. Set `api_desired_count = 1` and `worker_desired_count = 1` in the tfvars file, apply, and wait, because `terraform apply` returns before the tasks are healthy. If the waiter gives up after ten minutes, read the service events with the commands in [Monitoring window](#monitoring-window).

   ```bash
   terraform -chdir=infra/terraform apply -var-file="$TFVARS"
   aws ecs wait services-stable --cluster "$CLUSTER" --services "$(tf_out api_service_name)" "$(tf_out worker_service_name)"
   ```

A later image on the same environment needs the same order: either scale both services to `0` first (a short outage), or register only the new migration revision by adding `-target=aws_ecs_task_definition.migration` to the apply, run the migration, and then apply everything. Either way, keep migrations backward compatible, because old tasks keep serving until new ones are healthy.

## Deployed Smoke Checks

`npm run smoke:local` drives the Docker Compose containers and cannot check a deployment. Send these requests from an address in `allowed_http_cidrs`; the listener is plain HTTP on `alb_port`, so append `:<port>` to `BASE_URL` if it is not `80`.

```bash
BASE_URL="http://$(tf_out alb_dns_name)"
SMOKE_ID="smoke-$(date +%s)"
curl -sS -i "$BASE_URL/health/live"
curl -sS -i "$BASE_URL/health/ready"
curl -sS -i "$BASE_URL/health/serving"
```

Each returns `200`: `live` reports `"status":"ok"`, `ready` reports `config`, `postgres`, and `redis` as `ok`, and `serving` reports `config` and `postgres`. A `503` body names the failing dependency.

Then create a payment intent and send a signed webhook for it. The signature is HMAC-SHA256 with `WEBHOOK_SECRET` over `timestamp + "." + nonce + "." + raw_body`, sent as `X-Webhook-Signature: v1=<hex>`; the timestamp must be within 300 seconds of the server clock.

```bash
PAYMENT_INTENT_ID="$(curl -sS -f "$BASE_URL/payment-intents" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $SMOKE_ID" -H "X-Correlation-ID: $SMOKE_ID" \
  -d '{"amount":"125.50","asset":"USDC","destination":"wallet_smoke"}' | jq -r .id)"
echo "$PAYMENT_INTENT_ID"
export WEBHOOK_SECRET="$(aws secretsmanager get-secret-value \
  --secret-id "$NAME_PREFIX/runtime/webhook-secret" --query SecretString --output text)"
TS="$(date +%s)"
NONCE="$SMOKE_ID-nonce"
BODY="{\"eventId\":\"evt_$SMOKE_ID\",\"type\":\"transaction.confirmed\",\"paymentIntentId\":\"$PAYMENT_INTENT_ID\",\"txHash\":\"0x$SMOKE_ID\",\"amount\":\"125.50\",\"asset\":\"USDC\"}"
SIGNATURE="$(node -e 'const [t, n, b] = process.argv.slice(1); const h = require("node:crypto").createHmac("sha256", process.env.WEBHOOK_SECRET); process.stdout.write("v1=" + h.update(`${t}.${n}.${b}`).digest("hex"));' "$TS" "$NONCE" "$BODY")"
curl -sS -i "$BASE_URL/webhooks/blockchain" -H 'Content-Type: application/json' \
  -H "X-Webhook-Timestamp: $TS" -H "X-Webhook-Nonce: $NONCE" \
  -H "X-Webhook-Signature: $SIGNATURE" -H "X-Correlation-ID: $SMOKE_ID-webhook" \
  --data-binary "$BODY"
unset WEBHOOK_SECRET SIGNATURE
```

The first command prints the new payment intent ID (a UUID); the webhook returns `202` with `"status":"ACCEPTED"`. Within a few seconds the worker publishes and processes the event:

```bash
aws logs tail "/ecs/$NAME_PREFIX/worker" --since 10m \
  --filter-pattern '{ $.event = "outbox_dispatch_published" || $.event = "worker_job_processed" }'
aws logs tail "/ecs/$NAME_PREFIX/api" --since 10m \
  --filter-pattern "{ \$.correlationId = \"$SMOKE_ID\" || \$.correlationId = \"$SMOKE_ID-webhook\" }"
```

The check passes when the API log shows `webhook_accepted` for `evt_$SMOKE_ID`, the worker log shows `outbox_dispatch_published` followed by `worker_job_processed` with `"status":"PROCESSED"` for the same `webhookEventId`, and the payment intent reports the confirmation. Worker events carry the internal `webhookEventId`, not the provider `eventId`; on an otherwise idle environment the pair right after the webhook belongs to the smoke request. A `worker_job_failed` event carries the failure reason in `errorCode` instead. Each log line is one JSON object, so the filter patterns match its fields.

```bash
curl -sS "$BASE_URL/payment-intents/$PAYMENT_INTENT_ID" | jq '{status, confirmedTxHash}'
```

The payment intent returns `"status": "CONFIRMED"` and `"confirmedTxHash": "0x$SMOKE_ID"`.

Record the commit, image digest, `SMOKE_ID`, HTTP status codes, and the matching event names with their timestamps. Never paste secrets, signatures, or full request or response payloads into shared records.

## Monitoring Window

Watch the environment for the planned window, then tear it down. Scaling both services to `0` stops only the Fargate charges; the ALB, RDS, ElastiCache, and interface endpoints bill until the destroy.

| Signal | Where | Expected |
| --- | --- | --- |
| ALB errors | `AWS/ApplicationELB`: `HTTPCode_ELB_5XX_Count`, `HTTPCode_Target_5XX_Count`, `UnHealthyHostCount` | Zero or isolated; target 5xx match `http_request_failed` events. |
| Task restarts | ECS service events and stopped tasks (commands below) | No new stopped tasks and no repeated "has started 1 tasks" events after the rollout. |
| RDS | `AWS/RDS`: `FreeStorageSpace`, `DatabaseConnections`, `CPUUtilization` | Storage and connections stable. |
| Redis | `AWS/ElastiCache`: `DatabaseMemoryUsagePercentage`, `Evictions` | `Evictions` stays `0`. |

Log events:

- `http_request_failed` (API): a request ended with a 5xx status.
- `outbox_dispatch_failed` (worker): publishing a job to Redis failed; the outbox row stays `FAILED` and is retried with backoff.
- `worker_job_exhausted` (worker): a job failed its fifth and final BullMQ attempt.
- `outbox_reconcile_requeued` (worker): an outbox row `PUBLISHED` more than 10 minutes earlier still had its webhook event in `RECEIVED` or `QUEUED`, so the worker set it back to `FAILED` with `last_error = 'STALE_PUBLISHED_WEBHOOK_REQUEUED'` for republishing. Expected after lost Redis data or exhausted retries; repeated entries for the same event point to a processing failure that does not clear.
- `worker_error` (BullMQ worker errors, usually Redis connectivity) and `outbox_dispatch_runner_failed` (a whole dispatch batch failed, usually on PostgreSQL).

```bash
aws logs tail "/ecs/$NAME_PREFIX/worker" --since 1h --filter-pattern \
  '{ $.event = "outbox_dispatch_failed" || $.event = "worker_job_exhausted" || $.event = "outbox_reconcile_requeued" || $.event = "worker_error" || $.event = "outbox_dispatch_runner_failed" }'
aws logs tail "/ecs/$NAME_PREFIX/api" --since 1h --filter-pattern '{ $.event = "http_request_failed" }'
aws ecs describe-services --cluster "$CLUSTER" --services "$(tf_out api_service_name)" "$(tf_out worker_service_name)" \
  --query 'services[].{name: serviceName, running: runningCount, desired: desiredCount, events: events[:3].message}'
aws ecs list-tasks --cluster "$CLUSTER" --desired-status STOPPED
```

For a stopped task, `aws ecs describe-tasks --cluster "$CLUSTER" --tasks <task-arn> --query 'tasks[].stoppedReason'` gives the reason; `--follow` keeps `aws logs tail` streaming.

## Teardown

Before destroying:

- [ ] Export the logs you still need; the three log groups are managed by Terraform and are deleted with their contents.
- [ ] With the defaults (`postgres_skip_final_snapshot = true`, `postgres_deletion_protection = false`), destroy deletes the database without a final snapshot. With `postgres_skip_final_snapshot = false`, it leaves the snapshot `<name_prefix>-postgres-final-snapshot`, which bills until deleted and makes a later destroy fail while it exists. If `postgres_deletion_protection` or `alb_enable_deletion_protection` is `true`, set it to `false` and apply first.
- [ ] Empty the ECR repository, which has no `force_delete`, so destroy fails while images remain. Run the command again if `list-images` still returns entries:

  ```bash
  REPO_NAME="$(tf_out ecr_repository_name)"
  aws ecr batch-delete-image --repository-name "$REPO_NAME" \
    --image-ids "$(aws ecr list-images --repository-name "$REPO_NAME" --query 'imageIds' --output json)"
  ```

Destroy:

```bash
terraform -chdir=infra/terraform destroy -var-file="$TFVARS"
```

After destroying:

- [ ] The three runtime secrets have a 7-day recovery window: destroy only schedules their deletion and their names stay taken, so an apply with the same project and environment fails for 7 days unless you delete them now:

  ```bash
  for name in database-url redis-url webhook-secret; do
    aws secretsmanager delete-secret --secret-id "$NAME_PREFIX/runtime/$name" --force-delete-without-recovery
  done
  ```

- [ ] `redis.tf` sets no final snapshot, so the Redis replication group is deleted without one.
- [ ] Not managed by this configuration: the state bucket and any lock table, the budget, and the VPC, subnets, and route tables. Delete the state bucket only after `destroy` has finished without errors.
- [ ] Look for leftovers by the provider default tags; deregistered task definitions and secrets scheduled for deletion can still appear:

  ```bash
  aws resourcegroupstaggingapi get-resources --query 'ResourceTagMappingList[].ResourceARN' \
    --tag-filters "Key=Project,Values=<project_name>" "Key=Environment,Values=<environment>"
  ```

- [ ] Keep the budget alerts until the bill shows no new charges; billing data can lag by a day.
