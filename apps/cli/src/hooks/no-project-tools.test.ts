import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CliIo } from "../io.js";
import { runHookMode } from "./entry.js";
import { HOOK_HANDLERS } from "./registry.js";
import type { HookRuntime } from "./registry.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const recorder = (marker: string): string =>
  `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "");\n`;

/** A pnpm-shaped install whose package entry and `.bin` shim each record that they ran. */
async function plantTool(root: string, tool: string, pkg: string, bin: unknown, entry: string): Promise<void> {
  const store = join(root, "node_modules", ".pnpm", `${pkg.replace("/", "+")}@1.0.0`, "node_modules", pkg);
  await mkdir(join(store, dirname(entry)), { recursive: true });
  await writeFile(join(store, "package.json"), JSON.stringify({ name: pkg, bin }));
  await writeFile(join(store, entry), recorder(join(root, "ran", tool)), { mode: 0o755 });
  await mkdir(dirname(join(root, "node_modules", pkg)), { recursive: true });
  await symlink(store, join(root, "node_modules", pkg));
  await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
  await writeFile(join(root, "node_modules", ".bin", tool), `#!/bin/sh\n: > "${join(root, "ran", `${tool}-shim`)}"\n`, {
    mode: 0o755,
  });
}

/** A TypeScript project with a planted tsc, prettier and biome, and a `.prettierrc.js` that records a load. */
async function hostileProject(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-no-project-tools-")));
  dirs.push(root);
  await mkdir(join(root, ".git"));
  await mkdir(join(root, "ran"));
  await writeFile(join(root, "tsconfig.json"), "{}\n");
  await writeFile(join(root, "biome.json"), "{}\n");
  await writeFile(join(root, ".prettierrc.js"), recorder(join(root, "ran", "prettierrc")));
  await writeFile(join(root, "a.ts"), "export {};\n");
  await plantTool(root, "tsc", "typescript", { tsc: "bin/tsc" }, "bin/tsc");
  await plantTool(root, "prettier", "prettier", "./bin/prettier.cjs", "bin/prettier.cjs");
  await plantTool(root, "biome", "@biomejs/biome", { biome: "bin/biome" }, "bin/biome");
  return root;
}

function io(payload: unknown, out: string[]): CliIo {
  return {
    stdout: (line) => void out.push(line),
    stderr: (line) => void out.push(line),
    confirm: () => Promise.resolve(false),
    readStdin: () => Promise.resolve(null),
    readStdinBytes: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(payload))),
  };
}

// D102 (AUD-006, NEW-251): a hook never runs code from the project's node_modules.
describe("stop and format run no project tool", () => {
  for (const vendor of ["claude", "codex"] as const) {
    it(`runs no planted tsc, prettier or biome through the hook entry (${vendor})`, async () => {
      const root = await hostileProject();
      const payloads = {
        stop: { cwd: root, stop_hook_active: false },
        format:
          vendor === "claude"
            ? { cwd: root, tool_name: "Write", tool_input: { file_path: join(root, "a.ts") } }
            : {
                cwd: root,
                tool_name: "apply_patch",
                tool_input: { command: "*** Begin Patch\n*** Update File: a.ts\n@@\n-export {};\n+export {};\n*** End Patch\n" },
              },
      };
      // The second `format` runs without biome.json, where prettier and its `.prettierrc.js` were next.
      const runs = [...Object.entries(payloads), ["format", payloads.format] as const];
      for (const [index, [verb, payload]] of runs.entries()) {
        if (index === runs.length - 1) await rm(join(root, "biome.json"));
        const out: string[] = [];
        const code = await runHookMode(
          ["guard", verb, "--vendor", vendor],
          io(payload, out),
          () => {
            throw new Error("a hook verb built a context");
          },
          {
            env: {},
            userHome: root,
            processCwd: () => root,
            nodeExecutable: process.execPath,
            recordFiring: () => Promise.resolve(),
          },
        );
        expect(code, verb).toBe(0);
        expect(out, verb).toStrictEqual([]);
      }
      expect(await readdir(join(root, "ran"))).toStrictEqual([]);
    });
  }

  it("never reaches the process runner", async () => {
    const root = await hostileProject();
    const runtime: HookRuntime = {
      vendor: "claude",
      env: {},
      userHome: root,
      cwd: root,
      runner: { run: () => Promise.reject(new Error("a hook spawned a child")) },
      nodeExecutable: process.execPath,
      redact: (text) => text,
      io: io(null, []),
      createContext: () => {
        throw new Error("a hook verb built a context");
      },
    };
    const base = { cwd: root, command: null, prompt: null };
    expect(await HOOK_HANDLERS.stop?.({ ...base, toolName: null, filePath: null, stopHookActive: false }, runtime)).toStrictEqual({
      kind: "allow",
    });
    expect(
      await HOOK_HANDLERS.format?.({ ...base, toolName: "Write", filePath: join(root, "a.ts"), stopHookActive: null }, runtime),
    ).toStrictEqual({ kind: "allow" });
  });
});
