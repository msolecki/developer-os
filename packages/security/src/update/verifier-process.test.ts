import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";

import { decodePlannerJson, plannerJsonBytes, PlannerWireDecoder, PlannerWireEncoder, UpdateStepRejectedError } from "@developer-os/core";
import type { TargetVerificationPlanV1 } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { SecurityRefusalError } from "../paths.js";
import { createRedactor, type RedactionResult } from "../redaction.js";
import type { PlannerChildProcessV1, PlannerProcessSampleV1, PlannerSpawnRequestV1 } from "./planner-process.js";
import { TargetVerifierSupervisor, targetVerifierWireBounds, type TargetVerifierRunRequestV1 } from "./verifier-process.js";

const encoder = new TextEncoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);
const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
const SECRET_MARKER = "SYNTHETIC-SECRET-MARKER";
const BUNDLE_ROOT = "/product/releases/2.0.0/darwin-arm64";
const IDLE = 7_000;
const WALL = 90_000;
const SAMPLE = 5;

function plan(overrides: Partial<Record<keyof TargetVerificationPlanV1, unknown>> = {}): TargetVerificationPlanV1 {
  return {
    schemaVersion: 1,
    id: "target_verifier",
    coordinatorId: `lc_${"e".repeat(64)}_5`,
    release: { version: "2.0.0", bundleRoot: BUNDLE_ROOT },
    verifierEntrypoint: "bin/verifier",
    manifestHash: sha("manifest"),
    ownerPostimagesHash: sha("owners"),
    migrationPostimagesHash: sha("migrations"),
    inputBytes: 4_096,
    stdoutBytes: 1_024,
    stderrBytes: 64,
    idleMilliseconds: IDLE,
    wallMilliseconds: WALL,
    processCount: 1,
    readOnly: true,
    ...overrides,
  } as unknown as TargetVerificationPlanV1;
}

const echo = { manifestHash: sha("manifest"), ownerPostimagesHash: sha("owners"), migrationPostimagesHash: sha("migrations") };

class Pipe implements AsyncIterable<Uint8Array> {
  readonly #chunks: Uint8Array[] = [];
  #ended = false;
  #wake: (() => void) | null = null;

