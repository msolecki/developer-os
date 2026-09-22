import * as nodeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getuid } from "node:process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EXIT_CODES,
  InstructionCatalogInvalidError,
  InstructionSourceInvalidError,
  parseInstructionId,
} from "@developer-os/core";

import { createCommandFixture, REAL_FILESYSTEM_TIMEOUT_MS, removeCommandFixtures } from "../commands/testing.js";
import { PRODUCT_VERSION } from "../context.js";
import { LOCAL_BUNDLE_BIN, writeUnsignedLocalRelease } from "../update/local-release.js";
import {
  admitUnsignedLocalPackagedRelease,
  inspectPackagedRelease,
} from "../update/packaged-release.js";
import type { AdmittedPackagedReleaseV1 } from "../update/packaged-release.js";
import {
  loadInstructionDefaults,
  loadInstructionOverrides,
  loadReleaseWorkflows,
  mergeInstructionSources,
} from "./sources.js";
import type { InstructionDefaultsV1, InstructionSourceV1 } from "./sources.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const WORKFLOW_IDS: ReadonlySet<string> = new Set(["brain-search", "capture", "doctor", "ingest", "review", "shared"]);
const SENTINEL = "sentinel-7c1f-must-not-leak";
const UID = getuid?.() ?? 0;

const CATALOG = {
  artifacts: [
    { category: "output-style", id: "terse", legacyName: "terse", thinCommand: false, vendors: ["claude", "codex"] },
    { category: "rule", id: "honesty", legacyName: "honesty", thinCommand: false, vendors: ["claude", "codex"] },
    { category: "rule", id: "pnpm-first", legacyName: "pnpm-first", thinCommand: false, vendors: ["claude"] },
    { category: "skill", id: "triage", legacyName: "bug-triage", thinCommand: true, vendors: ["claude", "codex"] },
  ],
  schemaVersion: 1,
};
const DEFAULT_FILES: Readonly<Record<string, string>> = {
  "output-styles/terse.md": "---\nname: terse\n---\nBe terse.\n",
  "rules/honesty.md": "Be honest.\n",
  "rules/pnpm-first.md": "Prefer pnpm.\n",
  "skills/triage/SKILL.md": "---\nname: triage\n---\nTriage.\n",
  "skills/triage/references/checklist.md": "Default-only extra file.\n",
};

let tmp: string;

beforeEach(async () => {
  tmp = await nodeFs.realpath(await nodeFs.mkdtemp(join(tmpdir(), "developer-os-instruction-sources-")));
});

afterEach(async () => {
  await removeCommandFixtures();
  await nodeFs.rm(tmp, { recursive: true, force: true });
});

async function release(
  instructions: Readonly<Record<string, string>>,
  catalog: unknown = CATALOG,
): Promise<AdmittedPackagedReleaseV1> {
  const out = await writeUnsignedLocalRelease({
    outDir: join(tmp, "pkg"),
    version: PRODUCT_VERSION,
    bundleFiles: [
      LOCAL_BUNDLE_BIN,
      { relativePath: "instructions/catalog.json", bytes: encoder.encode(`${JSON.stringify(catalog)}\n`), mode: 0o600 },
      ...Object.entries(instructions).map(([path, text]) => ({
        relativePath: `instructions/${path}`,
        bytes: encoder.encode(text),
        mode: 0o600 as const,
      })),
    ],
  });
  return inspectPackagedRelease(await admitUnsignedLocalPackagedRelease(out, PRODUCT_VERSION));
}

async function write(path: string, text: string | Uint8Array): Promise<void> {
  await nodeFs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(path, text, { mode: 0o600 });
}

function overrides(vendor: "claude" | "codex" = "claude", effectiveUid = UID) {
  return loadInstructionOverrides({ productHome: join(tmp, "home"), vendor, effectiveUid, workflowIds: WORKFLOW_IDS });
}

async function refusal(promise: Promise<unknown>): Promise<InstructionSourceInvalidError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(InstructionSourceInvalidError);
  const invalid = error as InstructionSourceInvalidError;
  expect(invalid.reason).toBe("instruction_source_invalid");
  expect(invalid.code).toBe(EXIT_CODES.invalidInput);
  expect(invalid.message).not.toContain(SENTINEL);
  return invalid;
}

