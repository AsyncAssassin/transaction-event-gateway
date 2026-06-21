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

app_port          = 3000
alb_port          = 80
postgres_port     = 5432
redis_port        = 6379
health_check_path = "/health/ready"

allowed_http_cidrs = [
  "0.0.0.0/0",
]

tags = {
  Owner = "example"
}