  push(chunk: Uint8Array): void {
    if (this.#ended) return;
    this.#chunks.push(chunk);
    this.#wake?.();
  }

  end(): void {
    this.#ended = true;
    this.#wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    for (;;) {
      const next = this.#chunks.shift();
      if (next !== undefined) yield next;
      else if (this.#ended) return;
      else await new Promise<void>((resolve) => (this.#wake = resolve));
    }
  }
}

type Behavior = (child: FakeVerifierChild, stdin: Uint8Array) => void;
type Exit = { readonly exitCode: number | null; readonly signal: string | null };

class FakeVerifierChild implements PlannerChildProcessV1 {
  readonly pid = 4343;
  readonly stdout = new Pipe();
  readonly stderr = new Pipe();
  readonly exited: Promise<Exit>;
  readonly input: Uint8Array[] = [];
  killed = false;
  reaped = false;
  #resolveExit: (value: Exit) => void = () => undefined;

  constructor(readonly behavior: Behavior) {
    this.exited = new Promise<Exit>((resolve) => (this.#resolveExit = resolve)).then((value) => {
      this.reaped = true;
      return value;
    });
  }

  write(chunk: Uint8Array): Promise<void> {
    if (this.killed) return Promise.reject(new Error("EPIPE"));
    this.input.push(chunk.slice());
    return Promise.resolve();
  }

  endInput(): Promise<void> {
    this.behavior(this, Uint8Array.from(this.input.flatMap((chunk) => [...chunk])));
    return Promise.resolve();
  }

  exit(exitCode: number | null, signal: string | null = null): void {
    this.stdout.end();
    this.stderr.end();
    this.#resolveExit({ exitCode, signal });
  }

  kill(): void {
    this.killed = true;
    this.stdout.end();
    this.stderr.end();
    this.#resolveExit({ exitCode: null, signal: "SIGKILL" });
  }
}

interface Timer {
  readonly callback: () => void;
  readonly milliseconds: number;
  cancelled: boolean;
}

function harness(behavior: Behavior, sample: PlannerProcessSampleV1 | null = { residentBytes: 1024, descendants: 0 }) {
  const timers: Timer[] = [];
  const spawned: PlannerSpawnRequestV1[] = [];
  let child: FakeVerifierChild | null = null;
  const supervisor = new TargetVerifierSupervisor({
    spawn: (spawnRequest) => {
      spawned.push(spawnRequest);
      child = new FakeVerifierChild(behavior);
      return child;
    },
    now: () => 0,
    setTimer: (callback, milliseconds) => {
      const timer: Timer = { callback, milliseconds, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    sample: () => Promise.resolve(sample),
    redactor: (text: string): RedactionResult => ({ text, findings: text.includes(SECRET_MARKER) ? [{ class: "provider-token", fingerprint: "synthetic" }] : [] }),
    sampleIntervalMilliseconds: SAMPLE,
  });
  const fire = (milliseconds: number): void => {
    for (const timer of timers.filter((entry) => !entry.cancelled && entry.milliseconds === milliseconds)) timer.callback();
  };
  return { supervisor, spawned, fire, child: (): FakeVerifierChild => child as unknown as FakeVerifierChild };
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function run(overrides: Partial<TargetVerifierRunRequestV1> = {}): TargetVerifierRunRequestV1 {
  return {
    runtime: `${BUNDLE_ROOT}/bin/runtime`,
    cwd: "/private/tmp/developer-os-verifier-empty",
    plan: plan(),
    snapshot: { manifest: "synthetic" },
    inputBlobs: [bytes("synthetic blob")],
    remainingMilliseconds: 500_000,
    ...overrides,
  };
}

function output(value: unknown, verifierPlan = plan()): Uint8Array {
  const wire = new PlannerWireEncoder("output", targetVerifierWireBounds(verifierPlan));
  const json = plannerJsonBytes(value);
  return Uint8Array.from([...wire.magic(), ...wire.json(json), ...json, ...wire.end()]);
}

const answer = (value: unknown, exitCode = 0): Behavior => (child) => {
  child.stdout.push(output(value));
  child.exit(exitCode);
};

const rejection = (error: unknown): boolean => error instanceof UpdateStepRejectedError && error.reason === "update_verifier_rejected";

describe("target verifier supervision", () => {
  it("runs one pinned read-only process and returns the echoed digests", async () => {
    let received: Uint8Array | null = null;
    const { supervisor, spawned, child } = harness((verifier, stdin) => {
      received = stdin;
      answer(echo)(verifier, stdin);
    });
    expect(await supervisor.run(run())).toEqual({ exitCode: 0, ...echo });
    expect(spawned).toEqual([{ executable: run().runtime, args: [`${BUNDLE_ROOT}/bin/verifier`], cwd: run().cwd, env: {} }]);
    const frames = new PlannerWireDecoder("input", targetVerifierWireBounds(plan())).push(received as unknown as Uint8Array);
    const json = frames[0];
    expect(json?.kind).toBe("json");
    expect(decodePlannerJson((json as { payload: Uint8Array }).payload, 4_096)).toEqual({ schemaVersion: 1, plan: plan(), snapshot: { manifest: "synthetic" } });
    expect(frames.slice(1)).toEqual([{ kind: "blob", ordinal: 0, payload: bytes("synthetic blob") }, { kind: "end" }]);
    expect(child().reaped).toBe(true);
  });

  describe("the real redactor over the product-generated request", () => {
    const tmpHome = "/private/var/folders/j3/z6tddtv93jx1396f2d7vnqnc0000gn/T/developer-os-e2e-FP6Kwf/home/.developer-os";
    const withRedactor = (behavior: Behavior): { readonly supervisor: TargetVerifierSupervisor; readonly spawned: PlannerSpawnRequestV1[] } => {
      const base = harness(behavior);
      return { supervisor: new TargetVerifierSupervisor({ ...base.supervisor.dependencies, redactor: createRedactor(new Uint8Array(32).fill(7)) }), spawned: base.spawned };
    };
    const request = (bundleRoot: string): TargetVerifierRunRequestV1 => run({ plan: plan({ release: { version: "2.0.0", bundleRoot } }), snapshot: echo, inputBlobs: [] });

    it("admits sha256 fields and a random TMPDIR bundle root, and spawns the verifier", async () => {
      const { supervisor, spawned } = withRedactor(answer({ outcome: "disagree" }, 1));
      await expect(supervisor.run(request(`${tmpHome}/releases/2.0.0/darwin-arm64`))).rejects.toSatisfy(rejection);
      expect(spawned).toHaveLength(1);
    });

    it("still refuses a provider token planted in the request, before any spawn", async () => {
      const { supervisor, spawned } = withRedactor(answer(echo));
      await expect(supervisor.run(request(`/product/sk-${"A1b2C3d4".repeat(4)}/darwin-arm64`))).rejects.toBeInstanceOf(SecurityRefusalError);
      expect(spawned).toEqual([]);
    });
  });

  it("returns mismatched digests for `runTargetVerifier` to reject", async () => {
    const { supervisor } = harness(answer({ ...echo, manifestHash: sha("other") }));
    expect(await supervisor.run(run())).toEqual({ exitCode: 0, ...echo, manifestHash: sha("other") });
  });

  it.each<{ name: string; behavior: Behavior }>([
    { name: "a non-zero exit after a matching echo", behavior: answer(echo, 1) },
    { name: "a non-zero exit with no output", behavior: (child) => { child.exit(3); } },
    { name: "a clean exit with no output", behavior: (child) => { child.exit(0); } },
    { name: "a clean exit with an extra key", behavior: answer({ ...echo, note: "extra" }) },
    { name: "a clean exit with a missing digest", behavior: answer({ manifestHash: echo.manifestHash, ownerPostimagesHash: echo.ownerPostimagesHash }) },
    { name: "a clean exit with a malformed digest", behavior: answer({ ...echo, migrationPostimagesHash: "ABC" }) },
    { name: "a clean exit without its end frame", behavior: (child) => { child.stdout.push(output(echo).subarray(0, -9)); child.exit(0); } },
  ])("rejects $name so the coordinator compensates", async ({ behavior }) => {
    const { supervisor, child } = harness(behavior);
    const error = await supervisor.run(run()).then(() => null, (caught: unknown) => caught);
    expect(rejection(error)).toBe(true);
    expect(child().reaped).toBe(true);
  });

  it.each<{ name: string; behavior: Behavior }>([
    { name: "stdout beyond the plan's byte bound", behavior: (child) => { child.stdout.push(new Uint8Array(1_025)); } },
    { name: "stderr beyond the plan's byte bound", behavior: (child) => { child.stderr.push(new Uint8Array(65)); } },
    { name: "an output blob frame", behavior: (child) => { const bad = output(echo); child.stdout.push(Uint8Array.from([...bad.subarray(0, -9), 0x12, 0, 0, 0, 0, 0, 0, 0, 1, 7])); } },
    { name: "a wrong magic", behavior: (child) => { const bad = output(echo); bad[0] = 0x58; child.stdout.push(bad); } },
    { name: "a secret in the result frame", behavior: answer({ ...echo, manifestHash: SECRET_MARKER }) },
    { name: "a termination by signal", behavior: (child) => { child.exit(null, "SIGSEGV"); } },
  ])("refuses $name and reaps the child", async ({ behavior }) => {
    const { supervisor, child } = harness(behavior);
    await expect(supervisor.run(run())).rejects.toBeInstanceOf(SecurityRefusalError);
    expect(child().reaped).toBe(true);
  });

  it.each<{ name: string; milliseconds: number; remaining?: number }>([
    { name: "idle", milliseconds: IDLE },
    { name: "wall", milliseconds: WALL },
    { name: "remaining attempt", milliseconds: 40_000, remaining: 40_000 },
  ])("kills and reaps a verifier that exceeds its $name deadline", async ({ milliseconds, remaining }) => {
    const { supervisor, fire, child } = harness(() => undefined);
    const outcome = supervisor.run(run(remaining === undefined ? {} : { remainingMilliseconds: remaining })).then(() => null, (error: unknown) => error);
    await settle();
    fire(milliseconds);
    expect(await outcome).toBeInstanceOf(SecurityRefusalError);
    expect(child().killed).toBe(true);
    expect(child().reaped).toBe(true);
  });

  it.each<{ name: string; sample: PlannerProcessSampleV1 }>([
    { name: "resident memory beyond the planner bound", sample: { residentBytes: 536_870_913, descendants: 0 } },
    { name: "a second process", sample: { residentBytes: 1024, descendants: 1 } },
  ])("kills and reaps a verifier with $name", async ({ sample }) => {
    const { supervisor, fire, child } = harness(() => undefined, sample);
    const outcome = supervisor.run(run()).then(() => null, (error: unknown) => error);
    await settle();
    fire(SAMPLE);
    await settle();
    expect(await outcome).toBeInstanceOf(SecurityRefusalError);
    expect(child().reaped).toBe(true);
  });

  it.each<{ name: string; overrides: Partial<TargetVerifierRunRequestV1> }>([
    { name: "input beyond the plan's byte bound", overrides: { inputBlobs: [new Uint8Array(4_096)] } },
    { name: "a secret in the snapshot", overrides: { snapshot: { note: SECRET_MARKER } } },
    { name: "a secret in an input blob", overrides: { inputBlobs: [bytes(SECRET_MARKER)] } },
    { name: "a relative runtime", overrides: { runtime: "bin/runtime" } },
    { name: "a relative working directory", overrides: { cwd: "tmp" } },
    { name: "an exhausted attempt budget", overrides: { remainingMilliseconds: 0 } },
    { name: "a plan with a second process", overrides: { plan: plan({ processCount: 2 }) } },
    { name: "a plan that is not read-only", overrides: { plan: plan({ readOnly: false }) } },
  ])("refuses $name before spawning", async ({ overrides }) => {
    const { supervisor, spawned } = harness(answer(echo));
    await expect(supervisor.run(run(overrides))).rejects.toBeInstanceOf(SecurityRefusalError);
    expect(spawned).toEqual([]);
  });

  it("accepts input at exactly the plan's byte bound", async () => {
    const probe = new PlannerWireEncoder("input", targetVerifierWireBounds(plan()));
    const json = plannerJsonBytes({ schemaVersion: 1, plan: plan(), snapshot: { manifest: "synthetic" } });
    const overhead = probe.magic().byteLength + probe.json(json).byteLength + json.byteLength + 9 + probe.end().byteLength;
    const { supervisor } = harness(answer(echo));
    expect(await supervisor.run(run({ inputBlobs: [new Uint8Array(4_096 - overhead)] }))).toEqual({ exitCode: 0, ...echo });
    const { supervisor: over, spawned } = harness(answer(echo));
    await expect(over.run(run({ inputBlobs: [new Uint8Array(4_096 - overhead + 1)] }))).rejects.toBeInstanceOf(SecurityRefusalError);
    expect(spawned).toEqual([]);
  });
});

// D72 Q4-A: the repository graph gate (`tests/repository/check.ts`) is the only capability gate.
describe("the verifier entrypoint", () => {
  it("supervises a verifier that reads its counted request from stdin to completion", async () => {
    const root = await realpath(await mkdtemp(joinPath(tmpdir(), "dos-verifier-stdin-")));
    try {
      await mkdir(joinPath(root, "bin"));
      const entrypoint = joinPath(root, "bin", "verifier");
      await writeFile(entrypoint, "const chunks = [];\nfor await (const chunk of process.stdin) chunks.push(chunk);\nprocess.stdout.write(Buffer.concat(chunks));\n");
      const bound = run({ plan: plan({ release: { version: "2.0.0", bundleRoot: root } }) });
      const { supervisor, spawned, child } = harness((verifier) => { verifier.stdout.push(output(echo, bound.plan)); verifier.exit(0); });
      expect(await supervisor.run(bound)).toEqual({ exitCode: 0, ...echo });
      expect(spawned).toEqual([{ executable: bound.runtime, args: [entrypoint], cwd: bound.cwd, env: {} }]);
      expect(child().reaped).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
