import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@developer-os/brain": fileURLToPath(
        new URL("../../packages/brain/src/index.ts", import.meta.url),
      ),
      "@developer-os/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
      "@developer-os/platform-macos": fileURLToPath(
        new URL("../../packages/platform-macos/src/index.ts", import.meta.url),
      ),
      "@developer-os/security": fileURLToPath(
        new URL("../../packages/security/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    /**
     * Raised from vitest's 5000 ms default because these are the only unit
     * tests that drive a real transaction against a real filesystem, and the
     * cost is fsync, not computation.
     *
     * A measured install writes 73 files in about 0.8 s on an idle disk, and
     * `init`'s rollback cases pay that twice — apply, then revert. Run alone
     * the suite is comfortable; run alongside five other projects competing
     * for the same disk it drifts past five seconds occasionally, which is how
     * this surfaced: three tests timing out in a full run and passing in
     * isolation, after DOS-P2 Task 10 added the twelve-file vault template to
     * the install transaction.
     *
     * Twenty seconds is a ceiling for a hang, not a budget to grow into. If a
     * test needs it, the transaction got slower and that is the finding.
     */
    testTimeout: 20_000,
  },
});
