import { SecurityRefusalError } from "@developer-os/security";
import { describe, expect, it } from "vitest";

import { DEFAULT_BRAIN_CONFIG } from "../schema/config.js";
import { compareCanonical, compareRawBytes, discoverNotes } from "./discover.js";
import type { DirectoryEntry, DirectoryReader } from "./discover.js";

/**
 * Tree notation: a trailing `/` is a directory, a trailing `@` is a symlink,
 * anything else is a regular file. Neither suffix can collide with a name in
 * these fixtures, and an in-memory reader is what lets Task 4 reuse the same
 * trees under a hostile ordering.
 */
function readerFor(
  tree: Record<string, readonly string[]>,
  reverse = false,
): DirectoryReader {
  return {
    readDir(path: string): Promise<readonly DirectoryEntry[]> {
      const names = tree[path] ?? [];
      const entries = names.map((name) => ({
        name: name.replace(/[/@]$/u, ""),
        isDirectory: name.endsWith("/"),
        isFile: !name.endsWith("/") && !name.endsWith("@"),
        isSymbolicLink: name.endsWith("@"),
      }));
      return Promise.resolve(reverse ? [...entries].reverse() : entries);
    },
  };
}

function recording(base: DirectoryReader, log: string[]): DirectoryReader {
  return {
    readDir(path: string) {
      log.push(path);
      return base.readDir(path);
    },
  };
}

const VAULT = "/vault";
const TREE: Record<string, readonly string[]> = {
  "/vault": ["content/", ".obsidian/"],
  "/vault/content": [
    "DEV/",
    "PROJECTS/",
    "_raw/",
    "_indexes/",
    "templates/",
    "Scratch/",
  ],
  "/vault/content/DEV": ["caching.md", "notes.txt"],
  "/vault/content/PROJECTS": ["alpha.md"],
  "/vault/content/_raw": ["secret.md"],
  "/vault/content/_indexes": ["index.json"],
  "/vault/content/templates": ["note.md"],
  "/vault/content/Scratch": ["draft.md"],
  "/vault/.obsidian": ["app.json"],
};

const request = {
  vaultRoot: VAULT,
  config: DEFAULT_BRAIN_CONFIG,
  assertReadable: async (): Promise<void> => {},
};

