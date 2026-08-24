import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import { EXIT_CODES, serializeConfig } from "@developer-os/core";
import { afterEach, describe, expect, it } from "vitest";

import { renderBrain, runBrain } from "./brain.js";
import type { BrainOptions } from "./brain.js";
import { createCommandFixture, removeCommandFixtures } from "./testing.js";
import type { CommandFixture } from "./testing.js";

afterEach(removeCommandFixtures);

const OPTIONS: BrainOptions = {
  subcommand: "status",
  query: null,
  limit: null,
  dryRun: false,
};

function note(fields: Record<string, string> = {}, body = "Body.\n"): string {
  const merged: Record<string, string> = {
    schemaVersion: "1",
    title: "A note",
    type: "knowledge-note",
    created: "2026-01-01",
    tags: "[dev]",
    summary: "A summary.",
    stage: "established",
    author: "human",
    reviewed: "2026-07-01",
    ...fields,
  };
  return `---\n${Object.entries(merged)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n---\n\n${body}`;
}

const VAULT: Readonly<Record<string, string>> = {
  "content/DEV/caching.md": note({ title: "Caching" }, "See [[DEV/testing]].\n"),
  "content/DEV/testing.md": note({ title: "Testing" }, "Body.\n"),
};

/**
 * An installed product with a vault, written directly rather than through
 * `init`: these tests are about the `brain` group, and routing every one of
 * them through another command's success path would make an `init` regression
 * look like a `brain` failure.
 */
async function installed(
  label: string,
  files: Readonly<Record<string, string>> = VAULT,
): Promise<CommandFixture> {
  const fixture = await createCommandFixture(label);

  await nodeFs.mkdir(fixture.paths.home, { recursive: true, mode: 0o700 });
  await nodeFs.writeFile(
    fixture.paths.configFile,
    serializeConfig({
      schemaVersion: 1,
      brainPath: fixture.paths.brain,
      adapters: { claude: false, codex: false },
      git: { enabled: false },
      automation: { enabled: false },
      telemetry: false,
    }),
    { mode: 0o600 },
  );

  for (const [vaultPath, text] of Object.entries(files)) {
    const target = join(fixture.paths.brain, vaultPath);
    await nodeFs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(target, text, { mode: 0o600 });
  }
  await nodeFs.mkdir(join(fixture.paths.brain, "content", "_indexes"), {
    recursive: true,
    mode: 0o700,
  });

  return fixture;
}

