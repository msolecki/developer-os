---
paths:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/tests/**"
  - "**/__tests__/**"
  - "**/e2e/**"
---
# Tests — pin the contract, remove the ambient dependency

- A test pins the contract, not current behavior. If a test "passes after fixing the test," verify that you did not encode a bug; a red test may describe the correct contract.
- A fixture must pin an absolute instant (`2030-01-01T08:00:00Z`), never a local-time literal. An ambient-timezone fixture hides a contract mismatch until CI runs in a different timezone from your machine.
- Mock a module with a partial built on the original (for example Vitest's `importOriginal`), never an exhaustive hand-written stub. A stub with fixed bounds is a latent failure that fires the day the module gains an export, and one new export can break every suite that stubs it.
- Do not delete a test to make a build pass; it may be the only record of the correct contract.
