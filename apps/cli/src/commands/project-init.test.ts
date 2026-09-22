import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { EXIT_CODES } from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { redactionKeyPath } from "../context.js";
import { runInit } from "./init.js";
import { runProjectInit } from "./project-init.js";
import type { ProjectInitDependencies } from "./project-init.js";
import { PROJECT_TEMPLATE_MAX_BYTES } from "./project-template.js";
import type { ProjectTemplateFile } from "./project-template.js";
import {
  createCommandFixture,
  exists,
  inventoryDigest,
  removeCommandFixtures,
} from "./testing.js";
import type { CommandFixture } from "./testing.js";
import { runUninstall } from "./uninstall.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

// Same shape as `SENTINEL` in tests/security/helpers.ts, which this package cannot import.
const SENTINEL = `ghp_${"S3nt1nel".repeat(5)}`;

const TEMPLATES: readonly ProjectTemplateFile[] = [
  { name: "AGENTS.md", content: "# Synthetic agents\n" },
  { name: "CLAUDE.md", content: "# Synthetic claude\n" },
  { name: "CONTEXT.md", content: "# Synthetic signpost\n" },
];
const NAMES = TEMPLATES.map((file) => file.name);

interface ProjectFixture extends CommandFixture {
  /** A synthetic project directory, outside the product home and the Brain. */
  readonly project: string;
  readonly dependencies: ProjectInitDependencies;
}

async function installedFixture(label: string): Promise<ProjectFixture> {
  const fixture = await createCommandFixture(label);
  const installed = await runInit(fixture.context, ACCEPTED);
  expect(installed.ok, "the fixture must install first").toBe(true);
  const project = join(fixture.root, "project");
  await nodeFs.mkdir(project, { recursive: true, mode: 0o700 });
  return {
    ...fixture,
    project,
    dependencies: { cwd: () => fixture.root, templates: TEMPLATES },
  };
}

async function projectInitJournals(fixture: CommandFixture) {
  const journalDir = join(fixture.paths.stateDir, "transactions");
  let entries: readonly string[];
  try {
    entries = await nodeFs.readdir(journalDir);
  } catch {
    return [];
  }
  const journals = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const journal = await fixture.context.transactions.read(entry.slice(0, -".json".length));
    if (journal.kind === "project-init") journals.push(journal);
  }
  return journals;
}

async function readProjectFiles(project: string): Promise<readonly string[]> {
  return Promise.all(NAMES.map((name) => nodeFs.readFile(join(project, name), "utf8")));
}

function overrideDirectory(fixture: CommandFixture): string {
  return join(fixture.paths.home, "templates", "project");
}

async function writeOverride(fixture: CommandFixture, name: string, content: string): Promise<string> {
  await nodeFs.mkdir(overrideDirectory(fixture), { recursive: true, mode: 0o700 });
  const path = join(overrideDirectory(fixture), name);
  await nodeFs.writeFile(path, content, "utf8");
  return path;
}