describe("brain reindex", () => {
  /**
   * **BACKLOG NEW-22's defect statement, driven end to end.** The row is about
   * `brain reindex` and `ingest`'s third transaction failing outright on a vault whose
   * `content` is a symlink — `BrainService.reindex()` reaches `discoverNotes` through
   * `buildIndex()`, and that refused **any** content root reached through a link, with a
   * message naming a path the user had deliberately created.
   *
   * The unit coverage in `packages/brain/src/discovery/discover.test.ts` pins the anchor
   * against an in-memory reader and a hand-written `canonicalize`. **Neither exercises the
   * command the row names**, and a reindex-path change that reintroduced a vault-root
   * anchor anywhere above discovery would pass all of it. This is the case that would go
   * red.
   *
   * The layout is the ordinary one: a `brainPath` pointed at a new directory, with
   * `content` symlinked at an Obsidian vault the user already has.
   */
  it("reindexes a vault whose content is a symlink to a vault elsewhere", async () => {
    /** No vault files: this test writes its own, outside the brain. */
    const fixture = await installed("brain-reindex-symlinked-content", {});

    /** Replace the installed content directory with a link to one outside the brain. */
    const content = join(fixture.paths.brain, "content");
    const elsewhere = join(fixture.root, "obsidian-vault");
    await nodeFs.mkdir(join(elsewhere, "DEV"), { recursive: true, mode: 0o700 });
    /**
     * **`_indexes` is deliberately not pre-created.** A real Obsidian vault has none, and
     * `writeIndexArtifacts` creates it — so leaving it absent makes this case additionally
     * exercise `mkdir` **through** the symlink, which is the single filesystem operation
     * on a relocated root most likely to break and which nothing else drives end to end.
     */
    await nodeFs.writeFile(
      join(elsewhere, "DEV", "pattern.md"),
      note({ title: "Pattern" }, "Body.\n"),
      { mode: 0o600 },
    );
    await nodeFs.rm(content, { recursive: true, force: true });
    await nodeFs.symlink(elsewhere, content);

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "reindex",
    });

    expect(result.ok, "reindex must not refuse a symlinked content root").toBe(true);
    if (!result.ok || result.data.subcommand !== "reindex") return;
    expect(result.data.transactionId).not.toBeNull();
    /** The note under the linked vault is indexed, under its declared vault path. */
    expect(
      await nodeFs.readFile(join(elsewhere, "_indexes", "index.json"), "utf8"),
    ).toContain("content/DEV/pattern.md");
    /** And the link is still a link: nothing replaced it with a real directory. */
    expect((await nodeFs.lstat(content)).isSymbolicLink()).toBe(true);
  });

  it("writes the four artifacts through a transaction", async () => {
    const fixture = await installed("brain-reindex");

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "reindex",
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.data.subcommand !== "reindex") return;
    expect(result.data.transactionId).not.toBeNull();
    expect(result.data.written).toEqual([
      "content/_indexes/catalog.md",
      "content/_indexes/graph.json",
      "content/_indexes/index.json",
      "content/_indexes/vault-map.md",
    ]);

    for (const written of result.data.written) {
      const text = await nodeFs.readFile(
        join(fixture.paths.brain, written),
        "utf8",
      );
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("writes nothing under --dry-run", async () => {
    const fixture = await installed("brain-dry-run");

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "reindex",
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.data.subcommand !== "reindex") return;
    expect(result.data.transactionId).toBeNull();
    expect(result.data.written).toHaveLength(4);

    const indexes = await nodeFs.readdir(
      join(fixture.paths.brain, "content", "_indexes"),
    );
    expect(indexes).toEqual([]);
  });

  it("is idempotent: a second run leaves the artifacts byte-identical", async () => {
    /**
     * The determinism gate restated at process level. The second run replaces
     * rather than creates, so it also exercises the `expectedBeforeHash` path.
     */
    const fixture = await installed("brain-idempotent");
    const indexPath = join(
      fixture.paths.brain,
      "content",
      "_indexes",
      "index.json",
    );

    await runBrain(fixture.context, { ...OPTIONS, subcommand: "reindex" });
    const first = await nodeFs.readFile(indexPath, "utf8");

    const second = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "reindex",
    });
    expect(second.ok, second.ok ? "" : JSON.stringify(second.error)).toBe(true);

    const after = await nodeFs.readFile(indexPath, "utf8");
    /**
     * Compared in canonical form, not byte for byte. The fixture's clock
     * advances with every transaction id, so `generatedAt` legitimately differs
     * between the two runs — which is exactly why Brain architecture former §6.3 defines drift over
     * the canonical form rather than the bytes. Everything else must be equal.
     */
    const canonical = (text: string): string =>
      text.replace(/"generatedAt": "[^"]*"/u, '"generatedAt": "SENTINEL"');
    expect(canonical(after)).toBe(canonical(first));
    expect(after).not.toBe(first);
  });

  it("recovers when the user deletes the index directory", async () => {
    /**
     * The manifest still claims four artifacts that are gone, so a plan built
     * from the manifest alone says `replace` and the executor refuses — every
     * later reindex, forever, with no recovery text. Reconciling against the
     * disk first is what makes this an ordinary run.
     */
    const fixture = await installed("brain-deleted-indexes");
    await runBrain(fixture.context, { ...OPTIONS, subcommand: "reindex" });

    await nodeFs.rm(join(fixture.paths.brain, "content", "_indexes"), {
      recursive: true,
      force: true,
    });

    const again = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "reindex",
    });
    expect(again.ok, again.ok ? "" : JSON.stringify(again.error)).toBe(true);
    expect(
      await nodeFs.readdir(join(fixture.paths.brain, "content", "_indexes")),
    ).toHaveLength(4);
  });

  it("recovers when artifacts exist that no manifest records", async () => {
    /**
     * What a crash between the transaction and the recording leaves behind, and
     * also what `uninstall` → `init` → `reindex` produces: uninstall deletes
     * the manifest and preserves the vault by location, so the next reindex
     * meets four files nobody owns.
     */
    const fixture = await installed("brain-orphaned-artifacts");
    await runBrain(fixture.context, { ...OPTIONS, subcommand: "reindex" });

    await nodeFs.rm(fixture.paths.manifestFile, { force: true });

    const again = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "reindex",
    });
    expect(again.ok, again.ok ? "" : JSON.stringify(again.error)).toBe(true);
  });

  it("refuses to write into the product's own ownership universe", async () => {
    /**
     * The excluded root. This does *not* pin the owned root: every path
     * reindex plans is inside the index directory already, so widening that
     * root changes nothing observable — it constrains future callers, not this
     * one, and no test can tell the difference.
     */
    const fixture = await installed("brain-owned-root");
    const config = {
      ...fixture.context,
      paths: { ...fixture.paths, home: fixture.paths.brain },
    };

    const result = await runBrain(config, {
      ...OPTIONS,
      subcommand: "reindex",
    });

    /** The vault is now inside an excluded root, so nothing may be written. */
    expect(result.ok).toBe(false);
  });

  it("survives a vault reached through a symlinked ancestor", async () => {
    /**
     * The manifest records canonical paths. A reconciliation that looked up the
     * declared one missed every record whenever an ancestor of the vault is a
     * symlink — `/tmp`, `~/Dropbox`, `/Volumes` — and adopted a duplicate that
     * `validateManifest` accepted (it dedupes on the literal string) and
     * `validateChangePlan` then rejected forever, taking `init` down with it.
     *
     * The standard fixture cannot see this: it `realpath`s its own root, so
     * declared and canonical are always the same string.
     */
    const fixture = await createCommandFixture("brain-symlinked");
    const real = join(fixture.root, "real-vault");
    await nodeFs.mkdir(join(real, "content", "DEV"), {
      recursive: true,
      mode: 0o700,
    });
    await nodeFs.writeFile(join(real, "content", "DEV", "a.md"), note(), {
      mode: 0o600,
    });

    const linked = join(fixture.userHome, "LinkedBrain");
    await nodeFs.symlink(real, linked);

    await nodeFs.mkdir(fixture.paths.home, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(
      fixture.paths.configFile,
      serializeConfig({
        schemaVersion: 1,
        brainPath: linked,
        adapters: { claude: false, codex: false },
        git: { enabled: false },
        automation: { enabled: false },
        telemetry: false,
      }),
      { mode: 0o600 },
    );

    const first = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "reindex",
    });
    expect(first.ok, first.ok ? "" : JSON.stringify(first.error)).toBe(true);

    const second = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "reindex",
    });
    expect(second.ok, second.ok ? "" : JSON.stringify(second.error)).toBe(true);

    /** One record per artifact, keyed canonically — not two. */
    const manifest = await fixture.context.manifests.read();
    const paths = manifest.artifacts.map((artifact) => artifact.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.filter((path) => path.endsWith("index.json"))).toHaveLength(1);
  });

  it("does not record anything when the plan is refused", async () => {
    /**
     * Adoption used to be written to the manifest before the plan was
     * validated, so a refused reindex left vault artifacts recorded in a real
     * installation's manifest — and, with no manifest at all, fabricated one,
     * flipping `status.installed` to true for an install that never happened.
     *
     * Reaching that needs artifacts on disk that nobody owns, which is why this
     * reindexes successfully first and then removes the manifest: without those
     * two steps there is nothing to adopt and the bug is invisible.
     */
    const fixture = await installed("brain-refused-no-record");
    await runBrain(fixture.context, { ...OPTIONS, subcommand: "reindex" });
    await nodeFs.rm(fixture.paths.manifestFile, { force: true });

    const scoped = {
      ...fixture.context,
      paths: { ...fixture.paths, home: fixture.paths.brain },
    };
    const result = await runBrain(scoped, { ...OPTIONS, subcommand: "reindex" });

    expect(result.ok).toBe(false);
    expect(await fixture.context.manifests.readOptional()).toBeNull();
  });

  it("refuses a protected brainPath without creating anything", async () => {
    /**
     * Pins the outcome, not the mechanism. Three layers would each refuse this
     * — discovery's `assertReadable`, the `mkdir`'s `assertTarget`, and the
     * executor's own guard — and discovery gets there first, so no test can
     * show which one fired. The `mkdir` guard is therefore defence in depth
     * that no reachable input exercises today; it is there because `init` runs
     * every directory it creates through the same check, and a future caller
     * that reaches the `mkdir` by another route should not be the one to find
     * out it was missing.
     */
    const fixture = await createCommandFixture("brain-protected-mkdir");
    const protectedRoot = join(fixture.userHome, ".ssh");
    await nodeFs.mkdir(fixture.paths.home, { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(
      fixture.paths.configFile,
      serializeConfig({
        schemaVersion: 1,
        brainPath: protectedRoot,
        adapters: { claude: false, codex: false },
        git: { enabled: false },
        automation: { enabled: false },
        telemetry: false,
      }),
      { mode: 0o600 },
    );

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "reindex",
    });

    expect(result.ok).toBe(false);
    await expect(
      nodeFs.stat(join(protectedRoot, "content", "_indexes")),
    ).rejects.toThrow();
  });

  it("refuses to run at all when the product is not initialized", async () => {
    const fixture = await createCommandFixture("brain-uninitialized");

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "reindex",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(result.error.recovery).toBe("developer-os init");
  });
});

