# ECR Image Publishing Path

## Metadata

| Field | Value |
| --- | --- |
| Status | Documentation-only path, not executed |
| Scope | Future ECR image publication for `transaction-event-gateway` |
| Last updated | 2026-06-22 |

## Current Phase Status

This phase documents how an image should be selected, approved, published, and
passed to Terraform later. It does not publish an image, configure registry
authentication, add AWS credentials, add a deploy workflow, or run live AWS
commands.

Current CI verifies the production Docker image locally with:

```bash
docker build -t transaction-event-gateway:ci .
```

That local `:ci` tag is only a build check. It is not an ECR tag, release tag,
or deployed image reference.

The Terraform scaffold defines an ECR repository with immutable tags,
scan-on-push enabled, AES256 encryption, and a lifecycle policy that retains
the most recent 30 images. Those resources are scaffold only until a live apply
is explicitly approved.

## Publishing Decision

- Publish only from a reviewed commit SHA with a clean working tree.
- Use an immutable image tag, preferably the full commit SHA with a stable
  prefix such as `git-<full-commit-sha>`, or use the registry digest after
  publication.
- Do not use mutable tags such as `latest`, branch names, or moving release
  labels for Terraform deployments.
- Require explicit approval before registry authentication or image
  publication.
- Pass the approved immutable image reference into Terraform through
  `container_image`; do not hard-code real AWS account IDs, repository URLs,
  ARNs, credentials, tokens, or secrets in committed files.

## Image Selection and Tagging

The release owner selects the source commit before building the image. The
selected source must be a reviewed Git commit, not an uncommitted local tree.
The selected commit SHA becomes the image identity.

Recommended tag shape:

```text
git-<full-commit-sha>
```

The tag is only acceptable if it is never reused. The Terraform scaffold sets
`image_tag_mutability = "IMMUTABLE"` on the ECR repository so ECR rejects tag
overwrites after the repository exists.

For production-like deployments, prefer recording the ECR image digest after
publication and using the digest form in Terraform:

```text
<ecr-repository-url>@sha256:<image-digest>
```

An immutable tag is acceptable for early controlled environments:

```text
<ecr-repository-url>:git-<full-commit-sha>
```

Both forms must refer to the approved image built from the reviewed commit.

## Required Checks Before Publication

Run the existing local and CI checks before requesting image publication:

```bash
npm run typecheck
npm run lint
npm test
npm run build
docker compose config
docker build -t transaction-event-gateway:ci .
```

Future release gates should also include the checks already represented in CI
or release design:

- E2E tests when local PostgreSQL and Redis are available.
- Terraform scaffold formatting, backend-disabled init, and validation.
- Schema drift check against the test database.
- Production dependency audit.
- Forbidden wording scan.
- Credentials, AWS account ID, ARN, token, secret, and real repository URL
  scan.

If any required check fails, the image must not be published.

## Approval Gate

Image publication needs explicit approval from the deployment owner named for
the environment. Approval happens after verification passes and before any
registry authentication or image publication step.

The approval record should include:

- The reviewed commit SHA.
- The selected immutable tag or the requirement to capture and use a digest.
- The target environment.
- The intended ECR repository name or placeholder target, without committing a
  real account-specific URL unless that is separately approved.
- The Terraform `container_image` handoff path.
- Confirmation that no mutable `latest` tag will be used.
- Confirmation that cost, teardown, backend state, and secret population
  guardrails are satisfied if this publication is part of a live deployment.

## Future Flow

The expected future flow is:

1. Select the reviewed commit SHA for release.
2. Run all required checks from the same source revision.
3. Build the Docker image from the repository root with the existing
   `Dockerfile`.
4. Tag the image with the approved immutable tag.
5. Receive explicit approval for registry authentication and image
   publication.
6. Publish the approved image to ECR.
7. Capture the published image digest and scan result.
8. Set Terraform `container_image` to the approved immutable tag or digest.
9. Use that same image reference for the API, worker, and migration task
   definitions.

The one-off migration run order that consumes this same image is documented in
[One-off ECS migration task flow](aws-migration-task-flow.md). Steps 5 through
9 and the migration run remain future deployment work. They are intentionally
not added as automation in this phase.

## Terraform Handoff

`infra/terraform/variables.tf` defines `container_image`, and the ECS API,
worker, and migration task definitions consume that value. The committed
default stays as the non-routable placeholder
`example.invalid/transaction-event-gateway:replace-me`.

For a future approved deployment, supply `container_image` through an
environment-specific, non-secret process such as an ignored tfvars file or an
explicitly approved variable input. The value itself is not a password, but a
real ECR URL contains environment and account-specific details, so do not add
real values to committed examples without separate approval.

Acceptable future forms:

```text
container_image = "<ecr-repository-url>:git-<full-commit-sha>"
container_image = "<ecr-repository-url>@sha256:<image-digest>"
```

Do not set `container_image` to `latest`, a branch tag, a local-only tag, or a
placeholder for a live deployment.

## Out of Scope for This Phase

- No ECR image has been published.
- No registry authentication is configured.
- No AWS credentials, OIDC role, account ID, ARN, token, or secret is added.
- No deploy workflow is added.
- No Terraform plan, apply, destroy, or import is run.
- No AWS API call is made.
- No application, Dockerfile, package, or GitHub Actions behavior is changed.
