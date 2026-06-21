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
  description = "Short ECR-safe project name used for future resource naming."
  type        = string
  default     = "transaction-event-gateway"

  validation {
    condition     = length(var.project_name) >= 3 && length(var.project_name) <= 48 && can(regex("^[a-z0-9]+(-[a-z0-9]+)*$", var.project_name))
    error_message = "project_name must be 3 to 48 lowercase letters or numbers, with single hyphens only between alphanumeric segments."
  }
}

variable "environment" {
  description = "Short ECR-safe deployment environment name used for future resource naming and tags."
  type        = string
  default     = "dev"

  validation {
    condition     = length(var.environment) >= 2 && length(var.environment) <= 32 && can(regex("^[a-z0-9]+(-[a-z0-9]+)*$", var.environment))
    error_message = "environment must be 2 to 32 lowercase letters or numbers, with single hyphens only between alphanumeric segments."
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

variable "api_task_cpu" {
  description = "Fargate CPU units for the API task definition."
  type        = number
  default     = 512

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096, 8192, 16384], var.api_task_cpu)
    error_message = "api_task_cpu must be a valid Fargate CPU value."
  }
}

variable "api_task_memory" {
  description = "Fargate memory in MiB for the API task definition."
  type        = number
  default     = 1024

  validation {
    condition     = var.api_task_memory >= 512 && var.api_task_memory == floor(var.api_task_memory)
    error_message = "api_task_memory must be an integer number of MiB and at least 512."
  }
}

variable "worker_task_cpu" {
  description = "Fargate CPU units for the worker task definition."
  type        = number
  default     = 512

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096, 8192, 16384], var.worker_task_cpu)
    error_message = "worker_task_cpu must be a valid Fargate CPU value."
  }
}

variable "worker_task_memory" {
  description = "Fargate memory in MiB for the worker task definition."
  type        = number
  default     = 1024

  validation {
    condition     = var.worker_task_memory >= 512 && var.worker_task_memory == floor(var.worker_task_memory)
    error_message = "worker_task_memory must be an integer number of MiB and at least 512."
  }
}

variable "migration_task_cpu" {
  description = "Fargate CPU units for the one-off migration task definition."
  type        = number
  default     = 256

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096, 8192, 16384], var.migration_task_cpu)
    error_message = "migration_task_cpu must be a valid Fargate CPU value."
  }
}

variable "migration_task_memory" {
  description = "Fargate memory in MiB for the one-off migration task definition."
  type        = number
  default     = 512

  validation {
    condition     = var.migration_task_memory >= 512 && var.migration_task_memory == floor(var.migration_task_memory)
    error_message = "migration_task_memory must be an integer number of MiB and at least 512."
  }
}

variable "ecs_log_retention_days" {
  description = "CloudWatch Logs retention in days for ECS API, worker, and migration task log groups."
  type        = number
  default     = 30

  validation {
    condition = contains([
      1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180,
      365, 400, 545, 731, 1096, 1827, 2192, 2557, 3653
    ], var.ecs_log_retention_days)
    error_message = "ecs_log_retention_days must be a CloudWatch Logs supported retention value."
  }
}

variable "app_environment_variables" {
  description = "Non-secret environment variables injected into ECS task definitions. Do not include database, Redis, webhook, or AWS credential secrets."
  type        = map(string)
  default = {
    NODE_ENV = "production"
    PORT     = "3000"
  }

  validation {
    condition = alltrue([
      for name in keys(var.app_environment_variables) :
      can(regex("^[A-Z][A-Z0-9_]*$", name)) &&
      !contains([
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "DATABASE_URL",
        "REDIS_URL",
        "WEBHOOK_SECRET",
      ], name)
    ])
    error_message = "app_environment_variables keys must be uppercase env names and must not include secrets or AWS credentials."
  }
}

variable "create_vpc" {
  description = "Future switch for a managed VPC path. The current scaffold does not create VPC resources."
  type        = bool
  default     = false
}

variable "vpc_id" {
  description = "Existing VPC ID for security groups. Keep null during scaffold-only validation when not planning or applying."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.vpc_id == null || can(regex("^vpc-[0-9a-f]{8,17}$", var.vpc_id))
    error_message = "vpc_id must be null or look like vpc- followed by 8 to 17 lowercase hex characters."
  }
}

