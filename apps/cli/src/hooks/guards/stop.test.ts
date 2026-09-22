import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ProcessRequest, ProcessResult } from "@developer-os/security";
import { afterEach, describe, expect, it } from "vitest";

import type { HookPayloadV1 } from "../payload.js";
import type { HookRuntime } from "../registry.js";
import { guardStop } from "./stop.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "developer-os-guard-stop-")));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(files: { tsconfig?: boolean; tsc?: boolean; check?: boolean } = {}): Promise<string> {
  const root = await tempDir();
  await mkdir(join(root, ".git"));
  if (files.tsconfig ?? true) await writeFile(join(root, "tsconfig.json"), "{}\n");
  if (files.check ?? false) await writeFile(join(root, "tsconfig.check.json"), "{}\n");
  if (files.tsc ?? true) {
    await pnpmTool(root, "tsc", "typescript", { tsc: "bin/tsc", tsserver: "bin/tsserver" }, "bin/tsc");
  }
  return root;
}

/** A pnpm-shaped install: `.bin/<tool>` is a sh shim node cannot run; the package's `bin` names the JS entry. */
async function pnpmTool(root: string, tool: string, pkg: string, bin: unknown, entry: string): Promise<void> {
  const store = join(root, "node_modules", ".pnpm", `${pkg.replace("/", "+")}@1.0.0`, "node_modules", pkg);
  await mkdir(join(store, dirname(entry)), { recursive: true });
  await writeFile(join(store, "package.json"), JSON.stringify({ name: pkg, bin }));
  await writeFile(join(store, entry), "#!/usr/bin/env node\n", { mode: 0o755 });
  await mkdir(dirname(join(root, "node_modules", pkg)), { recursive: true });
  await symlink(store, join(root, "node_modules", pkg));
  await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
  await writeFile(join(root, "node_modules", ".bin", tool), `#!/bin/sh\nexec node "${join(store, entry)}" "$@"\n`, {
    mode: 0o755,
  });
}

const OK: ProcessResult = { stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false };

function runtimeFor(cwd: string, respond: () => Promise<ProcessResult> = () => Promise.resolve(OK)) {
  const requests: ProcessRequest[] = [];
  const runtime: HookRuntime = {
    vendor: "claude",
    env: {},
    userHome: "/Users/synthetic",
    cwd,
    runner: {
      run: (request) => {
        requests.push(request);
        return respond();
      },
    },
    nodeExecutable: "/synthetic/bin/node",
    now: () => new Date(0),
    io: {
      stdout: () => undefined,
      stderr: () => undefined,
      confirm: () => Promise.resolve(false),
      readStdin: () => Promise.resolve(null),
    },
    createContext: () => {
      throw new Error("a hook verb built a context");
    },
  };
  return { runtime, requests };
}

function payload(stopHookActive: boolean): HookPayloadV1 {
  return { cwd: null, toolName: null, command: null, filePath: null, prompt: null, stopHookActive };
}

