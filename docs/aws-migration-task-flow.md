# One-off ECS Migration Task Flow

## Metadata

| Field | Value |
| --- | --- |
| Status | Documentation-only flow, not executed |
| Scope | Future approval-gated ECS database migration task before API/worker rollout |
| Last updated | 2026-06-22 |

## Current Phase Status

This document records the intended operator flow for a future one-off ECS
migration task. It does not approve a live AWS operation, does not run a
migration, does not add a task runner, does not add deployment automation, and
does not change Terraform state.

The Terraform scaffold already defines a migration task definition. The run
step remains a future manual, approval-gated deployment action.

## Existing Terraform Contract

The migration task definition is `aws_ecs_task_definition.migration` in
`infra/terraform/ecs-tasks.tf`.

Its current contract is:

- It uses the same `var.container_image` value as the API and worker task
  definitions.
- It runs `npm run migration:run:prod`.
- It receives the shared non-secret ECS environment defaults.
- It receives only `DATABASE_URL` as a Secrets Manager secret.
- It writes to the dedicated migration CloudWatch log group.
- It uses Fargate with `awsvpc` networking and is intended to run in private
  subnets with the ECS task security group.

The task definition is only scaffold until Terraform apply is separately
approved and the required image, secrets, backend, and private networking
inputs exist.

## Required Approvals Before Any Live Run

Before a migration task is run in AWS, the deployment owner must approve:

- The reviewed commit SHA for the release.
- The immutable image tag or digest selected through
  [ECR image publishing path](ecr-image-publishing.md).
- The target environment and region.
- Terraform state owner and backend configuration.
- Secret value population for `DATABASE_URL`.
- Existing VPC, private subnet, private route table, and private egress inputs.
- The exact migration set included in the image.
- The expected lock behavior, duration, and rollback or compensating plan.
- The operator who will run the task and record the result.

Destructive, revert, irreversible, or data-rewrite migrations require a
separate explicit approval. This flow only describes the forward
`npm run migration:run:prod` path.

## Future Approved Flow

1. Select the reviewed commit SHA and confirm the working tree used for the
   image build is clean.
2. Complete the required checks from
   [ECR image publishing path](ecr-image-publishing.md).
3. Publish the approved image only after image publication approval, then
   record the immutable tag or digest.
4. Pass the approved image reference to Terraform through `container_image`.
5. Confirm the API, worker, and migration task definitions all use that same
   approved image reference.
6. Confirm the `DATABASE_URL` secret value exists through an approved
   out-of-git process.
7. Confirm the migration task will run in private subnets with the ECS task
   security group and the approved private egress path.
8. Run the one-off ECS migration task only after explicit live-run approval.
9. Watch the migration CloudWatch logs while the task runs.
10. Inspect the ECS task stopped reason and container exit code.
11. Stop the API/worker rollout if the task exits with any non-zero code, has
    an unexpected stopped reason, or emits unsafe migration logs.
12. Continue to API and worker rollout only after the migration task completes
    successfully and the result is recorded.
13. After API and worker rollout, use
    [AWS deployed smoke test flow](aws-smoke-test-flow.md) only when the
    deployed API base URL, non-production webhook values, and evidence path are
    approved.

The migration must run before API and worker rollout whenever the release code
expects the new schema.

## Required Result Record

The operator should record these values in the deployment notes for the target
environment:

- Migration task ARN.
- Migration task definition ARN or revision.
- Approved image tag or digest.
- Reviewed commit SHA.
- Target environment and region.
- Operator.
- Approval reference.
- Start and finish timestamp.
- Final ECS task stopped reason.
- Migration container exit code.
- CloudWatch log group and stream reference.
- Decision: rollout continued or rollout stopped.

Do not record database URLs, credentials, secret values, access tokens, AWS
account IDs, or real ARNs in committed repository files unless a separate
approval explicitly permits that metadata to be committed.

## Failure Handling

If the migration task fails or is inconclusive:

- Stop the rollout before updating API or worker services.
- Preserve CloudWatch logs and ECS task status details for diagnosis.
- Review whether the database changed before deciding on retry, compensation,
  restore, or a new migration.
- Do not run `migration:revert:prod` or any destructive command without a
  separate explicit approval.
- Do not reuse a failed migration result as approval for later service rollout.

## Explicit Non-Goals

- No live AWS command is approved by this document.
- No migration has been run.
- No image has been published by this document.
- No Terraform plan, apply, destroy, or import is approved by this document.
- No registry authentication, image push, task runner, deploy workflow, shell
  script, package script, or GitHub Actions workflow is added by this document.
- No deployed smoke test is run or approved by this document.
- No AWS account IDs, real ARNs, credentials, tokens, database URLs, or secrets
  should be committed as part of this flow.
