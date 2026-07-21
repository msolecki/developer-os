import { describe, expect, it } from "vitest";

import { run } from "./main.js";

describe("run", () => {
  it("prints the product version", async () => {
    const lines: string[] = [];

    const code = await run(["--version"], {
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => lines.push(`error:${line}`),
      confirm: () => Promise.resolve(false),
    });

    expect(code).toBe(0);
    expect(lines).toEqual(["developer-os 0.0.0"]);
  });
});
