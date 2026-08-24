import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "@developer-os/core";
import type { CliResult } from "@developer-os/core";
import type {
  BrainLintResultV1,
  BrainReindexResultV1,
  BrainSearchResultV1,
  BrainStatusResultV1,
} from "@developer-os/cli/dist/commands/brain.js";
import type { InitResultV1 } from "@developer-os/cli/dist/commands/init.js";
import type { UninstallResultV1 } from "@developer-os/cli/dist/commands/uninstall.js";

import { runCli, runJson } from "../helpers/run-cli.js";
import {
  createTempHome,
  inventory,
  removeTempHome,
} from "../helpers/temp-home.js";
import type { TempHome } from "../helpers/temp-home.js";

/**
 * The sandbox is deliberately not called `home`.
 *
 * The self-containment rule flags a variable named `home` sitting within forty
 * characters of a quoted `brain` — the shape a legacy vault lookup takes — and
 * every invocation in this file passes the CLI's own `brain` subcommand as an
 * argument right beside the sandbox. The rule is right to be that broad; its
 * own comment observes that a rule which fired on the product's `brainPath`
 * would be suppressed within a day, and suppressing it for a whole file to
 * accommodate a variable name would be that same mistake, one allowlist entry
 * at a time. Renaming the variable costs nothing and keeps the guard at full
 * strength. (This paragraph triggered it too, on the first draft.)
 */
function okData<T>(result: CliResult<T>): T {
  if (!result.ok) {
    throw new Error(
      `expected success, got exit ${String(result.code)}: ${result.error.message}`,
    );
  }
  return result.data;
}

async function withInstalled(
  body: (sandbox: TempHome) => Promise<void>,
): Promise<void> {
  const sandbox = await createTempHome();
  try {
    const installed = await runJson<InitResultV1>(sandbox, [
      "init",
      "--yes",
      "--json",
    ]);
    expect(installed.exitCode).toBe(EXIT_CODES.success);
    await body(sandbox);
  } finally {
    await removeTempHome(sandbox);
  }
}

const ARTIFACTS = [
  "content/_indexes/catalog.md",
  "content/_indexes/graph.json",
  "content/_indexes/index.json",
  "content/_indexes/vault-map.md",
] as const;

