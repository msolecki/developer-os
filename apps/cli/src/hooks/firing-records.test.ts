import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodeHookFiringRecord } from "@developer-os/core";
import type { HookFiringRecordV1 } from "@developer-os/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CliIo } from "../io.js";
import type { HookVendor, HookVerb } from "./argv.js";
import { FIRING_RECORD_EXIT_BOUND_MS, firingRecordWaitMs, HOOK_EXIT_BUDGET_MS, runHookMode, settleFiringRecords } from "./entry.js";
import type { HookEnvironment } from "./entry.js";
import {
  FIRING_RECORD_REFRESH_MS,
  HOOK_EVENT_OF,
  readHookFiringObservations,
  recordHookFiring,
} from "./firing-records.js";
import type { HookFiringRequest } from "./firing-records.js";
import { HOOK_HANDLERS } from "./registry.js";
import type { HookContextFactory, HookVerbHandler } from "./registry.js";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const HOUR = 3_600_000;
const uid = process.getuid?.() ?? -1;

let root: string;
let productHome: string;
let stateDirectory: string;
let hooks: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "dos-firing-")));
  productHome = join(root, ".developer-os");
  stateDirectory = join(productHome, "state");
  hooks = join(stateDirectory, "hooks");
  await mkdir(productHome, { mode: 0o700 });
});

