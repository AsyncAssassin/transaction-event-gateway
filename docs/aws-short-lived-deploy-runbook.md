# AWS Short-Lived Deploy Runbook

## Metadata

| Field | Value |
| --- | --- |
| Status | Documentation-only runbook, not executed |
| Scope | Future approval-gated short-lived AWS deploy coordination |
| Last updated | 2026-06-23 |

## Current Phase Status

This runbook links the existing AWS deployment documents into one future
operator order for a short-lived AWS deploy. It does not approve live AWS
usage, does not run Terraform, does not call AWS APIs, does not authenticate to
any registry, does not publish an image, does not deploy services, and does not
run a smoke test against a real URL.

The runbook intentionally contains no runnable live commands. Any future live
operation requires separate explicit approval, placeholder replacement through
an approved out-of-git process, and a deployment record for the target
environment. Do not commit real AWS account IDs, ARNs, deployed URLs,
credentials, tokens, database URLs, Redis URLs, webhook secrets, or secret
values.

## Source Documents

- [AWS deploy guardrails](aws-deploy-guardrails.md): budget, billing, region,
  first-deploy prerequisites, and teardown guardrails.
- [AWS deployment design](aws-deployment-design.md): target ECS, RDS, Redis,
  ALB, secrets, networking, migration, release, rollback, and observability
  shape.
- [ECR image publishing path](ecr-image-publishing.md): future image
  selection, approval, immutable tag or digest, and Terraform handoff.
- [One-off ECS migration task flow](aws-migration-task-flow.md): future
  migration task approval, run order, stop criteria, and result record.
- [AWS deployed smoke test flow](aws-smoke-test-flow.md): future deployed API
  smoke prerequisites, checks, evidence policy, and result record.
- [Terraform scaffold notes](../infra/terraform/README.md): current IaC scope,
  backend/state notes, private egress scaffold, runtime secret placeholders,
  and validation-only status.

## Deployment Record

Create the target environment deployment record before any live work starts.
The record belongs outside this repository if it contains real environment
identifiers.

| Field | Required before live work | Notes |
| --- | --- | --- |
| Operator | Yes | Person running the approved deployment steps and recording evidence. |
| Approver | Yes | Person approving live AWS usage for the target environment. |
| Target region | Yes | Confirm the selected AWS region before backend, image, or deploy work. |
| Backend config owner | Yes | Owner of remote state config and locking decision; no real values in git. |
| Image ref | Before rollout | Approved immutable tag or digest; never `latest` or a moving tag. |
| Commit SHA | Before image publication | Reviewed source commit used for the image. |
| Migration record | Before API/worker rollout | Required success record from the one-off migration task flow. |
| Smoke result | Before success claim | Required pass/fail record from the deployed smoke test flow. |
| Teardown owner/timebox | Yes | Named owner and deadline for teardown, scale-down, or rollback decision. |

If any required record field is unknown at its gate, stop and resolve it before
continuing.

## Preflight Go/No-Go Checklist

- [ ] Budget, billing notification, AWS credits, pricing review, target
      region, teardown owner, and teardown timebox are confirmed through
      [AWS deploy guardrails](aws-deploy-guardrails.md).
- [ ] Terraform backend/state owner, backend config location, and locking
      approach are approved before any remote backend or live infrastructure
      operation.
- [ ] Existing VPC, private subnet, and private route table inputs are approved
      for the private egress path, or an explicit documented alternative is
      approved.
- [ ] Runtime secret value population is approved for `DATABASE_URL`,
      `REDIS_URL`, and `WEBHOOK_SECRET` through an out-of-git process.
- [ ] The release commit SHA is reviewed and the image reference is immutable
      according to [ECR image publishing path](ecr-image-publishing.md).
- [ ] The migration task live-run approval, risk review, operator, and result
      record path are ready according to
      [One-off ECS migration task flow](aws-migration-task-flow.md).
- [ ] The API/worker rollout gate is clear: same approved image reference,
      small desired counts, readiness expectations, and rollback path.
- [ ] The deployed smoke gate is clear: approved deployed API base URL,
      non-production webhook values, evidence path, and result record.
- [ ] Monitoring window owner, expected duration, log inspection path, and cost
      follow-up are confirmed.
- [ ] Teardown, scale-down, rollback, and final snapshot decisions have named
      owners and deadlines.

## Approved Execution Order

This order is descriptive only. It is the sequence a future approved operator
should follow after separate live-deploy approval is granted.

1. Open the deployment record and name the operator, approver, target region,
   backend config owner, and teardown owner/timebox.
2. Complete budget, billing, credits, pricing, region, and teardown preflight
   using [AWS deploy guardrails](aws-deploy-guardrails.md).
3. Approve backend/state ownership, remote backend config handling, and locking
   before any state-bearing infrastructure operation.
4. Approve private egress inputs for ECS image pulls, CloudWatch Logs, Secrets
   Manager access, and S3-backed ECR layer access.
