import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveEditedPath, resolveProjectRoot } from "./project-root.js";

const roots: string[] = [];

async function tree(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-project-root-")));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resolveProjectRoot", () => {
  it("returns the nearest ancestor holding a .git directory", async () => {
    const tmp = await tree();
    await mkdir(join(tmp, "repo", ".git"), { recursive: true });
    await mkdir(join(tmp, "repo", "a", "b"), { recursive: true });
    expect(await resolveProjectRoot(join(tmp, "repo", "a", "b"))).toBe(join(tmp, "repo"));
  });

  it("counts a .git file, as in a worktree", async () => {
    const tmp = await tree();
    await mkdir(join(tmp, "repo", "a"), { recursive: true });
    await writeFile(join(tmp, "repo", ".git"), "gitdir: /synthetic\n");
    expect(await resolveProjectRoot(join(tmp, "repo", "a"))).toBe(join(tmp, "repo"));
  });

  it("returns the canonical cwd when no ancestor holds .git", async () => {
    const tmp = await tree();
    await mkdir(join(tmp, "plain", "a"), { recursive: true });
    const start = join(tmp, "plain", "a");
    expect(await resolveProjectRoot(start)).toBe(start);
  });

  it("refuses a relative cwd and a NUL byte", async () => {
    await expect(resolveProjectRoot("relative/dir")).rejects.toThrow();
    await expect(resolveProjectRoot("/tmp/a\0b")).rejects.toThrow();
  });
});

describe("resolveEditedPath", () => {
  it("resolves a relative path against the project root", async () => {
    const root = await tree();
    expect(await resolveEditedPath(root, ".env")).toBe(join(root, ".env"));
  });

  it("keeps an absolute path", async () => {
    const root = await tree();
    expect(await resolveEditedPath(root, "/abs/x")).toBe("/abs/x");
  });

  it("refuses a NUL byte", async () => {
    const root = await tree();
    await expect(resolveEditedPath(root, "a\0b")).rejects.toThrow();
  });
});
