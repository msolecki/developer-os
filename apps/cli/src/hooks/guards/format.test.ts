import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ProcessRequest, ProcessResult } from "@developer-os/security";
import { afterEach, describe, expect, it } from "vitest";

import type { HookPayloadV1 } from "../payload.js";
import type { HookRuntime } from "../registry.js";
import { guardFormat, PRETTIER_CONFIG_FILES } from "./format.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "developer-os-guard-format-")));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(configs: readonly string[]): Promise<string> {
  const root = await tempDir();
  await mkdir(join(root, ".git"));
  await pnpmTool(root, "biome", "@biomejs/biome", { biome: "bin/biome" }, "bin/biome");
  await pnpmTool(root, "prettier", "prettier", "./bin/prettier.cjs", "bin/prettier.cjs");
  for (const config of configs) await writeFile(join(root, config), "{}\n");
  await writeFile(join(root, "a.ts"), "export {};\n");
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

function edited(filePath: string, toolName = "Edit"): HookPayloadV1 {
  return { cwd: null, toolName, command: null, filePath, prompt: null, stopHookActive: null };
}

describe("guardFormat", () => {
  it("runs biome, never prettier, when biome.json exists", async () => {
    const root = await project(["biome.json", ".prettierrc"]);
    const { runtime, requests } = runtimeFor(root);
    expect(await guardFormat(edited("a.ts"), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.executable).toBe("/synthetic/bin/node");
    expect(requests[0]?.args).toStrictEqual([
      join(root, "node_modules", ".pnpm", "@biomejs+biome@1.0.0", "node_modules", "@biomejs", "biome", "bin", "biome"),
      "format",
      "--write",
      join(root, "a.ts"),
    ]);
    expect(requests[0]?.env).toStrictEqual({ DEVELOPER_OS_HOOK_ACTIVE: "1" });
    expect(requests[0]?.timeoutMs).toBe(30_000);
  });

  it("runs prettier when only .prettierrc exists", async () => {
    const root = await project([".prettierrc"]);
    const { runtime, requests } = runtimeFor(root);
    await guardFormat(edited(join(root, "a.ts"), "Write"), runtime);
    expect(requests.map((request) => request.args)).toStrictEqual([
      [
        join(root, "node_modules", ".pnpm", "prettier@1.0.0", "node_modules", "prettier", "bin", "prettier.cjs"),
        "--write",
        join(root, "a.ts"),
      ],
    ]);
  });

  it("recognizes every Prettier config file name", async () => {
    expect(PRETTIER_CONFIG_FILES.length).toBeGreaterThan(0);
    for (const config of PRETTIER_CONFIG_FILES) {
      const { runtime, requests } = runtimeFor(await project([config]));
      await guardFormat(edited("a.ts"), runtime);
      expect(requests[0]?.args[0]).toMatch(/prettier\.cjs$/u);
    }
  });

  it("runs nothing without a formatter config, including a package.json prettier key", async () => {
    const root = await project([]);
    await writeFile(join(root, "package.json"), JSON.stringify({ prettier: {} }));
    const { runtime, requests } = runtimeFor(root);
    expect(await guardFormat(edited("a.ts"), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toStrictEqual([]);
  });

  it("does not run on a file outside the root", async () => {
    const outside = await tempDir();
    await writeFile(join(outside, "b.ts"), "export {};\n");
    const { runtime, requests } = runtimeFor(await project(["biome.json"]));
    expect(await guardFormat(edited(join(outside, "b.ts")), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toStrictEqual([]);
  });

  it("does not run on a protected .env file", async () => {
    const root = await project(["biome.json"]);
    await writeFile(join(root, ".env"), "A=1\n");
    const { runtime, requests } = runtimeFor(root);
    expect(await guardFormat(edited(".env"), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toStrictEqual([]);
  });

  it("advises format-failed on a non-zero exit", async () => {
    const { runtime } = runtimeFor(await project(["biome.json"]), () => Promise.resolve({ ...OK, exitCode: 1 }));
    const outcome = await guardFormat(edited("a.ts"), runtime);
    expect(outcome.kind).toBe("advise");
    expect(outcome.kind === "advise" ? outcome.ruleId : undefined).toBe("format-failed");
  });

  it("runs nothing when only the .bin shim exists", async () => {
    const root = await tempDir();
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
    await writeFile(join(root, "node_modules", ".bin", "biome"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await writeFile(join(root, "biome.json"), "{}\n");
    await writeFile(join(root, "a.ts"), "export {};\n");
    const { runtime, requests } = runtimeFor(root);
    expect(await guardFormat(edited("a.ts"), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toStrictEqual([]);
  });

  it("ignores a Read tool", async () => {
    const { runtime, requests } = runtimeFor(await project(["biome.json"]));
    expect(await guardFormat(edited("a.ts", "Read"), runtime)).toStrictEqual({ kind: "allow" });
    expect(requests).toStrictEqual([]);
  });

  it("allows with a note when the user home is unknown", async () => {
    const { runtime, requests } = runtimeFor(await project(["biome.json"]));
    const outcome = await guardFormat(edited("a.ts"), { ...runtime, userHome: null });
    expect(outcome.kind === "allow" ? outcome.note : undefined).toEqual(expect.any(String));
    expect(requests).toStrictEqual([]);
  });
});
