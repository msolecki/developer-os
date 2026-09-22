import * as nodeFs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { EXIT_CODES } from "@developer-os/core";
import { createRedactor } from "@developer-os/security";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadOrCreateRedactionKey, redactionKeyPath } from "../context.js";
import type { CliContext } from "../context.js";
import { run } from "../main.js";
import {
  PROJECT_CHECK_MAX_READ_BYTES,
  PROJECT_INSTRUCTION_WARN_BYTES,
  runProjectCheck,
} from "./project-check.js";
import type { ProjectCheckReportV1 } from "./project-check.js";
import {
  createCommandFixture,
  exists,
  inventoryDigest,
  removeCommandFixtures,
} from "./testing.js";
import type { CommandFixture } from "./testing.js";

afterEach(removeCommandFixtures);

const TEMPLATE_NAMES = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"] as const;
const CHECK_IDS = ["instruction-file", "instruction-size", "instruction-secrets", "template-set"];

// Same shape as `SENTINEL` in tests/security/helpers.ts, which this package cannot import.
const TOKEN = `ghp_${"S3nt1nel".repeat(5)}`;
const KEY_BODY = "c3ludGhldGljLXRlc3QtbWF0ZXJpYWwtbm90LWtleQ==";
const KEY_BLOCK = [
  "-----BEGIN PRIVATE KEY-----", // gitleaks:allow -- synthetic test fixture
  KEY_BODY,
  "-----END PRIVATE KEY-----",
];

interface ProjectFixture extends CommandFixture {
  readonly project: string;
  check(dir?: string | null, context?: CliContext): ReturnType<typeof runProjectCheck>;
}

async function projectFixture(
  label: string,
  files: Readonly<Record<string, string>> = {},
): Promise<ProjectFixture> {
  const fixture = await createCommandFixture(label);
  const project = join(fixture.root, "project");
  await nodeFs.mkdir(project, { recursive: true, mode: 0o700 });
  for (const [name, content] of Object.entries(files)) {
    await nodeFs.writeFile(join(project, name), content);
  }
  return {
    ...fixture,
    project,
    check: (dir = null, context = fixture.context) =>
      runProjectCheck(context, { dir }, { cwd: () => project, templateNames: TEMPLATE_NAMES }),
  };
}

const CLEAN = {
  "AGENTS.md": "# Synthetic agents\n",
  "CLAUDE.md": "# Synthetic claude\n",
  "CONTEXT.md": "# Synthetic signpost\n",
};

function statusOf(report: ProjectCheckReportV1, id: string): string | undefined {
  return report.checks.find((check) => check.id === id)?.status;
}

