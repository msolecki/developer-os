import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const runProcess = promisify(execFile);

/**
 * NEW-202: the vendor search path carries the user's whole `PATH`, so it may decide which
 * binary is `claude` or `codex` and nothing else. This gate pins every product source file
 * that names it — the variable or the helpers that read it. A new reader has to be added
 * here on purpose. The needle is assembled at runtime so this file does not match itself.
 */
const NEEDLES = [
  ["DEVELOPER_OS", "VENDOR_SEARCH_PATH"].join("_"),
  ["VENDOR", "SEARCH_PATH_VARIABLE"].join("_"),
  ["parse", "VendorSearchPath"].join(""),
  ["vendor", "SearchPathOption"].join(""),
];

const ALLOWED = [
  "apps/cli/src/context.ts", // the production adapter's discovery `searchPath`
  "apps/cli/src/update/refresh.ts", // passed on to the refresh child
  "apps/launcher/src/environment.ts", // set from the PATH the launcher received
  "packages/platform-macos/src/index.ts",
  "packages/platform-macos/src/vendor-search-path.ts",
];

describe("the vendor search path (NEW-202)", () => {
  it("is named only by vendor discovery, the launcher and the refresh", async () => {
    const { stdout: top } = await runProcess("git", ["rev-parse", "--show-toplevel"]);
    const args = ["grep", "-l", "--untracked", ...NEEDLES.flatMap((needle) => ["-e", needle]), "--", "apps", "packages", "workflows", ":!*.test.ts"];
    // `git grep` exits 1 on no match: that must fail the comparison below, not throw.
    const result = spawnSync("git", args, { cwd: top.trim(), encoding: "utf8" });
    expect(result.status === 0 || result.status === 1, result.stderr).toBe(true);
    expect(result.stdout.split("\n").filter(Boolean).sort()).toStrictEqual(ALLOWED);
  });
});
