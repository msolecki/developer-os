import { createHash } from "node:crypto";
import { mkdtemp, realpath, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CanonicalAbsolutePathV1 } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { DARWIN_SYSTEM_EXECUTABLES, inspectSystemPath, inspectSystemPathSync } from "./system-executables.js";

describe("the darwin system executable table", () => {
  it("is exactly the four darwin rows", () => {
    expect(DARWIN_SYSTEM_EXECUTABLES).toEqual([
      { platform: "darwin", id: "git", path: "/usr/bin/git", ancestors: ["/", "/usr", "/usr/bin"], admission: "posix_root_owned", status: "implemented" },
      { platform: "darwin", id: "git-receive-pack", path: "/usr/bin/git-receive-pack", ancestors: ["/", "/usr", "/usr/bin"], admission: "posix_root_owned", status: "implemented" },
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

  it("inspectSystemPathSync observes exactly what inspectSystemPath does, and rehashes after a write", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "dos-sysexec-sync-")));
    await writeFile(join(dir, "bin"), "#!/bin/sh\n", { mode: 0o755 });
    await symlink("bin", join(dir, "link"));
    for (const name of ["bin", "link", "missing"]) {
      const path = join(dir, name) as CanonicalAbsolutePathV1;
      expect(inspectSystemPathSync(path)).toEqual(await inspectSystemPath(path));
    }
    const bin = join(dir, "bin") as CanonicalAbsolutePathV1;
    await writeFile(bin, "#!/bin/sh\nexit 1\n");
    expect(inspectSystemPathSync(bin)).toMatchObject({ sha256: createHash("sha256").update("#!/bin/sh\nexit 1\n").digest("hex") });
  });

  // MACOS-9: a same-length rewrite keeps path, dev, ino and size; only the timestamps move the cache key.
  it("inspectSystemPathSync rehashes a same-length rewrite", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "dos-sysexec-same-")));
    const bin = join(dir, "bin") as CanonicalAbsolutePathV1;
    await writeFile(bin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    expect(inspectSystemPathSync(bin)).toMatchObject({ sha256: createHash("sha256").update("#!/bin/sh\nexit 0\n").digest("hex") });
    await writeFile(bin, "#!/bin/sh\nexit 1\n");
    // A distinct mtime (and so ctime) even if the rewrite lands in the same clock tick.
    await utimes(bin, new Date(2_000_000_000_000), new Date(2_000_000_000_000));
    expect(inspectSystemPathSync(bin)).toMatchObject({ sha256: createHash("sha256").update("#!/bin/sh\nexit 1\n").digest("hex") });
  });
});