describe("discoverNotes", () => {
  it("returns only Markdown under configured topic folders", async () => {
    const result = await discoverNotes({ ...request, reader: readerFor(TREE) });
    expect(result.notes.map((note) => note.vaultPath)).toEqual([
      "content/DEV/caching.md",
      "content/PROJECTS/alpha.md",
    ]);
  });

  it("never opens a private folder or an Obsidian internal", async () => {
    const read: string[] = [];
    const result = await discoverNotes({
      ...request,
      reader: recording(readerFor(TREE), read),
    });

    const paths = result.notes.map((note) => note.vaultPath).join(" ");
    expect(paths).not.toContain("_raw");
    expect(paths).not.toContain("_indexes");
    expect(paths).not.toContain("templates");

    /**
     * Absence from the output is the weaker half. A private folder that is
     * enumerated and then filtered has still been opened, and `_raw` is where
     * quarantined captures live — the excluded folders must never be read at
     * all, which only the reader's own call log can prove.
     */
    expect(read).not.toContain("/vault/content/_raw");
    expect(read).not.toContain("/vault/content/_indexes");
    expect(read).not.toContain("/vault/content/templates");
    /** Discovery starts at `contentRoot`; the vault root is never enumerated. */
    expect(read).not.toContain("/vault");
    expect(read).toContain("/vault/content/DEV");
  });

  it("excludes a private folder nested inside a topic folder, at any depth", async () => {
    /**
     * Spec §5 excludes these names "at any depth". Checking only directly under
     * `contentRoot` lets `content/DEV/_raw/` be enumerated, opened and indexed,
     * which is the quarantined-capture leak deny-by-default exists to stop.
     */
    const read: string[] = [];
    const tree = {
      "/vault": ["content/"],
      "/vault/content": ["DEV/"],
      "/vault/content/DEV": [
        "ok.md",
        "_raw/",
        "_outputs/",
        "_graveyard/",
        "templates/",
        "_indexes/",
        ".hidden/",
      ],
      "/vault/content/DEV/_raw": ["quarantined.md"],
      "/vault/content/DEV/_outputs": ["draft.md"],
      "/vault/content/DEV/_graveyard": ["dead.md"],
      "/vault/content/DEV/templates": ["skeleton.md"],
      "/vault/content/DEV/_indexes": ["nested.md"],
      "/vault/content/DEV/.hidden": ["secret.md"],
    };

    const result = await discoverNotes({
      ...request,
      reader: recording(readerFor(tree), read),
    });

    expect(result.notes.map((note) => note.vaultPath)).toEqual([
      "content/DEV/ok.md",
    ]);
    for (const excluded of [
      "/vault/content/DEV/_raw",
      "/vault/content/DEV/_outputs",
      "/vault/content/DEV/_graveyard",
      "/vault/content/DEV/templates",
      "/vault/content/DEV/_indexes",
      "/vault/content/DEV/.hidden",
    ]) {
      expect(read).not.toContain(excluded);
    }
  });

  it("discovers a note nested in a subdirectory of a topic folder", async () => {
    /**
     * Spec §5 defines canonical notes as `<contentRoot>/<topicFolder>/**‍/*.md`.
     * Without this case an implementation that read only the top level of each
     * topic folder ships green.
     */
    const result = await discoverNotes({
      ...request,
      reader: readerFor({
        "/vault": ["content/"],
        "/vault/content": ["DEV/"],
        "/vault/content/DEV": ["top.md", "sub/"],
        "/vault/content/DEV/sub": ["deep.md", "deeper/"],
        "/vault/content/DEV/sub/deeper": ["deepest.md"],
      }),
    });

    expect(result.notes).toEqual([
      {
        vaultPath: "content/DEV/sub/deep.md",
        absolutePath: "/vault/content/DEV/sub/deep.md",
        topicFolder: "DEV",
      },
      {
        vaultPath: "content/DEV/sub/deeper/deepest.md",
        absolutePath: "/vault/content/DEV/sub/deeper/deepest.md",
        topicFolder: "DEV",
      },
      {
        vaultPath: "content/DEV/top.md",
        absolutePath: "/vault/content/DEV/top.md",
        topicFolder: "DEV",
      },
    ]);
  });

  it("reports an unconfigured folder instead of indexing it", async () => {
    const result = await discoverNotes({ ...request, reader: readerFor(TREE) });
    expect(result.unclassifiedFolders).toEqual(["content/Scratch"]);
  });

  it("sorts more than one unclassified folder", async () => {
    /** With a single entry the sort is a no-op and pins nothing. */
    const result = await discoverNotes({
      ...request,
      reader: readerFor({
        "/vault": ["content/"],
        "/vault/content": ["Zebra/", "Alpha/", "Mango/"],
        "/vault/content/Zebra": [],
        "/vault/content/Alpha": [],
        "/vault/content/Mango": [],
      }),
    });
    expect(result.unclassifiedFolders).toEqual([
      "content/Alpha",
      "content/Mango",
      "content/Zebra",
    ]);
  });

  it("produces identical output under a reversed directory reader", async () => {
    const forward = await discoverNotes({ ...request, reader: readerFor(TREE) });
    const reverse = await discoverNotes({
      ...request,
      reader: readerFor(TREE, true),
    });
    expect(reverse).toEqual(forward);
  });

  it("orders two names that differ only in normalization totally", async () => {
    /**
     * Both files fold to one NFC `vaultPath`, so a sort keyed on `vaultPath`
     * alone returns 0 and leaves their order to the reader — the one input that
     * makes the reversed-reader gate pass by luck rather than by construction.
     */
    const nfd = "cafe\u0301.md";
    const nfc = "caf\u00e9.md";
    expect(nfd).not.toBe(nfc);
    expect(nfd.normalize("NFC")).toBe(nfc);

    const tree = {
      "/vault": ["content/"],
      "/vault/content": ["DEV/"],
      "/vault/content/DEV": [nfd, nfc],
    };
    const forward = await discoverNotes({ ...request, reader: readerFor(tree) });
    const reverse = await discoverNotes({
      ...request,
      reader: readerFor(tree, true),
    });

    expect(forward.notes.map((note) => note.vaultPath)).toEqual([
      "content/DEV/caf\u00e9.md",
      "content/DEV/caf\u00e9.md",
    ]);
    expect(reverse).toEqual(forward);
  });

  it("calls assertReadable for every discovered note and for nothing else", async () => {
    const checked: string[] = [];
    const result = await discoverNotes({
      ...request,
      reader: readerFor(TREE),
      assertReadable: (path: string) => {
        checked.push(path);
        return Promise.resolve();
      },
    });

    expect(checked.length).toBeGreaterThan(0);
    expect([...checked].sort()).toEqual(
      result.notes.map((note) => note.absolutePath).sort(),
    );
  });

  it("propagates an assertReadable refusal instead of skipping the note", async () => {
    await expect(
      discoverNotes({
        ...request,
        reader: readerFor(TREE),
        assertReadable: (path: string) =>
          path.endsWith("caching.md")
            ? Promise.reject(new SecurityRefusalError("unreadable"))
            : Promise.resolve(),
      }),
    ).rejects.toThrow(SecurityRefusalError);
  });

  it("resolves a topic alias without renaming anything", async () => {
    const tree = {
      "/vault": ["content/"],
      "/vault/content": ["PROJEKTY/"],
      "/vault/content/PROJEKTY": ["alpha.md"],
    };
    const result = await discoverNotes({
      ...request,
      config: { ...DEFAULT_BRAIN_CONFIG, topicAliases: { PROJEKTY: "PROJECTS" } },
      reader: readerFor(tree),
    });
    expect(result.notes).toEqual([
      {
        vaultPath: "content/PROJEKTY/alpha.md",
        absolutePath: "/vault/content/PROJEKTY/alpha.md",
        topicFolder: "PROJECTS",
      },
    ]);
    expect(result.unclassifiedFolders).toEqual([]);
  });

  it("reads a topic alias only from the map's own keys", async () => {
    /**
     * An inherited `Scratch -> DEV` mapping. A plain `topicAliases[name]` lookup
     * walks the prototype chain and would index an unconfigured folder as DEV;
     * an own-key lookup reports it unclassified. Both branches end in a defined
     * string, so nothing downstream distinguishes them — this test is the only
     * thing standing between the two.
     */
    const inherited = Object.create({
      Scratch: "DEV",
    }) as Record<string, string>;

    const result = await discoverNotes({
      ...request,
      config: { ...DEFAULT_BRAIN_CONFIG, topicAliases: inherited },
      reader: readerFor({
        "/vault": ["content/"],
        "/vault/content": ["Scratch/"],
        "/vault/content/Scratch": ["draft.md"],
      }),
    });

    expect(result.notes).toEqual([]);
    expect(result.unclassifiedFolders).toEqual(["content/Scratch"]);
  });

  it("normalizes a decomposed filename to NFC", async () => {
    /**
     * Escaped rather than typed. A composed literal would let this case pass
     * against an implementation that normalizes nothing, and a decomposed one
     * typed literally survives only until an editor normalizes this source
     * file. The escapes make the input NFD independently of how the file is
     * stored. Three letters carry a combining acute (U+0301); U+0142 has no
     * decomposition. This is the form a macOS volume hands back.
     */
    const decomposed = "zaz\u0301o\u0301\u0142c\u0301.md";
    expect(decomposed.normalize("NFC")).not.toBe(decomposed);

    const result = await discoverNotes({
      ...request,
      reader: readerFor({
        "/vault": ["content/"],
        "/vault/content": ["DEV/"],
        "/vault/content/DEV": [decomposed],
      }),
    });

    expect(result.notes[0]?.vaultPath).toBe(
      `content/DEV/${decomposed.normalize("NFC")}`,
    );
    expect(result.notes[0]?.vaultPath.normalize("NFC")).toBe(
      result.notes[0]?.vaultPath,
    );

    /**
     * The absolute path keeps the on-disk bytes. Normalizing it too would build
     * a path that does not open on a volume storing the decomposed form.
     */
    expect(result.notes[0]?.absolutePath).toBe(
      `/vault/content/DEV/${decomposed}`,
    );
  });

  it("normalizes a decomposed contentRoot before interpolating it", async () => {
    /**
     * Every entry name is folded to NFC. Leaving the configured root raw emits
     * a vault path that is not in NFC, so two machines whose config files
     * differ only in normalization disagree on the index bytes.
     */
    const root = "conte\u0301nt";
    const result = await discoverNotes({
      ...request,
      config: { ...DEFAULT_BRAIN_CONFIG, contentRoot: root },
      reader: readerFor({
        [`/vault/${root}`]: ["DEV/"],
        [`/vault/${root}/DEV`]: ["a.md"],
      }),
    });

    expect(result.notes[0]?.vaultPath).toBe("cont\u00e9nt/DEV/a.md");
    expect(result.notes[0]?.vaultPath.normalize("NFC")).toBe(
      result.notes[0]?.vaultPath,
    );
  });

  it("skips a symlink that resolves inside the vault rather than indexing it", async () => {
    const result = await discoverNotes({
      ...request,
      reader: readerFor({
        "/vault": ["content/"],
        "/vault/content": ["DEV/"],
        "/vault/content/DEV": ["caching.md", "alias.md@"],
      }),
      canonicalize: (path: string) =>
        Promise.resolve(
          path === "/vault/content/DEV/alias.md"
            ? "/vault/content/DEV/caching.md"
            : path,
        ),
    });

    /**
     * A link and its target are one file. Indexed as two notes they carry one
     * content hash, which surfaces as a duplicate finding nobody can act on.
     */
    expect(result.notes.map((note) => note.vaultPath)).toEqual([
      "content/DEV/caching.md",
    ]);
  });

  it("refuses a symlink that escapes the vault", async () => {
    await expect(
      discoverNotes({
        ...request,
        reader: readerFor({
          "/vault": ["content/"],
          "/vault/content": ["DEV/"],
          "/vault/content/DEV": ["escape.md@"],
        }),
        canonicalize: (path: string) =>
          Promise.resolve(
            path === "/vault/content/DEV/escape.md" ? "/etc/passwd" : path,
          ),
      }),
    ).rejects.toThrow(SecurityRefusalError);
  });

  it("refuses a topic folder that is a symlink escaping the vault", async () => {
    /**
     * `readdir` reports a symlink with `isDirectory: false`, so a `continue` on
     * "not a directory" placed before the link check drops this entry before
     * the security branch ever sees it — silently, with no note and no refusal.
     */
    await expect(
      discoverNotes({
        ...request,
        reader: readerFor({
          "/vault": ["content/"],
          "/vault/content": ["PROJECTS@"],
        }),
        canonicalize: (path: string) =>
          Promise.resolve(
            path === "/vault/content/PROJECTS" ? "/etc" : path,
          ),
      }),
    ).rejects.toThrow(SecurityRefusalError);
  });

  it("reports a symlinked topic folder instead of dropping it", async () => {
    /**
     * It is descended into by nobody, so without this it reaches neither
     * `notes` nor `unclassifiedFolders` and the information is destroyed here.
     * Lint sees only the build result, so no later task can recover it.
     */
    const result = await discoverNotes({
      ...request,
      reader: readerFor({
        "/vault": ["content/"],
        "/vault/content": ["PROJECTS@", "DEV/"],
        "/vault/content/DEV": ["a.md"],
      }),
      canonicalize: (path: string) =>
        Promise.resolve(
          path === "/vault/content/PROJECTS"
            ? "/vault/content/DEV"
            : path,
        ),
    });

    expect(result.symlinkedFolders).toEqual(["content/PROJECTS"]);
    expect(result.notes.map((note) => note.vaultPath)).toEqual([
      "content/DEV/a.md",
    ]);
    expect(result.unclassifiedFolders).toEqual([]);
  });

  it("does not treat a regular file as excluded because it matches indexesDir", async () => {
    /**
     * `indexesDir` is a user-supplied path segment and `notes.md` is a legal
     * one. Matching the folder-name rule against files silently drops every
     * note of that name, at every depth.
     */
    const result = await discoverNotes({
      ...request,
      config: { ...DEFAULT_BRAIN_CONFIG, indexesDir: "notes.md" },
      reader: readerFor({
        "/vault": ["content/"],
        "/vault/content": ["DEV/"],
        "/vault/content/DEV": ["notes.md", "other.md"],
      }),
    });

    expect(result.notes.map((note) => note.vaultPath)).toEqual([
      "content/DEV/notes.md",
      "content/DEV/other.md",
    ]);
  });

  it("reports one finding for two folders that differ only in normalization", async () => {
    const result = await discoverNotes({
      ...request,
      reader: readerFor({
        "/vault": ["content/"],
        "/vault/content": ["Scra\u0301tch/", "Scr\u00e1tch/"],
        "/vault/content/Scra\u0301tch": [],
      }),
    });

    /** One directory, as far as the NFC vault path is concerned. */
    expect(result.unclassifiedFolders).toEqual(["content/Scr\u00e1tch"]);
  });

  it("refuses a relative vaultRoot rather than resolving it against cwd", async () => {
    await expect(
      discoverNotes({
        ...request,
        vaultRoot: "relative/vault",
        reader: readerFor({ "relative/vault/content": [] }),
      }),
    ).rejects.toThrow(SecurityRefusalError);
  });

  it("refuses a content root that resolves outside the vault", async () => {
    /**
     * A symlinked `content` is never reported by `readdir` — the walk starts
     * inside it — so nothing below would notice. Unchecked, a link to another
     * vault is enumerated in full and indexed as the user's own.
     */
    const read: string[] = [];
    await expect(
      discoverNotes({
        ...request,
        reader: recording(
          readerFor({
            "/vault/content": ["DEV/"],
            "/vault/content/DEV": ["a.md"],
          }),
          read,
        ),
        canonicalize: (path: string) =>
          Promise.resolve(
            path === "/vault/content" ? "/elsewhere/vault/content" : path,
          ),
      }),
    ).rejects.toThrow(SecurityRefusalError);

    /** Refused before anything is read, per spec §5. */
    expect(read).toEqual([]);
  });
});

