aws_region      = "us-east-1"
project_name    = "transaction-event-gateway"
environment     = "dev"
container_image = "example.invalid/transaction-event-gateway:replace-me"

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
health_check_path = "/health/ready"

tags = {
  Owner = "example"
}
