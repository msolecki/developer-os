import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { decodeCanonicalJson, encodeCanonicalJson, EXIT_CODES, hashBytes } from "@developer-os/core";
import type { CanonicalJsonValue, InstallationManifestV2 } from "@developer-os/core";

import { runInit } from "../commands/init.js";
import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { withLifecycleMutation } from "../lifecycle/mutation-gate.js";
import { hookNodePath, readActiveReleaseTree } from "./active-release.js";
import { applyInstructions, stableNodePath } from "./apply.js";

afterAll(removeCommandFixtures);

const CLAUDE = "/opt/synthetic/bin/claude";
const encoder = new TextEncoder();
const INSTRUCTIONS = [
  { relativePath: "catalog.json", bytes: encoder.encode(`${JSON.stringify({ schemaVersion: 1, artifacts: [{ category: "skill", id: "triage", legacyName: "triage", vendors: ["claude"], thinCommand: false }] })}\n`), mode: 0o600 },
  { relativePath: "skills/triage/SKILL.md", bytes: encoder.encode("---\nname: triage\ndescription: Triage a defect.\n---\nTriage.\n"), mode: 0o600 },
] as const;
const CLAUDE_ONLY = {
  agents: {
    claude: { name: "claude", installed: true, executablePath: CLAUDE, version: null },
    codex: { name: "codex", installed: false, executablePath: null, version: null },
  },
  runner: {
    run: (request: { readonly args: readonly string[] }) => request.args.join(" ") === "--version"
      ? Promise.resolve({ stdout: "2.1.280 (Claude Code)\n", stderr: "", exitCode: 0, signal: null, timedOut: false })
      : Promise.reject(new Error(`unexpected spawn: ${request.args.join(" ")}`)),
  },
} as const;

async function installed(label: string): Promise<{ readonly fixture: CommandFixture; readonly bundleRoot: string }> {
  const fixture = await createCommandFixture(label, { bootstrapAvailable: true, instructions: INSTRUCTIONS, ...CLAUDE_ONLY });
  await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });
  const result = await runInit(fixture.context, { dryRun: false, assumeYes: true, adapters: ["claude"] });
  if (!result.ok) throw new Error(JSON.stringify(result));
  const active = JSON.parse(await nodeFs.readFile(join(fixture.paths.stateDir, "active-release.json"), "utf8")) as { bundleRoot: string };
  return { fixture, bundleRoot: active.bundleRoot };
}

async function manifestOf(fixture: CommandFixture): Promise<InstallationManifestV2> {
  return decodeCanonicalJson(await nodeFs.readFile(fixture.paths.manifestFile), 1 << 26) as unknown as InstallationManifestV2;
}

/** A second context over the same home with no packaged release and the keg deleted. */
async function kegless(fixture: CommandFixture) {
  await nodeFs.rm(join(fixture.root, "prefix"), { recursive: true, force: true });
  return (await createCommandFixture("kegless", { root: fixture.root, ...CLAUDE_ONLY })).context;
}

/** C3: the fixture table's `opt` path, `<root>/prefix/opt/developer-os/libexec/fallback/bundle/bin/runtime`. */
function optNode(fixture: CommandFixture): string {
  return join(fixture.root, "prefix", "opt", "developer-os", "libexec", "fallback", "bundle", "bin", "runtime");
}