variable "public_subnet_ids" {
  description = "Existing public subnet IDs intended for a future public ALB. This scaffold does not create subnets."
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
  description = "Existing private subnet IDs intended for future ECS, RDS, Redis, and migration tasks. This scaffold does not create subnets."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for subnet_id in var.private_subnet_ids : can(regex("^subnet-[0-9a-f]{8,17}$", subnet_id))
    ])
    error_message = "Every private subnet ID must look like subnet- followed by 8 to 17 lowercase hex characters."
  }
}

variable "allowed_http_cidrs" {
  description = "IPv4 CIDR blocks allowed to reach the future public ALB over HTTP. MVP default is open internet for review only."
  type        = list(string)
  default     = ["0.0.0.0/0"]

  validation {
    condition = length(var.allowed_http_cidrs) > 0 && alltrue([
      for cidr in var.allowed_http_cidrs : can(cidrhost(cidr, 0)) && can(regex("^([0-9]{1,3}\\.){3}[0-9]{1,3}/[0-9]{1,2}$", cidr))
    ])
    error_message = "allowed_http_cidrs must contain one or more IPv4 CIDR blocks, for example 203.0.113.0/24."
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

variable "alb_port" {
  description = "Public HTTP listener port for the future ALB. Defaults to 80 for the MVP ALB slice."
  type        = number
  default     = 80

  validation {
    condition     = var.alb_port >= 1 && var.alb_port <= 65535
    error_message = "alb_port must be between 1 and 65535."
  }
}

variable "alb_enable_deletion_protection" {
  description = "Whether to enable deletion protection on the future ALB. Defaults to false for the no-apply MVP scaffold."
  type        = bool
  default     = false
}

variable "postgres_port" {
  description = "PostgreSQL port for the future RDS instance."
  type        = number
  default     = 5432

  validation {
    condition     = var.postgres_port >= 1 && var.postgres_port <= 65535
    error_message = "postgres_port must be between 1 and 65535."
  }
}

variable "postgres_engine_version" {
  description = "PostgreSQL engine version for the RDS instance."
  type        = string
  default     = "16.6"

  validation {
    condition     = can(regex("^[0-9]+(\\.[0-9]+)?$", var.postgres_engine_version))
    error_message = "postgres_engine_version must be a PostgreSQL major or major.minor version, for example 16 or 16.6."
  }
}

variable "postgres_instance_class" {
  description = "RDS instance class for PostgreSQL."
  type        = string
  default     = "db.t4g.micro"

  validation {
    condition     = can(regex("^db\\.[a-z0-9][a-z0-9.-]*$", var.postgres_instance_class))
    error_message = "postgres_instance_class must look like an RDS instance class, for example db.t4g.micro."
  }
}

variable "postgres_allocated_storage" {
  description = "Initial PostgreSQL allocated storage in GiB."
  type        = number
  default     = 20

  validation {
    condition     = var.postgres_allocated_storage >= 20 && var.postgres_allocated_storage == floor(var.postgres_allocated_storage)
    error_message = "postgres_allocated_storage must be an integer of at least 20 GiB."
  }
}

variable "postgres_max_allocated_storage" {
  description = "Maximum PostgreSQL autoscaled storage in GiB. Keep greater than or equal to postgres_allocated_storage."
  type        = number
  default     = 100

  validation {
    condition     = var.postgres_max_allocated_storage >= 20 && var.postgres_max_allocated_storage == floor(var.postgres_max_allocated_storage)
    error_message = "postgres_max_allocated_storage must be an integer of at least 20 GiB."
  }
}

variable "postgres_db_name" {
  description = "Initial PostgreSQL database name."
  type        = string
  default     = "transaction_event_gateway"

  validation {
    condition     = length(var.postgres_db_name) >= 1 && length(var.postgres_db_name) <= 63 && can(regex("^[A-Za-z][A-Za-z0-9_]*$", var.postgres_db_name))
    error_message = "postgres_db_name must be 1 to 63 characters, start with a letter, and contain only letters, digits, and underscores."
  }
}

variable "postgres_username" {
  description = "PostgreSQL master username. The password is managed by RDS and is not stored in Terraform files."
  type        = string
  default     = "app"

  validation {
    condition     = length(var.postgres_username) >= 1 && length(var.postgres_username) <= 63 && lower(var.postgres_username) != "postgres" && can(regex("^[A-Za-z][A-Za-z0-9_]*$", var.postgres_username))
    error_message = "postgres_username must be 1 to 63 characters, start with a letter, contain only letters, digits, and underscores, and must not be postgres."
  }
}

variable "postgres_backup_retention_days" {
  description = "PostgreSQL automated backup retention period in days."
  type        = number
  default     = 7

  validation {
    condition     = var.postgres_backup_retention_days >= 0 && var.postgres_backup_retention_days <= 35 && var.postgres_backup_retention_days == floor(var.postgres_backup_retention_days)
    error_message = "postgres_backup_retention_days must be an integer between 0 and 35."
  }
}

variable "postgres_multi_az" {
  description = "Whether to deploy PostgreSQL as a Multi-AZ RDS instance."
  type        = bool
  default     = false
}

variable "postgres_deletion_protection" {
  description = "Whether to enable deletion protection on the PostgreSQL RDS instance. Defaults to false for the no-apply MVP scaffold."
  type        = bool
  default     = false
}

variable "postgres_skip_final_snapshot" {
  description = "Whether to skip the final snapshot when destroying PostgreSQL. Defaults to true for the no-apply MVP scaffold; production should usually set this to false."
  type        = bool
  default     = true
}

variable "redis_port" {
  description = "Redis port for the ElastiCache replication group."
  type        = number
  default     = 6379

  validation {
    condition     = var.redis_port >= 1 && var.redis_port <= 65535
    error_message = "redis_port must be between 1 and 65535."
  }
}

variable "redis_node_type" {
  description = "ElastiCache node type for Redis."
  type        = string
  default     = "cache.t4g.micro"

  validation {
    condition     = can(regex("^cache\\.[a-z0-9][a-z0-9.-]*$", var.redis_node_type))
    error_message = "redis_node_type must look like an ElastiCache node type, for example cache.t4g.micro."
  }
}

variable "redis_engine_version" {
  description = "Redis engine version for the ElastiCache replication group."
  type        = string
  default     = "7.1"

  validation {
    condition     = can(regex("^[0-9]+(\\.[0-9]+)?$", var.redis_engine_version))
    error_message = "redis_engine_version must be a Redis major or major.minor version, for example 7 or 7.1."
  }
}

variable "redis_num_cache_clusters" {
  description = "Number of cache clusters in the Redis replication group. Use at least 2 with automatic failover."
  type        = number
  default     = 1

  validation {
    condition     = var.redis_num_cache_clusters >= 1 && var.redis_num_cache_clusters <= 6 && var.redis_num_cache_clusters == floor(var.redis_num_cache_clusters)
    error_message = "redis_num_cache_clusters must be an integer between 1 and 6."
  }
}

variable "redis_automatic_failover_enabled" {
  description = "Whether to enable automatic failover for Redis. Requires at least two cache clusters."
  type        = bool
  default     = false
}

variable "redis_multi_az_enabled" {
  description = "Whether to enable Multi-AZ for Redis. Requires automatic failover."
  type        = bool
  default     = false
}

variable "redis_at_rest_encryption_enabled" {
  description = "Whether to enable at-rest encryption for Redis."
  type        = bool
  default     = true
}

variable "redis_transit_encryption_enabled" {
  description = "Whether to enable in-transit encryption for Redis. Defaults to false because current app configuration accepts redis:// URLs only."
  type        = bool
  default     = false
}

variable "redis_snapshot_retention_limit" {
  description = "Number of days to retain automatic Redis snapshots. Use 0 to disable snapshots."
  type        = number
  default     = 7

  validation {
    condition     = var.redis_snapshot_retention_limit >= 0 && var.redis_snapshot_retention_limit <= 35 && var.redis_snapshot_retention_limit == floor(var.redis_snapshot_retention_limit)
    error_message = "redis_snapshot_retention_limit must be an integer between 0 and 35."
  }
}

variable "redis_apply_immediately" {
  description = "Whether Redis changes should apply immediately. Defaults to false so reviewed changes can wait for the next maintenance window."
  type        = bool
  default     = false
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
