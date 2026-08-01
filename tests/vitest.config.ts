import { defineProject } from "vitest/config";

/**
 * No source aliases, unlike the unit projects. These tests execute the compiled
 * binary as a process, so every contract they import must come from the same
 * `dist` output that binary was built from; aliasing to `src` would let a test
 * pass against source the shipped artifact does not contain.
 *
 * The timeouts are process budgets, not guesses: one lifecycle case spawns the
 * CLI a dozen times, and each spawn pays Node startup plus the transaction's
 * fsyncs.
 */
export default defineProject({
  test: {
    environment: "node",
    include: ["e2e/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
