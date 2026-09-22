import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { BrainService } from "@developer-os/brain";
import type { BrainSessionContextV1 } from "@developer-os/brain";
import { serializeConfig } from "@developer-os/core";
import type { DeveloperOsConfigV1 } from "@developer-os/core";
import type { ProcessRunner } from "@developer-os/security";
import { afterEach, describe, expect, it } from "vitest";

import { dependenciesFor } from "../commands/reindex.js";
import { createCommandFixture, inventoryDigest, removeCommandFixtures } from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import {
  composeInjection,
  injectBrainContext,
  MAX_INJECTED_CONTEXT_BYTES,
  VAULT_MAP_TRUNCATED_MARKER,
} from "./inject.js";
import type { HookPayloadV1 } from "./payload.js";
import type { HookContextFactory, HookRuntime } from "./registry.js";

afterEach(removeCommandFixtures);

const bytes = (text: string): number => new TextEncoder().encode(text).byteLength;

function mapOf(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `- line ${String(i).padStart(5, "0")} of the synthetic vault map`).join(
    "\n",
  );
}

describe("composeInjection", () => {
  it("returns null when both parts are absent", () => {
    expect(composeInjection({ vaultMap: null, projectNote: null })).toBeNull();
  });

  it("keeps a small map and note whole", () => {
    const text = composeInjection({ vaultMap: "# Map\n", projectNote: { title: "p", text: "body" } });
    expect(text).toBe("# Map\n\n\n# p\n\nbody");
  });

  it("keeps the project note whole when the vault map alone overflows", () => {
    const note = { title: "developer-os", text: "synthetic project body\n".repeat(20) };
    const context: BrainSessionContextV1 = { vaultMap: mapOf(2000), projectNote: note };
    expect(bytes(context.vaultMap ?? "")).toBeGreaterThan(MAX_INJECTED_CONTEXT_BYTES);
    const text = composeInjection(context) ?? "";
    expect(bytes(text)).toBeLessThanOrEqual(MAX_INJECTED_CONTEXT_BYTES);
    expect(text.endsWith(`# ${note.title}\n\n${note.text}`)).toBe(true);
    expect(text).toContain(VAULT_MAP_TRUNCATED_MARKER);
  });

  it("cuts the vault map at a line boundary and follows it with the marker", () => {
    const map = mapOf(2000);
    const text = composeInjection({ vaultMap: map, projectNote: null }) ?? "";
    expect(bytes(text)).toBeLessThanOrEqual(MAX_INJECTED_CONTEXT_BYTES);
    const lines = text.split("\n");
    expect(lines.at(-1)).toBe(VAULT_MAP_TRUNCATED_MARKER);
    const kept = lines.slice(0, -1);
    expect(kept.length).toBeGreaterThan(0);
    expect(map.startsWith(`${kept.join("\n")}\n`)).toBe(true);
  });

  it("caps a note that alone exceeds the bound", () => {
    const text = composeInjection({ vaultMap: null, projectNote: { title: "p", text: "x".repeat(40_000) } }) ?? "";
    expect(bytes(text)).toBeLessThanOrEqual(MAX_INJECTED_CONTEXT_BYTES);
  });
});

function projectNote(title: string): string {
  return [
    "---",
    "schemaVersion: 1",
    `title: ${title}`,
    "type: project-note",
    "created: 2026-01-01",
    "tags: [project]",
    "summary: The synthetic project.",
    "stage: established",
    "author: human",
    "reviewed: 2026-07-01",
    "---",
    "",
    "Synthetic project body.",
    "",
  ].join("\n");
}

function configFor(fixture: CommandFixture): DeveloperOsConfigV1 {
  return {
    schemaVersion: 1,
    brainPath: fixture.paths.brain,
    adapters: { claude: false, codex: false },
    git: { enabled: false },
    automation: { enabled: false },
    telemetry: false,
  };
}

interface Installed {
  readonly fixture: CommandFixture;
  readonly deepCwd: string;
}

