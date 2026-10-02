import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex } from "node:stream";

import { afterAll, describe, expect, it, vi } from "vitest";

import { DARWIN_SYSTEM_EXECUTABLES } from "@developer-os/platform-macos";
import { admitGitExecutables, recheckSystemExecutable } from "@developer-os/security";
import type { GitProcessPhaseV1, SystemPathInspectorV1, SystemPathObservationV1 } from "@developer-os/security";

import { bridgeReceivePack, createProductionGitRuntime, readLine, withoutGitChildAdditions, withoutReceiveQuarantine } from "./runtime.js";

type PresentObservation = Exclude<SystemPathObservationV1, { kind: "absent" }>;

/** A stock macOS host: every fixed path and ancestor root-owned `0755`; `overrides` change fields of one path. */
function stockHost(overrides: Readonly<Record<string, Partial<PresentObservation>>> = {}): SystemPathInspectorV1 {
  const directory: PresentObservation = { kind: "directory", ownerUid: 0, mode: 0o755, dev: "1", ino: "2", size: 64, sha256: null };
  const file = (ino: string, sha256: string): PresentObservation => ({ kind: "file", ownerUid: 0, mode: 0o755, dev: "1", ino, size: 119_000, sha256 });
  const paths: Record<string, PresentObservation> = {
    "/": directory,
    "/usr": directory,
    "/usr/bin": directory,
    "/usr/bin/git": file("10", "a".repeat(64)),
    "/usr/bin/git-receive-pack": file("11", "b".repeat(64)),
  };
  for (const [path, change] of Object.entries(overrides)) paths[path] = { ...(paths[path] as PresentObservation), ...change };
  return (path) => Promise.resolve(paths[path] ?? { kind: "absent" });
}

const GIT_ROW = DARWIN_SYSTEM_EXECUTABLES.find((row) => row.id === "git");

