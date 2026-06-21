variable "aws_region" {
  description = "AWS region intended for a future deployment. No credentials are configured in this scaffold."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]+$", var.aws_region))
    error_message = "aws_region must look like an AWS region, for example us-east-1."
  }
}

variable "project_name" {
  description = "Short project name used for future resource naming."
  type        = string
  default     = "transaction-event-gateway"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,47}$", var.project_name))
    error_message = "project_name must be 3 to 48 lowercase letters, numbers, or hyphens, and start with a letter."
  }
}

variable "environment" {
  description = "Deployment environment name used for future resource naming and tags."
  type        = string
  default     = "dev"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,31}$", var.environment))
    error_message = "environment must be 2 to 32 lowercase letters, numbers, or hyphens, and start with a letter."
  }
}

variable "container_image" {
  description = "Future ECS container image reference. Use an immutable tag or digest in real environments."
  type        = string
  default     = "example.invalid/transaction-event-gateway:replace-me"

  validation {
    condition     = length(trimspace(var.container_image)) > 0
    error_message = "container_image must not be empty."
  }
}

variable "create_vpc" {
  description = "Future switch for a managed VPC path. The current scaffold assumes existing VPC inputs."
  type        = bool
  default     = false
}

variable "vpc_id" {
  description = "Existing VPC ID for the future existing-network path. Keep null during scaffold-only validation."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.vpc_id == null || can(regex("^vpc-[0-9a-f]{8,17}$", var.vpc_id))
    error_message = "vpc_id must be null or look like vpc- followed by 8 to 17 lowercase hex characters."
  }
}

variable "public_subnet_ids" {
  description = "Existing public subnet IDs intended for the future ALB."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for subnet_id in var.public_subnet_ids : can(regex("^subnet-[0-9a-f]{8,17}$", subnet_id))
    ])
    error_message = "Every public subnet ID must look like subnet- followed by 8 to 17 lowercase hex characters."
  }
}

variable "private_subnet_ids" {
  description = "Existing private subnet IDs intended for future ECS, RDS, Redis, and migration tasks."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for subnet_id in var.private_subnet_ids : can(regex("^subnet-[0-9a-f]{8,17}$", subnet_id))
    ])
    error_message = "Every private subnet ID must look like subnet- followed by 8 to 17 lowercase hex characters."
  }
}

variable "app_port" {
  description = "Container port for the API service and future ALB target group."
  type        = number
  default     = 3000

  validation {
    condition     = var.app_port >= 1 && var.app_port <= 65535
    error_message = "app_port must be between 1 and 65535."
  }
}

variable "health_check_path" {
  description = "Future ALB health check path for API readiness."
  type        = string
  default     = "/health/ready"

  validation {
    condition     = startswith(var.health_check_path, "/")
    error_message = "health_check_path must start with /."
  }
}

variable "tags" {
  description = "Additional non-secret tags to merge into future AWS resources."
  type        = map(string)
  default     = {}
}
