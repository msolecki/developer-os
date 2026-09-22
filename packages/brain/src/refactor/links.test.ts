import { describe, expect, it } from "vitest";

import { buildIndex, createLinkResolver, extractLinks, findWikilinks } from "../indexes/index.js";
import type { IndexBuildRequest, IndexBuildResult } from "../indexes/index.js";
import { DEFAULT_BRAIN_CONFIG } from "../schema/config.js";
import { rewriteWikilinks, withoutAnchor } from "./links.js";

/** Notes keyed by content-root-relative path; an in-memory vault like `indexes/build.test.ts` uses. */
function buildFromNotes(notes: Record<string, string>): Promise<IndexBuildResult> {
  const files = Object.fromEntries(
    Object.entries(notes).map(([path, text]) => [`content/${path}`, text]),
  );
  const tree = new Map<string, { name: string; dir: boolean }[]>();
  for (const vaultPath of Object.keys(files)) {
    const segments = vaultPath.split("/");
    for (let i = 0; i < segments.length; i += 1) {
      const parent = `/vault${i === 0 ? "" : `/${segments.slice(0, i).join("/")}`}`;
      const entry = { name: segments[i] as string, dir: i < segments.length - 1 };
      const siblings = tree.get(parent) ?? [];
      if (!siblings.some((s) => s.name === entry.name)) siblings.push(entry);
      tree.set(parent, siblings);
    }
  }
  const request: IndexBuildRequest = {
    vaultRoot: "/vault",
    config: DEFAULT_BRAIN_CONFIG,
    reader: {
      readDir: (path: string) =>
        Promise.resolve(
          (tree.get(path) ?? []).map((e) => ({
            name: e.name,
            isDirectory: e.dir,
            isFile: !e.dir,
            isSymbolicLink: false,
          })),
        ),
    },
    readFile: (path: string) => {
      const text = files[path.replace("/vault/", "")];
      return text === undefined
        ? Promise.reject(new Error(`no such fixture file: ${path}`))
        : Promise.resolve(text);
    },
    assertReadable: () => Promise.resolve(),
    now: () => "2026-08-04T00:00:00.000Z",
  };
  return buildIndex(request);
}

function note(fields: Record<string, string | readonly string[]>, body = "Body.\n"): string {
  const merged: Record<string, string | readonly string[]> = {
    schemaVersion: "1",
    title: "A note",
    type: "knowledge-note",
    created: "2026-01-01",
    tags: ["dev"],
    summary: "A summary.",
    stage: "established",
    author: "human",
    reviewed: "2026-01-01",
    ...fields,
  };
  const lines = Object.entries(merged).map(
    ([k, v]) => `${k}: ${typeof v === "string" ? v : `[${v.join(", ")}]`}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

describe("findWikilinks", () => {
  it("finds exactly the links extractLinks counts, in order", () => {
    const bodies = [
      "see [[A]] and [[DEV/b#h|shown]]",
      "```\n[[in-fence]]\n```\n[[after]]",
      "`[[inline]]` then [[real]]",
      "[[outer [[inner]]",
    ];
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(
        findWikilinks(body)
          .map((o) => o.text.trim())
          .filter((t) => t.length > 0),
      ).toStrictEqual([...extractLinks(body)]);
    }
  });

  it("carries anchor and display in the tail and offsets that slice back to the link", () => {
    const body = "x [[DEV/b#h|shown]] y";
    const [o] = findWikilinks(body);
    expect(o).toStrictEqual({ index: 2, length: 17, text: "DEV/b", tail: "#h|shown" });
    expect(body.slice(o?.index ?? -1, (o?.index ?? -1) + (o?.length ?? 0))).toBe("[[DEV/b#h|shown]]");
  });

  it("keeps offsets aligned after an astral character inside masked code", () => {
    const body = "`\u{1F600}` [[after]]";
    const [o] = findWikilinks(body);
    expect(body.slice(o?.index ?? -1, (o?.index ?? -1) + (o?.length ?? 0))).toBe("[[after]]");
  });
});

describe("rewriteWikilinks", () => {
  it("rewrites only what decide returns and counts it", () => {
    const out = rewriteWikilinks("[[a]] [[b|d]] `[[a]]`", (o) =>
      o.text === "a" ? `[[z${o.tail}]]` : null,
    );
    expect(out).toStrictEqual({ body: "[[z]] [[b|d]] `[[a]]`", rewritten: 1 });
  });
});

describe("createLinkResolver", () => {
  it("resolves through the same tiers as the index", async () => {
    const build = await buildFromNotes({
      "DEV/b.md": note({ title: "Bee", aliases: ["bee-alias"] }),
    });
    const resolve = createLinkResolver(build.index.notes, "content");
    // "b": the bare-basename tier strips .md
    for (const text of ["DEV/b", "DEV/b.md", "b", "Bee", "bee-alias", "bee"]) {
      expect(resolve(text)).toBe("content/DEV/b.md");
    }
    expect(resolve("nothing")).toBeNull();
  });
});

describe("withoutAnchor", () => {
  it.each([
    ["#h|d", "|d"],
    ["#h", ""],
    ["|d", "|d"],
    ["", ""],
  ])("withoutAnchor(%s) is %s", (tail, expected) => {
    expect(withoutAnchor(tail)).toBe(expected);
  });
});
