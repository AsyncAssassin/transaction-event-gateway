# AWS Terraform Scaffold

## Status

This directory is an incremental Terraform scaffold for a future AWS MVP
deployment of `transaction-event-gateway`. It currently defines only the ECR
repository needed to store application images. It is not ready for `apply` and
does not require AWS credentials for formatting or validation.

The current Terraform files are intended to support structure review,
formatting, and validation only. They should not be used to create, update, or
delete live infrastructure in this phase without explicit approval.

## Current contents

- `versions.tf`: Terraform and AWS provider version constraints.
- `providers.tf`: AWS provider configuration through variables only. No
  credentials are configured here.
- `variables.tf`: baseline inputs for region, naming, image reference,
  networking, port, health check path, and tags.
- `locals.tf`: shared naming and tag values for future resources.
- `main.tf`: phase overview and future resource group notes.
- `ecr.tf`: ECR repository, immutable tag policy, scan-on-push setting, AES256
  encryption, and a small image retention policy.
- `outputs.tf`: scaffold outputs plus ECR repository name, URL, and ARN.
- `example.tfvars`: dummy values for local review. Do not put real secrets here.

## Planned AWS resource phases

The resource implementation should continue in small phases after review:

1. State backend design and environment layout.
2. Network path selection: existing VPC inputs first, optional managed VPC later.
3. IAM roles, security groups, and CloudWatch log groups.
4. ECS cluster, API task definition, and API service.
5. ALB, target group, HTTPS listener, and `/health/ready` health check.
6. ECS worker task definition and worker service with no inbound traffic.
7. One-off ECS migration task definition.
8. RDS PostgreSQL and ElastiCache Redis in private networking.
9. Secrets Manager or SSM Parameter Store wiring for runtime values.
10. Release workflow design after explicit approval.

## Variables

| Variable | Purpose |
| --- | --- |
| `aws_region` | Target AWS region for future resources. |
| `project_name` | Short ECR-safe name used in future resource names and tags. Lowercase letters and digits with single hyphens between segments. |
| `environment` | Short ECR-safe environment name such as `dev`, `stage`, or `staging-1`. Lowercase letters and digits with single hyphens between segments. |
| `container_image` | Future ECS image reference. Use an immutable tag or digest later. |
| `create_vpc` | Future switch for managed VPC creation. Current scaffold defaults to existing VPC inputs. |
| `vpc_id` | Existing VPC ID for the future existing-network path. |
| `public_subnet_ids` | Public subnets intended for a future ALB. |
| `private_subnet_ids` | Private subnets intended for future ECS, RDS, Redis, and migration tasks. |
| `app_port` | API container port. Defaults to `3000`. |
| `health_check_path` | Future ALB health check path. Defaults to `/health/ready`. |
| `tags` | Additional non-secret tags for future AWS resources. |

## Current ECR scope

This phase defines only ECR resources:

- `aws_ecr_repository.app`: application image repository named from
  `local.name_prefix`, with immutable image tags, scan on push, and AES256
  encryption.
- `aws_ecr_lifecycle_policy.app`: retention policy that keeps the most recent
  30 images.

No ECS, RDS, Redis, VPC, IAM, secrets, deployment workflow, registry login, or
image push behavior is implemented in this phase.

Do not store AWS credentials, account IDs, secret values, real ARNs, database
URLs, Redis URLs, or webhook secrets in Terraform files or tfvars files.

## State backend plan

No remote backend is configured yet. During this scaffold phase, validation
should use `init -backend=false` and should not create Terraform state.

A later phase should add an S3 backend with locking after the AWS account,
region, bucket naming, encryption policy, and access model are approved. The
future backend shape should be documented before use, for example:

```hcl
terraform {
  backend "s3" {
    bucket         = "example-terraform-state-bucket"
    key            = "transaction-event-gateway/dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "example-terraform-locks"
  }
}
```

The values above are placeholders only.

## Safe validation commands

These commands are allowed for scaffold review:

```bash
terraform -chdir=infra/terraform fmt -check
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate
```

`init -backend=false` may download the Terraform provider from the Terraform
registry, but it should not contact AWS APIs and should not require AWS
credentials.

## Commands requiring explicit approval

Do not run these commands for this phase without explicit approval:

```bash
terraform -chdir=infra/terraform plan
terraform -chdir=infra/terraform apply
terraform -chdir=infra/terraform destroy
terraform -chdir=infra/terraform import
aws ecr get-login-password
docker push
```

Also do not add deployment workflows, push images to ECR, create AWS resources,
or add credentials or secret values.
