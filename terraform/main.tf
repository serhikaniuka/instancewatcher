terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      instance_watcher = "true"
    }
  }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      instance_watcher = "true"
    }
  }
}

# ------------------------------------------------------------------------------
# DynamoDB
# ------------------------------------------------------------------------------

resource "aws_dynamodb_table" "state" {
  name         = "instanceec2_state"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "instance_id"

  attribute {
    name = "instance_id"
    type = "S"
  }
}

resource "aws_dynamodb_table" "action" {
  name         = "instanceec2_action"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "action_id"

  attribute {
    name = "action_id"
    type = "S"
  }
}

# ------------------------------------------------------------------------------
# Lambda build (null_resource + local-exec)
# ------------------------------------------------------------------------------

locals {
  root_dir           = abspath("${path.module}/..")
  build_dir          = "${local.root_dir}/build"
  api_src_hash       = filebase64sha256("${local.root_dir}/lambdas/api/app.py")
  api_deps_hash      = filebase64sha256("${local.root_dir}/lambdas/requirements.txt")
  scheduler_src_hash = filebase64sha256("${local.root_dir}/lambdas/scheduler/app.py")

  frontend_dir   = "${local.root_dir}/frontend"
  frontend_files = fileset(local.frontend_dir, "**")
  content_type_map = {
    "html" = "text/html"
    "js"   = "application/javascript"
    "css"  = "text/css"
    "json" = "application/json"
    "png"  = "image/png"
    "jpg"  = "image/jpeg"
    "jpeg" = "image/jpeg"
    "svg"  = "image/svg+xml"
    "webp" = "image/webp"
    "gif"  = "image/gif"
    "ico"  = "image/x-icon"
    "txt"  = "text/plain"
  }
}

data "aws_route53_zone" "main" {
  name         = var.domain_zone
  private_zone = false
}

resource "null_resource" "build_api" {
  triggers = {
    api_py   = local.api_src_hash
    deps_txt = local.api_deps_hash
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      BUILD_DIR="${local.build_dir}"
      API_PKG="$BUILD_DIR/api_pkg"
      rm -rf "$API_PKG"
      mkdir -p "$API_PKG"
      pip install -q -t "$API_PKG" -r "${local.root_dir}/lambdas/requirements.txt"
      cp "${local.root_dir}/lambdas/api/app.py" "$API_PKG/"
      (cd "$API_PKG" && zip -q -r "$BUILD_DIR/api.zip" .)
      rm -rf "$API_PKG"
    EOT
    environment = {
      PIP_DISABLE_PIP_VERSION_CHECK = "1"
    }
  }
}

resource "null_resource" "build_scheduler" {
  triggers = {
    scheduler_py = local.scheduler_src_hash
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      BUILD_DIR="${local.build_dir}"
      mkdir -p "$BUILD_DIR"
      (cd "${local.root_dir}/lambdas/scheduler" && zip -q "$BUILD_DIR/scheduler.zip" app.py)
    EOT
  }
}

# ------------------------------------------------------------------------------
# IAM: API Lambda
# ------------------------------------------------------------------------------