describe("compareCanonical", () => {
  it("orders by UTF-8 bytes, not by locale collation", () => {
    /**
     * The discriminating pair. Byte order puts `B` (0x42) before `a` (0x61);
     * every locale-aware collation puts `a` first. `compareCanonical` is the
     * comparator behind every array in `index.json`, so a `localeCompare`
     * implementation would make the index depend on the machine's locale — the
     * thing spec §6.1 forbids.
     */
    expect(compareCanonical("B", "a")).toBeLessThan(0);
    expect("B".localeCompare("a")).toBeGreaterThan(0);
  });

  it("treats the two normalizations of one name as equal", () => {
    expect(compareCanonical("cafe\u0301", "caf\u00e9")).toBe(0);
  });

  it("has a raw-byte counterpart that separates what it deliberately cannot", () => {
    /**
     * Exported because Task 4 re-sorts notes by `path` and hits the same tie.
     * A module-private tie-break would leave Task 4 reaching for
     * `compareCanonical` and reintroducing the non-total order this pair exists
     * to prevent.
     */
    const nfd = "cafe\u0301";
    const nfc = "caf\u00e9";
    expect(compareCanonical(nfd, nfc)).toBe(0);
    expect(compareRawBytes(nfd, nfc)).not.toBe(0);
  });

  it("is antisymmetric and reflexive over a mixed set", () => {
    const names = ["B", "a", "_raw", "\u00e9", "e\u0301x", "Z", "0"];
    for (const left of names) {
      expect(compareCanonical(left, left)).toBe(0);
      for (const right of names) {
        /** Summed rather than negated: `Object.is(0, -0)` is false. */
        expect(
          Math.sign(compareCanonical(left, right)) +
            Math.sign(compareCanonical(right, left)),
        ).toBe(0);
      }
    }
  });
});
