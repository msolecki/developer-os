import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createRedactor } from "@developer-os/security";
import { describe, expect, it } from "vitest";

import {
  PROJECT_TEMPLATE,
  PROJECT_TEMPLATE_MAX_BYTES,
  PROJECT_TEMPLATE_MAX_FILES,
} from "./project-template.js";

/** `../../../../` holds for both `src/commands/` and the compiled `dist/commands/`. */
const ROOT = fileURLToPath(new URL("../../../../templates/project", import.meta.url));

describe("the embedded project template", () => {
  it("embeds templates/project byte for byte, flat, within bounds, finding-free", async () => {
    const names = (await readdir(ROOT)).sort();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toStrictEqual(["AGENTS.md", "CLAUDE.md", "_Context.md"].sort());
    expect(names.length).toBeLessThanOrEqual(PROJECT_TEMPLATE_MAX_FILES);
    expect(PROJECT_TEMPLATE.map((file) => file.name).sort()).toStrictEqual(names);
    const redact = createRedactor(randomBytes(32));
    for (const file of PROJECT_TEMPLATE) {
      const bytes = await readFile(join(ROOT, file.name));
      expect(bytes.equals(Buffer.from(file.content, "utf8")), file.name).toBe(true);
      expect(bytes.byteLength).toBeLessThanOrEqual(PROJECT_TEMPLATE_MAX_BYTES);
      expect(redact(file.content).findings, file.name).toStrictEqual([]);
    }
  });
});