describe("guardStop", () => {
  it("allows without spawning when the stop-loop flag is set", async () => {
    const { runtime, requests } = runtimeFor(await project());
    expect(await guardStop(payload(true), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toStrictEqual([]);
  });

  it("allows without spawning when there is no tsconfig.json", async () => {
    const { runtime, requests } = runtimeFor(await project({ tsconfig: false }));
    expect(await guardStop(payload(false), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toStrictEqual([]);
  });

  it("allows without spawning when there is no local tsc", async () => {
    const { runtime, requests } = runtimeFor(await project({ tsc: false }));
    expect(await guardStop(payload(false), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toStrictEqual([]);
  });

  it("runs the local tsc script under the hook's node with the marker only", async () => {
    const root = await project();
    const { runtime, requests } = runtimeFor(root);
    expect(await guardStop(payload(false), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.executable).toBe("/synthetic/bin/node");
    expect(request?.args[0]).toBe(
      join(root, "node_modules", ".pnpm", "typescript@1.0.0", "node_modules", "typescript", "bin", "tsc"),
    );
    expect(request?.args.slice(1)).toStrictEqual(["--noEmit", "-p", join(root, "tsconfig.json")]);
    expect(request?.env).toStrictEqual({ DEVELOPER_OS_HOOK_ACTIVE: "1" });
    expect(request?.timeoutMs).toBe(120_000);
    expect(request?.cwd).toBe(root);
  });

  it("points -p at tsconfig.check.json when it sits beside tsconfig.json", async () => {
    const root = await project({ check: true });
    const { runtime, requests } = runtimeFor(root);
    await guardStop(payload(false), runtime);
    expect(requests[0]?.args.slice(1)).toStrictEqual(["--noEmit", "-p", join(root, "tsconfig.check.json")]);
  });

  it("blocks a failing typecheck with exactly the first 40 diagnostic lines", async () => {
    const lines = Array.from({ length: 60 }, (_, index) => `src/a.ts(${String(index + 1)},1): error TS2322: x`);
    expect(lines).toHaveLength(60);
    const { runtime } = runtimeFor(await project(), () =>
      Promise.resolve({ ...OK, exitCode: 1, stdout: `${lines.join("\n")}\n` }),
    );
    const outcome = await guardStop(payload(false), runtime);
    expect(outcome).toStrictEqual({ kind: "block", ruleId: "typecheck", detail: lines.slice(0, 40).join("\n") });
  });

  it.each([
    ["a timeout", () => Promise.resolve({ ...OK, exitCode: null, signal: "SIGKILL" as const, timedOut: true })],
    ["a spawn rejection", () => Promise.reject(new Error("spawn ENOENT"))],
    ["an output overflow", () => Promise.reject(new Error("Process output exceeded capture limit"))],
  ])("allows with a note on %s", async (_name, respond) => {
    const { runtime } = runtimeFor(await project(), respond);
    const outcome = await guardStop(payload(false), runtime);
    expect(outcome.kind).toBe("allow");
    expect(outcome.kind === "allow" ? outcome.note : undefined).toEqual(expect.any(String));
  });

  it("does not run a typescript package that resolves outside the project root", async () => {
    const outside = await tempDir();
    await pnpmTool(outside, "tsc", "typescript", { tsc: "bin/tsc" }, "bin/tsc");
    const root = await project({ tsc: false });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await symlink(join(outside, "node_modules", "typescript"), join(root, "node_modules", "typescript"));
    const { runtime, requests } = runtimeFor(root);
    expect(await guardStop(payload(false), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toStrictEqual([]);
  });

  it("does not run a bin entry that escapes its package", async () => {
    const root = await project({ tsc: false });
    await writeFile(join(root, "evil.js"), "synthetic\n");
    await pnpmTool(root, "tsc", "typescript", { tsc: "../../../../../evil.js" }, "bin/tsc");
    const { runtime, requests } = runtimeFor(root);
    expect(await guardStop(payload(false), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toStrictEqual([]);
  });

  it("does not read a package.json that links outside its package", async () => {
    const outside = await tempDir();
    await writeFile(join(outside, "package.json"), JSON.stringify({ name: "typescript", bin: { tsc: "bin/tsc" } }));
    const root = await project();
    const manifest = join(root, "node_modules", "typescript", "package.json");
    await rm(manifest);
    await symlink(join(outside, "package.json"), manifest);
    const { runtime, requests } = runtimeFor(root);
    expect(await guardStop(payload(false), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toStrictEqual([]);
  });

  it.each([
    ["no bin field", undefined],
    ["a string bin, which names the command typescript", "bin/tsc"],
    ["a bin object without tsc", { tsserver: "bin/tsc" }],
  ])("treats %s as an absent tsc even with a .bin shim", async (_name, bin) => {
    const root = await project({ tsc: false });
    await pnpmTool(root, "tsc", "typescript", bin, "bin/tsc");
    const { runtime, requests } = runtimeFor(root);
    expect(await guardStop(payload(false), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toStrictEqual([]);
  });
});
