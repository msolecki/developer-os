import { createHash } from "node:crypto";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SecurityRefusalError } from "./paths.js";
import {
  nodeSupervisedProcessDependencies,
  SupervisedProcessRunner,
  type SupervisedChildHandleV1,
  type SupervisedChildSpawnV1,
  type SupervisedPhaseV1,
  type SupervisedProcessDependenciesV1,
  type SupervisedSpawnRequestV1,
} from "./supervised-process.js";

const PID = 4242;
const encoder = new TextEncoder();
const bytes = (text: string): Uint8Array => encoder.encode(text);
const sha = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
const EMPTY_SHA = sha("");

/** Virtual monotonic time: when nothing else is pending, jumps to the earliest live timer and fires it. */
class VirtualClock {
  #now = 0;
  #sequence = 0;
  #timers: { readonly at: number; readonly sequence: number; readonly fire: () => void; live: boolean }[] = [];
  #scheduled = false;

  readonly now = (): number => this.#now;

  readonly setTimer = (ms: number, fire: () => void): (() => void) => {
    const timer = { at: this.#now + ms, sequence: this.#sequence++, fire, live: true };
    this.#timers.push(timer);
    this.#schedule();
    return () => {
      timer.live = false;
    };
  };

  advance(ms: number): void {
    this.#now += ms;
  }

  elapsedSince(startedAt: number): number {
    return this.#now - startedAt;
  }

  #schedule(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    setImmediate(() => {
      this.#scheduled = false;
      this.#timers = this.#timers.filter((timer) => timer.live).sort((left, right) => left.at - right.at || left.sequence - right.sequence);
      const next = this.#timers.shift();
      if (next === undefined) return;
      this.#now = Math.max(this.#now, next.at);
      next.fire();
      if (this.#timers.length > 0) this.#schedule();
    });
  }
}

class Channel implements AsyncIterable<Uint8Array> {
  readonly #queue: Uint8Array[] = [];
  #ended = false;
  #wake: (() => void) | null = null;

  push(chunk: Uint8Array): void {
    if (this.#ended) return;
    this.#queue.push(chunk);
    this.#notify();
  }

  end(): void {
    this.#ended = true;
    this.#notify();
  }

  #notify(): void {
    const wake = this.#wake;
    this.#wake = null;
    wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    for (;;) {
      const next = this.#queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.#ended) return;
      await new Promise<void>((resolveWake) => {
        this.#wake = resolveWake;
      });
    }
  }
}

interface ChildScript {
  readonly output?: readonly { readonly at: number; readonly stream: "stdout" | "stderr"; readonly chunk: Uint8Array }[];
  /** `null` hangs until signalled. */
  readonly exitAt?: number | null;
  readonly exitCode?: number;
  readonly ignoresSigterm?: boolean;
}

class FakeDependencies implements SupervisedProcessDependenciesV1 {
  readonly signals: [number, string][] = [];
  reaped = false;
  spawned = 0;
  #lastSpawn: SupervisedChildSpawnV1 | null = null;
  #finish: ((exitCode: number | null, signal: string | null) => void) | null = null;

  constructor(
    readonly clock: VirtualClock,
    readonly script: ChildScript,
  ) {}

