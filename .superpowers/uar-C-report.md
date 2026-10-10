# uar-C report
causeOf (packages/core/src/update/coordinator.ts) now falls back to step_<snake class name>[_<errno>] for Error instances without .reason, validated by parseSafeReasonCode; else update_step_failed. Message never read. Errno suffix only for string codes matching ^E[A-Z0-9]+$. Existing .reason path unchanged.
Tests (coordinator.test.ts): errno, named class, hostile name, hostile code, oversize name, existing reason. 3 fail on HEAD (errno, named class, hostile code).
Gates: coordinator.test.ts 62 pass; tsc -b clean; eslint clean; tests/repository 293 pass.
