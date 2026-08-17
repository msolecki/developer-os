import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { EXIT_CODES } from "@developer-os/core";
import type { ExitCode } from "@developer-os/core";

import { afterEach, describe, expect, it } from "vitest";

import { writeIndexArtifacts } from "./reindex.js";
import type { IndexWriteRequest } from "./reindex.js";
import { createCommandFixture, removeCommandFixtures } from "./testing.js";

afterEach(removeCommandFixtures);

type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.success>;

class TestRefusal extends Error {
  constructor(
    readonly code: FailureExitCode,
    message: string,
    readonly paths: readonly string[] = [],
    readonly recovery?: string,
  ) {
    super(message);
    this.name = "TestRefusal";
  }
}

/**
 * A minimal, realistic `IndexWriteRequest`: one generated artifact, vault-
 * relative paths built the same way both real callers (`brain.ts`, `ingest.ts`)
 * build them — `contentRoot` and `indexesDir` are independent fields, not one
 * re-split from the other.
 */
function requestFor(vaultRoot: string): IndexWriteRequest {
  return {
    vaultRoot,
    contentRoot: "content",
    indexesDir: "content/_indexes",
    files: { "content/_indexes/index.json": '{"schemaVersion":1}' },
    kind: "test-reindex",
    refuse: (message, paths) =>
      new TestRefusal(EXIT_CODES.operationalFailure, message, paths),
    refuseIndexEscape: (message, paths) =>
      new TestRefusal(
        EXIT_CODES.securityRefusal,
        message,
        paths,
        "restore the index directory inside the vault's content root; nothing is read or written through an index path that leaves it",
      ),
  };
}

/**
 * **Driven at the `writeIndexArtifacts` level, with a synthetic artifact in place of a
 * real `BrainService` build**, the way `ingest.ts` and `brain.ts` call it. That keeps this
 * suite about the artifact-writing containment rules rather than about discovery.
 *
 * **The reason this docblock used to give is no longer true, and the correction matters.**
 * It said `BrainService`'s own note discovery refuses *any* content root reached through
 * a symlink, so driving the full command would fail upstream for an unrelated reason. That
 * guard was the subject of `BACKLOG.md` §1 NEW-22 and was removed on 2026-08-17 — a
 * symlinked content root is now supported, on the founder's decision. **A reader is no
 * longer talked out of the end-to-end case**, and it exists: `brain.test.ts`'s
 * `reindexes a vault whose content is a symlink to a vault elsewhere` drives `runBrain`
 * against exactly this layout, and reddens if the refusal comes back.
 */
describe("writeIndexArtifacts, content symlinked to a vault elsewhere", () => {
  it("succeeds when the brain's content directory is a symlink to a directory outside the brain root", async () => {
    const fixture = await createCommandFixture("reindex-symlinked-content");
    await nodeFs.mkdir(fixture.paths.brain, { recursive: true, mode: 0o700 });

    const elsewhere = join(fixture.root, "elsewhere-vault");
    await nodeFs.mkdir(elsewhere, { recursive: true, mode: 0o700 });
    const content = join(fixture.paths.brain, "content");
    await nodeFs.symlink(elsewhere, content);

    const transactionId = await writeIndexArtifacts(
      fixture.context,
      requestFor(fixture.paths.brain),
    );

    expect(transactionId.length).toBeGreaterThan(0);
    expect((await nodeFs.lstat(content)).isSymbolicLink()).toBe(true);
    expect(
      await nodeFs.readFile(join(elsewhere, "_indexes", "index.json"), "utf8"),
    ).toBe('{"schemaVersion":1}');
  });

  it("still refuses a symlink that escapes the content root itself", async () => {
    const fixture = await createCommandFixture("reindex-symlinked-indexes");
    await nodeFs.mkdir(join(fixture.paths.brain, "content"), {
      recursive: true,
      mode: 0o700,
    });

    const stolen = join(fixture.root, "stolen-indexes");
    await nodeFs.mkdir(stolen, { recursive: true, mode: 0o700 });
    await nodeFs.symlink(
      stolen,
      join(fixture.paths.brain, "content", "_indexes"),
    );

    await expect(
      writeIndexArtifacts(fixture.context, requestFor(fixture.paths.brain)),
    ).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
    expect(await nodeFs.readdir(stolen)).toStrictEqual([]);
  });
});