5. Approve runtime secret value population for `DATABASE_URL`, `REDIS_URL`, and
   `WEBHOOK_SECRET` without committing secret values.
6. Select the reviewed commit SHA, complete required checks, approve image
   publication, and capture the immutable image tag or digest through
   [ECR image publishing path](ecr-image-publishing.md).
7. Hand the approved immutable image reference to Terraform through the
   approved non-secret input path for `container_image`.
8. Stop at the live infrastructure boundary unless explicit approval exists for
   the target environment, backend config, private egress inputs, secrets, and
   image reference.
9. After approved infrastructure and task definition work, run the one-off
   migration task only under the approved
   [migration task flow](aws-migration-task-flow.md). Record the result.
10. Continue to API and worker rollout only when the migration record is
    successful, the stopped reason and exit code are acceptable, and the logs
    are safe.
11. Roll out the API service, then the worker service, using the same approved
    immutable image reference and conservative desired counts.
12. Confirm readiness expectations before traffic or smoke is treated as valid.
13. Run the deployed smoke flow only after its prerequisites are approved in
    [AWS deployed smoke test flow](aws-smoke-test-flow.md). Record pass/fail
    and evidence.
14. Hold the agreed monitoring window for API, worker, migration, outbox,
    webhook processing, readiness, logs, and billing/cost signals.
15. Make the teardown, scale-down, rollback, or keep-alive decision within the
    approved timebox.

## Required Artifacts and Owners

| Artifact | Owner | Required evidence |
| --- | --- | --- |
| Budget and billing guardrails | Approver or environment owner | Actual and forecast budgets, notifications, credits, region, pricing review, teardown timebox. |
| Backend/state config | Backend config owner | Approved backend config handling and locking approach; no state files or real backend values committed. |
| Private egress inputs | Network or deployment owner | Approved VPC, private subnet, private route table, endpoint, or explicit alternative decision. |
| Runtime secrets | Secret owner | Approved population path for `DATABASE_URL`, `REDIS_URL`, and `WEBHOOK_SECRET`; no secret values in git. |
| Image reference | Release owner | Reviewed commit SHA plus immutable tag or digest; no mutable deployment tag. |
| Migration result | Migration operator | Result record from the one-off migration task flow. |
| API/worker rollout | Deployment operator | Approved task definitions or rollout notes using the same image reference. |
| Smoke result | Smoke operator | Result record from the deployed smoke test flow with safe evidence only. |
| Monitoring window | Operations owner | Timebox, log and readiness review, billing follow-up, and final decision notes. |
| Teardown/cleanup | Teardown owner | Teardown, scale-down, rollback, final snapshot, and cost follow-up decision. |

## Explicit Stop Points

Stop the future deploy and do not continue to the next gate if any of these are
true:

- Budget, billing alerts, AWS credits review, selected region, teardown owner,
  or teardown timebox are missing.
- Backend/state ownership, backend config handling, or locking approach is
  unclear.
- The image reference is not immutable, is not tied to the reviewed commit SHA,
  or uses a moving tag such as `latest`.
- Required secret values are not populated through an approved out-of-git
  process.
- Private egress inputs are unresolved, or a NAT/cost alternative lacks
  explicit approval.
- Live infrastructure work has not received explicit approval for the target
  environment.
- The migration task fails, has an unsafe stopped reason, exits non-zero, emits
  unsafe logs, or lacks a completed result record.
- API readiness fails, worker rollout is inconclusive, or the rollout cannot be
  tied to the approved image reference.
- The deployed smoke test fails, is inconclusive, lacks an approved evidence
  path, or exposes sensitive data.
- Monitoring ownership, teardown owner, teardown deadline, rollback owner, or
  final snapshot decision is missing.

## Teardown and Cleanup Decision

The teardown decision must exist before live work starts and must be revisited
after smoke and monitoring:

- **Tear down** when the demo is complete, smoke fails, evidence is
  inconclusive, cost guardrails require removal, or no owner accepts a longer
  lifetime.
- **Scale down** only when the approver accepts the remaining billable
  resources and names a new review deadline.
- **Rollback** when rollout or smoke fails but the environment should stay
  inside the approved timebox for diagnosis.
- **Keep alive** only with a renewed owner, renewed timebox, cost review,
  monitoring plan, and explicit approval.

Before destroying data services, decide whether a final RDS snapshot is
required. After cleanup, inspect for remaining billable resources according to
the [teardown checklist](aws-deploy-guardrails.md#teardown-checklist) and keep
budget notifications active until billing reflects the expected state.

## Phase Non-Goals

- No live AWS deploy was run by this document.
- No Terraform `plan`, `apply`, `destroy`, or `import` was run or approved by
  this document.
- No AWS CLI, AWS API, registry authentication, image publication, deploy
  workflow, shell script, package script, GitHub Actions workflow, or smoke run
  against a real URL is added by this document.
- No real AWS account IDs, ARNs, URLs, credentials, tokens, database URLs,
  Redis URLs, webhook secrets, or secret values should be committed as part of
  this runbook.
