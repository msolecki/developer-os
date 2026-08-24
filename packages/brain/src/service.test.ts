import { describe, expect, it } from "vitest";

import type { DirectoryEntry, DirectoryReader } from "./discovery/index.js";
import { artifactPaths } from "./indexes/index.js";
import { DEFAULT_BRAIN_CONFIG } from "./schema/config.js";
import { BrainService } from "./service.js";
import type { BrainServiceDependencies } from "./service.js";

const NOW = new Date("2026-08-04T00:00:00.000Z");
const PATHS = artifactPaths(DEFAULT_BRAIN_CONFIG);

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
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n\n${body}`;
}

interface Harness {
  readonly deps: BrainServiceDependencies;
  readonly reads: string[];
}

/**
 * An in-memory vault. `files` is keyed by vault-relative path, so a test can
 * seed the four artifacts exactly as a reindex would have written them.
 */
function harness(files: Record<string, string>): Harness {
  const reads: string[] = [];
  const tree = new Map<string, { name: string; dir: boolean }[]>();
  for (const vaultPath of Object.keys(files)) {
    const segments = vaultPath.split("/");
    for (let i = 0; i < segments.length; i += 1) {
      const parent = `/vault${i === 0 ? "" : `/${segments.slice(0, i).join("/")}`}`;
      const siblings = tree.get(parent) ?? [];
      const name = segments[i] as string;
      if (!siblings.some((entry) => entry.name === name)) {
        siblings.push({ name, dir: i < segments.length - 1 });
      }
      tree.set(parent, siblings);
    }
  }

  const reader: DirectoryReader = {
    readDir: (path: string): Promise<readonly DirectoryEntry[]> =>
      Promise.resolve(
        (tree.get(path) ?? []).map((entry) => ({
          name: entry.name,
          isDirectory: entry.dir,
          isFile: !entry.dir,
          isSymbolicLink: false,
        })),
      ),
  };

  return {
    reads,
    deps: {
      vaultRoot: "/vault",
      config: DEFAULT_BRAIN_CONFIG,
      reader,
      readFile: (path: string) => {
        reads.push(path);
        const text = files[path.replace("/vault/", "")];
        return text === undefined
          ? Promise.reject(new Error(`ENOENT: ${path}`))
          : Promise.resolve(text);
      },
      assertReadable: () => Promise.resolve(),
      canonicalize: (path: string) => Promise.resolve(path),
      now: () => NOW,
    },
  };
}

const VAULT = {
  "content/DEV/a.md": note({ title: "Caching" }, "See [[DEV/b]].\n"),
  "content/DEV/b.md": note({ title: "Testing" }, "Body.\n"),
};

describe("BrainService.reindex", () => {
  it("returns the four artifacts and writes nothing", async () => {
    const { deps } = harness(VAULT);
    const service = new BrainService(deps);
    const artifacts = await service.reindex();

    expect(Object.keys(artifacts.files).sort()).toEqual(
      [PATHS.catalog, PATHS.graph, PATHS.index, PATHS.vaultMap].sort(),
    );
    expect(artifacts.build.index.notes).toHaveLength(2);
  });

  it("has no write channel at all", () => {
    /**
     * The gate is the type literal below, checked by `tsc`, not the runtime
     * assertion. Listing `Object.keys` of the harness only describes the
     * harness: an *optional* `writeFile?` on the dependencies would compile,
     * pass `tsc`, and pass a key check, because the test object never sets it.
     * `Record<keyof BrainServiceDependencies, true>` misses a required property
     * the moment any key is added, optional or not.
     */
    const keys: Record<keyof BrainServiceDependencies, true> = {
      vaultRoot: true,
      config: true,
      reader: true,
      readFile: true,
      assertReadable: true,
      canonicalize: true,
      now: true,
    };
    expect(Object.keys(keys)).not.toContain("writeFile");
  });

  it("produces artifacts at the configured paths", async () => {
    /**
     * Comparing against `renderArtifacts` would be tautological — it is what
     * `reindex` calls. The property that matters, "a clean reindex reports no
     * drift", is pinned by the lint test below; this only checks the paths
     * follow the config rather than being hardcoded.
     */
    const { deps } = harness(VAULT);
    const custom = { ...deps, config: { ...DEFAULT_BRAIN_CONFIG, indexesDir: "_idx" } };
    const artifacts = await new BrainService(custom).reindex();
    expect(Object.keys(artifacts.files).sort()).toEqual([
      "content/_idx/catalog.md",
      "content/_idx/graph.json",
      "content/_idx/index.json",
      "content/_idx/vault-map.md",
    ]);
  });

  it("takes its timestamp from the injected clock only", async () => {
    const { deps } = harness(VAULT);
    const artifacts = await new BrainService(deps).reindex();
    expect(artifacts.build.index.generatedAt).toBe(NOW.toISOString());
  });
});

describe("BrainService.lint", () => {
  it("reports no drift when the artifacts on disk are a clean reindex", async () => {
    const { deps } = harness(VAULT);
    const fresh = await new BrainService(deps).reindex();
    const seeded = harness({ ...VAULT, ...fresh.files });

    const result = await new BrainService(seeded.deps).lint();
    expect(result.findings.filter((f) => f.class === "index-drift")).toEqual([]);
  });

  it("reports every artifact as missing when the vault was never indexed", async () => {
    const { deps } = harness(VAULT);
    const result = await new BrainService(deps).lint();
    expect(
      result.findings.filter((f) => f.class === "index-drift"),
    ).toHaveLength(4);
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it("derives today from the injected clock, not the host's", async () => {
    /**
     * 2026-02-05 is exactly 180 days before the injected clock and fewer than
     * 180 before nothing else. Asserting on a note reviewed years ago proves
     * nothing — it is stale under any clock, so `new Date()` would pass.
     */
    const boundary = { "content/DEV/a.md": note({ reviewed: "2026-02-05" }) };
    const { deps } = harness(boundary);
    const result = await new BrainService(deps).lint();
    expect(result.findings.filter((f) => f.class === "staleness")).toEqual([]);

    const older = { "content/DEV/a.md": note({ reviewed: "2026-02-04" }) };
    const past = await new BrainService(harness(older).deps).lint();
    expect(past.findings.filter((f) => f.class === "staleness")).toHaveLength(1);
  });
});

describe("BrainService.search", () => {
  it("reads the index from disk and never rebuilds it", async () => {
    const { deps } = harness(VAULT);
    const fresh = await new BrainService(deps).reindex();
    const seeded = harness({ ...VAULT, ...fresh.files });

    const result = await new BrainService(seeded.deps).search({
      text: "caching",
      maxCandidates: 10,
    });

    expect(result.kind).toBe("results");
    /**
     * Index-first, per design spec §13.5: the notes themselves are never
     * opened, so a search cannot be slower than reading one file.
     */
    expect(seeded.reads).toEqual([`/vault/${PATHS.index}`]);
  });

  it("says the index is unavailable rather than silently finding nothing", async () => {
    /**
     * A missing index and a genuine miss are different answers and must not
     * look alike — one means "run reindex", the other means "that note is not
     * here". Returning `no-candidates` for both would train the user to
     * disbelieve the second.
     */
    const { deps } = harness(VAULT);
    const result = await new BrainService(deps).search({
      text: "caching",
      maxCandidates: 10,
    });

    expect(result.kind).toBe("index-unavailable");
    if (result.kind !== "index-unavailable") return;
    /** Machine-readable, so Task 9 need not match on English. */
    expect(result.reason).toBe("missing");
    expect(result.message).toContain("brain reindex");
  });

  it("refuses a corrupt index instead of searching a half-parsed one", async () => {
    /**
     * Every case below must reach the check it is written for. Two of these
     * once omitted `contentRoot` and were rejected three lines earlier, so
     * deleting the whole `notes` validation left the test green.
     */
    const head = '"schemaVersion":1,"contentRoot":"content","generatedAt":"2026-01-01T00:00:00.000Z"';
    const note = (extra: string) =>
      `{${head},"notes":[{"path":"content/DEV/a.md","title":"t","summary":"s","stage":"established","type":"knowledge-note","topicFolder":"DEV","reviewed":null,"tags":[],"aliases":[],"terms":[],${extra}}]}`;

    for (const corrupt of [
      "{ not json",
      "[]",
      '{"schemaVersion":2,"notes":[]}',
      `{${head},"notes":"nope"}`,
      `{${head},"notes":[{"path":1}]}`,
      /** Containers of the right type holding the wrong elements. */
      note('"tags":[123]'),
      note('"aliases":[{}]'),
      note('"terms":[null]'),
      note('"terms":["nope"]'),
      note('"terms":[{"term":"x","count":"9"}]'),
      /** A record with the wrong field type: `isRecord` alone waves it past. */
      note('"terms":[{"term":123,"count":1}]'),
      note('"stage":"totally-not-a-stage"'),
    ]) {
      const seeded = harness({ ...VAULT, [PATHS.index]: corrupt });
      const result = await new BrainService(seeded.deps).search({
        text: "caching",
        maxCandidates: 10,
      });
      expect(result.kind).toBe("index-unavailable");
    }
  });

  it("returns no-candidates for a genuine miss against a present index", async () => {
    const { deps } = harness(VAULT);
    const fresh = await new BrainService(deps).reindex();
    const seeded = harness({ ...VAULT, ...fresh.files });
    const result = await new BrainService(seeded.deps).search({
      text: "zzzznotpresent",
      maxCandidates: 10,
    });
    expect(result.kind).toBe("no-candidates");
  });
});

describe("BrainService.status", () => {
  it("reports adoption findings without changing anything", async () => {
    const { deps } = harness(VAULT);
    const report = await new BrainService(deps).status();

    expect(report.schemaVersion).toBe(1);
    expect(report.vaultRoot).toBe("/vault");
    expect(report.topicFolders).toEqual(DEFAULT_BRAIN_CONFIG.topicFolders);
    expect(report.noteCount).toBe(2);
    expect(report.contentRoot).toBe("content");
    expect(report.unclassifiedFolders).toEqual([]);
    expect(report.wouldChange).toEqual([]);
    expect(report.indexPresent).toBe(false);
  });

  it("counts a never-indexed vault as clean adoption, not as drift", async () => {
    /**
     * `indexPresent` is the field for "you have not reindexed yet". Folding the
     * four missing-artifact errors into `wouldChange` would tell a user with a
     * perfectly valid vault that four things are wrong with their notes.
     */
    const { deps } = harness(VAULT);
    const report = await new BrainService(deps).status();
    expect(report.wouldChange).toEqual([]);

    const linted = await new BrainService(deps).lint();
    expect(linted.errorCount).toBeGreaterThan(0);
  });

  it("reports what an unadoptable vault would have to change", async () => {
    const { deps } = harness({
      "content/DEV/broken.md": note({}, "See [[DEV/absent]].\n"),
      "content/DEV/invalid.md": "---\ntitle: only a title\n---\n\nBody.\n",
      "content/Scratch/draft.md": note(),
    });
    const report = await new BrainService(deps).status();

    const classes = new Set(report.wouldChange.map((f) => f.class));
    expect(classes).toContain("links");
    expect(classes).toContain("frontmatter");
    expect(report.unclassifiedFolders).toEqual(["content/Scratch"]);
    expect(classes).not.toContain("index-drift");

    /**
     * Brain architecture former §9's second named example — "folders that are neither configured
     * nor private". It is a `frontmatter` warn, so an error-only filter would
     * drop it while every other assertion here still passed.
     */
    expect(report.wouldChange.map((f) => f.path)).toContain("content/Scratch");
  });

  it("leaves a duplicate title out of adoption but keeps a case collision in", async () => {
    /**
     * Brain architecture former §7 draws this line in one sentence: "Two notes with the same title
     * are a curation question. Two paths that differ only in case are a
     * data-loss question the moment the vault is cloned." The first is a warn
     * and must not block adoption; the second is an error and must.
     */
    const titles = await new BrainService(
      harness({
        "content/DEV/one.md": note({ title: "Caching" }, "one\n"),
        "content/DEV/two.md": note({ title: "caching" }, "two\n"),
      }).deps,
    ).status();
    expect(titles.wouldChange).toEqual([]);

    const collision = await new BrainService(
      harness({
        "content/DEV/Note.md": note({ title: "Upper" }, "one\n"),
        "content/DEV/note.md": note({ title: "Lower" }, "two\n"),
      }).deps,
    ).status();
    expect(
      collision.wouldChange.filter((f) => f.class === "duplicates"),
    ).toHaveLength(2);
  });

  it("leaves curation out of adoption", async () => {
    /**
     * An agent-written note nobody has reviewed, and a note reviewed long ago,
     * are both perfectly valid. Brain architecture former §9 defines adoption as "what would have to
     * change for it to validate" — a judgement about the vault's shape, not
     * about its housekeeping.
     */
    const { deps } = harness({
      "content/DEV/a.md": note({ author: "agent", reviewed: "null" }),
      "content/DEV/b.md": note({ title: "Old", reviewed: "2020-01-01" }),
    });
    const report = await new BrainService(deps).status();
    const linted = await new BrainService(deps).lint();

    expect(report.wouldChange).toEqual([]);
    expect(linted.findings.some((f) => f.class === "provenance")).toBe(true);
    expect(linted.findings.some((f) => f.class === "staleness")).toBe(true);
  });

  it("walks the vault once, not once per question it answers", async () => {
    /**
     * `status` needs both the findings and the build. Asking `lint()` for the
     * first and building again for the second parsed every note twice.
     */
    const { deps, reads } = harness(VAULT);
    await new BrainService(deps).status();
    /** `vault-map.md` and `catalog.md` are artifacts, not notes. */
    const noteReads = reads.filter(
      (path) => path.endsWith(".md") && !path.includes("/_indexes/"),
    );
    expect(noteReads).toHaveLength(2);
    expect(new Set(noteReads).size).toBe(noteReads.length);
  });

  it("sees the index once it exists", async () => {
    const { deps } = harness(VAULT);
    const fresh = await new BrainService(deps).reindex();
    const seeded = harness({ ...VAULT, ...fresh.files });
    const report = await new BrainService(seeded.deps).status();
    expect(report.indexPresent).toBe(true);
  });
});