describe("fixed-path Git admission (D71)", () => {
  it("the production runtime spawns /usr/bin/git under a hostile PATH and DEVELOPER_DIR", async () => {
    const seen: string[] = [];
    const host = stockHost();
    const inspect: SystemPathInspectorV1 = (path) => {
      seen.push(path);
      return host(path);
    };
    vi.stubEnv("PATH", "/tmp/evil/bin");
    vi.stubEnv("DEVELOPER_DIR", "/tmp/evil/Developer");
    try {
      await createProductionGitRuntime({ inspect, architecture: "arm64" }).admitDistribution("local");
      expect([...new Set(seen)].sort()).toEqual(["/", "/usr", "/usr/bin", "/usr/bin/git", "/usr/bin/git-receive-pack"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("retry re-admits after a binary change between plan and retry", async () => {
    if (GIT_ROW === undefined) throw new Error("fixture: no darwin git row");
    const first = await admitGitExecutables(DARWIN_SYSTEM_EXECUTABLES, stockHost(), "arm64", "local");
    const updated = stockHost({ "/usr/bin/git": { sha256: "d".repeat(64), ino: "42" } });
    await expect(admitGitExecutables(DARWIN_SYSTEM_EXECUTABLES, updated, "arm64", "local")).resolves.toBeDefined();
    await expect(recheckSystemExecutable(GIT_ROW, updated, first.git)).rejects.toThrow();
  });

  it("refuses HTTPS and SSH before observing any path", async () => {
    const seen: string[] = [];
    const inspect: SystemPathInspectorV1 = (path) => {
      seen.push(path);
      return stockHost()(path);
    };
    for (const transport of ["https", "ssh"] as const) {
      await expect(createProductionGitRuntime({ inspect, architecture: "arm64" }).admitDistribution(transport)).rejects.toThrow("unsupported_git_distribution");
    }
    expect(seen).toEqual([]);
  });

  it("no Git module reads PATH or DEVELOPER_DIR", async () => {
    for (const file of ["runtime.ts", "../../../../../packages/security/src/git/distribution.ts"]) {
      const source = await nodeFs.readFile(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/process\.env(\.|\[")(PATH|DEVELOPER_DIR)/u);
    }
  });
});

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await nodeFs.rm(root, { recursive: true, force: true });
});

function phase(wallMs: number): GitProcessPhaseV1 {
  const deadlineAtMs = performance.now() + wallMs;
  return { id: "push", deadlineAtMs, remainingMilliseconds: () => Math.max(0, deadlineAtMs - performance.now()) };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A connection that never ends, like a push helper stalled after `connect`. */
function silentConnection(): Duplex {
  return new Duplex({
    read: () => undefined,
    write: (_chunk, _encoding, done) => {
      done();
    },
  });
}

describe("the receive-pack bridge", () => {
  it("streams the connection through the trampoline in both directions", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "dos-receive-bridge-"));
    roots.push(root);
    const trampoline = join(root, "git-receive-pack");
    await nodeFs.writeFile(trampoline, "#!/bin/sh\nexec /bin/cat\n", { mode: 0o700 });
    const written: Buffer[] = [];
    const incoming = ["pack ", "bytes"];
    const socket = new Duplex({
      read() {
        this.push(incoming.shift() ?? null);
      },
      write: (chunk: Buffer, _encoding, done) => {
        written.push(chunk);
        done();
      },
    });

    await bridgeReceivePack({
      executable: trampoline,
      argv: [],
      env: {},
      cwd: root,
      rest: new TextEncoder().encode("helper "),
      socket,
      phase: phase(10_000),
    });

    expect(Buffer.concat(written).toString("utf8")).toBe("helper pack bytes");
  }, 15_000);

  it("ends a stalled trampoline at the push phase deadline and reaps its whole process group", async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), "dos-receive-bridge-"));
    roots.push(root);
    const trampoline = join(root, "git-receive-pack");
    const grandchildPid = join(root, "grandchild.pid");
    await nodeFs.writeFile(trampoline, '#!/bin/sh\n/bin/sleep 60 &\necho $! > "$1"\nwait\n', { mode: 0o700 });

    const bridged = bridgeReceivePack({
      executable: trampoline,
      argv: [grandchildPid],
      env: {},
      cwd: root,
      rest: new Uint8Array(),
      socket: silentConnection(),
      phase: phase(500),
    });

    // The trampoline sleeps 60 s, so the 15 s test budget is what proves the deadline, not the exit, ended it.
    await expect(bridged).rejects.toThrow("git_process_failed");
    expect(isAlive(Number((await nodeFs.readFile(grandchildPid, "utf8")).trim()))).toBe(false);
  }, 15_000);
});

describe("the gateway line reader", () => {
  it("refuses a line as soon as it passes its limit, without waiting for a line feed", async () => {
    const socket = silentConnection();
    const read = readLine(socket as never, 4096);
    socket.push(Buffer.alloc(4097, 0x61));

    await expect(read).rejects.toThrow("git_gateway_line_too_long");
  });

  it("leaves no listener behind once a line is read", async () => {
    const socket = silentConnection();
    for (const text of ["first", "second", "third"]) {
      const read = readLine(socket as never, 4096);
      socket.resume();
      socket.push(`${text}\n`);
      expect((await read).line).toBe(text);
    }

    expect([socket.listenerCount("data"), socket.listenerCount("error"), socket.listenerCount("end")]).toStrictEqual([0, 0, 0]);
  });
});