  get lastSpawn(): SupervisedChildSpawnV1 {
    if (this.#lastSpawn === null) throw new Error("nothing was spawned");
    return this.#lastSpawn;
  }

  readonly now = (): number => this.clock.now();
  readonly setTimer = (ms: number, fire: () => void): (() => void) => this.clock.setTimer(ms, fire);

  readonly spawn = (request: SupervisedChildSpawnV1): SupervisedChildHandleV1 => {
    this.spawned += 1;
    this.reaped = false;
    this.#lastSpawn = request;
    const stdout = new Channel();
    const stderr = new Channel();
    let resolveClosed: (value: { readonly exitCode: number | null; readonly signal: string | null }) => void = () => undefined;
    const closed = new Promise<{ readonly exitCode: number | null; readonly signal: string | null }>((resolve) => {
      resolveClosed = resolve;
    });
    this.#finish = (exitCode, signal) => {
      if (this.reaped) return;
      stdout.end();
      stderr.end();
      this.reaped = true;
      resolveClosed({ exitCode, signal });
    };
    const output = this.script.output ?? [];
    for (const item of output) {
      this.clock.setTimer(item.at, () => {
        (item.stream === "stdout" ? stdout : stderr).push(item.chunk);
      });
    }
    if (this.script.exitAt !== null) {
      const exitAt = this.script.exitAt ?? Math.max(0, ...output.map((item) => item.at)) + 1;
      this.clock.setTimer(exitAt, () => this.#finish?.(this.script.exitCode ?? 0, null));
    }
    return {
      pid: PID,
      stdout,
      stderr,
      closed,
      closeOutput: () => {
        stdout.end();
        stderr.end();
      },
    };
  };

  readonly killGroup = (pid: number, signal: "SIGTERM" | "SIGKILL"): void => {
    this.signals.push([-pid, signal]);
    if (signal === "SIGKILL" || this.script.ignoresSigterm !== true) this.#finish?.(null, signal);
  };
}

function setup(script: ChildScript): { readonly clock: VirtualClock; readonly deps: FakeDependencies; readonly runner: SupervisedProcessRunner; readonly request: SupervisedSpawnRequestV1 } {
  const clock = new VirtualClock();
  const deps = new FakeDependencies(clock, script);
  const runner = new SupervisedProcessRunner(deps);
  const request: SupervisedSpawnRequestV1 = {
    executable: "/usr/bin/true",
    argv: ["true"],
    env: {},
    cwd: "/",
    stdin: "ignore",
    inheritedFds: [],
    stdoutCap: 1_024,
    stderrCap: 1_024,
    idleMs: 30_000,
    wallMs: 30_000,
    terminationGraceMs: 100,
    phase: runner.beginPhase("test", 3_600_000),
  };
  return { clock, deps, runner, request };
}

const HANG: ChildScript = { exitAt: null };

describe("SupervisedProcessRunner", () => {
  it("does not reset an inherited phase in a later child", async () => {
    const { clock, runner, request } = setup(HANG);
    const startedAt = clock.now();
    const phase = runner.beginPhase("push", 600_000);
    clock.advance(599_900);
    const evidence = await runner.run({ ...request, phase, wallMs: 30_000 });
    expect(evidence.termination).toBe("phase_deadline");
    expect(clock.elapsedSince(startedAt)).toBeLessThanOrEqual(600_000 + request.terminationGraceMs);
    expect(phase.remainingMilliseconds()).toBe(0);
  });

  it("refuses a child whose inherited phase has already expired, without spawning", async () => {
    const { clock, deps, runner, request } = setup(HANG);
    const phase = runner.beginPhase("push", 600_000);
    clock.advance(600_000);
    await expect(runner.run({ ...request, phase })).rejects.toBeInstanceOf(SecurityRefusalError);
    expect(deps.spawned).toBe(0);
  });

  it("classifies its own wall deadline apart from the phase deadline", async () => {
    const { deps, runner, request } = setup(HANG);
    const evidence = await runner.run({ ...request, wallMs: 50 });
    expect(evidence.termination).toBe("wall_deadline");
    expect(deps.signals).toEqual([[-PID, "SIGTERM"], [-PID, "SIGKILL"]]);
  });

  it("sends SIGTERM, then SIGKILL after the grace, to the whole group and reaps it", async () => {
    const { clock, deps, runner, request } = setup({ exitAt: null, ignoresSigterm: true });
    const hangingRequest = request;
    const startedAt = clock.now();
    const evidence = await runner.run({ ...hangingRequest, wallMs: 50, terminationGraceMs: 100 });
    expect(deps.signals).toEqual([[-PID, "SIGTERM"], [-PID, "SIGKILL"]]);
    expect(deps.reaped).toBe(true);
    expect(evidence.groupReaped).toBe(true);
    expect(evidence.signal).toBe("SIGKILL");
    expect(clock.elapsedSince(startedAt)).toBe(150);
  });

  it("sends no signal to a child that exits on its own", async () => {
    const { deps, runner, request } = setup({ output: [{ at: 5, stream: "stdout", chunk: bytes("ok\n") }], exitCode: 3 });
    const evidence = await runner.run(request);
    expect(evidence).toEqual({
      exitCode: 3,
      signal: null,
      stdoutBytes: 3,
      stderrBytes: 0,
      stdoutSha256: sha("ok\n"),
      stderrSha256: EMPTY_SHA,
      termination: "exited",
      groupReaped: true,
    });
    expect(deps.signals).toEqual([]);
  });

  it("passes exactly the requested environment and only FD 3 when asked", async () => {
    const { deps, runner, request } = setup({});
    await runner.run({ ...request, env: { LANG: "C" }, inheritedFds: [{ childFd: 3, parentFd: 42 }] });
    expect(deps.lastSpawn.env).toEqual({ LANG: "C" });
    expect(deps.lastSpawn.stdio).toEqual(["ignore", "pipe", "pipe", 42]);
  });

  it("passes exactly three descriptors without an FD 3 request and pipes stdin bytes only when given", async () => {
    const { deps, runner, request } = setup({});
    await runner.run(request);
    expect(deps.lastSpawn.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(deps.lastSpawn.stdinBytes).toBeNull();
    await runner.run({ ...request, stdin: { bytes: bytes("input") } });
    expect(deps.lastSpawn.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(deps.lastSpawn.stdinBytes).toEqual(bytes("input"));
    expect(deps.lastSpawn.argv).toEqual(["true"]);
  });

  it("re-arms the idle deadline on every output chunk", async () => {
    const output = [50, 100, 150, 200].map((at) => ({ at, stream: at % 100 === 0 ? ("stderr" as const) : ("stdout" as const), chunk: bytes("x") }));
    const { clock, runner, request } = setup({ output, exitAt: null });
    const startedAt = clock.now();
    const evidence = await runner.run({ ...request, idleMs: 60 });
    expect(evidence.termination).toBe("idle_deadline");
    expect(evidence.stdoutBytes + evidence.stderrBytes).toBe(4);
    expect(clock.elapsedSince(startedAt)).toBe(200 + 60 + request.terminationGraceMs);
  });

  it("stops a silent child at the idle deadline long before its wall deadline", async () => {
    const { runner, request } = setup(HANG);
    const evidence = await runner.run({ ...request, idleMs: 100, wallMs: 30_000 });
    expect(evidence.termination).toBe("idle_deadline");
  });

  it("admits output of exactly the cap", async () => {
    const { deps, runner, request } = setup({ output: [{ at: 1, stream: "stdout", chunk: bytes("12345678") }] });
    const evidence = await runner.run({ ...request, stdoutCap: 8 });
    expect(evidence.termination).toBe("exited");
    expect(evidence.stdoutBytes).toBe(8);
    expect(evidence.stdoutSha256).toBe(sha("12345678"));
    expect(deps.signals).toEqual([]);
  });

  it("stops the group at cap+1 and never hashes or sinks the over-cap bytes", async () => {
    const sunk: string[] = [];
    const { deps, runner, request } = setup({
      output: [
        { at: 1, stream: "stderr", chunk: bytes("12345678") },
        { at: 2, stream: "stderr", chunk: bytes("9") },
      ],
      exitAt: null,
    });
    const evidence = await runner.run({ ...request, stderrCap: 8 }, (chunk) => {
      sunk.push(Buffer.from(chunk).toString("utf8"));
    });
    expect(evidence.termination).toBe("output_cap");
    expect(evidence.stderrBytes).toBe(8);
    expect(evidence.stderrSha256).toBe(sha("12345678"));
    expect(sunk).toEqual(["12345678"]);
    expect(deps.signals).toEqual([[-PID, "SIGTERM"], [-PID, "SIGKILL"]]);
  });

  it("hashes exactly the bytes it counts and hands each admitted chunk to the sink", async () => {
    const chunks = [
      { at: 1, stream: "stdout" as const, chunk: bytes("alpha ") },
      { at: 2, stream: "stderr" as const, chunk: bytes("warn") },
      { at: 3, stream: "stdout" as const, chunk: bytes("beta") },
      { at: 4, stream: "stderr" as const, chunk: new Uint8Array([0, 255, 10]) },
    ];
    const sunk: { stdout: Uint8Array[]; stderr: Uint8Array[] } = { stdout: [], stderr: [] };
    const { runner, request } = setup({ output: chunks });
    const evidence = await runner.run(request, (chunk, stream) => {
      sunk[stream].push(chunk);
    });
    const stdout = Buffer.concat(sunk.stdout);
    const stderr = Buffer.concat(sunk.stderr);
    expect(sunk.stdout.length).toBeGreaterThan(0);
    expect(sunk.stderr.length).toBeGreaterThan(0);
    expect(stdout).toEqual(Buffer.from("alpha beta"));
    expect(evidence.stdoutBytes).toBe(stdout.byteLength);
    expect(evidence.stderrBytes).toBe(stderr.byteLength);
    expect(evidence.stdoutSha256).toBe(sha(stdout));
    expect(evidence.stderrSha256).toBe(sha(stderr));
  });

  it("stops the group and rethrows when the sink throws", async () => {
    const failure = new Error("sink failed");
    const { deps, runner, request } = setup({ output: [{ at: 1, stream: "stdout", chunk: bytes("x") }], exitAt: null });
    await expect(
      runner.run(request, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(deps.signals).toEqual([[-PID, "SIGTERM"], [-PID, "SIGKILL"]]);
    expect(deps.reaped).toBe(true);
  });

  it("refuses a non-absolute executable or working directory before spawning", async () => {
    const { deps, runner, request } = setup({});
    for (const invalid of [{ executable: "git" }, { executable: "./git" }, { cwd: "relative" }, { argv: ["a\0b"] }, { env: { "A=B": "c" } }]) {
      await expect(runner.run({ ...request, ...invalid })).rejects.toBeInstanceOf(SecurityRefusalError);
    }
    expect(deps.spawned).toBe(0);
  });

  it("refuses any inherited descriptor other than the single childFd 3", async () => {
    const { deps, runner, request } = setup({});
    const invalid = [
      [{ childFd: 4, parentFd: 42 }],
      [{ childFd: 3, parentFd: 42 }, { childFd: 3, parentFd: 43 }],
      [{ childFd: 3, parentFd: -1 }],
      [{ childFd: 3, parentFd: 1.5 }],
    ] as unknown as SupervisedSpawnRequestV1["inheritedFds"][];
    expect(invalid.length).toBeGreaterThan(0);
    for (const inheritedFds of invalid) {
      await expect(runner.run({ ...request, inheritedFds })).rejects.toBeInstanceOf(SecurityRefusalError);
    }
    expect(deps.spawned).toBe(0);
  });

  it("refuses non-integer caps and non-positive deadlines", async () => {
    const { deps, runner, request } = setup({});
    for (const invalid of [{ stdoutCap: -1 }, { stderrCap: 0.5 }, { idleMs: 0 }, { wallMs: Number.POSITIVE_INFINITY }, { terminationGraceMs: 0 }]) {
      await expect(runner.run({ ...request, ...invalid })).rejects.toBeInstanceOf(SecurityRefusalError);
    }
    expect(deps.spawned).toBe(0);
  });
});

describe("nodeSupervisedProcessDependencies", () => {
  const runner = new SupervisedProcessRunner(nodeSupervisedProcessDependencies);
  const nodeRequest = (script: string, phase: SupervisedPhaseV1): SupervisedSpawnRequestV1 => ({
    executable: process.execPath,
    argv: ["-e", script],
    env: {},
    cwd: tmpdir(),
    stdin: "ignore",
    inheritedFds: [],
    stdoutCap: 65_536,
    stderrCap: 65_536,
    idleMs: 10_000,
    wallMs: 10_000,
    terminationGraceMs: 100,
    phase,
  });
  const collect = (): { readonly chunks: Uint8Array[]; readonly sink: (chunk: Uint8Array) => void; text(): string } => {
    const chunks: Uint8Array[] = [];
    return { chunks, sink: (chunk) => chunks.push(chunk), text: () => Buffer.concat(chunks).toString("utf8") };
  };

  it("never runs a shell: metacharacters reach the child as literal argv", async () => {
    const output = collect();
    const literal = ["$(id)", "`id`", "a;b|c", "$HOME"];
    const evidence = await runner.run(
      { ...nodeRequest("process.stdout.write(JSON.stringify(process.argv.slice(1)))", runner.beginPhase("argv", 30_000)), argv: ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...literal] },
      output.sink,
    );
    expect(evidence.termination).toBe("exited");
    expect(evidence.exitCode).toBe(0);
    expect(JSON.parse(output.text())).toEqual(literal);
    expect(evidence.stdoutSha256).toBe(sha(output.text()));
  });

  it("hands the child exactly the parent descriptor as FD 3", async () => {
    const directory = mkdtempSync(join(tmpdir(), "supervised-fd3-"));
    const file = join(directory, "snapshot.plist");
    writeFileSync(file, "synthetic snapshot bytes");
    const fd = openSync(file, "r");
    try {
      const output = collect();
      const evidence = await runner.run(
        { ...nodeRequest("process.stdout.write(require('node:fs').readFileSync(3))", runner.beginPhase("fd3", 30_000)), inheritedFds: [{ childFd: 3, parentFd: fd }] },
        output.sink,
      );
      expect(evidence.exitCode).toBe(0);
      expect(output.text()).toBe("synthetic snapshot bytes");
    } finally {
      closeSync(fd);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("terminates and reaps a real hanging child at its wall deadline", async () => {
    const evidence = await runner.run({ ...nodeRequest("setInterval(() => undefined, 1000)", runner.beginPhase("hang", 30_000)), wallMs: 200 });
    expect(evidence.termination).toBe("wall_deadline");
    expect(evidence.exitCode).toBeNull();
    expect(evidence.signal).toBe("SIGTERM");
    expect(evidence.groupReaped).toBe(true);
  });

  it("refuses an executable that does not exist", async () => {
    await expect(runner.run({ ...nodeRequest("", runner.beginPhase("missing", 30_000)), executable: "/nonexistent/developer-os-test-binary" })).rejects.toBeInstanceOf(SecurityRefusalError);
  });
});
