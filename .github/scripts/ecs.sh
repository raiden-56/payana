#!/usr/bin/env bash
# Helpers for .github/workflows/deploy.yml. Sourced, not executed.

# register_with_image <family> <image-uri>
#
# Copies the newest active task definition of <family>, swaps in the given
# image, registers the copy as a new revision and prints the new revision's ARN.
# Returns non-zero (and prints nothing) if any step fails.
#
# Starting from the newest revision means configuration changed by Terraform
# (environment variables, secrets, CPU, memory) is carried into the release,
# while the image is always the one being deployed. Only fields that
# register-task-definition accepts are copied; describe-task-definition also
# returns read-only ones (revision, status, registeredAt, ...).
#
# Each step is checked explicitly: this function is called inside $( ... ),
# where bash does not apply `set -e`.
register_with_image() {
  local family="$1"
  local image="$2"
  local current spec arn

  current="$(aws ecs describe-task-definition --task-definition "$family" --query taskDefinition)" || return 1

  spec="$(mktemp)" || return 1
  jq --arg image "$image" '
      .containerDefinitions[0].image = $image
      | {
          family,
          containerDefinitions,
          executionRoleArn,
          taskRoleArn,
          networkMode,
          requiresCompatibilities,
          cpu,
          memory,
          runtimePlatform
        }
      | with_entries(select(.value != null))
    ' <<< "$current" > "$spec" || { rm -f "$spec"; return 1; }

  arn="$(aws ecs register-task-definition \
    --cli-input-json "file://${spec}" \
    --query 'taskDefinition.taskDefinitionArn' --output text)" || { rm -f "$spec"; return 1; }

  rm -f "$spec"
  printf '%s\n' "$arn"
}