describe("brain, against the compiled binary under a temporary HOME", () => {
  it("installs a vault carrying the template, and reports its notes", async () => {
    await withInstalled(async (sandbox) => {
      const note = join(
        sandbox.brain,
        "content",
        "DEV",
        "example-knowledge-note.md",
      );
      expect((await readFile(note, "utf8")).length).toBeGreaterThan(0);

      const status = await runJson<BrainStatusResultV1>(sandbox, [
        "brain",
        "status",
        "--json",
      ]);
      expect(status.exitCode).toBe(EXIT_CODES.success);
      const report = okData(status.result);

      /** One example per note type, and nothing the folder policy excludes. */
      expect(report.noteCount).toBe(4);
      expect(report.indexPresent).toBe(false);
      expect(report.unclassifiedFolders).toStrictEqual([]);
      expect(report.wouldChange).toStrictEqual([]);
    });
  });

  it("writes exactly four artifacts, and nothing under --dry-run", async () => {
    await withInstalled(async (sandbox) => {
      const before = await inventory(sandbox.brain);

      const dry = await runJson<BrainReindexResultV1>(sandbox, [
        "brain",
        "reindex",
        "--dry-run",
        "--json",
      ]);
      expect(dry.exitCode).toBe(EXIT_CODES.success);
      expect(okData(dry.result).transactionId).toBeNull();
      expect(await inventory(sandbox.brain)).toStrictEqual(before);

      const real = await runJson<BrainReindexResultV1>(sandbox, [
        "brain",
        "reindex",
        "--json",
      ]);
      expect(real.exitCode).toBe(EXIT_CODES.success);
      const written = okData(real.result);
      expect(written.transactionId).not.toBeNull();
      expect([...written.written].sort()).toStrictEqual([...ARTIFACTS]);

      for (const artifact of ARTIFACTS) {
        const text = await readFile(join(sandbox.brain, artifact), "utf8");
        expect(text.length, artifact).toBeGreaterThan(0);
      }
    });
  });

  it("is idempotent: a second reindex changes nothing but the timestamp", async () => {
    await withInstalled(async (sandbox) => {
      await runCli(sandbox, ["brain", "reindex"]);
      const first = await readFile(
        join(sandbox.brain, "content/_indexes/index.json"),
        "utf8",
      );

      const second = await runCli(sandbox, ["brain", "reindex"]);
      expect(second.exitCode).toBe(EXIT_CODES.success);
      const after = await readFile(
        join(sandbox.brain, "content/_indexes/index.json"),
        "utf8",
      );

      /**
       * Canonical form, not bytes. `generatedAt` is taken from a real clock, so
       * the two runs differ there and only there — which is exactly why Brain
       * architecture former §6.3 defines drift over canonical form rather than over the file.
       */
      const canonical = (text: string): string =>
        text.replace(/"generatedAt": "[^"]*"/u, '"generatedAt": "SENTINEL"');
      expect(canonical(after)).toBe(canonical(first));
    });
  });

  it("lints the freshly installed template clean", async () => {
    await withInstalled(async (sandbox) => {
      await runCli(sandbox, ["brain", "reindex"]);

      const lint = await runJson<BrainLintResultV1>(sandbox, [
        "brain",
        "lint",
        "--json",
      ]);
      expect(lint.exitCode).toBe(EXIT_CODES.success);
      expect(okData(lint.result).errorCount).toBe(0);
    });
  });

  it("fails lint after a note is corrupted by hand", async () => {
    await withInstalled(async (sandbox) => {
      await runCli(sandbox, ["brain", "reindex"]);
      await writeFile(
        join(sandbox.brain, "content", "DEV", "example-knowledge-note.md"),
        "---\ntitle: only a title\n---\n\nBody.\n",
      );

      const lint = await runCli(sandbox, ["brain", "lint"]);
      expect(lint.exitCode).toBe(EXIT_CODES.operationalFailure);
      expect(lint.stderr).toContain("frontmatter");
    });
  });

  it("reports index drift after an artifact is edited by hand", async () => {
    await withInstalled(async (sandbox) => {
      await runCli(sandbox, ["brain", "reindex"]);
      await appendFile(
        join(sandbox.brain, "content/_indexes/catalog.md"),
        "- injected\n",
      );

      const lint = await runCli(sandbox, ["brain", "lint"]);
      expect(lint.exitCode).toBe(EXIT_CODES.operationalFailure);
      expect(lint.stderr).toContain("index-drift");

      /** And the command that clears it actually does. */
      expect((await runCli(sandbox, ["brain", "reindex"])).exitCode).toBe(
        EXIT_CODES.success,
      );
      expect((await runCli(sandbox, ["brain", "lint"])).exitCode).toBe(
        EXIT_CODES.success,
      );
    });
  });

  it("returns a match whose path exists on disk", async () => {
    await withInstalled(async (sandbox) => {
      await runCli(sandbox, ["brain", "reindex"]);

      const found = await runJson<BrainSearchResultV1>(sandbox, [
        "brain",
        "search",
        "brain",
        "--json",
      ]);
      expect(found.exitCode).toBe(EXIT_CODES.success);
      const data = okData(found.result);
      expect(data.matches.length).toBeGreaterThan(0);

      for (const match of data.matches) {
        const text = await readFile(join(sandbox.brain, match.path), "utf8");
        expect(text.length, match.path).toBeGreaterThan(0);
      }
    });
  });

  it("exits 0 and names the doors it tried for an absent term", async () => {
    await withInstalled(async (sandbox) => {
      await runCli(sandbox, ["brain", "reindex"]);

      const miss = await runJson<BrainSearchResultV1>(sandbox, [
        "brain",
        "search",
        "zzzznotpresent",
        "--json",
      ]);
      expect(miss.exitCode).toBe(EXIT_CODES.success);
      const data = okData(miss.result);
      expect(data.matches).toStrictEqual([]);
      expect(data.tried).toStrictEqual([
        "tag",
        "type",
        "folder",
        "title",
        "alias",
      ]);
    });
  });

  it("tells the user to reindex when no index has been built", async () => {
    await withInstalled(async (sandbox) => {
      const search = await runCli(sandbox, ["brain", "search", "brain"]);
      expect(search.exitCode).toBe(EXIT_CODES.invalidInput);
      expect(search.stderr).toContain("developer-os brain reindex");
    });
  });

  it("treats developer-os search as an alias for brain search", async () => {
    await withInstalled(async (sandbox) => {
      await runCli(sandbox, ["brain", "reindex"]);

      const alias = await runCli(sandbox, ["search", "brain", "--json"]);
      const direct = await runCli(sandbox, ["brain", "search", "brain", "--json"]);

      expect(alias.exitCode).toBe(direct.exitCode);
      expect(alias.stdout).toBe(direct.stdout);
    });
  });

  it("refuses a --limit that is not a positive integer", async () => {
    await withInstalled(async (sandbox) => {
      for (const limit of ["0", "-1", "2.5", "abc"]) {
        const refused = await runCli(sandbox, [
          "brain",
          "search",
          "brain",
          "--limit",
          limit,
        ]);
        expect(refused.exitCode, limit).toBe(EXIT_CODES.invalidInput);
      }
    });
  });

it("prints a joined emoji in a title as the author wrote it", async () => {
    /**
     * The one test that crosses both screens. The Brain exempts U+200D from its
     * redaction and `renderPath` exempts it from the CLI's, and neither
     * exemption is worth anything if the other layer removes the character —
     * which is exactly what happened: the Brain preserved the joiner and
     * `renderPath` replaced it with U+FFFD, so a family emoji reached the user
     * as three replacement characters, worse than before either screen existed.
     * Nothing inside a package can catch that; only the compiled binary can.
     *
     * The hostile half rides along: the same title carries U+202E, which *must*
     * be gone, so this pins both halves of the policy in one row.
     */
    await withInstalled(async (sandbox) => {
      const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
      const note = join(sandbox.brain, "content", "DEV", "joined-title.md");
      await writeFile(
        note,
        [
          "---",
          "schemaVersion: 1",
          `title: "Deploy ${family} keys\u202E"`,
          "type: knowledge-note",
          "created: 2026-08-10",
          "tags: [dev]",
          "summary: A title that must survive one screen and not the other.",
          "stage: emerging",
          "author: agent",
          "reviewed: null",
          "---",
          "",
          "Body.",
          "",
        ].join("\n"),
      );
      await runCli(sandbox, ["brain", "reindex"]);

      const found = await runCli(sandbox, ["brain", "search", "deploy"]);
      expect(found.exitCode, found.stderr).toBe(EXIT_CODES.success);
      expect(found.stdout).toContain(family);
      expect(found.stdout).not.toContain("\u202E");
    });
  });

  it("preserves every vault artifact through uninstall", async () => {
    await withInstalled(async (sandbox) => {
      await runCli(sandbox, ["brain", "reindex"]);
      const before = await inventory(sandbox.brain);

      const removed = await runJson<UninstallResultV1>(sandbox, [
        "uninstall",
        "--yes",
        "--json",
      ]);
      expect(removed.exitCode).toBe(EXIT_CODES.success);
      expect(
        okData(removed.result).removed.filter((path) =>
          path.startsWith(sandbox.brain),
        ),
      ).toStrictEqual([]);

      /**
       * Byte for byte, including the four generated artifacts. They are
       * manifest-owned, so what preserves them is `uninstall`'s location rule
       * rather than the absence of a record — which is the half that would
       * silently stop working.
       */
      expect(await inventory(sandbox.brain)).toStrictEqual(before);
    });
  });

  it("survives uninstall, reinstall, and another reindex", async () => {
    /**
     * The sequence that used to wedge `reindex` permanently: uninstall deletes
     * the manifest and preserves the vault, so the next reindex meets four
     * artifacts nobody owns.
     */
    await withInstalled(async (sandbox) => {
      await runCli(sandbox, ["brain", "reindex"]);
      await runCli(sandbox, ["uninstall", "--yes"]);
      expect((await runCli(sandbox, ["init", "--yes"])).exitCode).toBe(
        EXIT_CODES.success,
      );

      const again = await runCli(sandbox, ["brain", "reindex"]);
      expect(again.exitCode, again.stderr).toBe(EXIT_CODES.success);
      expect((await runCli(sandbox, ["brain", "lint"])).exitCode).toBe(
        EXIT_CODES.success,
      );
    });
  });
});