function text(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

describe("loadInstructionDefaults", () => {
  it("loads every catalog row through release.readFile, SKILL.md first", async () => {
    const admitted = await release(DEFAULT_FILES);
    const readFile = vi.fn(admitted.readFile);
    const defaults = await loadInstructionDefaults({ ...admitted, readFile }, WORKFLOW_IDS);

    const expected = [
      "bundle/instructions/catalog.json",
      ...Object.keys(DEFAULT_FILES).map((path) => `bundle/instructions/${path}`),
    ];
    expect(expected.length).toBeGreaterThan(1);
    expect(readFile.mock.calls.map(([path]) => path).sort()).toStrictEqual(expected.sort());
    expect(defaults.artifacts.map((row) => `${row.category}/${row.id}`)).toStrictEqual([
      "output-style/terse",
      "rule/honesty",
      "rule/pnpm-first",
      "skill/triage",
    ]);
    expect(defaults.files.get("skill/triage")?.map((file) => file.relativePath)).toStrictEqual([
      "SKILL.md",
      "references/checklist.md",
    ]);
    expect(defaults.files.get("rule/honesty")?.map((file) => [file.relativePath, text(file.bytes)])).toStrictEqual([
      ["honesty.md", "Be honest.\n"],
    ]);
  });

  it.each([
    ["an unlisted file", { ...DEFAULT_FILES, "rules/stray.md": "Stray.\n" }],
    ["an unlisted file outside any category", { ...DEFAULT_FILES, "notes.md": "Stray.\n" }],
    ["a listed file that is missing", Object.fromEntries(Object.entries(DEFAULT_FILES).filter(([path]) => path !== "rules/honesty.md"))],
    ["a listed skill without files", Object.fromEntries(Object.entries(DEFAULT_FILES).filter(([path]) => !path.startsWith("skills/")))],
  ])("refuses %s with instruction_catalog_invalid (exit 2)", async (_label, files) => {
    const admitted = await release(files);
    const error = await loadInstructionDefaults(admitted, WORKFLOW_IDS).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(InstructionCatalogInvalidError);
    expect((error as InstructionCatalogInvalidError).code).toBe(EXIT_CODES.invalidInput);
  });

  it("refuses a catalog that is not JSON", async () => {
    const out = await writeUnsignedLocalRelease({
      outDir: join(tmp, "pkg"),
      version: PRODUCT_VERSION,
      bundleFiles: [LOCAL_BUNDLE_BIN, { relativePath: "instructions/catalog.json", bytes: encoder.encode("{\n"), mode: 0o600 }],
    });
    const admitted = await inspectPackagedRelease(await admitUnsignedLocalPackagedRelease(out, PRODUCT_VERSION));
    await expect(loadInstructionDefaults(admitted, WORKFLOW_IDS)).rejects.toBeInstanceOf(InstructionCatalogInvalidError);
  });

  it("refuses a catalog row named after a workflow", async () => {
    const catalog = {
      artifacts: [{ category: "rule", id: "capture", legacyName: "capture", thinCommand: false, vendors: ["claude"] }],
      schemaVersion: 1,
    };
    const admitted = await release({ "rules/capture.md": "x\n" }, catalog);
    await expect(loadInstructionDefaults(admitted, WORKFLOW_IDS)).rejects.toBeInstanceOf(InstructionCatalogInvalidError);
  });
});

describe("loadInstructionOverrides", () => {
  const vendorRoot = (): string => join(tmp, "home", "instructions", "claude");

  it("returns nothing when the product home has no instructions directory", async () => {
    await nodeFs.mkdir(join(tmp, "home"), { mode: 0o700 });
    expect(await overrides()).toStrictEqual([]);
  });

  it("loads each category from its directory, the id from the name", async () => {
    await write(join(vendorRoot(), "rules", "honesty.md"), "Mine.\n");
    await write(join(vendorRoot(), "skills", "mine", "SKILL.md"), "Skill.\n");
    await write(join(vendorRoot(), "skills", "mine", "a", "b.md"), "Nested.\n");
    const loaded = await overrides();
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.map((source) => [source.category, source.id, source.source, source.files.map((file) => file.relativePath)])).toStrictEqual([
      ["rule", "honesty", "user", ["honesty.md"]],
      ["skill", "mine", "user", ["SKILL.md", "a/b.md"]],
    ]);
  });

  it("refuses a symlinked file", async () => {
    await write(join(tmp, "elsewhere.md"), `${SENTINEL}\n`);
    await nodeFs.mkdir(join(vendorRoot(), "rules"), { recursive: true, mode: 0o700 });
    await nodeFs.symlink(join(tmp, "elsewhere.md"), join(vendorRoot(), "rules", "linked.md"));
    expect((await refusal(overrides())).path).toBe(join(vendorRoot(), "rules", "linked.md"));
  });

  it("refuses a symlinked skill directory", async () => {
    await write(join(tmp, "elsewhere", "SKILL.md"), `${SENTINEL}\n`);
    await nodeFs.mkdir(join(vendorRoot(), "skills"), { recursive: true, mode: 0o700 });
    await nodeFs.symlink(join(tmp, "elsewhere"), join(vendorRoot(), "skills", "linked"));
    expect((await refusal(overrides())).path).toBe(join(vendorRoot(), "skills", "linked"));
  });

  it("refuses a symlinked category directory", async () => {
    await write(join(tmp, "elsewhere", "x.md"), `${SENTINEL}\n`);
    await nodeFs.mkdir(vendorRoot(), { recursive: true, mode: 0o700 });
    await nodeFs.symlink(join(tmp, "elsewhere"), join(vendorRoot(), "rules"));
    expect((await refusal(overrides())).path).toBe(join(vendorRoot(), "rules"));
  });

  it("refuses a hard-linked file (nlink 2)", async () => {
    await write(join(vendorRoot(), "rules", "one.md"), `${SENTINEL}\n`);
    await nodeFs.link(join(vendorRoot(), "rules", "one.md"), join(tmp, "second-name.md"));
    expect((await refusal(overrides())).path).toBe(join(vendorRoot(), "rules", "one.md"));
  });

  it.each([
    ["a BOM", Uint8Array.of(0xef, 0xbb, 0xbf, ...encoder.encode(`${SENTINEL}\n`)), 1],
    ["a NUL", encoder.encode(`${SENTINEL}\nsecond\0line\n`), 2],
    ["CRLF", encoder.encode(`${SENTINEL}\r\n`), 1],
  ])("refuses %s with the path and line", async (_label, bytes, line) => {
    await write(join(vendorRoot(), "rules", "bad.md"), bytes);
    const error = await refusal(overrides());
    expect(error.path).toBe(join(vendorRoot(), "rules", "bad.md"));
    expect(error.line).toBe(line);
  });

  it("ignores a regular .DS_Store at the vendor root and inside a skill directory", async () => {
    await write(join(vendorRoot(), ".DS_Store"), SENTINEL);
    await write(join(vendorRoot(), "skills", "mine", "SKILL.md"), "Skill.\n");
    await write(join(vendorRoot(), "skills", "mine", ".DS_Store"), SENTINEL);
    await write(join(vendorRoot(), "skills", "mine", "a", ".DS_Store"), SENTINEL);
    const loaded = await overrides();
    expect(loaded.map((source) => [source.id, source.files.map((file) => file.relativePath)])).toStrictEqual([["mine", ["SKILL.md"]]]);
  });

  it("refuses a symlink named .DS_Store", async () => {
    await write(join(tmp, "elsewhere"), `${SENTINEL}\n`);
    await write(join(vendorRoot(), "skills", "mine", "SKILL.md"), "Skill.\n");
    await nodeFs.symlink(join(tmp, "elsewhere"), join(vendorRoot(), "skills", "mine", ".DS_Store"));
    expect((await refusal(overrides())).path).toBe(join(vendorRoot(), "skills", "mine", ".DS_Store"));
  });

  it.each(["._foo", ".DS_Store2"])("refuses a %s file", async (name) => {
    await write(join(vendorRoot(), name), `${SENTINEL}\n`);
    expect((await refusal(overrides())).path).toBe(join(vendorRoot(), name));
  });

  it("refuses an unknown category directory", async () => {
    await write(join(vendorRoot(), "hooks", "x.md"), `${SENTINEL}\n`);
    expect((await refusal(overrides())).path).toBe(join(vendorRoot(), "hooks"));
  });

  it("refuses an override named after a workflow", async () => {
    await write(join(vendorRoot(), "skills", "capture", "SKILL.md"), `${SENTINEL}\n`);
    expect((await refusal(overrides())).path).toBe(join(vendorRoot(), "skills", "capture"));
  });

  it("refuses a tree owned by another uid", async () => {
    await write(join(vendorRoot(), "rules", "honesty.md"), `${SENTINEL}\n`);
    const error = await refusal(overrides("claude", UID + 1));
    expect(error.path.startsWith(join(tmp, "home", "instructions"))).toBe(true);
  });
});

