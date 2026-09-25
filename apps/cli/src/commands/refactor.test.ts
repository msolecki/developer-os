import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { EXIT_CODES } from "@developer-os/core";
import type { RefactorRequestV1 } from "@developer-os/brain";
import { afterEach, describe, expect, it } from "vitest";

import type { CliContext } from "../context.js";
import { runBrain } from "./brain.js";
import { runInit } from "./init.js";
import { runRefactor } from "./refactor.js";
import {
  createCommandFixture,
  inventoryDigest,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
} from "./testing.js";
import type { CommandFixture } from "./testing.js";

afterEach(removeCommandFixtures);

/** `templates/brain`'s notes: the DEV note links to the TOOLS note; INFRA's has no referrer. */
const LINKED = "TOOLS/example-reference-note.md";
const REFERRER = "DEV/example-knowledge-note.md";
const ISOLATED = "INFRA/example-compiled-note.md";

const RETIRE: RefactorRequestV1 = { mode: "retire", note: ISOLATED };
const RENAME: RefactorRequestV1 = { mode: "rename", note: LINKED, newName: "brain-commands.md" };

function note(title: string, body = "Body.", extra: readonly string[] = []): string {
  return [
    "---",
    "schemaVersion: 1",
    `title: ${title}`,
    "type: knowledge-note",
    "created: 2026-01-01",
    "tags: [dev]",
    `summary: About ${title}.`,
    "stage: established",
    "author: human",
    "reviewed: 2026-07-01",
    ...extra,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

interface Installed extends CommandFixture {
  readonly content: string;
}

async function installed(
  label: string,
  options: { readonly env?: Readonly<Record<string, string>> } = {},
): Promise<Installed> {
  const fixture = await createCommandFixture(label, { env: options.env ?? {} });
  const init = await runInit(fixture.context, { dryRun: false, assumeYes: true });
  expect(init.ok, "the fixture must install").toBe(true);
  return { ...fixture, content: join(fixture.paths.brain, "content") };
}

/** Records every transaction kind, and optionally acts just before one executes. */
function recording(
  context: CliContext,
  before: (kind: string) => Promise<void> = () => Promise.resolve(),
): { readonly context: CliContext; readonly kinds: string[] } {
  const kinds: string[] = [];
  const inner = context.executor;
  return {
    kinds,
    context: {
      ...context,
      executor: {
        execute: async (plan) => {
          kinds.push(plan.kind);
          await before(plan.kind);
          return inner.execute(plan);
        },
        resume: (transactionId) => inner.resume(transactionId),
        rollback: (transactionId) => inner.rollback(transactionId),
      },
    },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await nodeFs.lstat(path);
    return true;
  } catch {
    return false;
  }
}

describe("runRefactor", () => {
  it("applies a rename in one brain-refactor transaction, then reindexes in brain-refactor-reindex", async () => {
    const fixture = await installed("refactor-rename");
    const { context, kinds } = recording(fixture.context);

    const result = await runRefactor(context, { subcommand: "refactor", request: RENAME, dryRun: false });

    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(kinds).toStrictEqual(["brain-refactor", "brain-refactor-reindex"]);
    expect(result.data.transactionId).not.toBeNull();
    expect(result.data.rewrittenLinks).toBe(1);
    expect(await exists(join(fixture.content, LINKED))).toBe(false);
    expect(await exists(join(fixture.content, "TOOLS", "brain-commands.md"))).toBe(true);
    const referrer = await nodeFs.readFile(join(fixture.content, REFERRER), "utf8");
    expect(referrer).toContain("[[brain-commands]]");
    expect(referrer).not.toContain("[[TOOLS/example-reference-note]]");

    const lint = await runBrain(fixture.context, {
      subcommand: "lint",
      query: null,
      limit: null,
      dryRun: false,
    });
    expect(lint.ok && lint.data.subcommand === "lint" && lint.data.errorCount).toBe(0);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("reports the plan and writes nothing under --dry-run, with transactionId null", async () => {
    const fixture = await installed("refactor-dry-run");
    const before = await inventoryDigest(fixture.root);

    const result = await runRefactor(fixture.context, { subcommand: "retire", request: RETIRE, dryRun: true });

    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.data).toStrictEqual({
      schemaVersion: 1,
      subcommand: "retire",
      mode: "retire",
      transactionId: null,
      mutations: expect.arrayContaining([
        { operation: "create", path: `_graveyard/${ISOLATED}` },
        { operation: "remove", path: ISOLATED },
      ]) as unknown,
      rewrittenLinks: 0,
    });
    expect(result.data.mutations).toHaveLength(2);
    expect(await inventoryDigest(fixture.root)).toEqual(before);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses an applied run exit 5 brain_refactor_in_agent_session when CLAUDECODE=1, and allows --dry-run", async () => {
    const fixture = await installed("agent", { env: { CLAUDECODE: "1" } });
    const before = await inventoryDigest(fixture.root);
    const applied = await runRefactor(fixture.context, { subcommand: "retire", request: RETIRE, dryRun: false });
    expect(!applied.ok && [applied.code, applied.error.kind]).toStrictEqual([
      EXIT_CODES.securityRefusal,
      "brain_refactor_in_agent_session",
    ]);
    expect(await inventoryDigest(fixture.root)).toEqual(before);
    expect((await runRefactor(fixture.context, { subcommand: "retire", request: RETIRE, dryRun: true })).ok).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses with CODEX_THREAD_ID and with both markers set (any-match)", async () => {
    for (const env of [
      { CODEX_THREAD_ID: "0199-synthetic-thread" },
      { CLAUDECODE: "1", CODEX_THREAD_ID: "0199-synthetic-thread" },
    ]) {
      const fixture = await installed(`agent-${String(Object.keys(env).length)}`, { env });
      const applied = await runRefactor(fixture.context, { subcommand: "refactor", request: RENAME, dryRun: false });
      expect(!applied.ok && [applied.code, applied.error.kind], JSON.stringify(env)).toStrictEqual([
        EXIT_CODES.securityRefusal,
        "brain_refactor_in_agent_session",
      ]);
      expect(await exists(join(fixture.content, LINKED))).toBe(true);
    }
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses exit 3 note_changed_since_read when a referrer changes between plan and apply", async () => {
    const fixture = await installed("refactor-race");
    const referrer = join(fixture.content, REFERRER);
    const { context, kinds } = recording(fixture.context, async (kind) => {
      if (kind === "brain-refactor") await nodeFs.appendFile(referrer, "\nhand edit mid-run\n");
    });

    const result = await runRefactor(context, { subcommand: "refactor", request: RENAME, dryRun: false });

    expect(kinds).toStrictEqual(["brain-refactor"]);
    expect(!result.ok && [result.code, result.error.kind]).toStrictEqual([
      EXIT_CODES.decisionRequired,
      "note_changed_since_read",
    ]);
    expect(!result.ok && result.error.message).toContain("nothing was written");
    expect(await exists(join(fixture.content, LINKED))).toBe(true);
    expect(await exists(join(fixture.content, "TOOLS", "brain-commands.md"))).toBe(false);
    expect(await nodeFs.readFile(referrer, "utf8")).toContain("hand edit mid-run");
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses exit 2 brain_refactor_input_invalid for a note that is not valid UTF-8, instead of a note_changed_since_read loop", async () => {
    const fixture = await installed("refactor-non-utf8");
    const referrer = join(fixture.content, REFERRER);
    await nodeFs.appendFile(referrer, Buffer.from([0x0a, 0xff, 0x0a]));
    const before = await nodeFs.readFile(referrer);

    const result = await runRefactor(fixture.context, { subcommand: "refactor", request: RENAME, dryRun: false });

    expect(!result.ok && [result.code, result.error.kind]).toStrictEqual([
      EXIT_CODES.invalidInput,
      "brain_refactor_input_invalid",
    ]);
    expect(await nodeFs.readFile(referrer)).toStrictEqual(before);
    expect(await exists(join(fixture.content, LINKED))).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses exit 3 refactor_destination_exists for a non-note file already at the destination", async () => {
    const fixture = await installed("refactor-occupied");
    const occupied = join(fixture.content, "DEV", "c.md");
    await nodeFs.writeFile(occupied, "plain text, not a note\n", { mode: 0o600 });

    const result = await runRefactor(fixture.context, {
      subcommand: "refactor",
      request: { mode: "rename", note: REFERRER, newName: "c.md" },
      dryRun: false,
    });

    expect(!result.ok && [result.code, result.error.kind]).toStrictEqual([
      EXIT_CODES.decisionRequired,
      "refactor_destination_exists",
    ]);
    expect(await nodeFs.readFile(occupied, "utf8")).toBe("plain text, not a note\n");
    expect(await exists(join(fixture.content, REFERRER))).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("refuses exit 5 brain_refactor_path_refused through a symlinked topic folder", async () => {
    const fixture = await installed("refactor-symlink");
    /** Inside the vault, so discovery skips the link rather than refusing the whole build. */
    const elsewhere = join(fixture.content, "_outputs", "qa-elsewhere");
    await nodeFs.mkdir(elsewhere, { recursive: true, mode: 0o700 });
    await nodeFs.rm(join(fixture.content, "QA"), { recursive: true, force: true });
    await nodeFs.symlink(elsewhere, join(fixture.content, "QA"));

    const result = await runRefactor(fixture.context, {
      subcommand: "refactor",
      request: { mode: "move", note: ISOLATED, folder: "QA" },
      dryRun: false,
    });

    expect(!result.ok && [result.code, result.error.kind]).toStrictEqual([
      EXIT_CODES.securityRefusal,
      "brain_refactor_path_refused",
    ]);
    expect(await nodeFs.readdir(elsewhere)).toStrictEqual([]);
    expect(await exists(join(fixture.content, ISOLATED))).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it.each([
    ["brain_refactor_input_invalid", 2],
    ["retire_has_referrers", 3],
    ["refactor_postcondition_failed", 1],
    ["refactor_too_wide", 1],
  ] as const)("publishes planner refusal %s with exit %i", async (reason, code) => {
    const fixture = await installed(`refactor-${reason}`);
    const dev = join(fixture.content, "DEV");
    let request: RefactorRequestV1;
    switch (reason) {
      case "brain_refactor_input_invalid":
        request = { mode: "retire", note: "DEV/missing.md" };
        break;
      case "retire_has_referrers":
        request = { mode: "retire", note: LINKED };
        break;
      case "refactor_postcondition_failed":
        // `sources` is frontmatter, which a refactor never edits, so the citation stops resolving.
        await nodeFs.writeFile(join(dev, "cites.md"), note("Cites", "Body.", [`sources: [${ISOLATED}]`]), {
          mode: 0o600,
        });
        request = { mode: "rename", note: ISOLATED, newName: "renamed.md" };
        break;
      case "refactor_too_wide":
        // 256 referrers → 256 replace + remove + create = 258 mutations.
        for (let i = 0; i < 256; i += 1) {
          const id = String(i).padStart(3, "0");
          await nodeFs.writeFile(join(dev, `r${id}.md`), note(`R${id}`, "[[INFRA/example-compiled-note]]"), {
            mode: 0o600,
          });
        }
        request = { mode: "rename", note: ISOLATED, newName: "renamed.md" };
        break;
    }
    const before = await inventoryDigest(fixture.root);

    const result = await runRefactor(fixture.context, {
      subcommand: request.mode === "retire" ? "retire" : "refactor",
      request,
      dryRun: false,
    });

    expect(!result.ok && [result.code, result.error.kind]).toStrictEqual([code, reason]);
    if (reason === "retire_has_referrers") {
      expect(!result.ok && result.error.paths).toStrictEqual([REFERRER]);
      expect(!result.ok && result.error.recovery).toContain("developer-os brain refactor --merge");
    }
    expect(await inventoryDigest(fixture.root)).toEqual(before);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
