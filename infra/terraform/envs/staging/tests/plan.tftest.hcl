# Plans the whole staging stack against a mocked AWS provider.
# No credentials, no API calls, nothing created:  terraform test
#
# `terraform validate` proves the configuration is well-formed; this proves it
# can actually be planned with real inputs, and pins the properties that
# matter most.

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
    }
  }

  mock_data "aws_region" {
    defaults = {
      name = "ap-south-1"
    }
  }

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "111122223333"
    }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
}

variables {
  api_origin_domain_name = "origin.staging.example.in"
  alb_certificate_arn    = "arn:aws:acm:ap-south-1:111122223333:certificate/00000000-0000-0000-0000-000000000000"
  github_repository      = "example-org/payana"
  alert_email            = "ops@example.in"
}

run "plan_staging" {
  command = plan

  assert {
    condition     = !module.database.deletion_protection && !module.database.multi_az
    error_message = "Staging database must be single-AZ and deletable."
  }

  assert {
    condition     = module.network.nat_gateway_count == 1
    error_message = "Staging must share one NAT gateway."
  }

  assert {
    condition     = module.web_hosting.api_path_pattern == "/api/*"
    error_message = "The API must be routed on /api/*."
  }

  assert {
    condition     = !module.web_hosting.has_custom_error_responses
    error_message = "custom_error_response applies to every behaviour and would rewrite API errors to index.html; the SPA fallback must stay in the CloudFront function."
  }

  assert {
    condition     = one(module.deploy_role[*].trusted_subject) == "repo:example-org/payana:environment:staging"
    error_message = "The deploy role must trust only this repository's staging environment."
  }
}
