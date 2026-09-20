import * as nodeFs from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadOrCreateRedactionKey } from "../context.js";
import { runInit } from "../commands/init.js";
import {
  createCommandFixture,
  exists,
  inventoryDigest,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
} from "../commands/testing.js";
import type { CommandFixture } from "../commands/testing.js";
import { runUninstall } from "../commands/uninstall.js";
import { runAbsentManifestUninstall } from "./absent-manifest-uninstall.js";

const ACCEPTED = { dryRun: false, assumeYes: true } as const;
const LEAF = ".lifecycle-bootstrap.lock";
const ALLOCATED_LEAF = /^[.]?(?:tx|lc|ge|le|mf)_[0-9a-f]{64}_(?:0|[1-9][0-9]*)(?:[.]|$)/u;

const keyReads = vi.hoisted(() => ({ path: null as string | null, count: 0 }));

/**
 * `importOriginal` partial rather than a hand-written stub: the whole fresh-`init` graph runs
 * through this module, so an exhaustive replacement would be a latent break on the next export
 * Node adds.
 */
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof nodeFs>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const target: unknown = args[0];
      if (keyReads.path !== null && target === keyReads.path) keyReads.count += 1;
      return actual.readFile(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const target: unknown = args[0];
      if (keyReads.path === null || target !== keyReads.path) return handle;
      return new Proxy(handle, {
        get(target, property, receiver): unknown {
          if (property === "read" || property === "readv" || property === "readFile") {
            return (...call: unknown[]): unknown => {
              keyReads.count += 1;
              const member = Reflect.get(target, property) as (...rest: unknown[]) => unknown;
              return member.apply(target, call);
            };
          }
          const value: unknown = Reflect.get(target, property, receiver);
          return typeof value === "function" ? (value as () => unknown).bind(target) : value;
        },
      });
    },
  };
});

function spyOnKeyContentReads(fixture: CommandFixture): () => number {
  keyReads.path = join(fixture.paths.stateDir, "redaction.key");
  keyReads.count = 0;
  return () => keyReads.count;
}

async function lifecycleIdLeaves(fixture: CommandFixture): Promise<readonly string[]> {
  const roots = [
    fixture.paths.stateDir,
    join(fixture.paths.stateDir, "lifecycle-journals"),
    join(fixture.paths.stateDir, "git-effect-journals"),
    join(fixture.paths.stateDir, "launchd-effect-journals"),
  ];
  const found: string[] = [];
  for (const root of roots) {
    let names: readonly string[];
    try {
      names = await nodeFs.readdir(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (ALLOCATED_LEAF.test(name)) found.push(join(root, name));
    }
  }
  return found.sort();
}

afterEach(async () => {
  keyReads.path = null;
  await removeCommandFixtures();
});

describe("absent-manifest uninstall over a rolled-back V2 init", () => {
  /**
   * `after_global_lock`, not a later point. A rollback past it retains every ordinary path it
   * created — `config.toml` among them — and §6 then reads that as residue, which D27 refuses;
   * `apps/cli/src/bootstrap/bookkeeping.v2.test.ts` pins the same boundary for reinstall.
   */
  it("deletes an orphaned key after a rolled-back V2 init under the bootstrap leaf, then init succeeds", async () => {
    const fixture = await createCommandFixture("absent-manifest-orphan-key", {
      bootstrapAvailable: true,
      bootstrapFailureAfter: "after_global_lock",
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(false);
    fixture.disableBootstrapFailure();
    loadOrCreateRedactionKey(fixture.paths.stateDir);
    const keyPath = join(fixture.paths.stateDir, "redaction.key");
    const context = fixture.rebuildContext();
    const lifecycle = context.lifecycle;
    if (lifecycle === undefined) throw new Error("the fixture context has no lifecycle capability");
    if (context.bootstrap?.state !== "available") throw new Error("the fixture has no bootstrap");

    const previewed = await runUninstall(context, { dryRun: true, assumeYes: true });
    expect(previewed).toMatchObject({ ok: true, data: { removed: [keyPath], transactionId: null } });
    expect(await exists(keyPath)).toBe(true);

    /**
     * Armed after the evidence inspection, not around the whole command: a rolled-back
     * envelope retains `state` as a directory tree, and `projectRegularEntry`
     * (`apps/cli/src/bootstrap/retention.ts`) hashes every regular file it walks — the
     * orphaned key included. That shipped read predates this arm and is reported as a
     * finding; what §6 binds here is that the arm itself never opens the key for content.
     */
    const evidence = await context.bootstrap.inspectEvidence();
    const countKeyReads = spyOnKeyContentReads(fixture);

    const removed = await runAbsentManifestUninstall({
      context,
      lifecycle,
      options: ACCEPTED,
      evidence,
    });

    expect(removed).toMatchObject({ arm: "key_present", removed: [keyPath], transactionId: null });
    expect(countKeyReads()).toBe(0);
    expect(await exists(keyPath)).toBe(false);
    expect(await exists(join(fixture.paths.stateDir, LEAF))).toBe(true);
    expect(await lifecycleIdLeaves(fixture)).toStrictEqual([]);
    expect(fixture.stableLockEvents).toStrictEqual([]);
    expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);

  it("creates nothing on an empty state and lets init succeed over it", async () => {
    const fixture = await createCommandFixture("absent-manifest-key-absent-init", {
      bootstrapAvailable: true,
    });
    await nodeFs.mkdir(fixture.paths.stateDir, { recursive: true, mode: 0o700 });
    await nodeFs.chmod(fixture.paths.home, 0o700);
    await nodeFs.chmod(fixture.paths.stateDir, 0o700);
    const context = fixture.context;
    const lifecycle = context.lifecycle;
    if (lifecycle === undefined) throw new Error("the fixture context has no lifecycle capability");
    if (context.bootstrap?.state !== "available") throw new Error("the fixture has no bootstrap");
    const before = await inventoryDigest(fixture.root);

    const outcome = await runAbsentManifestUninstall({
      context,
      lifecycle,
      options: ACCEPTED,
      evidence: await context.bootstrap.inspectEvidence(),
    });

    expect(outcome).toMatchObject({ arm: "key_absent", removed: [], transactionId: null });
    expect(await inventoryDigest(fixture.root)).toStrictEqual(before);
    expect((await runInit(fixture.rebuildContext(), ACCEPTED)).ok).toBe(true);
  }, REAL_FILESYSTEM_TIMEOUT_MS);
});
