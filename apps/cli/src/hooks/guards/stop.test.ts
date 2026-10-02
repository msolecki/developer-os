import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createRedactor } from "@developer-os/security";
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

async function project(
  files: { tsconfig?: boolean; tsc?: boolean; check?: boolean; config?: string } = {},
): Promise<string> {
  const root = await tempDir();
  await mkdir(join(root, ".git"));
  if (files.tsconfig ?? true) await writeFile(join(root, "tsconfig.json"), files.config ?? "{}\n");
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

async function mkRefs(root: string): Promise<void> {
  for (const dir of ["packages/ui", "packages/core"]) {
    await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, dir, "tsconfig.json"), "{}\n");
  }
}

async function tree(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries.filter((e) => !e.startsWith("node_modules") && !e.startsWith(".git")).sort();
}

const redact = createRedactor(new Uint8Array(32));

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
    redact: (text) => redact(text).text,
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

  const SOLUTION = '{ "files": [], "references": [{ "path": "packages/ui" }, { "path": "./packages/core/tsconfig.json" }] }';

  it("builds a solution tsconfig through its references with tsc -b --noEmit", async () => {
    const root = await project({ config: SOLUTION });
    await mkRefs(root);
    const { runtime, requests } = runtimeFor(root);
    expect(await guardStop(payload(false), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.args.slice(1)).toStrictEqual(["-b", "--noEmit", join(root, "tsconfig.json")]);
  });

  it("detects references in a JSONC tsconfig with comments and trailing commas", async () => {
    const config = `{
      // solution config
      "files": [], /* none */
      "references": [
        { "path": "packages/ui", }, // trailing comma
      ],
      "x": "// not a comment",
    }`;
    const jroot = await project({ config });
    await mkRefs(jroot);
    const { runtime, requests } = runtimeFor(jroot);
    await guardStop(payload(false), runtime);
    expect(requests[0]?.args.slice(1, 3)).toStrictEqual(["-b", "--noEmit"]);
  });

  it("keeps -p for an empty references array and prefers tsconfig.check.json", async () => {
    const empty = runtimeFor(await project({ config: '{ "references": [] }' }));
    await guardStop(payload(false), empty.runtime);
    expect(empty.requests[0]?.args[1]).toBe("--noEmit");
    const root = await project({ config: SOLUTION, check: true });
    await mkRefs(root);
    const { runtime, requests } = runtimeFor(root);
    await guardStop(payload(false), runtime);
    expect(requests[0]?.args.slice(1)).toStrictEqual(["--noEmit", "-p", join(root, "tsconfig.check.json")]);
  });

  it("falls back to each referenced project with -p when tsc rejects -b --noEmit", async () => {
    const root = await project({ config: SOLUTION });
    await mkRefs(root);
    let call = 0;
    const { runtime, requests } = runtimeFor(root, () => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({ ...OK, exitCode: 1, stdout: "error TS5094: Compiler option '--noEmit' may not be used with '--build'.\n" });
      }
      return Promise.resolve(call === 2 ? { ...OK, exitCode: 1, stdout: "a.ts(1,1): error TS1: one\n" } : { ...OK, exitCode: 1, stdout: "b.ts(1,1): error TS2: two\n" });
    });
    const outcome = await guardStop(payload(false), runtime);
    expect(requests.slice(1).map((r) => r.args.slice(1))).toStrictEqual([
      ["--noEmit", "-p", join(root, "packages/ui", "tsconfig.json")],
      ["--noEmit", "-p", join(root, "packages/core/tsconfig.json")],
    ]);
    expect(outcome).toStrictEqual({ kind: "block", ruleId: "typecheck", detail: "a.ts(1,1): error TS1: one\nb.ts(1,1): error TS2: two" });
  });

  it.each([["invalid JSON", "{ nope"], ["a non-object", "[1]"]])("allows with a note on %s", async (_n, config) => {
    const { runtime } = runtimeFor(await project({ config }));
    const outcome = await guardStop(payload(false), runtime);
    expect(outcome.kind).toBe("allow");
    expect(outcome.kind === "allow" ? outcome.note : undefined).toEqual(expect.any(String));
  });

  it("passes a real solution monorepo with a jsx package (no TS6142)", async () => {
    const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
    const root = await project({
      config: '{ "files": [], "references": [{ "path": "packages/ui" }] }',
    });
    await mkdir(join(root, "packages/ui"), { recursive: true });
    await writeFile(
      join(root, "packages/ui/tsconfig.json"),
      '{ "compilerOptions": { "jsx": "preserve", "composite": true, "strict": true, "skipLibCheck": true, "types": [] }, "include": ["*.ts", "*.tsx"] }',
    );
    await writeFile(join(root, "packages/ui/a.tsx"), "export const A = 1;\n");
    await writeFile(join(root, "packages/ui/b.ts"), 'import { A } from "./a";\nexport const B: number = A;\n');
    const { runtime } = runtimeFor(root);
    const real: HookRuntime = {
      ...runtime,
      nodeExecutable: process.execPath,
      runner: {
        run: (request) =>
          new Promise((done) => {
            execFile(process.execPath, [tsc, ...request.args.slice(1)], { cwd: request.cwd }, (err, stdout, stderr) => {
              done({ stdout, stderr, exitCode: err === null ? 0 : 1, signal: null, timedOut: false });
            });
          }),
      },
    };
    expect(await guardStop(payload(false), real)).toStrictEqual({ kind: "allow" });
  }, 30_000);

  it("does not trigger the -p fallback on an unrelated TS5083 mentioning build", async () => {
    const root = await project({ config: SOLUTION });
    await mkRefs(root);
    const { runtime, requests } = runtimeFor(root, () =>
      Promise.resolve({ ...OK, exitCode: 1, stdout: "error TS5083: Cannot read file '/x/build/tsconfig.json'.\n" }),
    );
    expect((await guardStop(payload(false), runtime)).kind).toBe("block");
    expect(requests).toHaveLength(1);
  });

  it("falls back on TS6310 too", async () => {
    const root = await project({ config: SOLUTION });
    await mkRefs(root);
    let n = 0;
    const { runtime, requests } = runtimeFor(root, () => {
      n += 1;
      return Promise.resolve(n === 1 ? { ...OK, exitCode: 1, stdout: "error TS6310: x\n" } : OK);
    });
    await guardStop(payload(false), runtime);
    expect(requests).toHaveLength(3);
  });

  it.each([
    ["an absolute path", (outside: string) => outside],
    ["a ../ path", () => "../outside-ref"],
    ["a symlink to outside", () => "link"],
    ["a missing path", () => "packages/missing"],
  ])("allows with a note and no tsc when a reference is %s", async (_n, refPath) => {
    const outside = await tempDir();
    await writeFile(join(outside, "tsconfig.json"), "{}\n");
    const root = await project({ config: JSON.stringify({ references: [{ path: refPath(outside) }] }) });
    await symlink(outside, join(root, "link"));
    await mkdir(join(root, "..", "outside-ref"), { recursive: true });
    await writeFile(join(root, "..", "outside-ref", "tsconfig.json"), "{}\n");
    const { runtime, requests } = runtimeFor(root);
    const outcome = await guardStop(payload(false), runtime);
    expect(outcome.kind === "allow" ? outcome.note : "").toMatch(/reference/u);
    expect(requests).toStrictEqual([]);
    await rm(join(root, "..", "outside-ref"), { recursive: true, force: true });
  });

  it("parses a BOM-prefixed tsconfig and keeps a comma-bracket inside a string", async () => {
    const config = '\uFEFF{ "x": "a, ]", "references": [{ "path": "packages/ui" }] }';
    const root = await project({ config });
    await mkRefs(root);
    const { runtime, requests } = runtimeFor(root);
    await guardStop(payload(false), runtime);
    expect(requests[0]?.args.slice(1, 3)).toStrictEqual(["-b", "--noEmit"]);
  });

  it("leaves no new build-info file behind but keeps pre-existing ones", async () => {
    const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
    const root = await project({ config: '{ "files": [], "references": [{ "path": "p" }] }' });
    await mkdir(join(root, "p"), { recursive: true });
    await writeFile(
      join(root, "p/tsconfig.json"),
      '{ "compilerOptions": { "composite": true, "strict": true, "skipLibCheck": true, "types": [] }, "include": ["*.ts"] }',
    );
    await writeFile(join(root, "p/a.ts"), "export const A = 1;\n");
    await writeFile(join(root, "keep.tsbuildinfo"), "keep");
    const before = await tree(root);
    const { runtime } = runtimeFor(root);
    const real: HookRuntime = {
      ...runtime,
      nodeExecutable: process.execPath,
      runner: {
        run: (request) =>
          new Promise((done) => {
            execFile(process.execPath, [tsc, ...request.args.slice(1)], { cwd: request.cwd }, (err, stdout, stderr) => {
              done({ stdout, stderr, exitCode: err === null ? 0 : 1, signal: null, timedOut: false });
            });
          }),
      },
    };
    expect(await guardStop(payload(false), real)).toStrictEqual({ kind: "allow" });
    expect(await tree(root)).toStrictEqual(before);
    expect(await readFile(join(root, "keep.tsbuildinfo"), "utf8")).toBe("keep");
  }, 30_000);

  it("blocks a failing typecheck with exactly the first 40 diagnostic lines", async () => {
    const lines = Array.from({ length: 60 }, (_, index) => `src/a.ts(${String(index + 1)},1): error TS2322: x`);
    expect(lines).toHaveLength(60);
    const { runtime } = runtimeFor(await project(), () =>
      Promise.resolve({ ...OK, exitCode: 1, stdout: `${lines.join("\n")}\n` }),
    );
    const outcome = await guardStop(payload(false), runtime);
    expect(outcome).toStrictEqual({ kind: "block", ruleId: "typecheck", detail: lines.slice(0, 40).join("\n") });
  });

  it("redacts a quoted secret the 1,800-byte cap would cut before it truncates", async () => {
    // Synthetic provider-token shape; the diagnostic byte cap (1,800) falls inside it.
    const token = `ghp_${"SyntheticToken0".repeat(3)}`;
    const quoted = `src/a.ts(1,1): error TS2322: ${"x".repeat(1790 - 30)}${token}`;
    const { runtime } = runtimeFor(await project(), () => Promise.resolve({ ...OK, exitCode: 1, stdout: quoted }));
    const outcome = await guardStop(payload(false), runtime);
    expect(outcome.kind).toBe("block");
    expect(outcome.kind === "block" ? outcome.detail : "").not.toContain(token.slice(0, 8));
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
