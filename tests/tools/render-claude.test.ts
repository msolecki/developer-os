import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertRepositoryRoot, regenerate } from "./render-claude.js";

/**
 * The regenerator is the one place in this repository that deletes a directory
 * recursively, and it shipped with no test at all. The guard it shipped with
 * checked that the target path ended with `plugins/claude`, which the
 * expression building that path already guaranteed — so it could not throw for
 * any working directory, and a decoy directory entered directly with `node`
 * lost files. Found by fresh-context review, 2026-08-11.
 */
describe("assertRepositoryRoot", () => {
  const root = resolve("/synthetic/checkout");

  it("accepts the checkout the tool was built into", () => {
    expect(() => {
      assertRepositoryRoot(root, root);
    }).not.toThrow();
  });

  it("accepts a path that differs only in how it is spelled", () => {
    expect(() => {
      assertRepositoryRoot(join(root, "packages", ".."), root);
    }).not.toThrow();
  });

  it("refuses any other directory, however plausible", () => {
    for (const elsewhere of [
      resolve("/"),
      resolve("/synthetic/decoy"),
      join(root, "packages"),
      resolve(root, ".."),
    ]) {
      expect(
        () => {
          assertRepositoryRoot(elsewhere, root);
        },
        `${elsewhere} must be refused`,
      ).toThrow(/refusing to regenerate/u);
    }
  });

  it("names both directories, so the refusal is actionable", () => {
    expect(() => {
      assertRepositoryRoot(resolve("/synthetic/decoy"), root);
    }).toThrow(/decoy[\s\S]*checkout/u);
  });
});

/**
 * The guard as a pure function proves nothing about the tool. Deleting the
 * `assertRepositoryRoot` call from `regenerate` left the four cases above
 * green while restoring exactly the behaviour that lost a decoy directory's
 * files — so these two drive the real function, against a temporary tree, and
 * pin the order: refuse *before* the delete. Found by fresh-context review,
 * 2026-08-11.
 */
describe("regenerate", () => {
  const temporaries: string[] = [];

  async function decoy(): Promise<{ root: string; generated: string; kept: string }> {
    const root = await mkdtemp(join(tmpdir(), "developer-os-render-"));
    temporaries.push(root);
    const generated = join(root, "plugins", "claude");
    await mkdir(generated, { recursive: true });
    const kept = join(generated, "important.txt");
    await writeFile(kept, "PRECIOUS", "utf8");
    return { root, generated, kept };
  }

  afterEach(async () => {
    for (const root of temporaries.splice(0)) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses before deleting anything when the working directory is not the checkout", async () => {
    const { root, generated, kept } = await decoy();
    await expect(
      regenerate({
        workingDirectory: root,
        repositoryRoot: resolve("/synthetic/checkout"),
        generatedRoot: generated,
      }),
    ).rejects.toThrow(/refusing to regenerate/u);
    expect(await readFile(kept, "utf8")).toBe("PRECIOUS");
  });

  it("replaces the tree once the working directory is the checkout", async () => {
    const { root, generated, kept } = await decoy();
    const written = await regenerate({
      workingDirectory: root,
      repositoryRoot: root,
      generatedRoot: generated,
    });
    expect(written).toBeGreaterThan(0);
    expect(await readdir(generated)).not.toContain("important.txt");
    await expect(readFile(kept, "utf8")).rejects.toThrow();
    expect(await readdir(join(generated, "skills"))).toHaveLength(6);
  });
});
