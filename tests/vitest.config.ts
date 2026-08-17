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
    include: [
      "contracts/**/*.test.ts",
      "integration/**/*.test.ts",
      "e2e/**/*.test.ts",
      "repository/**/*.test.ts",
      "security/**/*.test.ts",
      "tools/**/*.test.ts",
    ],
    /**
     * **This project's files run one at a time**, added with `security/**`.
     *
     * Every suite here is process- and fsync-heavy — a temporary HOME, a real
     * `init`, real transactions — and eight more of them running beside the unit
     * projects starved a suite that has nothing to do with them:
     * `apps/cli/src/commands/doctor.test.ts`'s redaction-key case has a
     * twenty-second budget and blew it in **five of six** full runs once
     * `security/` joined the list, while **three of three** control runs with
     * `security/` excluded passed. Serialized here it passed four of four.
     *
     * Under reduced parallelism the summed test time falls from about 1000
     * seconds to about 700, which is the ordinary overhead of contention — waits
     * counted against each test's own clock — and not evidence of work being
     * repeated. It costs about sixty seconds of wall clock. Raising the other
     * project's timeout instead would have hidden the starvation rather than
     * removed it.
     *
     * **One symptom is not explained by starvation and may only have become
     * rarer.** Two of the five failures also reported `ENOTEMPTY: rmdir
     * …/backups/transactions/<id>` from that suite's own recursive cleanup.
     * That is a filesystem race during removal, not a timeout, and nothing here
     * was measured against it; it is folded in only because it appeared in the
     * same runs. If it returns, it is its own defect and this line is not the
     * fix for it.
     */
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
