import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";

import {
  admitTargetUpdateDraft,
  decodePlannerInput,
  encodePlannerOutput,
  PLANNER_WIRE_BOUNDS_V1,
  plannerBlobSetHash,
  plannerJsonBytes,
  plannerJsonHash,
  plannerPathToken,
  validateReleaseIdentity,
  validateUpdatePlannerRequest,
} from "@developer-os/core";
import type { CanonicalPathEvidenceV1, TargetUpdateDraftV1, UpdatePlannerRequestV1 } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { SecurityRefusalError } from "../paths.js";
import type { RedactionResult } from "../redaction.js";
import {
  sampleNodePlannerProcess,
  spawnNodePlannerChild,
  TargetPlannerSupervisor,
  type PlannerChildProcessV1,
  type PlannerProcessSampleV1,
  type PlannerSpawnRequestV1,
  type TargetPlannerRunRequestV1,
} from "./planner-process.js";

const encoder = new TextEncoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);
const sha = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
const SECRET_MARKER = "SYNTHETIC-SECRET-MARKER";
const evidence: CanonicalPathEvidenceV1 = {
  reopenCanonicalAbsolutePath: (value) => value,
  containsCanonicalPath: () => true,
  hasFoldedAlias: () => false,
};

function release(version: string, sequence: string, updateProtocol = 1): unknown {
  return validateReleaseIdentity({
    version, releaseSequence: sequence, releaseIdentityHash: sha(`identity-${version}`),
    delegationSequence: "1", delegationHash: sha("delegation"), releaseIndexSequence: sequence, releaseIndexHash: sha(`index-${sequence}`),
    bundleManifestHash: sha(`manifest-${version}`), bundleRoot: `/product/releases/${version}/darwin-arm64`,
    platform: "darwin", architecture: "arm64", launcherProtocol: 1, updateProtocol,
  }, evidence);
}

const toolBytes = bytes("synthetic tool v1\n");
const nextBytes = bytes("synthetic tool v2\n");
const token = plannerPathToken(0);

function requestValue(targetProtocol = 1): Record<string, unknown> {
  const verification = { mode: "content", installedHash: sha(toolBytes) };
  const columns = { token, owner: "core", kind: "file", verification, productVersion: "1.0.0", source: "tools/tool.md", mergeStrategy: "dedicated" };
  return {
    schemaVersion: 1, protocol: 1, plannedAt: "2026-09-23T08:00:00.000Z", platform: "darwin", architecture: "arm64",
    currentRelease: release("1.0.0", "1"), targetRelease: release("2.0.0", "2", targetProtocol),
    manifest: { schemaVersion: 1, productVersion: "1.0.0", installedAt: "2026-09-01T08:00:00.000Z", artifacts: [{ ...columns, currentHash: sha(toolBytes) }] },
    config: { schemaVersion: 1, brainRoot: "brain_root", adapters: { claude: false, codex: false }, git: { enabled: false }, automation: { enabled: false }, brain: null, redactionPatternsCount: 0, telemetry: false },
    installedOwners: ["core"],
    artifactInputs: [{ ...columns, observed: { state: "content", mode: 384, bytes: toolBytes.byteLength, sha256: sha(toolBytes), blob: { stream: "input", ordinal: 0, bytes: toolBytes.byteLength, sha256: sha(toolBytes) } } }],
    brain: { schemaVersion: 1, root: "brain_root", folderPolicyVersion: 1, entries: [], aggregateBytes: 0 },
  };
}

const request = (): UpdatePlannerRequestV1 => validateUpdatePlannerRequest(requestValue());

function draft(outputBytes = nextBytes.byteLength): TargetUpdateDraftV1 {
  const value = requestValue();
  const blob = { stream: "output", ordinal: 0, bytes: outputBytes };
  return admitTargetUpdateDraft({
    schemaVersion: 1, protocol: 1, currentRelease: value.currentRelease, targetRelease: value.targetRelease,
    ownerPlans: [{ owner: "core", currentArtifacts: [token], proposedOperations: [{ operation: "replace", target: { kind: "installed", token }, expectedHash: sha(toolBytes), content: { kind: "output_blob", blob } }], externalEffects: [] }],
    migrations: [],
    expectedManifest: { schemaVersion: 2, productVersion: "2.0.0", artifacts: [{ owner: "core", path: { kind: "installed", token }, productVersion: "2.0.0", source: "tools/tool.md", mergeStrategy: "dedicated", kind: "file", verification: { mode: "content", installed: { kind: "output_blob", blob } } }] },
  }, request()).draft;
}

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