describe("readActiveReleaseTree (K8)", () => {
  it("(a) lists the active bundle's instructions/ and workflows/ files", async () => {
    const { fixture, bundleRoot } = await installed("active-tree");
    const tree = await readActiveReleaseTree(fixture.context);
    if (tree === null) throw new Error("a package-channel home must have an active tree");
    expect(tree).toMatchObject({ bundleRoot, version: "1.0.0", runtimeEntrypoint: "bin/runtime" });
    const paths = tree.files.map((file) => file.relativePath);
    expect(paths).toContain(`${bundleRoot}/instructions/catalog.json`);
    expect(paths.some((path) => path.startsWith(`${bundleRoot}/workflows/`))).toBe(true);
    expect(paths.every((path) => path.startsWith(`${bundleRoot}/instructions/`) || path.startsWith(`${bundleRoot}/workflows/`))).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(b) refuses a bundle file whose bytes differ from the retained manifest, exit 6", async () => {
    const { fixture, bundleRoot } = await installed("active-tree-tampered");
    const skill = join(bundleRoot, "instructions", "skills", "triage", "SKILL.md");
    await nodeFs.writeFile(skill, "tampered\n");
    const tree = await readActiveReleaseTree(fixture.context);
    await expect(tree?.readFile(skill)).rejects.toMatchObject({ reason: "active_release_tree_invalid", code: EXIT_CODES.recoveryRequired });
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(c) refuses a retained bundle manifest that does not hash to the active record, exit 6", async () => {
    const { fixture } = await installed("active-tree-manifest");
    const active = JSON.parse(await nodeFs.readFile(join(fixture.paths.stateDir, "active-release.json"), "utf8")) as { bundleManifestHash: string };
    await nodeFs.appendFile(join(fixture.paths.stateDir, "release-metadata", "bundles", `${active.bundleManifestHash}.json`), " ");
    await expect(readActiveReleaseTree(fixture.context)).rejects.toMatchObject({ reason: "active_release_tree_invalid", code: EXIT_CODES.recoveryRequired });
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});

describe("applyInstructions({ source: \"active-release\" }) (K8, C1, C3)", () => {
  it("(d) restores a deleted managed file with no keg; hooks name the stable opt Node, unchanged", async () => {
    const { fixture } = await installed("active-refresh-restore");
    const rows = (await manifestOf(fixture)).artifacts;
    const skill = rows.find((row) => row.kind === "instruction" && row.owner === "claude" && row.path.endsWith("/SKILL.md"));
    const hooks = rows.find((row) => row.owner === "claude" && row.path.endsWith("/hooks/hooks.json"));
    if (skill === undefined || hooks === undefined) throw new Error("no rendered skill or hooks");
    const hooksBefore = await nodeFs.readFile(hooks.path, "utf8");
    expect(hooksBefore).toContain(`${optNode(fixture)} ${join(fixture.paths.home, "bin", "developer-os.mjs")} `);
    const skillBytes = await nodeFs.readFile(skill.path);
    await nodeFs.rm(skill.path);
    const context = await kegless(fixture);

    const result = await applyInstructions(context, { selection: null, release: null, source: "active-release" });

    expect(result.restored.length).toBeGreaterThan(0);
    expect(await nodeFs.readFile(skill.path)).toEqual(skillBytes);
    expect(await nodeFs.readFile(hooks.path, "utf8")).toBe(hooksBefore);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(e) refuses an edited managed file with instruction_target_drifted, exit 3, and leaves it as is", async () => {
    const { fixture } = await installed("active-refresh-drift");
    const skill = (await manifestOf(fixture)).artifacts.find((row) => row.kind === "instruction" && row.path.endsWith("/SKILL.md"));
    if (skill === undefined) throw new Error("no rendered skill");
    await nodeFs.writeFile(skill.path, "edited by the user\n");
    await expect(applyInstructions(await kegless(fixture), { selection: null, release: null, source: "active-release" }))
      .rejects.toMatchObject({ reason: "instruction_target_drifted", code: EXIT_CODES.decisionRequired });
    expect(await nodeFs.readFile(skill.path, "utf8")).toBe("edited by the user\n");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(f) stamps every rendered row at the manifest's version even when no byte changes (C1)", async () => {
    const { fixture } = await installed("active-refresh-stamp");
    const before = await nodeFs.readFile(fixture.paths.manifestFile);
    const manifest = decodeCanonicalJson(before, 1 << 26) as unknown as InstallationManifestV2;
    const older = { ...manifest, artifacts: manifest.artifacts.map((row) => (row.kind === "instruction" ? { ...row, productVersion: "0.9.0" } : row)) };
    const lifecycle = fixture.context.lifecycle;
    if (lifecycle === undefined) throw new Error("no lifecycle context");
    await withLifecycleMutation(fixture.context, lifecycle, () => fixture.context.executor.execute({
      kind: "instructions",
      mutations: [{ targetPath: fixture.paths.manifestFile, operation: "replace", content: encoder.encode(encodeCanonicalJson(older as unknown as CanonicalJsonValue)), expectedBeforeHash: hashBytes(before) }],
    }));

    await applyInstructions(await kegless(fixture), { selection: null, release: null, source: "active-release" });

    const rows = (await manifestOf(fixture)).artifacts.filter((row) => row.kind === "instruction");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.productVersion === "1.0.0")).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("(g) names the Node that ran init when the home has no package-channel tree (unsigned-local, C3)", async () => {
    const fixture = await createCommandFixture("hook-node-dev", {});
    expect(await hookNodePath(fixture.context, null)).toBe(await stableNodePath(process.execPath));
    // A home with no active record reads as no tree, never as exit 6.
    expect(await readActiveReleaseTree(fixture.context)).toBeNull();
  });
});