async function reportOf(fixture: ProjectFixture): Promise<ProjectCheckReportV1> {
  const result = await fixture.check();
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}`);
  return result.data;
}

describe("runProjectCheck", () => {
  it("passes every check on a clean project", async () => {
    const fixture = await projectFixture("project-check-pass", CLEAN);
    const result = await fixture.check();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe(EXIT_CODES.success);
    expect(result.data.checks.map((check) => check.id)).toEqual(CHECK_IDS);
    expect(result.data.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("warns instruction-file when neither instruction file exists", async () => {
    const fixture = await projectFixture("project-check-no-instruction", {
      "CONTEXT.md": CLEAN["CONTEXT.md"],
    });
    const report = await reportOf(fixture);

    expect(statusOf(report, "instruction-file")).toBe("warn");
  });

  it("passes instruction-size at 40,000 bytes and warns at 40,001", async () => {
    const atBound = await projectFixture("project-check-size-bound", {
      ...CLEAN,
      "AGENTS.md": "a".repeat(PROJECT_INSTRUCTION_WARN_BYTES),
    });
    expect(statusOf(await reportOf(atBound), "instruction-size")).toBe("pass");

    const past = await projectFixture("project-check-size-past", {
      ...CLEAN,
      "AGENTS.md": "a".repeat(PROJECT_INSTRUCTION_WARN_BYTES + 1),
    });
    const report = await reportOf(past);
    const size = report.checks.find((check) => check.id === "instruction-size");
    expect(size?.status).toBe("warn");
    expect(size?.message).toContain("AGENTS.md");
  });

  it("warns template-set and names the absent signpost", async () => {
    const fixture = await projectFixture("project-check-template-set", {
      "AGENTS.md": CLEAN["AGENTS.md"],
      "CLAUDE.md": CLEAN["CLAUDE.md"],
    });
    const report = await reportOf(fixture);
    const templateSet = report.checks.find((check) => check.id === "template-set");

    expect(templateSet?.status).toBe("warn");
    expect(templateSet?.message).toContain("CONTEXT.md");
  });

  it("fails exit 5 on secrets and names file, class and line, never the value", async () => {
    const claude = [
      "# Synthetic claude",
      "",
      ...KEY_BLOCK,
      "",
      "",
      "",
      `token ${TOKEN}`,
      "",
    ].join("\n");
    const fixture = await projectFixture("project-check-secrets", { ...CLEAN, "CLAUDE.md": claude });
    await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
    const key = loadOrCreateRedactionKey(fixture.paths.stateDir);
    const fingerprints = createRedactor(key)(claude).findings.map((entry) => entry.fingerprint);
    expect(fingerprints.length).toBeGreaterThan(0);

    const result = await fixture.check();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.securityRefusal);
    expect(result.error.message).toContain("CLAUDE.md: private-key (line null)");
    expect(result.error.message).toContain("CLAUDE.md: provider-token (line 9)");

    const code = await run(["project", "check", fixture.project, "--json"], fixture.io, () => fixture.context);
    expect(code).toBe(EXIT_CODES.securityRefusal);
    const outputs = [JSON.stringify(result), ...fixture.io.out, ...fixture.io.err];
    expect(fixture.io.out.length + fixture.io.err.length).toBeGreaterThan(0);
    for (const output of outputs) {
      expect(output).not.toContain(TOKEN);
      expect(output).not.toContain(KEY_BODY);
      for (const fingerprint of fingerprints) expect(output).not.toContain(fingerprint);
    }
  });

  it("fails instruction-secrets with exit 1 past the read bound and reads no further", async () => {
    const fixture = await projectFixture("project-check-over-bound", {
      ...CLEAN,
      "AGENTS.md": "a".repeat(PROJECT_CHECK_MAX_READ_BYTES + 1),
    });
    const requests: number[] = [];
    const base = fixture.context.guards;
    const readText = vi.fn(
      (path: string, reader?: (handle: FileHandle) => Promise<string>) =>
        base.readText(path, async (handle) => {
          const original = handle.read.bind(handle);
          vi.spyOn(handle, "read").mockImplementation(((
            buffer: Buffer,
            offset: number,
            length: number,
            position: number,
          ) => {
            requests.push(length);
            return original(buffer, offset, length, position);
          }) as FileHandle["read"]);
          if (reader === undefined) throw new Error("the reader must pass its own reader");
          return reader(handle);
        }),
    );
    const context: CliContext = { ...fixture.context, guards: { ...base, readText } };

    const result = await fixture.check(null, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.operationalFailure);
    expect(result.error.message).toContain("instruction-secrets");
    expect(result.error.message).toContain("AGENTS.md");
    expect(requests.length).toBeGreaterThan(0);
    expect(Math.max(...requests)).toBeLessThanOrEqual(PROJECT_CHECK_MAX_READ_BYTES + 1);
  });

  it("writes nothing and creates no key", async () => {
    const fixture = await projectFixture("project-check-no-write", CLEAN);
    const before = await inventoryDigest(fixture.root);

    await fixture.check();

    expect(await inventoryDigest(fixture.root)).toEqual(before);
    expect(await exists(redactionKeyPath(fixture.paths.stateDir))).toBe(false);
  });

  it("resolves a relative dir against the injected cwd", async () => {
    const fixture = await projectFixture("project-check-relative");
    const nested = join(fixture.project, "nested");
    await nodeFs.mkdir(nested);
    for (const [name, content] of Object.entries(CLEAN)) {
      await nodeFs.writeFile(join(nested, name), content);
    }

    const result = await fixture.check("nested");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.root).toBe(await nodeFs.realpath(nested));
    expect(result.data.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("refuses exit 2 when the target is not a directory", async () => {
    const fixture = await projectFixture("project-check-not-directory", CLEAN);

    const result = await fixture.check("AGENTS.md");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(result.error.kind).toBe("project_root_not_directory");
  });
});
