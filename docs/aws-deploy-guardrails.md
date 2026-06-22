# AWS Deploy Guardrails

## Purpose

This document is a practical preflight checklist for a future short-lived AWS
deployment. It is intentionally documentation-only: it does not approve a live
deployment, does not configure credentials, and does not replace an explicit
approval step before Terraform or AWS operations.

Use [AWS short-lived deploy runbook](aws-short-lived-deploy-runbook.md) when a
future operator needs the full approval-gated order, required deployment record,
stop points, monitoring window, and teardown decision.

The goal is to keep the first AWS run small, timeboxed, observable, and easy to
tear down before cost grows unnoticed.

## Region Choice

- Recommended first deploy region: `eu-central-1` Frankfurt.
- Alternative region: `eu-north-1` Stockholm, only if current pricing and
  required service availability are acceptable immediately before apply.
- Confirm the target region in writing before any plan or apply.
- Check current AWS pricing immediately before apply. Pricing changes and
  varies by region; this document lists rough cost risks, not exact rates.
- AWS credits are useful, but they are not a substitute for budgets, alerts, and
  a teardown timebox.

## Main Cost Risks

- **Application Load Balancer**: hourly load balancer cost plus LCU usage. An
  idle ALB can still cost money while it exists.
- **ECS Fargate**: API, worker, and one-off migration tasks consume vCPU and
  memory task hours. Keep desired counts low for the first run.
- **RDS PostgreSQL**: instance hours, allocated storage, autoscaled storage,
  backup retention, snapshots, and I/O can continue after the app is idle.
- **ElastiCache Redis**: node hours and snapshots can continue while the Redis
  replication group exists. Extra nodes or failover settings increase spend.
- **NAT Gateway**: gateway hours and data processing can become expensive for a
  small demo stack. Avoid NAT unless explicitly approved.
- **VPC endpoints**: interface endpoint hourly charges and data processing can
  still matter for a small demo stack. Prefer them over NAT for private ECS
  egress, but include them in the cost/timebox review.
- **CloudWatch Logs**: log ingestion and retained storage are usually smaller
  than the managed compute/data services, but they are still nonzero.

## Required Guardrails Before First Apply

- [ ] Create an AWS Budget for actual spend, for example `$20`.
- [ ] Create an AWS Budget for forecast spend, for example `$40`.
- [ ] Configure billing alarm or budget email notifications to a monitored
      address.
- [ ] Confirm active AWS credits and their expiration date.
- [ ] Confirm selected region, with `eu-central-1` as the default first choice.
- [ ] Confirm the teardown owner.
- [ ] Confirm the teardown timebox before apply, such as same day or a specific
      number of hours.
- [ ] Confirm the Terraform state owner and approved backend config location
      before any first remote backend init or apply.
- [ ] Confirm who is allowed to approve any NAT Gateway, Multi-AZ, failover, or
      longer-lived environment change.
- [ ] Check current AWS pricing for ALB, Fargate, RDS, ElastiCache, NAT, and
      CloudWatch in the selected region immediately before apply.

## Deployment Prerequisites Not Yet Implemented

- Approved secret value population for `DATABASE_URL`, `REDIS_URL`, and
  `WEBHOOK_SECRET`; Terraform only defines safe references/placeholders.
- Approved ECR image publishing using
  [ECR image publishing path](ecr-image-publishing.md):
  - no image has been published in the current phase;
  - no registry authentication is configured;
  - publishing requires an approved reviewed commit SHA, immutable tag or
    digest, and `container_image` handoff;
  - mutable tags such as `latest` are not allowed for deployment inputs.
- Private egress inputs for ECS tasks:
  - Terraform defines the preferred VPC endpoint path for ECR API, ECR Docker,
    CloudWatch Logs, Secrets Manager, and S3-backed ECR layer access;
  - approved existing VPC, private subnet, and private route table IDs are still
    required before apply;
  - explicit approval required: NAT Gateway;
  - short-lived compromise: only if the network and cost trade-off is written
    down before apply.
- Remote Terraform backend enablement. The backend/state decision is documented,
  but no remote backend is configured or enabled yet; first apply requires an
  approved state owner and backend config outside git.
