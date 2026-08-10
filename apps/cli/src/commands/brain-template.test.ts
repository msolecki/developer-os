import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BRAIN_TEMPLATE,
  BRAIN_TEMPLATE_DIRECTORIES,
} from "./brain-template.js";

/**
 * `../../../../` holds for both `src/commands/` and the compiled
 * `dist/commands/`, which sit at the same depth below the repository root.
 */
const TEMPLATE_ROOT = fileURLToPath(
  new URL("../../../../templates/brain", import.meta.url),
);

async function walk(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push(relative(TEMPLATE_ROOT, full).split(sep).join("/"));
  }
  return found.sort();
}

describe("the embedded Brain template", () => {
  it("matches templates/brain byte for byte", async () => {
    /**
     * The embedded copy is what ships; `templates/brain/` is what a human
     * reads and reviews. Nothing but this test stops them diverging, and a
     * divergence is invisible — `init` would keep installing the old skeleton
     * while every reviewer read the new one.
     */
    const onDisk = await walk(TEMPLATE_ROOT);
    expect(BRAIN_TEMPLATE.map((file) => file.path)).toEqual(onDisk);
    expect(onDisk.length).toBeGreaterThan(0);

    for (const file of BRAIN_TEMPLATE) {
      const text = await readFile(join(TEMPLATE_ROOT, file.path), "utf8");
      expect(file.content, file.path).toBe(text);
    }
  });

  it("lists every directory its files need, parents before children", () => {
    const needed = new Set<string>();
    for (const file of BRAIN_TEMPLATE) {
      const segments = file.path.split("/");
      for (let i = 1; i < segments.length; i += 1) {
        needed.add(segments.slice(0, i).join("/"));
      }
    }
    expect([...BRAIN_TEMPLATE_DIRECTORIES].sort()).toEqual([...needed].sort());

    /** A child must never be created before its parent. */
    for (const [index, directory] of BRAIN_TEMPLATE_DIRECTORIES.entries()) {
      const parent = directory.split("/").slice(0, -1).join("/");
      if (parent === "") continue;
      expect(BRAIN_TEMPLATE_DIRECTORIES.indexOf(parent)).toBeLessThan(index);
    }
  });

  it("ships a .gitkeep only where a folder would otherwise be empty", () => {
    /**
     * `.gitkeep` exists to make an empty directory survive a clone. Beside a
     * real note it is noise in the user's vault — and each one is another file
     * through the install transaction, which is fsync-bound.
     */
    const paths = BRAIN_TEMPLATE.map((file) => file.path);
    for (const keep of paths.filter((path) => path.endsWith("/.gitkeep"))) {
      const folder = keep.slice(0, -"/.gitkeep".length);
      const siblings = paths.filter(
        (path) => path.startsWith(`${folder}/`) && path !== keep,
      );
      expect(siblings, folder).toEqual([]);
    }
  });

  it("keeps every private folder the folder policy names", () => {
    /**
     * A skeleton missing `_raw/quarantine/` is a skeleton where the first
     * capture has nowhere to land. `.gitkeep` is what makes an empty folder
     * survive a clone.
     */
    const paths = BRAIN_TEMPLATE.map((file) => file.path);
    /** `content/templates/` is excluded: it ships `note.md`, so it is not empty. */
    for (const folder of [
      "content/_raw/quarantine",
      "content/_raw/inbox",
      "content/_raw/processed",
      "content/_outputs",
      "content/_graveyard",
      "content/_indexes",
    ]) {
      expect(paths, folder).toContain(`${folder}/.gitkeep`);
    }
  });

  it("ships one example of every note type, and no more", () => {
    const examples = BRAIN_TEMPLATE.filter(
      (file) => file.path.endsWith(".md") && !file.path.includes("/templates/"),
    );
    const types = examples.map(
      (file) => /^type: (.+)$/mu.exec(file.content)?.[1] ?? "",
    );
    expect(types.sort()).toEqual([
      "compiled-note",
      "knowledge-note",
      "project-note",
      "reference-note",
    ]);
  });

  it("links two examples together so a fresh install has a non-empty graph", () => {
    const links = BRAIN_TEMPLATE.flatMap((file) =>
      [...file.content.matchAll(/\[\[([^\]]+)\]\]/gu)].map((m) => m[1] ?? ""),
    );
    expect(links.length).toBeGreaterThan(0);

    /** Every link must name a note the template actually ships. */
    const basenames = new Set(
      BRAIN_TEMPLATE.map((file) => file.path.replace(/\.md$/u, "")),
    );
    for (const link of links) {
      expect([...basenames].some((path) => path.endsWith(link)), link).toBe(true);
    }
  });

  it("names no real machine, person or address", () => {
    /**
     * Same rule as the fixtures. Asserted by shape rather than by listing the
     * names to avoid — a list of forbidden strings is itself a reference, and
     * the self-containment lint refused this file when it held one.
     */
    const text = BRAIN_TEMPLATE.map((file) => file.content).join("\n");
    expect(text).not.toMatch(/\/Users\/|\/home\/[a-z]/u);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/u);
    expect(text).not.toMatch(/https?:\/\//u);
  });
});
