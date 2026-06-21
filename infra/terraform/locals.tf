locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = merge(
    {
      Environment = var.environment
      ManagedBy   = "terraform"
      Phase       = "aws-iac-scaffold"
      Project     = var.project_name
    },
    var.tags
  )

  networking_mode = var.create_vpc ? "future-managed-vpc" : "existing-vpc-inputs"
}
