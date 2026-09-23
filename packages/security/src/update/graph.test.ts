import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { blankPlannerModule, inspectPlannerGraph, type PlannerCapabilityV1 } from "./graph.js";

const compiledPlannerEntrypoint = fileURLToPath(new URL("../../../core/dist/update/planner.js", import.meta.url));

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop() as string, { recursive: true, force: true });
});

async function graphOf(files: Readonly<Record<string, string>>): Promise<{ readonly root: string; readonly entry: string }> {
  const root = await mkdtemp(join(tmpdir(), "dos-planner-graph-"));
  roots.push(root);
  for (const [name, source] of Object.entries(files)) await writeFile(join(root, name), source);
  return { root, entry: join(root, "entry.js") };
}

describe("planner capability graph", () => {
  it("enumerates a non-empty graph with no forbidden capability", () => {
    const graph = inspectPlannerGraph(compiledPlannerEntrypoint);
    expect(graph.modules.length).toBeGreaterThan(0);
    expect(graph.modules).toContain(compiledPlannerEntrypoint);
    expect(graph.forbidden).toEqual([]);
  });

  it.each<{ name: string; source: string; capability: PlannerCapabilityV1 }>([
    { name: "a filesystem import", source: 'import { readFileSync } from "node:fs";\n', capability: "filesystem" },
    { name: "a promises filesystem import", source: 'export * from "fs/promises";\n', capability: "filesystem" },
    { name: "a network import", source: 'import { request } from "node:https";\n', capability: "network" },
    { name: "a socket import", source: 'import net from "node:net";\n', capability: "network" },
    { name: "a fetch call", source: "export const load = () => fetch(url);\n", capability: "network" },
    { name: "a process import", source: 'import { spawn } from "node:child_process";\n', capability: "process" },
    { name: "an environment read", source: "export const home = process.env.HOME;\n", capability: "environment" },
    { name: "an os import", source: 'import os from "node:os";\n', capability: "environment" },
    { name: "a global object reach", source: 'export const p = globalThis["pro" + "cess"];\n', capability: "environment" },
    { name: "a clock read", source: "export const now = Date.now();\n", capability: "clock" },
    { name: "an argument-free date", source: "export const now = new Date();\n", capability: "clock" },
    { name: "a performance clock", source: "export const now = performance.now();\n", capability: "clock" },
    { name: "a timer", source: "setTimeout(() => undefined, 1);\n", capability: "clock" },
    { name: "Math.random", source: "export const r = Math.random();\n", capability: "randomness" },
    { name: "crypto randomness", source: 'import { randomBytes } from "node:crypto";\nexport const r = randomBytes(4);\n', capability: "randomness" },
    { name: "web crypto randomness", source: "export const r = crypto.getRandomValues(new Uint8Array(4));\n", capability: "randomness" },
    { name: "a native addon", source: 'import addon from "./addon.node";\n', capability: "native" },
    { name: "a worker import", source: 'import { Worker } from "node:worker_threads";\n', capability: "worker" },
    { name: "a dynamic import", source: 'export const later = import("./other.js");\n', capability: "dynamic_import" },
    { name: "a require call", source: 'export const fs = require("fs");\n', capability: "dynamic_import" },
    { name: "eval", source: 'export const x = eval("1");\n', capability: "dynamic_import" },
    { name: "the Function constructor", source: 'export const f = new Function("return 1");\n', capability: "dynamic_import" },
    { name: "a module import", source: 'import { createRequire } from "node:module";\n', capability: "dynamic_import" },
    { name: "import.meta", source: "export const here = import.meta.url;\n", capability: "filesystem" },
    { name: "an unclassified builtin", source: 'import { lookup } from "node:inspector";\n', capability: "unresolved" },
  ])("refuses $name", async ({ source, capability }) => {
    const { entry } = await graphOf({ "entry.js": source, "addon.node": "", "other.js": "export {};\n" });
    expect(inspectPlannerGraph(entry).forbidden.map((finding) => finding.capability)).toContain(capability);
  });

  it("follows the complete transitive graph through cycles", async () => {
    const { root, entry } = await graphOf({
      "entry.js": 'import { b } from "./b.js";\nexport const a = b;\n',
      "b.js": 'export { c as b } from "./c.js";\nimport "./entry.js";\n',
      "c.js": 'import { readFileSync } from "node:fs";\nexport const c = 1;\n',
    });
    const graph = inspectPlannerGraph(entry);
    expect(graph.modules).toEqual([join(root, "b.js"), join(root, "c.js"), join(root, "entry.js")].sort());
    expect(graph.forbidden).toEqual([{ module: join(root, "c.js"), capability: "filesystem", evidence: "node:fs" }]);
  });

  it("refuses a missing entrypoint with an empty graph", async () => {
    const { entry } = await graphOf({});
    const graph = inspectPlannerGraph(entry);
    expect(graph.modules).toEqual([]);
    expect(graph.forbidden.map((finding) => finding.capability)).toEqual(["unresolved"]);
  });

  it("refuses an unreadable relative module and an unresolvable package", async () => {
    const { entry } = await graphOf({ "entry.js": 'import "./missing.js";\nimport "not-a-real-package-xyz";\n' });
    const evidence = inspectPlannerGraph(entry).forbidden.map((finding) => `${finding.capability}:${finding.evidence}`);
    expect(evidence).toEqual(expect.arrayContaining(["unresolved:module is not readable", "unresolved:not-a-real-package-xyz"]));
  });

  it("admits hashing, argument-bearing dates, and capability names in prose or literals", async () => {
    const { entry } = await graphOf({
      "entry.js": [
        'import { createHash } from "node:crypto";',
        "// process.env and Date.now() in a comment",
        "/* fetch(url) and require('fs') in a block comment */",
        'const text = "Math.random() import(\\"x\\")";',
        "const pattern = /[\"'`]process/gu;",
        "const quoted = `${text} Date.now()`;",
        'export const parsed = new Date("2026-09-23T08:00:00Z");',
        'export const digest = createHash("sha256").update(quoted + String(pattern)).digest("hex");',
        "export const size = value.process;",
        "",
      ].join("\n"),
    });
    const graph = inspectPlannerGraph(entry);
    expect(graph.builtins).toEqual(["crypto"]);
    expect(graph.forbidden).toEqual([]);
  });

  it("keeps template substitutions as code", () => {
    const { code } = blankPlannerModule("const a = `x ${process.env.HOME} y`;\n");
    expect(code).toContain("process.env.HOME");
    expect(code).not.toContain("x ");
  });

  it("refuses an unlexable module instead of skipping it", async () => {
    const { entry } = await graphOf({ "entry.js": 'const broken = "unterminated;\n' });
    expect(inspectPlannerGraph(entry).forbidden).toEqual([expect.objectContaining({ capability: "unresolved", evidence: "module is not lexable" })]);
  });
});