type Behavior = (child: FakePlannerChild, stdin: Uint8Array) => void;

class FakePlannerChild implements PlannerChildProcessV1 {
  readonly pid = 4242;
  readonly stdout = new Pipe();
  readonly stderr = new Pipe();
  readonly exited: Promise<{ readonly exitCode: number | null; readonly signal: string | null }>;
  readonly input: Uint8Array[] = [];
  killed = false;
  reaped = false;
  #resolveExit: (value: { readonly exitCode: number | null; readonly signal: string | null }) => void = () => undefined;

  constructor(readonly behavior: Behavior) {
    this.exited = new Promise((resolve) => (this.#resolveExit = resolve)).then((value) => {
      this.reaped = true;
      return value as { readonly exitCode: number | null; readonly signal: string | null };
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

  exit(exitCode: number): void {
    this.stdout.end();
    this.stderr.end();
    this.#resolveExit({ exitCode, signal: null });
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
  let child: FakePlannerChild | null = null;
  const supervisor = new TargetPlannerSupervisor({
    spawn: (spawnRequest) => {
      spawned.push(spawnRequest);
      child = new FakePlannerChild(behavior);
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
    sampleIntervalMilliseconds: 5,
  });
  const fire = (milliseconds: number): void => {
    for (const timer of timers.filter((entry) => !entry.cancelled && entry.milliseconds === milliseconds)) timer.callback();
  };
  return { supervisor, spawned, fire, child: (): FakePlannerChild => child as unknown as FakePlannerChild };
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function run(overrides: Partial<TargetPlannerRunRequestV1> = {}): TargetPlannerRunRequestV1 {
  return {
    runtime: "/product/releases/2.0.0/darwin-arm64/bin/runtime",
    planner: "/product/releases/2.0.0/darwin-arm64/bin/planner",
    cwd: "/private/tmp/developer-os-planner-empty",
    request: request(),
    inputBlobs: [toolBytes],
    remainingMilliseconds: 500_000,
    ...overrides,
  };
}

/** A well-behaved target: decode the complete stdin transcript, answer, exit zero. */
const answer = (output: (stdin: Uint8Array) => Uint8Array, exitCode = 0): Behavior => (child, stdin) => {
  child.stdout.push(output(stdin));
  child.exit(exitCode);
};
const validOutput = (stdin: Uint8Array): Uint8Array => {
  const decoded = decodePlannerInput(stdin);
  return encodePlannerOutput(decoded.request, draft(), [nextBytes]);
};

function header(kind: number, length: number): Uint8Array {
  const frame = new Uint8Array(9);
  frame[0] = kind;
  new DataView(frame.buffer).setBigUint64(1, BigInt(length));
  return frame;
}

function join(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

const MAGIC = bytes("DOSUPD1\n");
const resultJson = (): Uint8Array => plannerJsonBytes(draft());

describe("target planner supervision", () => {
  it("runs one pinned process and returns the screened draft, blobs, and transcript", async () => {
    const { supervisor, spawned, child } = harness(answer(validOutput));
    const result = await supervisor.run(run());

    expect(spawned).toEqual([{ executable: run().runtime, args: [run().planner], cwd: run().cwd, env: {} }]);
    expect(result.draft).toEqual(draft());
    expect(result.outputBlobs).toEqual([{ ordinal: 0, bytes: nextBytes.byteLength, sha256: sha(nextBytes), content: nextBytes }]);
    expect(result.transcript).toEqual({
      protocol: 1,
      bounds: PLANNER_WIRE_BOUNDS_V1,
      requestHash: plannerJsonHash("input", plannerJsonBytes(request())),
      inputBlobsHash: plannerBlobSetHash("input", [toolBytes]),
      resultHash: plannerJsonHash("output", resultJson()),
      outputBlobsHash: plannerBlobSetHash("output", [nextBytes]),
    });
    expect(child().reaped).toBe(true);
  });

  const wireMutations: { name: string; behavior: Behavior }[] = [
    { name: "a wrong magic", behavior: answer((stdin) => join(bytes("DOSUPD9\n"), validOutput(stdin).subarray(8))) },
    { name: "an input frame kind on stdout", behavior: answer(() => join(MAGIC, header(0x01, resultJson().byteLength), resultJson(), header(0x03, 0))) },
    { name: "an unknown frame kind", behavior: answer(() => join(MAGIC, header(0x11, resultJson().byteLength), resultJson(), header(0x14, 0))) },
    { name: "a trailing byte", behavior: answer((stdin) => join(validOutput(stdin), Uint8Array.of(0))) },
    { name: "a missing end frame", behavior: answer((stdin) => validOutput(stdin).subarray(0, -9)) },
    { name: "a nonzero end length", behavior: answer((stdin) => join(validOutput(stdin).subarray(0, -9), header(0x13, 1), Uint8Array.of(0))) },
    { name: "a missing output blob", behavior: answer(() => join(MAGIC, header(0x11, resultJson().byteLength), resultJson(), header(0x13, 0))) },
    { name: "an unreferenced extra blob", behavior: answer(() => join(MAGIC, header(0x11, resultJson().byteLength), resultJson(), header(0x12, nextBytes.byteLength), nextBytes, header(0x12, 1), Uint8Array.of(1), header(0x13, 0))) },
    { name: "a blob whose length differs from its reference", behavior: answer(() => join(MAGIC, header(0x11, resultJson().byteLength), resultJson(), header(0x12, 2), bytes("v2"), header(0x13, 0))) },
    { name: "non-canonical result JSON", behavior: answer(() => { const loose = bytes(` ${new TextDecoder().decode(resultJson())}`); return join(MAGIC, header(0x11, loose.byteLength), loose, header(0x12, nextBytes.byteLength), nextBytes, header(0x13, 0)); }) },
    { name: "a draft for another protocol", behavior: answer(() => { const json = bytes(new TextDecoder().decode(resultJson()).replace('"protocol":1', '"protocol":2')); return join(MAGIC, header(0x11, json.byteLength), json, header(0x12, nextBytes.byteLength), nextBytes, header(0x13, 0)); }) },
    { name: "a secret in an output blob", behavior: answer(() => { const secret = bytes(`${SECRET_MARKER}!`.padEnd(nextBytes.byteLength, "x")); return join(MAGIC, header(0x11, resultJson().byteLength), resultJson(), header(0x12, secret.byteLength), secret, header(0x13, 0)); }) },
    { name: "a blob declared above 16 MiB", behavior: answer(() => join(MAGIC, header(0x11, resultJson().byteLength), resultJson(), header(0x12, 16_777_217))) },
    { name: "a nonzero exit after complete output", behavior: answer(validOutput, 1) },
    { name: "an exit with no output", behavior: (child) => { child.exit(0); } },
    { name: "stderr beyond 1 MiB", behavior: (child) => { child.stderr.push(new Uint8Array(1_048_577)); } },
  ];

  it.each(wireMutations)("refuses $name and reaps the child", async ({ behavior }) => {
    const { supervisor, child } = harness(behavior);
    await expect(supervisor.run(run())).rejects.toBeInstanceOf(SecurityRefusalError);
    expect(child().reaped).toBe(true);
  });

  it("refuses a secret in the result JSON before hashing it", async () => {
    const { supervisor, child } = harness(answer(() => {
      const json = bytes(`{"note":"${SECRET_MARKER}"}`);
      return join(MAGIC, header(0x11, json.byteLength), json, header(0x13, 0));
    }));
    await expect(supervisor.run(run())).rejects.toThrow("secret screen");
    expect(child().reaped).toBe(true);
  });

  it.each<{ name: string; milliseconds: number }>([
    { name: "idle", milliseconds: PLANNER_WIRE_BOUNDS_V1.idleMilliseconds },
    { name: "wall", milliseconds: 500_000 },
  ])("kills and reaps a planner that exceeds its $name deadline", async ({ milliseconds }) => {
    const { supervisor, fire, child } = harness(() => undefined);
    const outcome = supervisor.run(run()).then(() => null, (error: unknown) => error);
    await settle();
    fire(milliseconds);
    expect(await outcome).toBeInstanceOf(SecurityRefusalError);
    expect(child().killed).toBe(true);
    expect(child().reaped).toBe(true);
  });

  it("never lets the wall deadline exceed ten minutes", async () => {
    const { supervisor, fire, child } = harness(() => undefined);
    const outcome = supervisor.run(run({ remainingMilliseconds: 900_000 })).then(() => null, (error: unknown) => error);
    await settle();
    fire(PLANNER_WIRE_BOUNDS_V1.wallMilliseconds);
    expect(await outcome).toBeInstanceOf(SecurityRefusalError);
    expect(child().reaped).toBe(true);
  });

  it.each<{ name: string; sample: PlannerProcessSampleV1 }>([
    { name: "resident memory beyond 512 MiB", sample: { residentBytes: 536_870_913, descendants: 0 } },
    { name: "a second process", sample: { residentBytes: 1024, descendants: 1 } },
  ])("kills and reaps a planner with $name", async ({ sample }) => {
    const { supervisor, fire, child } = harness(() => undefined, sample);
    const outcome = supervisor.run(run()).then(() => null, (error: unknown) => error);
    await settle();
    fire(5);
    await settle();
    expect(await outcome).toBeInstanceOf(SecurityRefusalError);
    expect(child().reaped).toBe(true);
  });

  it.each<{ name: string; overrides: Partial<TargetPlannerRunRequestV1> }>([
    { name: "a secret in an input blob", overrides: { inputBlobs: [bytes(SECRET_MARKER.padEnd(toolBytes.byteLength, "x").slice(0, toolBytes.byteLength))] } },
    { name: "an input blob that differs from its reference", overrides: { inputBlobs: [nextBytes] } },
    { name: "a missing input blob", overrides: { inputBlobs: [] } },
    { name: "a relative runtime", overrides: { runtime: "bin/runtime" } },
    { name: "a relative working directory", overrides: { cwd: "tmp" } },
    { name: "an exhausted attempt budget", overrides: { remainingMilliseconds: 0 } },
    { name: "a newer target protocol", overrides: { request: requestValue(2) as unknown as UpdatePlannerRequestV1 } },
  ])("refuses $name before spawning", async ({ overrides }) => {
    const { supervisor, spawned } = harness(answer(validOutput));
    await expect(supervisor.run(run(overrides))).rejects.toThrow();
    expect(spawned).toEqual([]);
  });
});

describe("the production planner child", () => {
  it("runs with no inherited environment, the exact cwd, and a group kill that reaps", async () => {
    const root = await realpath(await mkdtemp(joinPath(tmpdir(), "dos-planner-child-")));
    try {
      const script = joinPath(root, "planner.mjs");
      await writeFile(script, [
        "process.stdin.resume();",
        "process.stdin.on('end', () => {",
        "  process.stdout.write(JSON.stringify({ env: Object.keys(process.env), cwd: process.cwd(), argv: process.argv.slice(1) }));",
        "  setInterval(() => undefined, 1000);",
        "});",
        "",
      ].join("\n"));
      const child = spawnNodePlannerChild({ executable: process.execPath, args: [script], cwd: root, env: {} });
      await child.write(bytes("ignored"));
      await child.endInput();
      let text = "";
      for await (const chunk of child.stdout) {
        text += new TextDecoder().decode(chunk);
        if (text.endsWith("}")) break;
      }
      // macOS CoreFoundation sets __CF_USER_TEXT_ENCODING inside every Node process at startup; it is not inherited.
      const report = JSON.parse(text) as { env: string[]; cwd: string; argv: string[] };
      expect({ ...report, env: report.env.filter((key) => key !== "__CF_USER_TEXT_ENCODING") }).toEqual({ env: [], cwd: root, argv: [script] });
      child.kill();
      expect(await child.exited).toEqual({ exitCode: null, signal: "SIGKILL" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a relative executable before spawning", () => {
    expect(() => spawnNodePlannerChild({ executable: "node", args: ["planner.mjs"], cwd: "/", env: {} })).toThrow(SecurityRefusalError);
  });

  it("samples resident bytes and descendants, and nothing for a gone process", async () => {
    const own = await sampleNodePlannerProcess(process.pid);
    expect(own?.residentBytes).toBeGreaterThan(0);
    expect(await sampleNodePlannerProcess(2_147_483_646)).toBeNull();
  });
});
