---
name: deploy-checklist
description: Produce a repository-specific go/no-go deployment checklist covering validation, migrations, feature flags, monitoring, communication, rollback, deploy window, and post-deploy checks. Use when the user plans a deployment, release to production, or shipping event.
---

# Deployment readiness

Follow this order and return a concrete `GO` or `NO-GO` verdict.

1. Detect the package manager from the lockfile and run the repository's actual test, lint, typecheck, and build commands. Require green CI and the intended release branch.
2. For migrations, verify local/staging execution, backward compatibility, backup, expected lock/runtime, and tested rollback.
3. Verify feature-flag defaults and rollout percentages for risky behavior.
4. Confirm dashboards, error tracking, alerts, and explicit abort thresholds.
5. Draft deployment/client/status communication when needed, but do not send without explicit authorization.
6. Write exact rollback command, estimated recovery steps, and trigger metrics.
7. Confirm an appropriate deployment window and an owner available for at least one hour of monitoring.
8. After deploy, monitor error rate and latency, inspect new exceptions, run a critical-flow smoke test, and record stable/rollback status.

Never invent provider-specific commands. Derive them from repository configuration or ask for the missing deployment target.
