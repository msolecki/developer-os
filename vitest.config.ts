import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/core/vitest.config.ts",
      "packages/platform-macos/vitest.config.ts",
      "packages/security/vitest.config.ts",
      "packages/brain/vitest.config.ts",
      "packages/workflow-schema/vitest.config.ts",
      "packages/adapter-claude/vitest.config.ts",
      "apps/cli/vitest.config.ts",
      "tests/vitest.config.ts",
    ],
  },
});
