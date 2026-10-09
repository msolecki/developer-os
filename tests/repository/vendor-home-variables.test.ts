import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const runProcess = promisify(execFile);

/**
 * NEW-208: `CODEX_HOME` and `CLAUDE_CONFIG_DIR` cross the launcher's closed environment and the
 * K8 refresh environment through one helper, so the two cannot pass different sets. The variable
 * names are read all over the CLI, so this gate pins the helper's readers instead: a new one has
 * to be added here on purpose. The needles are assembled at runtime so this file does not match itself.
 */
const NEEDLES = [
  ["parse", "VendorHomeVariables"].join(""),
  ["VENDOR", "HOME_VARIABLES"].join("_"),
  ["VendorHome", "VariableError"].join(""),
];

const ALLOWED = [
  "apps/cli/src/update/refresh.ts", // passed on to the refresh child
  "apps/launcher/src/environment.ts", // set from the launcher's own environment
  "packages/platform-macos/src/index.ts",
  "packages/platform-macos/src/vendor-home-variables.ts",
];

describe("the vendor-home variables (NEW-208)", () => {
  it("are passed on only by the launcher and the refresh", async () => {
    const { stdout: top } = await runProcess("git", ["rev-parse", "--show-toplevel"]);
    const args = ["grep", "-l", "--untracked", ...NEEDLES.flatMap((needle) => ["-e", needle]), "--", "apps", "packages", "workflows", ":!*.test.ts"];
    // `git grep` exits 1 on no match: that must fail the comparison below, not throw.
    const result = spawnSync("git", args, { cwd: top.trim(), encoding: "utf8" });
    expect(result.status === 0 || result.status === 1, result.stderr).toBe(true);
    expect(result.stdout.split("\n").filter(Boolean).sort()).toStrictEqual(ALLOWED);
  });
});
