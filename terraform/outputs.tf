output "api_base_url" {
  description = "HTTP API base URL"
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "api_id" {
  description = "API Gateway v2 API ID"
  value       = aws_apigatewayv2_api.main.id
}

output "api_lambda_name" {
  description = "API Lambda function name"
  value       = aws_lambda_function.api.function_name
}

output "scheduler_lambda_name" {
  description = "Scheduler Lambda function name"
  value       = aws_lambda_function.scheduler.function_name
}

output "frontend_url" {
  description = "Frontend URL (custom domain)"
  value       = "https://${var.frontend_domain}"
}

output "frontend_cloudfront_url" {
  description = "Frontend URL via CloudFront domain"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID (for invalidations)"
  value       = aws_cloudfront_distribution.frontend.id
}

output "frontend_bucket_name" {
  description = "S3 bucket name used for frontend assets"
  value       = aws_s3_bucket.frontend.id
}

output "frontend_domain" {
  description = "Custom frontend domain name"
  value       = var.frontend_domain
}