describe("mergeInstructionSources", () => {
  it("replaces per vendor, replaces a skill whole, adds new ids and reports unsupported categories", async () => {
    const defaults = await loadInstructionDefaults(await release(DEFAULT_FILES), WORKFLOW_IDS);
    await write(join(tmp, "home", "instructions", "claude", "rules", "honesty.md"), "Mine.\n");
    await write(join(tmp, "home", "instructions", "claude", "skills", "triage", "SKILL.md"), "My triage.\n");
    await write(join(tmp, "home", "instructions", "claude", "rules", "extra.md"), "Added.\n");
    await write(join(tmp, "home", "instructions", "codex", "output-styles", "mine.md"), "Style.\n");

    const claude = mergeInstructionSources("claude", defaults, await overrides("claude"));
    const codex = mergeInstructionSources("codex", defaults, await overrides("codex"));
    const summary = (source: InstructionSourceV1) => [
      `${source.category}/${source.id}`,
      source.source,
      source.files.map((file) => `${file.relativePath}=${text(file.bytes)}`),
    ];

    expect(claude.artifacts.length).toBeGreaterThan(0);
    expect(claude.artifacts.map(summary)).toStrictEqual([
      ["output-style/terse", "default", ["terse.md=---\nname: terse\n---\nBe terse.\n"]],
      ["rule/extra", "user", ["extra.md=Added.\n"]],
      ["rule/honesty", "user", ["honesty.md=Mine.\n"]],
      ["rule/pnpm-first", "default", ["pnpm-first.md=Prefer pnpm.\n"]],
      ["skill/triage", "user", ["SKILL.md=My triage.\n"]],
    ]);
    expect(claude.artifacts.find((source) => source.id === "triage")?.thinCommand).toBe(true);
    expect(claude.unsupported).toStrictEqual([]);

    expect(codex.artifacts.map(summary)).toStrictEqual([
      ["rule/honesty", "default", ["honesty.md=Be honest.\n"]],
      ["skill/triage", "default", ["SKILL.md=---\nname: triage\n---\nTriage.\n", "references/checklist.md=Default-only extra file.\n"]],
    ]);
    expect(codex.unsupported).toStrictEqual([
      { category: "output-style", id: "mine", path: "instructions/codex/output-styles/mine.md" },
      { category: "output-style", id: "terse", path: "instructions/output-styles/terse.md" },
    ]);
  });

  const EMPTY: InstructionDefaultsV1 = { schemaVersion: 1, artifacts: [], files: new Map() };
  const rules = (count: number, bytes: (index: number) => number): InstructionSourceV1[] =>
    Array.from({ length: count }, (_, index) => {
      const id = parseInstructionId(`r${String(index).padStart(3, "0")}`);
      return {
        category: "rule",
        id,
        source: "user",
        files: [{ relativePath: `${id}.md`, bytes: new Uint8Array(bytes(index)) }],
        thinCommand: false,
        vendors: ["claude"],
      };
    });

  it.each([
    ["128 artifacts", 128, () => 1, true],
    ["129 artifacts", 129, () => 1, false],
    ["exactly 8 MiB", 128, () => 65_536, true],
    ["8 MiB + 1 byte", 128, (index: number) => (index === 0 ? 65_537 : 65_536), false],
  ])("applies the per-vendor cap at %s", (_label, count, bytes, admitted) => {
    const merge = () => mergeInstructionSources("claude", EMPTY, rules(count, bytes));
    if (admitted) {
      expect(merge().artifacts).toHaveLength(count);
    } else {
      expect(merge).toThrow(InstructionSourceInvalidError);
    }
  });
});