describe("brain lint", () => {
  it("succeeds with warnings on a vault whose only findings are curation", async () => {
    const fixture = await installed("brain-lint-clean", {
      ...VAULT,
      "content/DEV/unreviewed.md": note({
        title: "Unreviewed",
        author: "agent",
        reviewed: "null",
      }),
    });
    await runBrain(fixture.context, { ...OPTIONS, subcommand: "reindex" });

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "lint",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe(EXIT_CODES.success);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("fails and names the findings when the vault has errors", async () => {
    const fixture = await installed("brain-lint-broken", {
      "content/DEV/broken.md": note({}, "See [[DEV/absent]].\n"),
    });
    await runBrain(fixture.context, { ...OPTIONS, subcommand: "reindex" });

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "lint",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.operationalFailure);
    /**
     * This command exists to say what is wrong, so the findings ride in the message:
     * exiting non-zero with only a count would make every consumer run the command twice.
     * `CliError.data` exists now (Foundation request 3) and `lint` does not use it yet —
     * that move needs its own output contract, so this pins the message as it stands.
     */
    expect(result.error.message).toContain("DEV/absent");
    expect(result.error.paths).toContain("content/DEV/broken.md");
  });

  it("reports drift after an artifact is edited by hand", async () => {
    const fixture = await installed("brain-lint-drift");
    await runBrain(fixture.context, { ...OPTIONS, subcommand: "reindex" });

    const catalog = join(
      fixture.paths.brain,
      "content",
      "_indexes",
      "catalog.md",
    );
    await nodeFs.appendFile(catalog, "- injected\n");

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "lint",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("index-drift");
  });
});

describe("brain search", () => {
  it("returns a match whose path exists on disk", async () => {
    const fixture = await installed("brain-search");
    await runBrain(fixture.context, { ...OPTIONS, subcommand: "reindex" });

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "search",
      query: "caching",
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.data.subcommand !== "search") return;
    expect(result.data.matches.length).toBeGreaterThan(0);

    for (const match of result.data.matches) {
      await expect(
        nodeFs.stat(join(fixture.paths.brain, match.path)),
      ).resolves.toBeDefined();
    }
  });

  it("succeeds and names the doors it tried when nothing is reachable", async () => {
    const fixture = await installed("brain-search-miss");
    await runBrain(fixture.context, { ...OPTIONS, subcommand: "reindex" });

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "search",
      query: "zzzznotpresent",
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.data.subcommand !== "search") return;
    expect(result.data.matches).toEqual([]);
    expect(result.data.tried).toEqual(["tag", "type", "folder", "title", "alias"]);
  });

  it("refuses with reindex recovery when the index was never built", async () => {
    const fixture = await installed("brain-search-noindex");

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "search",
      query: "caching",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(result.error.recovery).toBe("developer-os brain reindex");
  });

  it("says something different when the index is present and corrupt", async () => {
    /**
     * "There is no index" and "there is a file there and it is wrong" are
     * different problems, and telling someone to overwrite a file is worth
     * doing only after saying what is in it.
     */
    const fixture = await installed("brain-search-corrupt");
    await runBrain(fixture.context, { ...OPTIONS, subcommand: "reindex" });
    await nodeFs.writeFile(
      join(fixture.paths.brain, "content", "_indexes", "index.json"),
      "{ not json",
    );

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "search",
      query: "caching",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.recovery).toContain("inspect the index");
    expect(result.error.recovery).not.toBe("developer-os brain reindex");
  });

  it("honours --limit and says it truncated", async () => {
    const fixture = await installed("brain-search-limit");
    await runBrain(fixture.context, { ...OPTIONS, subcommand: "reindex" });

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "search",
      query: "dev",
      limit: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.data.subcommand !== "search") return;
    expect(result.data.matches).toHaveLength(1);
    expect(result.data.truncated).toBe(true);
    expect(result.data.considered).toBeGreaterThan(1);
  });

  it("turns a bad limit into invalid input rather than a stack trace", async () => {
    /**
     * `search` throws `RangeError` for a non-positive integer. `--limit` is
     * validated at parse time, so this is the backstop for a second caller.
     */
    const fixture = await installed("brain-search-badlimit");
    await runBrain(fixture.context, { ...OPTIONS, subcommand: "reindex" });

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "search",
      query: "dev",
      limit: 0,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(EXIT_CODES.invalidInput);
  });
});

