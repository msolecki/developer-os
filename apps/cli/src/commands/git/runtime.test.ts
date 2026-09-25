import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex } from "node:stream";

import { afterAll, describe, expect, it } from "vitest";

import type { GitProcessPhaseV1 } from "@developer-os/security";

import { bridgeReceivePack, readLine, withoutGitChildAdditions, withoutReceiveQuarantine } from "./runtime.js";

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

    const started = performance.now();
    const bridged = bridgeReceivePack({
      executable: trampoline,
      argv: [grandchildPid],
      env: {},
      cwd: root,
      rest: new Uint8Array(),
      socket: silentConnection(),
      phase: phase(500),
    });

    await expect(bridged).rejects.toThrow("git_process_failed");
    expect(performance.now() - started).toBeLessThan(5_000);
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