describe("runProjectInit", () => {
  it("refuses exit 4 with an empty template set and writes nothing", async () => {
    const fixture = await installedFixture("project-init-empty");
    const before = await inventoryDigest(fixture.root);

    const result = await runProjectInit(
      fixture.context,
      { dir: "project", dryRun: false },
      { cwd: () => fixture.root, templates: [] },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
    expect(result.error.kind).toBe("project_templates_unavailable");
    expect(await inventoryDigest(fixture.root)).toEqual(before);
  });

  it("refuses exit 4 with the production default set today", async () => {
    const fixture = await installedFixture("project-init-default-set");
    const before = await inventoryDigest(fixture.root);

    const result = await runProjectInit(fixture.context, { dir: fixture.project, dryRun: false });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
    expect(result.error.kind).toBe("project_templates_unavailable");
    expect(await inventoryDigest(fixture.root)).toEqual(before);
  });

  it("refuses exit 1 with recovery developer-os init when not initialized", async () => {
    const fixture = await createCommandFixture("project-init-uninitialized");
    const project = join(fixture.root, "project");
    await nodeFs.mkdir(project, { recursive: true, mode: 0o700 });

    const result = await runProjectInit(
      fixture.context,
      { dir: "project", dryRun: false },
      { cwd: () => fixture.root, templates: TEMPLATES },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.operationalFailure);
    expect(result.error.recovery).toBe("developer-os init");
    expect(await nodeFs.readdir(project)).toEqual([]);
  });

  it("creates the template set from a relative dir, in one create-only journal outside the manifest", async () => {
    const fixture = await installedFixture("project-init-creates");
    const manifestBefore = await nodeFs.readFile(fixture.paths.manifestFile);

    const result = await runProjectInit(
      fixture.context,
      { dir: "project", dryRun: false },
      fixture.dependencies,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.root).toBe(fixture.project);
    expect(result.data.created).toEqual(NAMES);
    expect(result.data.overridden).toEqual([]);
    expect(result.data.transactionId).not.toBeNull();
    expect((await nodeFs.readdir(fixture.project)).sort()).toEqual([...NAMES].sort());
    expect(await readProjectFiles(fixture.project)).toEqual(TEMPLATES.map((file) => file.content));

    const journals = await projectInitJournals(fixture);
    expect(journals).toHaveLength(1);
    const mutations = journals[0]?.mutations ?? [];
    expect(mutations).toHaveLength(3);
    expect(mutations.every((mutation) => mutation.operation === "create")).toBe(true);
    expect(journals[0]?.id).toBe(result.data.transactionId);

    expect(await nodeFs.readFile(fixture.paths.manifestFile)).toEqual(manifestBefore);
  });

  it("targets the injected working directory when dir is null", async () => {
    const fixture = await installedFixture("project-init-default-dir");

    const result = await runProjectInit(
      fixture.context,
      { dir: null, dryRun: false },
      { cwd: () => fixture.project, templates: TEMPLATES },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.root).toBe(fixture.project);
    expect(await readProjectFiles(fixture.project)).toEqual(TEMPLATES.map((file) => file.content));
  });

  it("refuses exit 3 listing every existing target, and writes nothing", async () => {
    const fixture = await installedFixture("project-init-create-only");
    await nodeFs.writeFile(join(fixture.project, "AGENTS.md"), "user agents\n");
    await nodeFs.writeFile(join(fixture.project, "CONTEXT.md"), "user context\n");

    const result = await runProjectInit(
      fixture.context,
      { dir: "project", dryRun: false },
      fixture.dependencies,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.decisionRequired);
    expect(result.error.kind).toBe("project_file_exists");
    expect([...result.error.paths].sort()).toEqual([
      join(fixture.project, "AGENTS.md"),
      join(fixture.project, "CONTEXT.md"),
    ]);
    expect(await exists(join(fixture.project, "CLAUDE.md"))).toBe(false);
    expect(await projectInitJournals(fixture)).toEqual([]);
  });

  it.each([
    ["equal to the product home", (f: CommandFixture) => f.paths.home],
    ["inside the product home", (f: CommandFixture) => f.paths.stateDir],
    ["containing the product home", (f: CommandFixture) => dirname(f.paths.home)],
    ["equal to the Brain", (f: CommandFixture) => f.paths.brain],
    ["inside the Brain", (f: CommandFixture) => join(f.paths.brain, "content")],
    ["containing the Brain", (f: CommandFixture) => dirname(f.paths.brain)],
  ])("refuses exit 5 for a target %s", async (_label, targetOf) => {
    const fixture = await installedFixture("project-init-overlap");
    const target = targetOf(fixture);
    await nodeFs.mkdir(target, { recursive: true, mode: 0o700 });
    const before = await inventoryDigest(fixture.root);

    const result = await runProjectInit(
      fixture.context,
      { dir: target, dryRun: false },
      fixture.dependencies,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.securityRefusal);
    expect(result.error.kind).toBe("project_root_overlaps_product");
    expect(await inventoryDigest(fixture.root)).toEqual(before);
  });

  it("refuses exit 2 for a target that is a file", async () => {
    const fixture = await installedFixture("project-init-file-target");
    await nodeFs.writeFile(join(fixture.root, "not-a-directory"), "plain\n");

    const result = await runProjectInit(
      fixture.context,
      { dir: "not-a-directory", dryRun: false },
      fixture.dependencies,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(result.error.kind).toBe("project_root_not_directory");
  });

  describe("overrides", () => {
    it("replaces a default by name and warns about a name outside the set", async () => {
      const fixture = await installedFixture("project-init-override");
      await writeOverride(fixture, "CLAUDE.md", "# User claude\n");
      await writeOverride(fixture, "EXTRA.md", "# Extra\n");

      const result = await runProjectInit(
        fixture.context,
        { dir: "project", dryRun: false },
        fixture.dependencies,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.overridden).toEqual(["CLAUDE.md"]);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((warning) => warning.includes("EXTRA.md"))).toBe(true);
      expect(await readProjectFiles(fixture.project)).toEqual([
        "# Synthetic agents\n",
        "# User claude\n",
        "# Synthetic signpost\n",
      ]);
      expect(await exists(join(fixture.project, "EXTRA.md"))).toBe(false);
    });

    it("refuses exit 5 for an override carrying a secret, and never prints it", async () => {
      const fixture = await installedFixture("project-init-override-secret");
      const override = await writeOverride(fixture, "AGENTS.md", `token ${SENTINEL}\n`);
      const before = await inventoryDigest(fixture.root);

      const result = await runProjectInit(
        fixture.context,
        { dir: "project", dryRun: false },
        fixture.dependencies,
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(EXIT_CODES.securityRefusal);
      expect(result.error.kind).toBe("project_template_secret");
      expect(result.error.paths).toEqual([override]);
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
      expect([...fixture.io.out, ...fixture.io.err].join("\n")).not.toContain(SENTINEL);
      expect(await inventoryDigest(fixture.root)).toEqual(before);
    });

    it("accepts an override at the byte bound", async () => {
      const fixture = await installedFixture("project-init-override-bound");
      await writeOverride(fixture, "AGENTS.md", "a".repeat(PROJECT_TEMPLATE_MAX_BYTES));

      const result = await runProjectInit(
        fixture.context,
        { dir: "project", dryRun: false },
        fixture.dependencies,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.overridden).toEqual(["AGENTS.md"]);
      expect((await nodeFs.stat(join(fixture.project, "AGENTS.md"))).size).toBe(PROJECT_TEMPLATE_MAX_BYTES);
    });

    it("refuses exit 1 for an override one byte past the bound", async () => {
      const fixture = await installedFixture("project-init-override-large");
      await writeOverride(fixture, "AGENTS.md", "a".repeat(PROJECT_TEMPLATE_MAX_BYTES + 1));
      const before = await inventoryDigest(fixture.root);

      const result = await runProjectInit(
        fixture.context,
        { dir: "project", dryRun: false },
        fixture.dependencies,
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(EXIT_CODES.operationalFailure);
      expect(await inventoryDigest(fixture.root)).toEqual(before);
    });
  });

  it("dry-runs on a home without a redaction key, writing nothing and creating no key", async () => {
    const fixture = await installedFixture("project-init-dry-run");
    const key = redactionKeyPath(fixture.paths.stateDir);
    await nodeFs.rm(key, { force: true });
    const before = await inventoryDigest(fixture.root);

    const result = await runProjectInit(
      fixture.context,
      { dir: "project", dryRun: true },
      fixture.dependencies,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transactionId).toBeNull();
    expect(result.data.created).toEqual(NAMES);
    expect(await inventoryDigest(fixture.root)).toEqual(before);
    expect(await exists(key)).toBe(false);
  });

  it("leaves the created files in place across uninstall", async () => {
    const fixture = await installedFixture("project-init-uninstall");
    const created = await runProjectInit(
      fixture.context,
      { dir: "project", dryRun: false },
      fixture.dependencies,
    );
    expect(created.ok).toBe(true);
    const bytes = await readProjectFiles(fixture.project);
    expect(bytes).toHaveLength(3);

    const uninstalled = await runUninstall(fixture.context, ACCEPTED);

    expect(uninstalled.ok).toBe(true);
    expect(await readProjectFiles(fixture.project)).toEqual(bytes);
  });
});
