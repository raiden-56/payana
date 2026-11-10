locals {
  uploads_origin = "https://${var.uploads_bucket_domain_name}"

  # Default Content-Security-Policy for the web application.
  #  - 'self' covers the app, its self-hosted fonts and the same-origin API.
  #  - style-src needs 'unsafe-inline': Angular injects component styles at runtime.
  #  - The uploads bucket appears because browsers PUT documents straight to it
  #    and display photos from it through presigned URLs.
  #  - The Google hosts are those gtag.js (GA4), Google Ads conversion tracking
  #    and AdSense load from. They cost nothing while the integrations are off.
  # Override var.content_security_policy to tighten it, e.g. drop the AdSense
  # hosts if display ads are never switched on.
  default_csp = join("; ", [
    "default-src 'self'",
    "script-src 'self' https://*.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://www.google.com https://pagead2.googlesyndication.com https://*.adtrafficquality.google",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: ${local.uploads_origin} https://*.google-analytics.com https://*.googletagmanager.com https://*.g.doubleclick.net https://*.google.com https://*.google.co.in https://www.googleadservices.com https://*.googlesyndication.com",
    "font-src 'self'",
    "connect-src 'self' ${local.uploads_origin} https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.g.doubleclick.net https://*.google.com https://www.googleadservices.com https://pagead2.googlesyndication.com https://*.adtrafficquality.google",
    "frame-src https://www.googletagmanager.com https://td.doubleclick.net https://bid.g.doubleclick.net https://googleads.g.doubleclick.net https://*.googlesyndication.com https://www.google.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ])

  csp              = coalesce(var.content_security_policy, local.default_csp)
  has_custom_cert  = var.acm_certificate_arn != null
  web_origin_id    = "web-bucket"
  api_origin_id    = "api-load-balancer"
  api_path_pattern = "/api/*"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

# Forwards every viewer header (including Authorization), cookie and query
# string to the API, but sends the origin's own host name as Host so the
# load balancer certificate matches.
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name}-web"
  description                       = "CloudFront access to the private web bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Caching follows the Cache-Control header each object was uploaded with
# (see the deploy workflow): content-hashed bundles are immutable for a year;
# index.html, ngsw.json, ngsw-worker.js and app-config.json say "no-cache" and
# are therefore revalidated with S3 on every request. An object with no
# Cache-Control header is not cached at all.
resource "aws_cloudfront_cache_policy" "web" {
  name        = "${var.name}-web"
  comment     = "Honour origin Cache-Control; never cache by default"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# Single-page-app fallback. Attached to the default (S3) behaviour only, so it
# can never touch /api/*: an API 404 reaches the client as the API sent it.
# This is why the distribution has no custom_error_response blocks - those
# apply to every behaviour and would turn API errors into index.html.
resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${var.name}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Serve index.html for application routes"
  publish = true
  code    = file("${path.module}/spa-rewrite.js")
}

resource "aws_cloudfront_response_headers_policy" "web" {
  name    = "${var.name}-web"
  comment = "Security headers for the web application"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = var.hsts_include_subdomains
      preload                    = false
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    dynamic "content_security_policy" {
      for_each = var.csp_report_only ? [] : [local.csp]

      content {
        content_security_policy = content_security_policy.value
        override                = true
      }
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = var.permissions_policy
      override = true
    }

    # Report-only mode: violations show in the browser console, nothing is blocked.
    dynamic "items" {
      for_each = var.csp_report_only ? [local.csp] : []

      content {
        header   = "Content-Security-Policy-Report-Only"
        value    = items.value
        override = true
      }
    }
  }
}

# The API sets its own headers; these fill in only what it leaves out.
resource "aws_cloudfront_response_headers_policy" "api" {
  name    = "${var.name}-api"
  comment = "Transport security for API responses"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = var.hsts_include_subdomains
      preload                    = false
      override                   = false
    }

    content_type_options {
      override = true
    }
  }
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  comment             = var.name
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  price_class         = var.price_class
  aliases             = var.domain_names
  default_root_object = "index.html"
  web_acl_id          = var.web_acl_arn

  origin {
    origin_id                = local.web_origin_id
    domain_name              = var.web_bucket_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = local.api_origin_id
    domain_name = var.api_origin_domain_name

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 30
      origin_keepalive_timeout = 5
    }

    custom_header {
      name  = var.origin_verify_header_name
      value = var.origin_verify_header_value
    }
  }

  # Everything that is not /api/* is the static application.
  default_cache_behavior {
    target_origin_id           = local.web_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.web.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  # The API: never cached, every method, and cookies / headers / query strings
  # passed through untouched so sign-in and the refresh cookie work.
  ordered_cache_behavior {
    path_pattern               = local.api_path_pattern
    target_origin_id           = local.api_origin_id
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = false # edge compression needs caching; the API compresses its own responses
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.api.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.has_custom_cert
    acm_certificate_arn            = var.acm_certificate_arn
    ssl_support_method             = local.has_custom_cert ? "sni-only" : null
    minimum_protocol_version       = local.has_custom_cert ? "TLSv1.2_2021" : "TLSv1"
  }
}

# --- Web bucket policy --------------------------------------------------------------
# Only this distribution may read the bucket. ListBucket is granted so that a
# missing file is an honest 404 instead of S3's 403.

data "aws_iam_policy_document" "web_bucket" {
  statement {
    sid       = "CloudFrontReadObjects"
    actions   = ["s3:GetObject"]
    resources = ["${var.web_bucket_arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }

  statement {
    sid       = "CloudFrontListBucket"
    actions   = ["s3:ListBucket"]
    resources = [var.web_bucket_arn]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [var.web_bucket_arn, "${var.web_bucket_arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = var.web_bucket_name
  policy = data.aws_iam_policy_document.web_bucket.json
}
