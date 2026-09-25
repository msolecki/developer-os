import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex } from "node:stream";

import { afterAll, describe, expect, it } from "vitest";

import type { GitProcessPhaseV1 } from "@developer-os/security";

import { bridgeReceivePack } from "./runtime.js";

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
