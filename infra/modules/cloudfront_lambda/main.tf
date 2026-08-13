locals {
  name_prefix = "${var.project}-${var.environment}"
}

resource "aws_s3_bucket" "assets" {
  bucket = "${local.name_prefix}-static-assets"
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Re-syncs whenever any file under the assets output changes.
resource "null_resource" "upload_assets" {
  triggers = {
    assets_hash = sha1(join("", [
      for f in fileset(var.open_next_assets_path, "**") : filesha1("${var.open_next_assets_path}/${f}")
    ]))
  }

  # Unquoted - none of these interpolated values ever contain spaces (fixed project/env naming
  # and build-output paths), and quoting here breaks on Windows: cmd.exe (used by local-exec's
  # default Windows interpreter) doesn't strip backslash-escaped quotes the way a POSIX shell
  # does, so the AWS CLI ends up receiving literal quote characters as part of the path/URI.
  provisioner "local-exec" {
    command = "aws s3 sync ${var.open_next_assets_path} s3://${aws_s3_bucket.assets.bucket}/_assets --delete"
  }

  depends_on = [aws_s3_bucket_public_access_block.assets]
}

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${local.name_prefix}-s3-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Origin Access Control for Lambda Function URLs - lets CloudFront SigV4-sign requests to
# the function URL so it can stay AWS_IAM-authed (not public) while still being reachable
# through the distribution. Verify this resource/argument shape against the AWS provider
# docs at `terraform init`/`plan` time - it's a newer CloudFront capability and the exact
# schema is worth a final check before a real apply.
resource "aws_cloudfront_origin_access_control" "lambda" {
  name                              = "${local.name_prefix}-lambda-oac"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = ""
  comment             = "${local.name_prefix} app"

  origin {
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id                = "s3-assets"
    origin_path              = "/_assets"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    domain_name              = var.lambda_function_url_domain
    origin_id                = "lambda-app"
    origin_access_control_id = aws_cloudfront_origin_access_control.lambda.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Everything except the static build assets and BUILD_ID goes to the Lambda server
  # function - matches the routing table in .open-next/open-next.output.json.
  default_cache_behavior {
    target_origin_id       = "lambda-app"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # Managed policy IDs (stable, account-agnostic AWS constants - not project-specific
    # resources). Re-confirm these against the current AWS docs before a real apply:
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # AllViewerExceptHostHeader - required for Lambda Function URL origins behind OAC
  }

  ordered_cache_behavior {
    path_pattern           = "_next/*"
    target_origin_id       = "s3-assets"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized - versioned/immutable build assets
  }

  ordered_cache_behavior {
    path_pattern           = "BUILD_ID"
    target_origin_id       = "s3-assets"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled - always read fresh
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # No custom domain yet - CloudFront's shared default cert on the *.cloudfront.net
  # hostname is fine until a real domain is added (deferred, see TERRAFORM_CHECKLIST.md).
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.assets.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.this.arn
        }
      }
    }]
  })
}

resource "aws_lambda_permission" "cloudfront" {
  statement_id  = "AllowCloudFrontInvokeFunctionUrl"
  action        = "lambda:InvokeFunctionUrl"
  function_name = var.lambda_function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.this.arn
}

# As of October 2025, AWS requires CloudFront's OAC-signed requests to a Lambda Function URL
# to be granted BOTH lambda:InvokeFunctionUrl and lambda:InvokeFunction - without this second
# grant, CloudFront gets a 403 from the function URL even though the OAC signing itself is
# working correctly.
resource "aws_lambda_permission" "cloudfront_invoke_function" {
  statement_id  = "AllowCloudFrontInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.this.arn
}
