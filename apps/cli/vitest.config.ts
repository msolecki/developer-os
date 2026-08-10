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
  },
});