async function installed(label: string, options: { vault: boolean; index: boolean }): Promise<Installed> {
  const fixture = await createCommandFixture(label);
  await nodeFs.mkdir(fixture.paths.home, { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(fixture.paths.configFile, serializeConfig(configFor(fixture)), { mode: 0o600 });

  if (options.vault) {
    const files: Record<string, string> = {
      "content/PROJECTS/developer-os.md": projectNote("developer-os"),
      "content/PROJECTS/deeper.md": projectNote("deeper"),
    };
    for (const [vaultPath, text] of Object.entries(files)) {
      const target = join(fixture.paths.brain, vaultPath);
      await nodeFs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await nodeFs.writeFile(target, text, { mode: 0o600 });
    }
    await nodeFs.mkdir(join(fixture.paths.brain, "content", "_indexes"), { recursive: true, mode: 0o700 });
    const service = new BrainService(dependenciesFor(fixture.context, fixture.paths.brain, configFor(fixture)));
    const artifacts = await service.reindex();
    for (const [vaultPath, text] of Object.entries(artifacts.files)) {
      if (!options.index && vaultPath.endsWith("/index.json")) continue;
      await nodeFs.writeFile(join(fixture.paths.brain, vaultPath), text, { mode: 0o600 });
    }
  }

  const projectRoot = join(fixture.root, "work", "developer-os");
  await nodeFs.mkdir(join(projectRoot, ".git"), { recursive: true, mode: 0o700 });
  const deepCwd = join(projectRoot, "src", "deeper");
  await nodeFs.mkdir(deepCwd, { recursive: true, mode: 0o700 });
  return { fixture, deepCwd };
}

const noSpawn: ProcessRunner = {
  run: () => Promise.reject(new Error("inject spawned a process")),
};

const PAYLOAD: HookPayloadV1 = {
  cwd: null,
  toolName: null,
  command: null,
  filePath: null,
  prompt: null,
  stopHookActive: null,
};

function runtimeFor(fixture: CommandFixture, cwd: string, createContext?: HookContextFactory): HookRuntime {
  return {
    vendor: "claude",
    env: {},
    userHome: fixture.userHome,
    cwd,
    runner: noSpawn,
    nodeExecutable: "/usr/local/bin/node",
    now: () => new Date("2026-09-22T00:00:00.000Z"),
    io: fixture.io,
    createContext: createContext ?? (() => fixture.context),
  };
}

describe("injectBrainContext", () => {
  it("returns context carrying the project note, with the context's redactor", async () => {
    const { fixture, deepCwd } = await installed("inject-context", { vault: true, index: true });
    const outcome = await injectBrainContext(PAYLOAD, runtimeFor(fixture, deepCwd));
    expect(outcome.kind).toBe("context");
    if (outcome.kind !== "context") return;
    expect(outcome.text).toContain("# developer-os");
    expect(outcome.text).toContain("Synthetic project body.");
    expect(outcome.redact).toBe(fixture.context.guards.redactDiagnostic);
  });

  it("derives the slug from the git root's basename, not from the deeper cwd", async () => {
    const { fixture, deepCwd } = await installed("inject-slug", { vault: true, index: true });
    const outcome = await injectBrainContext(PAYLOAD, runtimeFor(fixture, deepCwd));
    expect(outcome.kind).toBe("context");
    if (outcome.kind !== "context") return;
    expect(outcome.text).toContain("# developer-os\n");
    expect(outcome.text).not.toContain("# deeper\n");
  });

  it("writes nothing to the vault", async () => {
    const { fixture, deepCwd } = await installed("inject-no-write", { vault: true, index: true });
    const before = await inventoryDigest(fixture.paths.brain);
    expect(before.length).toBeGreaterThan(0);
    await injectBrainContext(PAYLOAD, runtimeFor(fixture, deepCwd));
    expect(await inventoryDigest(fixture.paths.brain)).toStrictEqual(before);
  });

  it("allows with a note when the ordinary-command gate refuses", async () => {
    const { fixture, deepCwd } = await installed("inject-gate", { vault: true, index: true });
    await nodeFs.writeFile(join(fixture.paths.home, "installation-manifest.json"), '{"schemaVersion":2}', {
      mode: 0o600,
    });
    const outcome = await injectBrainContext(PAYLOAD, runtimeFor(fixture, deepCwd));
    expect(outcome.kind).toBe("allow");
    expect(outcome.kind === "allow" ? outcome.note : undefined).toBeDefined();
  });

  it("allows with a note when building the context throws", async () => {
    const { fixture, deepCwd } = await installed("inject-context-throws", { vault: true, index: true });
    const outcome = await injectBrainContext(
      PAYLOAD,
      runtimeFor(fixture, deepCwd, () => {
        throw new Error("synthetic context failure");
      }),
    );
    expect(outcome.kind).toBe("allow");
    expect(outcome.kind === "allow" ? outcome.note : undefined).not.toContain("synthetic context failure");
  });

  it("allows with a note when the Brain is missing", async () => {
    const { fixture, deepCwd } = await installed("inject-no-brain", { vault: false, index: false });
    const outcome = await injectBrainContext(PAYLOAD, runtimeFor(fixture, deepCwd));
    expect(outcome.kind).toBe("allow");
    expect(outcome.kind === "allow" ? outcome.note : undefined).toBeDefined();
  });

  it("allows with a note when the index is missing, even beside a stale vault map", async () => {
    const { fixture, deepCwd } = await installed("inject-no-index", { vault: true, index: false });
    expect(await inventoryDigest(fixture.paths.brain)).toContainEqual(expect.stringContaining("vault-map.md"));
    const outcome = await injectBrainContext(PAYLOAD, runtimeFor(fixture, deepCwd));
    expect(outcome.kind).toBe("allow");
    expect(outcome.kind === "allow" ? outcome.note : undefined).toBeDefined();
  });

  it("never writes to the context's stdout", async () => {
    const { fixture, deepCwd } = await installed("inject-silent", { vault: true, index: true });
    let handed: Parameters<HookContextFactory>[0] | null = null;
    await injectBrainContext(
      PAYLOAD,
      runtimeFor(fixture, deepCwd, (io) => {
        handed = io;
        return fixture.context;
      }),
    );
    expect(handed).not.toBeNull();
    const before = fixture.io.out.length;
    (handed as Parameters<HookContextFactory>[0] | null)?.stdout("synthetic");
    expect(fixture.io.out).toHaveLength(before);
  });
});
