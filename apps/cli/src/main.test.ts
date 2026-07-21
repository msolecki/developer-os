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

  it("reports unknown input to stderr with the invalid-input exit code", async () => {
    const lines: string[] = [];

    const code = await run(["unknown"], {
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => lines.push(`error:${line}`),
      confirm: () => Promise.resolve(false),
    });

    expect(code).toBe(2);
    expect(lines).toEqual(["error:Usage: developer-os --version [--json]"]);
  });

  it("prints version results as one JSON line on stdout", async () => {
    const lines: string[] = [];

    const code = await run(["--version", "--json"], {
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => lines.push(`error:${line}`),
      confirm: () => Promise.resolve(false),
    });

    expect(code).toBe(0);
    expect(lines).toEqual([
      '{"ok":true,"code":0,"data":{"version":"0.0.0"},"warnings":[]}',
    ]);
  });

  it("prints invalid JSON invocations as one JSON line on stdout", async () => {
    const lines: string[] = [];

    const code = await run(["unknown", "--json"], {
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => lines.push(`error:${line}`),
      confirm: () => Promise.resolve(false),
    });

    expect(code).toBe(2);
    expect(lines).toEqual([
      '{"ok":false,"code":2,"error":{"kind":"invalid_input","message":"Usage: developer-os --version [--json]","paths":[]}}',
    ]);
  });
});