afterEach(async () => {
  await chmod(hooks, 0o700).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

async function createHooksDirectory(mode = 0o700): Promise<void> {
  await mkdir(hooks, { recursive: true });
  await chmod(hooks, mode);
}

function withoutGateSeam(): HookFiringRequest {
  return {
    productHome,
    stateDirectory,
    userHome: root,
    vendor: "claude",
    verb: "stop",
    now: NOW,
    productVersion: "0.0.0",
    effectiveUid: uid,
  };
}

function request(overrides: Partial<HookFiringRequest> = {}): HookFiringRequest {
  return { ...withoutGateSeam(), admit: () => Promise.resolve(), ...overrides };
}

function record(event: string, firstSeen: Date, lastSeen: Date, vendor: HookVendor = "claude"): string {
  const value: HookFiringRecordV1 = {
    schemaVersion: 1,
    vendor,
    event,
    productVersion: "0.0.0",
    firstSeen: firstSeen.toISOString(),
    lastSeen: lastSeen.toISOString(),
  };
  return encodeHookFiringRecord(value);
}

describe("HOOK_EVENT_OF", () => {
  it("maps every verb to its hooks.md §3.4 event, with the same PascalCase names on Codex", () => {
    expect(HOOK_EVENT_OF.claude).toStrictEqual({
      inject: "SessionStart",
      command: "PreToolUse",
      commit: "PreToolUse",
      path: "PreToolUse",
      format: "PostToolUse",
      edit: "PostToolUse",
      stop: "Stop",
      prompt: "UserPromptSubmit",
    });
    expect(HOOK_EVENT_OF.codex).toStrictEqual(HOOK_EVENT_OF.claude);
  });
});

describe("recordHookFiring", () => {
  it("writes nothing and creates nothing when the directory is absent", async () => {
    await recordHookFiring(request());
    expect(await readdir(productHome)).toStrictEqual([]);
  });

  it("writes nothing into a directory with mode 0755", async () => {
    await createHooksDirectory(0o755);
    await recordHookFiring(request());
    expect(await readdir(hooks)).toStrictEqual([]);
  });

  it("writes nothing when the directory belongs to another uid", async () => {
    await createHooksDirectory();
    await recordHookFiring(request({ effectiveUid: uid + 1 }));
    expect(await readdir(hooks)).toStrictEqual([]);
  });

  it("writes a fresh record with firstSeen equal to lastSeen equal to now", async () => {
    await createHooksDirectory();
    await recordHookFiring(request());
    expect(await readFile(join(hooks, "claude.stop.json"), "utf8")).toBe(record("Stop", NOW, NOW));
  });

  it("leaves no temp file behind after a successful write", async () => {
    await createHooksDirectory();
    await recordHookFiring(request({ verb: "inject" }));
    expect(await readdir(hooks)).toStrictEqual(["claude.inject.json"]);
  });

  it("keeps one record per verb, so verbs sharing an event are observed apart", async () => {
    await createHooksDirectory();
    await recordHookFiring(request({ vendor: "codex", verb: "command" }));
    await recordHookFiring(request({ vendor: "codex", verb: "path" }));
    expect((await readdir(hooks)).sort()).toStrictEqual(["codex.command.json", "codex.path.json"]);
    expect(await readFile(join(hooks, "codex.path.json"), "utf8")).toBe(record("PreToolUse", NOW, NOW, "codex"));
  });

  it("leaves a record younger than 24 h byte-identical", async () => {
    await createHooksDirectory();
    const seen = new Date(NOW.getTime() - HOUR);
    const bytes = record("Stop", new Date(NOW.getTime() - 100 * HOUR), seen);
    await writeFile(join(hooks, "claude.stop.json"), bytes, { mode: 0o600 });
    let gateCalls = 0;
    await recordHookFiring(request({
      admit: () => {
        gateCalls += 1;
        return Promise.resolve();
      },
    }));
    expect(await readFile(join(hooks, "claude.stop.json"), "utf8")).toBe(bytes);
    expect(gateCalls).toBe(0);
  });

  it("rewrites a record older than 24 h and keeps its firstSeen", async () => {
    await createHooksDirectory();
    const first = new Date(NOW.getTime() - 100 * HOUR);
    const stale = new Date(NOW.getTime() - FIRING_RECORD_REFRESH_MS - 1);
    await writeFile(join(hooks, "claude.stop.json"), record("Stop", first, stale), { mode: 0o600 });
    await recordHookFiring(request());
    expect(await readFile(join(hooks, "claude.stop.json"), "utf8")).toBe(record("Stop", first, NOW));
  });

  it("replaces a malformed record with a fresh one", async () => {
    await createHooksDirectory();
    await writeFile(join(hooks, "claude.stop.json"), "{not json", { mode: 0o600 });
    await recordHookFiring(request());
    expect(await readFile(join(hooks, "claude.stop.json"), "utf8")).toBe(record("Stop", NOW, NOW));
  });

  it("writes nothing, not even a failure marker, when the gate refuses", async () => {
    await createHooksDirectory();
    await recordHookFiring(request({ admit: () => Promise.reject(new Error("synthetic refusal")) }));
    expect(await readdir(hooks)).toStrictEqual([]);
  });

  it("writes nothing when the real ordinary-command gate refuses a malformed V2 manifest", async () => {
    await createHooksDirectory();
    await writeFile(join(productHome, "installation-manifest.json"), '{"schemaVersion":2}', { mode: 0o600 });
    await recordHookFiring(withoutGateSeam());
    expect(await readdir(hooks)).toStrictEqual([]);
  });

  it("writes nothing into a directory uninstall empties while the gate is still deciding", async () => {
    await createHooksDirectory();
    await writeFile(join(hooks, "claude.inject.json"), record("SessionStart", NOW, NOW), { mode: 0o600 });
    // Uninstall removes the children, then the gate (seeing the home going away) refuses.
    await recordHookFiring(request({
      admit: async () => {
        await rm(join(hooks, "claude.inject.json"));
        throw new Error("synthetic refusal mid-uninstall");
      },
    }));
    expect(await readdir(hooks)).toStrictEqual([]);
  });

  it("leaves an empty failure marker when the admitted write fails (NEW-139)", async () => {
    await createHooksDirectory();
    await mkdir(join(hooks, "claude.stop.json"));
    await recordHookFiring(request());
    expect(await readFile(join(hooks, "claude.record_failed.json"), "utf8")).toBe("");
  });

  it("clears the vendor's failure marker with the next written record, and leaves the other vendor's", async () => {
    await createHooksDirectory();
    await writeFile(join(hooks, "claude.record_failed.json"), "", { mode: 0o600 });
    await writeFile(join(hooks, "codex.record_failed.json"), "", { mode: 0o600 });
    await recordHookFiring(request());
    expect((await readdir(hooks)).sort()).toStrictEqual(["claude.stop.json", "codex.record_failed.json"]);
  });

  it("never creates the hooks directory for a failure marker", async () => {
    await recordHookFiring(request());
    expect(await readdir(stateDirectory).catch(() => [])).toStrictEqual([]);
  });

  it("records a Codex firing under the Codex vendor", async () => {
    await createHooksDirectory();
    await recordHookFiring(request({ vendor: "codex" }));
    expect(await readdir(hooks)).toStrictEqual(["codex.stop.json"]);
  });

  it("resolves and removes its temp file when the rename fails", async () => {
    await createHooksDirectory();
    await mkdir(join(hooks, "claude.stop.json"));
    await expect(recordHookFiring(request())).resolves.toBeUndefined();
    expect((await readdir(hooks)).sort()).toStrictEqual(["claude.record_failed.json", "claude.stop.json"]);
  });

  it("resolves when the state directory cannot be reached at all", async () => {
    await writeFile(join(productHome, "state"), "not a directory");
    await expect(recordHookFiring(request())).resolves.toBeUndefined();
  });

  it("resolves on a directory it cannot write into", async () => {
    await createHooksDirectory(0o500);
    await expect(recordHookFiring(request())).resolves.toBeUndefined();
  });
});

describe("readHookFiringObservations", () => {
  it("observes nothing when the directory is absent", async () => {
    const read = await readHookFiringObservations(stateDirectory, "claude");
    expect(read.observations.size).toBe(0);
    expect(read.records).toStrictEqual([]);
  });

  it("observes plugin_hooks from any valid Claude record", async () => {
    await createHooksDirectory();
    await writeFile(join(hooks, "claude.stop.json"), record("Stop", NOW, NOW));
    const read = await readHookFiringObservations(stateDirectory, "claude");
    expect([...read.observations]).toStrictEqual([["plugin_hooks", "observed"]]);
    expect(read.records).toHaveLength(1);
    expect(read.records[0]?.verb).toBe("stop");
  });

  it("also observes session_start_injection from the SessionStart record", async () => {
    await createHooksDirectory();
    await writeFile(join(hooks, "claude.inject.json"), record("SessionStart", NOW, NOW));
    const read = await readHookFiringObservations(stateDirectory, "claude");
    expect(read.observations.get("plugin_hooks")).toBe("observed");
    expect(read.observations.get("session_start_injection")).toBe("observed");
  });

  it("never lets a Codex record observe a Claude key", async () => {
    await createHooksDirectory();
    await writeFile(join(hooks, "codex.inject.json"), record("SessionStart", NOW, NOW, "codex"));
    const claude = await readHookFiringObservations(stateDirectory, "claude");
    expect(claude.observations.size).toBe(0);
    const codex = await readHookFiringObservations(stateDirectory, "codex");
    expect(codex.observations.get("plugin_hooks")).toBe("observed");
  });

  it("ignores a malformed record, a record filed under another verb's event and a per-event record", async () => {
    await createHooksDirectory();
    await writeFile(join(hooks, "claude.stop.json"), "{not json");
    await writeFile(join(hooks, "claude.path.json"), record("SessionStart", NOW, NOW));
    await writeFile(join(hooks, "claude.PreToolUse.json"), record("PreToolUse", NOW, NOW));
    const read = await readHookFiringObservations(stateDirectory, "claude");
    expect(read.observations.size).toBe(0);
    expect(read.records).toStrictEqual([]);
  });

  it("reports the vendor's own failure marker and nothing else as a failed record write", async () => {
    await createHooksDirectory();
    expect((await readHookFiringObservations(stateDirectory, "claude")).recordFailed).toBe(false);
    await writeFile(join(hooks, "codex.record_failed.json"), "");
    expect((await readHookFiringObservations(stateDirectory, "claude")).recordFailed).toBe(false);
    await writeFile(join(hooks, "claude.record_failed.json"), "");
    const read = await readHookFiringObservations(stateDirectory, "claude");
    expect(read.recordFailed).toBe(true);
    expect(read.observations.size).toBe(0);
  });
});

describe("runHookMode and the firing record", () => {
  const io: CliIo = {
    stdout: () => undefined,
    stderr: () => undefined,
    confirm: () => Promise.resolve(false),
    readStdin: () => Promise.resolve(null),
    readStdinBytes: () =>
      Promise.resolve(new TextEncoder().encode(JSON.stringify({ cwd: "/Users/synthetic/p", stop_hook_active: false }))),
  };
  const factory: HookContextFactory = () => {
    throw new Error("a hook verb built a context");
  };
  let saved: HookVerbHandler | undefined;

  beforeEach(() => {
    saved = HOOK_HANDLERS.stop;
  });

  afterEach(() => {
    if (saved === undefined) Reflect.deleteProperty(HOOK_HANDLERS, "stop");
    else HOOK_HANDLERS.stop = saved;
  });

  const writers: readonly (readonly [string, () => Promise<void>])[] = [
    ["succeeds", () => Promise.resolve()],
    ["rejects", () => Promise.reject(new Error("synthetic write failure"))],
    [
      "throws",
      () => {
        throw new Error("synthetic synchronous failure");
      },
    ],
  ];

  it.each([
    ["allow", { kind: "allow" } as const, 0],
    ["block", { kind: "block", ruleId: "synthetic", detail: "synthetic" } as const, 2],
  ])("returns the same exit code for a %s outcome however the write goes", async (_name, outcome, code) => {
    expect(writers.length).toBeGreaterThan(0);
    for (const [label, writer] of writers) {
      const calls: (readonly [HookVendor, HookVerb])[] = [];
      HOOK_HANDLERS.stop = () => Promise.resolve(outcome);
      const environment: HookEnvironment = {
        env: {},
        userHome: root,
        processCwd: () => root,
        nodeExecutable: "/usr/local/bin/node",
        recordFiring: (vendor, verb) => {
          calls.push([vendor, verb]);
          return writer();
        },
      };
      expect(await runHookMode(["guard", "stop", "--vendor", "claude"], io, factory, environment), label).toBe(code);
      expect(calls, label).toStrictEqual([["claude", "stop"]]);
    }
  });

  it("returns the exit code without waiting for a record write that never settles", async () => {
    HOOK_HANDLERS.stop = () => Promise.resolve({ kind: "block", ruleId: "synthetic", detail: "synthetic" });
    let recordCalls = 0;
    const environment: HookEnvironment = {
      env: {},
      userHome: root,
      processCwd: () => root,
      nodeExecutable: "/usr/local/bin/node",
      recordFiring: () => {
        recordCalls += 1;
        return new Promise<void>(() => {
          // never settles
        });
      },
    };
    // NEW-29: no race against a timer; awaiting the write would hang this test past its own budget.
    const code = await runHookMode(["guard", "stop", "--vendor", "claude"], io, factory, environment);
    expect(code).toBe(2);
    expect(recordCalls).toBe(1);
  });

  it("hands the pending record write to the caller, which may wait for it before exiting (NEW-139)", async () => {
    HOOK_HANDLERS.stop = () => Promise.resolve({ kind: "allow" });
    let release = (): void => undefined;
    const pending: Promise<void>[] = [];
    let settled = false;
    const environment: HookEnvironment = {
      env: {},
      userHome: root,
      processCwd: () => root,
      nodeExecutable: "/usr/local/bin/node",
      recordFiring: () => new Promise<void>((resolve) => {
        release = resolve;
      }),
      onRecordPending: (write) => {
        pending.push(write.then(() => {
          settled = true;
        }));
      },
    };
    expect(await runHookMode(["guard", "stop", "--vendor", "claude"], io, factory, environment)).toBe(0);
    expect(pending).toHaveLength(1);
    expect(settled).toBe(false);
    release();
    await Promise.all(pending);
    expect(settled).toBe(true);
  });

  it("does not record a firing when the recursion marker short-circuits the hook", async () => {
    HOOK_HANDLERS.stop = () => Promise.resolve({ kind: "allow" });
    let calls = 0;
    const environment: HookEnvironment = {
      env: { DEVELOPER_OS_HOOK_ACTIVE: "1" },
      userHome: root,
      processCwd: () => root,
      nodeExecutable: "/usr/local/bin/node",
      recordFiring: () => {
        calls += 1;
        return Promise.resolve();
      },
    };
    expect(await runHookMode(["guard", "stop", "--vendor", "claude"], io, factory, environment)).toBe(0);
    expect(calls).toBe(0);
  });
});

describe("settleFiringRecords (NEW-139)", () => {
  it("bounds the exit wait well under the vendors' 2 s hook timeout", () => {
    expect(FIRING_RECORD_EXIT_BOUND_MS).toBeLessThan(HOOK_EXIT_BUDGET_MS);
  });

  it("waits only what is left of the exit budget after the handler ran, never below zero", () => {
    expect(HOOK_EXIT_BUDGET_MS).toBeLessThanOrEqual(1_500);
    expect(firingRecordWaitMs(0)).toBe(FIRING_RECORD_EXIT_BOUND_MS);
    expect(firingRecordWaitMs(HOOK_EXIT_BUDGET_MS - 200)).toBe(200);
    expect(firingRecordWaitMs(HOOK_EXIT_BUDGET_MS)).toBe(0);
    expect(firingRecordWaitMs(HOOK_EXIT_BUDGET_MS + 5_000)).toBe(0);
  });

  it("returns once every pending write has settled", async () => {
    let settled = false;
    const write = Promise.resolve().then(() => {
      settled = true;
    });
    await settleFiringRecords([write], FIRING_RECORD_EXIT_BOUND_MS);
    expect(settled).toBe(true);
  });

  it("gives up at its bound on a write that never settles", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const settling = settleFiringRecords([new Promise<void>(() => undefined)], FIRING_RECORD_EXIT_BOUND_MS).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(FIRING_RECORD_EXIT_BOUND_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await settling;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
