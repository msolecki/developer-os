import { fileURLToPath } from "node:url";

import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@developer-os/core": fileURLToPath(
        new URL("../core/src/index.ts", import.meta.url),
      ),
      "@developer-os/security": fileURLToPath(
        new URL("../security/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
