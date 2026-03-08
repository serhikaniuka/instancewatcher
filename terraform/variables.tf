variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "eu-central-1"
}

variable "project_name" {
  description = "Project name prefix for Lambda and related resources"
  type        = string
}

variable "allowed_email" {
  description = "Allowed Google account email for API auth"
  type        = string
}

variable "google_client_id" {
  description = "Google OAuth 2.0 Web client ID for token verification"
  type        = string
}

variable "frontend_bucket_name" {
  description = "S3 bucket name for frontend static assets (must be globally unique)"
  type        = string
}

variable "cloudfront_price_class" {
  description = "CloudFront distribution price class (PriceClass_All, PriceClass_200, PriceClass_100)"
  type        = string
  default     = "PriceClass_100"
}

variable "domain_zone" {
  description = "Route53 hosted zone name used for frontend domain (e.g. kanyuka.info)"
  type        = string
  default     = "kanyuka.info"
}

variable "frontend_domain" {
  description = "Custom domain name for the frontend (e.g. iw.kanyuka.info)"
  type        = string
  default     = "iw.kanyuka.info"
}
