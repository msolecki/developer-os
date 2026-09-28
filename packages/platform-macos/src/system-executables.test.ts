import { createHash } from "node:crypto";
import { mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CanonicalAbsolutePathV1 } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { DARWIN_SYSTEM_EXECUTABLES, inspectSystemPath } from "./system-executables.js";

describe("the darwin system executable table", () => {
  it("is exactly the three darwin rows", () => {
    expect(DARWIN_SYSTEM_EXECUTABLES).toEqual([
      { platform: "darwin", id: "git", path: "/usr/bin/git", ancestors: ["/", "/usr", "/usr/bin"], admission: "posix_root_owned", status: "implemented" },
      { platform: "darwin", id: "scheduler", path: "/bin/launchctl", ancestors: ["/", "/bin"], admission: "posix_root_owned", status: "implemented" },
      { platform: "darwin", id: "ssh", path: "/usr/bin/ssh", ancestors: ["/", "/usr", "/usr/bin"], admission: "posix_root_owned", status: "implemented" },
    ]);
    expect(JSON.stringify(DARWIN_SYSTEM_EXECUTABLES)).not.toMatch(/Xcode|25G83|certif/iu);
  });

  it("inspectSystemPath reports a link without following it and hashes a file by descriptor", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "dos-sysexec-")));
    await writeFile(join(dir, "bin"), "#!/bin/sh\n", { mode: 0o755 });
    await symlink("bin", join(dir, "link"));
    expect(await inspectSystemPath(join(dir, "link") as CanonicalAbsolutePathV1)).toMatchObject({ kind: "symlink", sha256: null });
    expect(await inspectSystemPath(join(dir, "bin") as CanonicalAbsolutePathV1)).toMatchObject({ kind: "file", sha256: createHash("sha256").update("#!/bin/sh\n").digest("hex") });
    expect(await inspectSystemPath(join(dir, "missing") as CanonicalAbsolutePathV1)).toEqual({ kind: "absent" });
  });
});