resource "aws_iam_role" "api" {
  name = "${var.project_name}-api-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "api" {
  name = "${var.project_name}-api-lambda"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:DescribeRegions",
          "ec2:StartInstances",
          "ec2:StopInstances"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem"
        ]
        Resource = [
          aws_dynamodb_table.state.arn,
          "${aws_dynamodb_table.state.arn}/*",
          aws_dynamodb_table.action.arn,
          "${aws_dynamodb_table.action.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:*:*"
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# IAM: Scheduler Lambda
# ------------------------------------------------------------------------------

resource "aws_iam_role" "scheduler" {
  name = "${var.project_name}-scheduler-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  name = "${var.project_name}-scheduler-lambda"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:StopInstances"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:Scan",
          "dynamodb:DeleteItem",
          "dynamodb:PutItem"
        ]
        Resource = [
          aws_dynamodb_table.state.arn,
          "${aws_dynamodb_table.state.arn}/*",
          aws_dynamodb_table.action.arn,
          "${aws_dynamodb_table.action.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:*:*"
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# Lambda functions (build artifacts at build/api.zip and build/scheduler.zip;
# run build before plan, e.g. via scripts/deploy-terraform.sh)
# ------------------------------------------------------------------------------

resource "aws_lambda_function" "api" {
  function_name = "${var.project_name}-api"
  role          = aws_iam_role.api.arn
  handler       = "app.lambda_handler"
  runtime       = "python3.12"
  timeout       = 30
  memory_size   = 256

  filename         = "${local.root_dir}/build/api.zip"
  source_code_hash = filebase64sha256("${local.root_dir}/build/api.zip")

  environment {
    variables = {
      STATE_TABLE      = aws_dynamodb_table.state.name
      ACTION_TABLE     = aws_dynamodb_table.action.name
      ALLOWED_EMAIL    = var.allowed_email
      GOOGLE_CLIENT_ID = var.google_client_id
    }
  }

  depends_on = [null_resource.build_api]
}

resource "aws_lambda_function" "scheduler" {
  function_name = "${var.project_name}-scheduler"
  role          = aws_iam_role.scheduler.arn
  handler       = "app.lambda_handler"
  runtime       = "python3.12"
  timeout       = 30
  memory_size   = 256

  filename         = "${local.root_dir}/build/scheduler.zip"
  source_code_hash = filebase64sha256("${local.root_dir}/build/scheduler.zip")

  environment {
    variables = {
      STATE_TABLE  = aws_dynamodb_table.state.name
      ACTION_TABLE = aws_dynamodb_table.action.name
    }
  }

  depends_on = [null_resource.build_scheduler]
}

# ------------------------------------------------------------------------------
# HTTP API Gateway v2
# ------------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["Authorization", "Content-Type"]
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /health"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "instances" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /instances"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "start" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /instances/{instance_id}/start"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "set_duration" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /instances/{instance_id}/set-duration"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_route" "options_proxy" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "OPTIONS /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "api_gw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ------------------------------------------------------------------------------
# EventBridge schedule for scheduler (every 5 minutes)
# ------------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "scheduler" {
  name                = "${var.project_name}-scheduler-every-5min"
  description         = "Trigger scheduler Lambda every 5 minutes"
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "scheduler" {
  rule      = aws_cloudwatch_event_rule.scheduler.name
  target_id = "SchedulerLambda"
  arn       = aws_lambda_function.scheduler.arn
}

resource "aws_lambda_permission" "eventbridge_scheduler" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.scheduler.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.scheduler.arn
}

# ------------------------------------------------------------------------------
# Frontend: S3 + CloudFront
# ------------------------------------------------------------------------------

resource "aws_s3_bucket" "frontend" {
  bucket = var.frontend_bucket_name
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Disabled"
  }
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project_name}-frontend-oac"
  description                       = "OAC for frontend S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class
  comment             = "${var.project_name} frontend"
  aliases             = [var.frontend_domain]

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.frontend.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${aws_s3_bucket.frontend.id}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.frontend.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  depends_on = [aws_acm_certificate_validation.frontend]
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontServicePrincipal"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.frontend.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.frontend]
}

resource "aws_s3_object" "frontend" {
  for_each = local.frontend_files

  bucket       = aws_s3_bucket.frontend.id
  key          = each.value
  source       = "${local.frontend_dir}/${each.value}"
  content_type = lookup(local.content_type_map, try(lower(replace(regex("\\.[^.]+$", each.value), ".", "")), ""), "application/octet-stream")
  etag         = filemd5("${local.frontend_dir}/${each.value}")
}

resource "aws_acm_certificate" "frontend" {
  provider          = aws.us_east_1
  domain_name       = var.frontend_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "frontend_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.frontend.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "frontend" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.frontend.arn
  validation_record_fqdns = [for record in aws_route53_record.frontend_cert_validation : record.fqdn]
}

resource "aws_route53_record" "frontend_alias" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.frontend_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "frontend_alias_ipv6" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.frontend_domain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}
