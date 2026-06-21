aws_region      = "us-east-1"
project_name    = "transaction-event-gateway"
environment     = "dev"
container_image = "example.invalid/transaction-event-gateway:replace-me"

# Fake placeholder values for local review only. Replace them per environment
# before any approved plan or apply.
create_vpc = false
vpc_id     = "vpc-aaaaaaaaaaaaaaaaa"

public_subnet_ids = [
  "subnet-aaaaaaaaaaaaaaaaa",
  "subnet-bbbbbbbbbbbbbbbbb",
]

private_subnet_ids = [
  "subnet-ccccccccccccccccc",
  "subnet-ddddddddddddddddd",
]

app_port                       = 3000
alb_port                       = 80
alb_enable_deletion_protection = false
postgres_port                  = 5432
postgres_engine_version        = "16.6"
postgres_instance_class        = "db.t4g.micro"
postgres_allocated_storage     = 20
postgres_max_allocated_storage = 100
postgres_db_name               = "transaction_event_gateway"
postgres_username              = "app"
postgres_backup_retention_days = 7
postgres_multi_az              = false
postgres_deletion_protection   = false
postgres_skip_final_snapshot   = true
redis_port                     = 6379
health_check_path              = "/health/ready"

allowed_http_cidrs = [
  "0.0.0.0/0",
]

tags = {
  Owner = "example"
}