describe("createCommandFixture instructions", () => {
  it("carries the repository workflows and the given instruction files", async () => {
    const fixture = await createCommandFixture("instruction-sources", {
      bootstrapAvailable: true,
      instructions: [{ relativePath: "catalog.json", bytes: encoder.encode('{"artifacts":[],"schemaVersion":1}\n'), mode: 0o600 }],
    });
    const bootstrap = fixture.context.bootstrap;
    if (bootstrap?.state !== "available") throw new Error("fixture bootstrap is unavailable");
    const admitted = await inspectPackagedRelease(bootstrap.packagedRelease);

    const workflows = await loadReleaseWorkflows(admitted);
    expect(workflows.length).toBeGreaterThan(0);
    expect(workflows.map((workflow) => workflow.id)).toContain("capture");
    const defaults = await loadInstructionDefaults(admitted, new Set(workflows.map((workflow) => workflow.id)));
    expect(defaults.artifacts).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("carries neither tree by default", async () => {
    const fixture = await createCommandFixture("instruction-sources-default", { bootstrapAvailable: true });
    const bootstrap = fixture.context.bootstrap;
    if (bootstrap?.state !== "available") throw new Error("fixture bootstrap is unavailable");
    const admitted = await inspectPackagedRelease(bootstrap.packagedRelease);
    expect(admitted.files.some((file) => file.relativePath.startsWith("bundle/workflows/"))).toBe(false);
    expect(await loadReleaseWorkflows(admitted)).toStrictEqual([]);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