- One-off migration task flow is documented in
  [One-off ECS migration task flow](aws-migration-task-flow.md), but the live
  run still requires explicit approval, populated `DATABASE_URL`, an approved
  image reference, backend/state approval, private egress inputs, and result
  recording before API/worker rollout.
- Deployed smoke test flow is documented in
  [AWS deployed smoke test flow](aws-smoke-test-flow.md), but the live run still
  requires an approved deployed API base URL, completed prerequisites, approved
  non-production webhook values, and an approved evidence path.

## Short-Lived Deploy Checklist

- [ ] Preflight: confirm budgets, billing notifications, credits, region,
      teardown owner, and teardown timebox.
- [ ] Review current pricing and the expected lifetime of ALB, Fargate, RDS,
      Redis, NAT or VPC endpoints, and CloudWatch Logs.
- [ ] Confirm the selected private route tables for the S3 gateway endpoint and
      private subnets for interface endpoints.
- [ ] Confirm backend config values are supplied through ignored
      `infra/terraform/backend.hcl` or an explicitly approved command, with no
      state files or real backend values committed.
- [ ] Select the reviewed commit SHA and immutable ECR tag or digest according
      to the documented image publishing path.
- [ ] Run the required checks before image publication: typecheck, lint, tests,
      build, Docker image build, schema drift check, dependency audit, forbidden
      wording scan, and credentials/account-safety scan.
- [ ] Approve image publication before any registry authentication or image
      publication step.
- [ ] Apply only after explicit approval for live AWS usage.
- [ ] Publish the approved Docker image to ECR with an immutable tag or digest.
- [ ] Set Terraform `container_image` to the approved immutable tag or digest
      through a non-secret, environment-specific input path.
- [ ] Wire approved secrets and non-secret environment values.
- [ ] Review the documented one-off migration task flow, then run the task
      only after explicit live-run approval and verify the stopped reason,
      container exit code, and CloudWatch logs.
- [ ] Deploy the API and worker services with small desired counts.
- [ ] Verify `GET /health/ready` through the deployed API path.
- [ ] Run the documented deployed smoke check only after the deployed API base
      URL and prerequisites are approved.
- [ ] Record the deployed smoke result, including image reference, commit SHA,
      migration record, operator, timestamp, and pass/fail decision.
- [ ] Inspect AWS Billing, Cost Explorer, and service consoles after the stack
      has been running long enough for usage to appear.
- [ ] On smoke failure or inconclusive evidence, stop rollout and decide
      whether to retry, roll back, scale down, or tear down within the approved
      timebox.
- [ ] Destroy or scale down the environment when the demo is complete or the
      smoke outcome requires it.

## Teardown Checklist

- [ ] Stop or destroy ECS API and worker services/tasks.
- [ ] Destroy ALB resources if the environment is no longer needed.
- [ ] Destroy RDS resources only after deciding whether a final snapshot is
      required.
- [ ] Destroy ElastiCache Redis resources and snapshots that should not remain.
- [ ] Review ECR lifecycle behavior and remove images or policies only as
      appropriate for the environment.
- [ ] Remove NAT Gateway or unused VPC endpoint resources if they were created
      in a later phase.
- [ ] Check the selected region for remaining billable resources, including
      load balancers, target groups, ECS services, task definitions, RDS
      instances, snapshots, ElastiCache clusters, NAT gateways, VPC endpoints,
      CloudWatch log groups, and ECR storage.
- [ ] Check AWS Billing and Cost Explorer after a delay because usage reporting
      is not always immediate.
- [ ] Keep budget notifications enabled until billing shows the expected state.

## Explicit Non-Goals

- No production hardening yet.
- No multi-region deployment.
- No autoscaling.
- No HTTPS, domain, or WAF unless added in later phases.
- No long-running unattended environment.
- No Terraform apply, destroy, import, image publication, registry
  authentication, credentials, account IDs, real ARNs, state files, or secrets
  in this scaffold.

## Approval Rule

The Terraform scaffold is still for review and validation until a live AWS
operation is explicitly approved. Image publication also requires explicit
approval before registry authentication or publication. A first apply should
happen only after the guardrails above are checked, the Terraform state owner
and backend config are approved, missing deployment prerequisites are resolved,
the migration task and deployed smoke live-run gates are understood, and the
teardown owner/timebox is clear. The short-lived deploy runbook records the
single future go/no-go order that connects those gates; it is not a substitute
for live-operation approval.