describe("the trampoline report's environment", () => {
  const base = { GIT_EXEC_PATH: "/g", PATH: "/g", GIT_DIR: "/s" };

  it("folds back exactly what the pinned Git adds to every child it starts", () => {
    expect(withoutGitChildAdditions({ ...base, PATH: "/g:/g", GIT_PREFIX: "", __CF_USER_TEXT_ENCODING: "0x1F5:0x0:0x0" })).toEqual(base);
  });

  /** What `/usr/bin/git`'s `xcrun` step adds for the selected developer directory, measured verbatim on Apple Git-157. */
  const xcode = "/Applications/Xcode.app/Contents/Developer";
  const xcodeShim = {
    SDKROOT: `${xcode}/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk`,
    MANPATH: `${xcode}/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk/usr/share/man:${xcode}/Platforms/MacOSX.platform/usr/share/man:${xcode}/usr/share/man:${xcode}/Toolchains/XcodeDefault.xctoolchain/usr/share/man:`,
    CPATH: "/usr/local/include",
    LIBRARY_PATH: "/usr/local/lib",
  };
  const clt = "/Library/Developer/CommandLineTools";
  const cltShim = {
    SDKROOT: `${clt}/SDKs/MacOSX.sdk`,
    MANPATH: `${clt}/SDKs/MacOSX.sdk/usr/share/man:${clt}/usr/share/man:${clt}/Toolchains/XcodeDefault.xctoolchain/usr/share/man:`,
    CPATH: "/usr/local/include",
    LIBRARY_PATH: "/usr/local/lib",
  };

  it("folds back the four variables the Apple shim adds for an Xcode or Command Line Tools developer directory", () => {
    expect(withoutGitChildAdditions({ ...base, ...xcodeShim })).toEqual(base);
    expect(withoutGitChildAdditions({ ...base, ...cltShim })).toEqual(base);
  });

  it("keeps the shim's variables unless all four have exactly the shim's shape", () => {
    for (const changed of [
      { SDKROOT: xcodeShim.SDKROOT, MANPATH: xcodeShim.MANPATH, LIBRARY_PATH: xcodeShim.LIBRARY_PATH },
      { ...xcodeShim, CPATH: "/evil/include" },
      { ...xcodeShim, LIBRARY_PATH: "/evil/lib" },
      { ...xcodeShim, SDKROOT: "/evil/SDKs/MacOSX.sdk" },
      { ...xcodeShim, SDKROOT: "relative/SDKs/MacOSX.sdk" },
      { ...xcodeShim, MANPATH: `/evil/man:${xcodeShim.MANPATH}` },
      { ...cltShim, MANPATH: xcodeShim.MANPATH },
    ]) {
      expect(withoutGitChildAdditions({ ...base, ...changed })).toEqual({ ...base, ...changed });
    }
  });

  it("keeps any other value so admission still refuses it", () => {
    expect(withoutGitChildAdditions({ ...base, PATH: "/evil:/g" })).toEqual({ ...base, PATH: "/evil:/g" });
    expect(withoutGitChildAdditions({ ...base, GIT_PREFIX: "sub/" })).toEqual({ ...base, GIT_PREFIX: "sub/" });
    expect(withoutGitChildAdditions({ ...base, __CF_USER_TEXT_ENCODING: "x" })).toEqual({ ...base, __CF_USER_TEXT_ENCODING: "x" });
  });

  it("folds receive-pack's object quarantine back only in the destination shadow", () => {
    const incoming = "/s/./objects/tmp_objdir-incoming-AbC123";
    const quarantined = { ...base, GIT_DIR: ".", GIT_OBJECT_DIRECTORY: incoming, GIT_QUARANTINE_PATH: incoming, GIT_ALTERNATE_OBJECT_DIRECTORIES: "/s/./objects" };
    expect(withoutReceiveQuarantine(quarantined, "/s", "/s")).toEqual(base);
    expect(withoutReceiveQuarantine(quarantined, "/elsewhere", "/s")).toBe(quarantined);
    const redirected = { ...quarantined, GIT_ALTERNATE_OBJECT_DIRECTORIES: "/real/objects" };
    expect(withoutReceiveQuarantine(redirected, "/s", "/s")).toBe(redirected);
    const outside = { ...quarantined, GIT_OBJECT_DIRECTORY: "/tmp/x", GIT_QUARANTINE_PATH: "/tmp/x" };
    expect(withoutReceiveQuarantine(outside, "/s", "/s")).toBe(outside);
  });
});
