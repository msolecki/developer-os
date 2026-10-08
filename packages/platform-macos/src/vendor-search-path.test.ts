import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";

import { MacOsPlatformAdapter, MacOsPlatformTrustError } from "./macos.js";
import {
  MAX_VENDOR_SEARCH_PATH_BYTES,
  parseVendorSearchPath,
  VENDOR_SEARCH_PATH_VARIABLE,
  vendorSearchPathOption,
} from "./vendor-search-path.js";

const DARWIN = { platform: "darwin", architecture: "arm64", release: "25.5.0", userHome: "/Users/example" } as const;

/** The real `/usr/bin/which`, unredacted: a redacting runner would rewrite the random sandbox segment. */
const whichRunner: ProcessRunner = {
  run: (request: ProcessRequest): Promise<ProcessResult> =>
    new Promise((resolve) => {
      execFile(request.executable, [...request.args], { cwd: request.cwd, env: { ...request.env } }, (error, stdout, stderr) => {
        const exitCode = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ stdout, stderr, exitCode, signal: null, timedOut: false });
      });
    }),
};

describe("parseVendorSearchPath (NEW-202)", () => {
  it("passes a valid search path through unchanged", () => {
    expect(parseVendorSearchPath("/opt/homebrew/bin:/usr/bin")).toBe("/opt/homebrew/bin:/usr/bin");
    expect(parseVendorSearchPath(`/${"a".repeat(MAX_VENDOR_SEARCH_PATH_BYTES - 1)}`)).not.toBeNull();
  });

  it("drops an absent, empty, NUL-carrying or oversize value", () => {
    for (const raw of [undefined, "", "/opt/homebrew/bin\0:/usr/bin", `/${"a".repeat(MAX_VENDOR_SEARCH_PATH_BYTES)}`]) {
      expect(parseVendorSearchPath(raw), JSON.stringify(raw?.slice(0, 20))).toBeNull();
    }
  });

  it("bounds bytes, not UTF-16 code units", () => {
    expect(parseVendorSearchPath(`/${"é".repeat(MAX_VENDOR_SEARCH_PATH_BYTES / 2)}`)).toBeNull();
  });

  it("becomes the adapter's search path only when present and valid", () => {
    expect(vendorSearchPathOption({ [VENDOR_SEARCH_PATH_VARIABLE]: "/opt/homebrew/bin", PATH: "/usr/bin" })).toStrictEqual({ searchPath: "/opt/homebrew/bin" });
    expect(vendorSearchPathOption({ PATH: "/usr/bin" })).toStrictEqual({});
    expect(vendorSearchPathOption({ [VENDOR_SEARCH_PATH_VARIABLE]: "/x\0" })).toStrictEqual({});
  });
});

describe("vendor discovery through the vendor search path, against a real filesystem (NEW-202)", () => {
  const roots: string[] = [];

  afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  async function plantVendor(): Promise<string> {
    const temp = await realpath(tmpdir());
    const base = ((await stat(temp)).mode & 0o022) === 0 ? temp : await realpath(homedir());
    const root = await realpath(await mkdtemp(join(base, ".dos-vendor-")));
    roots.push(root);
    await mkdir(join(root, "bin"), { mode: 0o755 });
    await writeFile(join(root, "bin", "claude"), "#!/bin/sh\n", { mode: 0o755 });
    return join(root, "bin");
  }

  it("finds a vendor only the variable names, and admits it", async () => {
    const bin = await plantVendor();
    const env = { [VENDOR_SEARCH_PATH_VARIABLE]: `${bin}:/usr/bin`, PATH: "/usr/bin:/bin" };
    const adapter = new MacOsPlatformAdapter({ environment: DARWIN, runner: whichRunner, ...vendorSearchPathOption(env) });

    const discovery = await adapter.discoverExecutable("claude");

    expect(discovery).toStrictEqual({ name: "claude", installed: true, executablePath: join(bin, "claude"), version: null });
    await expect(adapter.assertTrustedExecutable(join(bin, "claude"))).resolves.toBeUndefined();
  });

  it("refuses a vendor it found in a group-writable directory another uid owns", async () => {
    const bin = await plantVendor();
    const uid = process.getuid?.() ?? -1;
    const adapter = new MacOsPlatformAdapter({
      environment: DARWIN,
      runner: whichRunner,
      ...vendorSearchPathOption({ [VENDOR_SEARCH_PATH_VARIABLE]: bin }),
      stat: async (path) => {
        if (path === bin) return { uid: uid + 1, mode: 0o040775 };
        const real = await stat(path);
        return { uid: real.uid, mode: real.mode };
      },
    });

    const discovery = await adapter.discoverExecutable("claude");

    expect(discovery.executablePath).toBe(join(bin, "claude"));
    await expect(adapter.assertTrustedExecutable(join(bin, "claude"))).rejects.toThrow(MacOsPlatformTrustError);
  });
});