describe("brain status", () => {
  it("reports the vault without changing it", async () => {
    const fixture = await installed("brain-status");
    const before = await nodeFs.readdir(
      join(fixture.paths.brain, "content", "_indexes"),
    );

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "status",
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.data.subcommand !== "status") return;
    expect(result.data.noteCount).toBe(2);
    expect(result.data.indexPresent).toBe(false);
    expect(result.data.wouldChange).toEqual([]);

    const after = await nodeFs.readdir(
      join(fixture.paths.brain, "content", "_indexes"),
    );
    expect(after).toEqual(before);
  });

  it("sees the index after a reindex", async () => {
    const fixture = await installed("brain-status-indexed");
    await runBrain(fixture.context, { ...OPTIONS, subcommand: "reindex" });

    const result = await runBrain(fixture.context, {
      ...OPTIONS,
      subcommand: "status",
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.data.subcommand !== "status") return;
    expect(result.data.indexPresent).toBe(true);
  });
});

describe("rendering", () => {
  it("screens a control character out of a rendered match path", () => {
    /**
     * Retrieval leaves `path` byte-exact on purpose — Brain architecture former §14 gates on every
     * match resolving at the returned path — which makes screening it the CLI's
     * job, and this the only place a user-controlled vault path reaches a
     * terminal. Removing every `renderPath` call from `renderBrain` left all
     * 106 CLI tests green.
     */
    const rendered = renderBrain({
      schemaVersion: 1,
      subcommand: "search",
      matches: [
        {
          path: "content/DEV/ev\u001b[31mil.md",
          title: "safe\u202Ereversed",
          summary: "",
          stage: "established",
          reviewed: null,
          score: 3,
          matched: [],
        },
      ],
      considered: 1,
      selected: 1,
      truncated: false,
      tried: null,
    });

    /** Per line: joining with `\n` would put a `\p{Cc}` in the haystack itself. */
    for (const line of rendered) {
      /**
       * U+200D is exempt, here as in `redact.ts` and `renderPath`. Written as
       * an exemption rather than as a bare class so that adding an emoji to a
       * fixture cannot make this go red for the wrong reason — the obvious
       * repair for that would be to weaken the assertion or to drop the
       * exemption, and both undo a deliberate decision.
       */
      expect(line).not.toMatch(/(?!\u200D)[\p{Cc}\p{Cf}]/u);
    }
    expect(rendered.join(" ")).toContain("il.md");
  });

  it("screens a control character out of a lint finding's path", () => {
    const rendered = renderBrain({
      schemaVersion: 1,
      subcommand: "lint",
      findings: [
        {
          class: "links",
          severity: "error",
          path: "content/DEV/ev\u001b[31mil.md",
          key: null,
          message: "the link \"x\" resolves to no note",
          line: 4,
        },
      ],
      errorCount: 1,
      warnCount: 0,
      infoCount: 0,
    });
    for (const line of rendered) expect(line).not.toMatch(/\p{Cc}/u);
    expect(rendered.join(" ")).toContain(":4");
  });

  it("screens the vault root and folders in a status report", () => {
    const rendered = renderBrain({
      schemaVersion: 1,
      subcommand: "status",
      vaultRoot: "/home/u/ev\u001b[31mil",
      contentRoot: "content",
      noteCount: 0,
      topicFolders: ["DE\u202EV"],
      unclassifiedFolders: [],
      indexPresent: false,
      wouldChange: [],
    });
    for (const line of rendered) {
      /**
       * U+200D is exempt, here as in `redact.ts` and `renderPath`. Written as
       * an exemption rather than as a bare class so that adding an emoji to a
       * fixture cannot make this go red for the wrong reason — the obvious
       * repair for that would be to weaken the assertion or to drop the
       * exemption, and both undo a deliberate decision.
       */
      expect(line).not.toMatch(/(?!\u200D)[\p{Cc}\p{Cf}]/u);
    }
  });
});
