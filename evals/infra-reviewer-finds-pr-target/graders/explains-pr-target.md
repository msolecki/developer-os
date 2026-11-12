---
type: llm
---
The reply reports, as a P0 or P1 finding in .github/workflows/pr-check.yml, that the workflow runs on `pull_request_target` and checks out the pull request's head, so code from a fork runs (`node --test`) with the base repository's secret (`NPM_TOKEN`) and token in reach. It proposes a fix such as triggering on `pull_request`, not checking out the PR head, or keeping secrets out of the job that runs untrusted code.
