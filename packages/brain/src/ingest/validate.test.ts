import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { redactText } from "@developer-os/security";
import { afterAll, describe, expect, it } from "vitest";

import type { DirectoryEntry, DirectoryReader } from "../discovery/index.js";
import { DEFAULT_BRAIN_CONFIG } from "../schema/config.js";
import type { BrainServiceDependencies } from "../service.js";
import type { IngestProposal, ProposedNote } from "./proposal.js";
import { validateProposal, VALIDATOR_IDS } from "./validate.js";
import type {
  IngestValidationContext,
  IngestValidationResult,
  ValidatorId,
} from "./validate.js";

/**
 * Fixed, and 32 bytes because `redactText` refuses a shorter key. A fingerprint
 * is an HMAC of the secret, so a random key here would make one assertion in
 * this file — that no finding carries the secret — pass for the wrong reason on
 * one run in a million.
 */
const KEY = new Uint8Array(32).fill(7);
const NOW = new Date("2026-08-14T00:00:00.000Z");

/** 16 hex characters, which is what `buildCapture` produces. Synthetic. */
const CAPTURE_ID = "0123456789abcdef";

/**
 * What `resolveScopeGlob` yields for the `ingest` contract's declared write
 * scopes under `DEFAULT_BRAIN_CONFIG`. Constructed here rather than sourced:
 * Task 12 reads no workflow file (correction 3), and `packages/brain` cannot
 * reach `workflow-schema` to resolve one (correction 2).
 */
const DECLARED_WRITE_SCOPES: readonly string[] = [
  "content/**",
  "content/_indexes/**",
];

type Fields = Readonly<Record<string, string | undefined>>;

function noteText(fields: Fields = {}, body = "Plain body.\n"): string {
  const merged: Record<string, string | undefined> = {
    schemaVersion: "1",
    title: "Widget cache invalidation",
    type: "knowledge-note",
    created: "2026-08-01",
    tags: "[dev]",
    summary: "One sentence.",
    stage: "emerging",
    author: "agent",
    reviewed: "null",
    ...fields,
  };
  const lines = Object.entries(merged)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return `---\n${lines}\n---\n\n${body}`;
}

/**
 * The one note built to satisfy all nine validators at once — valid
 * frontmatter, the capture it came from, a wiki-link that resolves against the
 * fixture vault, no duplicate, the frontmatter its `emerging` stage requires,
 * nothing the redactor finds, and a path inside the narrowed allowlist.
 *
 * Shared rather than rebuilt per test, per correction 6: a positive case that
 * passes because a validator silently failed to run is the gate that scans
 * nothing, and one shared note is the only way every `findings` is empty for
 * the same reason.
 */
function validNote(path = "DEV/a.md"): ProposedNote {
  return {
    path,
    contents: noteText({}, "Cache keys, following [[existing]].\n"),
    sourceCaptureId: CAPTURE_ID,
  };
}

function note(path: string, fields: Fields = {}, body?: string): ProposedNote {
  return {
    path,
    contents: body === undefined ? noteText(fields) : noteText(fields, body),
    sourceCaptureId: CAPTURE_ID,
  };
}

function proposal(...notes: readonly ProposedNote[]): IngestProposal {
  return { schemaVersion: 1, notes };
}

/**
 * A synthetic GitHub personal access token: the `ghp_` prefix plus 36
 * characters, which is the shape `redactText`'s `provider-token` class matches.
 * Composed rather than written out so nothing that greps this repository for a
 * credential finds one, and so no real token is ever a fixture.
 */
function providerToken(filler: string): string {
  return `ghp_${filler.repeat(36)}`;
}

/** Already in the fixture vault, and what `[[existing]]` resolves to. */
const EXISTING_NOTE = noteText(
  { title: "Existing note", summary: "Already in the vault." },
  "An existing note.\n",
);

const nodeReader: DirectoryReader = {
  async readDir(path: string): Promise<readonly DirectoryEntry[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
    }));
  },
};

const sandboxes: string[] = [];

async function sandbox(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  sandboxes.push(root);
  return root;
}

afterAll(async () => {
  for (const root of sandboxes) await rm(root, { recursive: true, force: true });
});

/**
 * A real directory, because the symlink case below needs a real one:
 * `canonicalizePlannedPath` resolves links against a filesystem, and a fake
 * canonicalizer would let a check on the written path pass while the resolved
 * destination escapes — the bug that test exists to catch.
 */
async function makeVault(): Promise<string> {
  const root = await sandbox("dos-brain-ingest-");
  await mkdir(join(root, "content", "DEV"), { recursive: true });
  /**
   * A real quarantine directory, because the private-folder cases below are
   * about what a path *resolves to*: on a case-insensitive volume
   * `_RAW/quarantine` canonicalizes into this one, and a case that never
   * created it would be measuring a path with no destination.
   */
  await mkdir(join(root, "content", "_raw", "quarantine"), { recursive: true });
  await writeFile(join(root, "content", "DEV", "existing.md"), EXISTING_NOTE, "utf8");
  return root;
}

function brainDeps(vaultRoot: string): BrainServiceDependencies {
  return {
    vaultRoot,
    config: DEFAULT_BRAIN_CONFIG,
    reader: nodeReader,
    readFile: (path: string) => readFile(path, "utf8"),
    assertReadable: () => Promise.resolve(),
    now: () => NOW,
  };
}

function contextFor(vaultRoot: string): IngestValidationContext {
  return {
    captureId: CAPTURE_ID,
    ingestContract: DECLARED_WRITE_SCOPES,
    redact: (text: string) => redactText(text, KEY),
    brain: brainDeps(vaultRoot),
  };
}

function validators(result: IngestValidationResult): readonly string[] {
  return result.findings.map((finding) => finding.validator);
}

/**
 * The positive assertion, and it asserts `findings` rather than only `ok`:
 * `ok` alone is satisfied by nine validators that all failed to run.
 */
function expectClean(result: IngestValidationResult): void {
  expect(result.findings).toStrictEqual([]);
  expect(result.ok).toBe(true);
}

interface Fixture {
  readonly validator: ValidatorId;
  readonly proposal: IngestProposal;
  readonly context: IngestValidationContext;
}

/**
 * One fixture per validator, because no single payload can trip all nine:
 * `deterministic-reindex`'s trigger is not in the proposal at all (correction
 * 1). Its fixture is an injected `readFile` that answers differently on the
 * second read, which is the only thing that can make a deterministic builder
 * disagree with itself.
 */
async function everyValidatorFixture(): Promise<readonly Fixture[]> {
  const vault = await makeVault();
  const context = contextFor(vault);

  let reads = 0;
  const drifting: BrainServiceDependencies = {
    ...brainDeps(vault),
    readFile: async (path: string): Promise<string> => {
      reads += 1;
      return `${await readFile(path, "utf8")}\nread ${String(reads)}\n`;
    },
  };

  return [
    {
      validator: "schema-and-frontmatter",
      proposal: proposal(note("DEV/bad.md", { summary: undefined })),
      context,
    },
    {
      validator: "source-and-provenance",
      proposal: proposal({ ...validNote(), sourceCaptureId: "fedcba9876543210" }),
      context,
    },
    {
      validator: "link-and-graph",
      proposal: proposal(
        note("DEV/dangling.md", {}, "See [[no-such-note]].\n"),
      ),
      context,
    },
    {
      validator: "duplicate-detection",
      proposal: proposal(note("DEV/twin.md", { title: "Existing note" })),
      context,
    },
    {
      validator: "confidence-and-lifecycle",
      proposal: proposal(note("DEV/settled.md", { stage: "established" })),
      context,
    },
    {
      validator: "secret-scan",
      proposal: proposal(
        note("DEV/leak.md", {}, `token ${providerToken("a")}\n`),
      ),
      context,
    },
    {
      validator: "deterministic-reindex",
      proposal: proposal(validNote()),
      context: { ...context, brain: drifting },
    },
    {
      validator: "generated-output-consistency",
      proposal: proposal(note("_indexes/index.json")),
      context,
    },
    { validator: "write-scope", proposal: proposal(note("/tmp/escape.md")), context },
  ];
}

describe("validateProposal", () => {
  it("runs every validator the design spec names, and the set is non-empty", async () => {
    expect(VALIDATOR_IDS).toHaveLength(9);

    const fixtures = await everyValidatorFixture();
    /**
     * Without this the union below matches trivially over an empty list, and
     * the loop scans zero proposals while reporting complete coverage.
     */
    expect(fixtures).toHaveLength(VALIDATOR_IDS.length);

    const fired = new Set<string>();
    for (const fixture of fixtures) {
      const result = await validateProposal(fixture.proposal, fixture.context);
      /**
       * Per scope, not in total. A union assertion alone passes when one
       * fixture happens to trip two validators and another trips none.
       */
      expect(validators(result), fixture.validator).toContain(fixture.validator);
      for (const finding of result.findings) fired.add(finding.validator);
    }

    expect(fired).toEqual(new Set(VALIDATOR_IDS));
  });

  it("accepts a proposal that satisfies all nine, with no finding at all", async () => {
    const result = await validateProposal(proposal(validNote()), contextFor(await makeVault()));
    expectClean(result);
  });

  it("reports every failure rather than stopping at the first", async () => {
    /**
     * A model that produced one bad path probably produced others, and a
     * caller fixing them one exit code at a time is a caller we made do nine
     * round trips.
     */
    const result = await validateProposal(
      proposal(note("_raw/quarantine/evil.md", { summary: undefined })),
      contextFor(await makeVault()),
    );

    expect(validators(result)).toContain("write-scope");
    expect(validators(result)).toContain("schema-and-frontmatter");
  });

  it("refuses rather than reporting clean when a vault directory cannot be read", async () => {
    /**
     * The projection may treat a *missing* directory as empty — a proposal
     * legitimately names folders the vault does not have yet. It may not treat
     * an **unreadable** one that way: the model chooses the path that puts a
     * virtual entry under the failing directory, so failing open here is a
     * condition the proposal controls. An `EACCES` on `content/DEV` while the
     * proposal writes into it would hide every existing note in that folder,
     * and `duplicate-detection` would certify a twin it never saw.
     */
    const vault = await makeVault();
    const base = contextFor(vault);
    const denied = join(vault, "content", "DEV");
    const context: IngestValidationContext = {
      ...base,
      brain: {
        ...base.brain,
        reader: {
          readDir: (path: string) =>
            path === denied
              ? Promise.reject(
                  Object.assign(new Error("EACCES: permission denied"), {
                    code: "EACCES",
                  }),
                )
              : nodeReader.readDir(path),
        },
      },
    };

    const result = await validateProposal(
      proposal(note("DEV/twin.md", { title: "Existing note" })),
      context,
    );

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("duplicate-detection");
  });

  it("still treats a directory the vault does not have yet as empty", async () => {
    /**
     * The other half of the same branch: a proposal writing into a folder that
     * does not exist is ordinary, and must not be refused for it.
     */
    const result = await validateProposal(
      proposal(note("DEV/sub/deep.md")),
      contextFor(await makeVault()),
    );

    expect(result.findings).toStrictEqual([]);
  });
});

describe("schema-and-frontmatter", () => {
  it("refuses a note whose frontmatter fails NoteFrontmatterV1", async () => {
    const result = await validateProposal(
      proposal(note("DEV/bad.md", { summary: undefined })),
      contextFor(await makeVault()),
    );

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("schema-and-frontmatter");
    expect(result.findings[0]?.path).toBe("DEV/bad.md");
  });

  it("refuses a note with no frontmatter block at all", async () => {
    const result = await validateProposal(
      proposal({
        path: "DEV/bare.md",
        contents: "Just prose.\n",
        sourceCaptureId: CAPTURE_ID,
      }),
      contextFor(await makeVault()),
    );

    expect(validators(result)).toContain("schema-and-frontmatter");
  });

  it("accepts a note whose frontmatter validates", async () => {
    const result = await validateProposal(proposal(validNote()), contextFor(await makeVault()));
    expect(validators(result)).not.toContain("schema-and-frontmatter");
  });
});

describe("source-and-provenance", () => {
  it("refuses a note naming a capture other than the one being ingested", async () => {
    const result = await validateProposal(
      proposal({ ...validNote(), sourceCaptureId: "fedcba9876543210" }),
      contextFor(await makeVault()),
    );

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("source-and-provenance");
  });

  it("names neither capture id in the finding it writes", async () => {
    /**
     * A capture id is model-echoed here — the proposal chose it — and the
     * validation report is written and logged. The finding names the class and
     * the file, never the value.
     */
    const result = await validateProposal(
      proposal({ ...validNote(), sourceCaptureId: "fedcba9876543210" }),
      contextFor(await makeVault()),
    );

    expect(JSON.stringify(result)).not.toContain("fedcba9876543210");
  });

  it("refuses a note citing a source that resolves to nothing", async () => {
    /**
     * `sources` is optional frontmatter a model is free to emit, and `lint.ts`
     * grades an unresolved entry `provenance` at severity **error**. Without
     * this the proposal passes all nine, gets applied, and then makes the
     * user's own `brain lint` fail on a note the user did not write — the one
     * outcome this gate exists to prevent.
     */
    const result = await validateProposal(
      proposal(note("DEV/cited.md", { sources: "[a-note-that-does-not-exist]" })),
      contextFor(await makeVault()),
    );

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("source-and-provenance");
  });

  it("accepts a note citing a source that resolves to a note in the vault", async () => {
    const result = await validateProposal(
      proposal(note("DEV/cited.md", { sources: "[DEV/existing.md]" })),
      contextFor(await makeVault()),
    );

    expect(validators(result)).not.toContain("source-and-provenance");
  });

  it("accepts a note naming the capture it came from", async () => {
    const result = await validateProposal(proposal(validNote()), contextFor(await makeVault()));
    expect(validators(result)).not.toContain("source-and-provenance");
  });
});

describe("link-and-graph", () => {
  it("refuses a proposed note whose wiki-link resolves to nothing", async () => {
    const result = await validateProposal(
      proposal(note("DEV/dangling.md", {}, "See [[no-such-note]].\n")),
      contextFor(await makeVault()),
    );

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("link-and-graph");
  });

  it("refuses a wiki-link into a private folder, which is never indexed", async () => {
    const result = await validateProposal(
      proposal(note("DEV/into-raw.md", {}, "See [[_raw/quarantine/evil]].\n")),
      contextFor(await makeVault()),
    );

    expect(validators(result)).toContain("link-and-graph");
  });

  it("accepts a wiki-link that resolves against the projected vault", async () => {
    const result = await validateProposal(proposal(validNote()), contextFor(await makeVault()));
    expect(validators(result)).not.toContain("link-and-graph");
  });

  it("resolves a link to another note in the same proposal, not only to the vault", async () => {
    /**
     * The projection is the current vault *plus* the proposed notes. Building
     * from the vault alone would refuse a pair of notes that link to each
     * other, which is the ordinary shape of a two-note proposal.
     */
    const result = await validateProposal(
      proposal(
        note("DEV/first.md", { title: "First" }, "See [[second]].\n"),
        note("DEV/second.md", { title: "Second" }, "See [[first]].\n"),
      ),
      contextFor(await makeVault()),
    );

    expect(validators(result)).not.toContain("link-and-graph");
  });
});

describe("duplicate-detection", () => {
  it("refuses a note duplicating an existing one under the vault's own duplicate rule", async () => {
    const result = await validateProposal(
      proposal(note("DEV/twin.md", { title: "Existing note" })),
      contextFor(await makeVault()),
    );

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("duplicate-detection");
  });

  it("refuses a note whose path collides with an existing one only by case", async () => {
    const result = await validateProposal(
      proposal(note("DEV/Existing.md", { title: "Something else" })),
      contextFor(await makeVault()),
    );

    expect(validators(result)).toContain("duplicate-detection");
  });

  it("accepts a note that duplicates nothing", async () => {
    const result = await validateProposal(proposal(validNote()), contextFor(await makeVault()));
    expect(validators(result)).not.toContain("duplicate-detection");
  });
});

describe("confidence-and-lifecycle", () => {
  it("refuses an established note that records nobody has reviewed it", async () => {
    const result = await validateProposal(
      proposal(note("DEV/settled.md", { stage: "established" })),
      contextFor(await makeVault()),
    );

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("confidence-and-lifecycle");
  });

  it("refuses a deprecated note that does not say when it changed", async () => {
    const result = await validateProposal(
      proposal(note("DEV/old.md", { stage: "deprecated" })),
      contextFor(await makeVault()),
    );

    expect(validators(result)).toContain("confidence-and-lifecycle");
  });

  it("accepts an established note carrying a review date", async () => {
    const result = await validateProposal(
      proposal(
        note("DEV/settled.md", { stage: "established", reviewed: "2026-08-10" }),
      ),
      contextFor(await makeVault()),
    );

    expect(validators(result)).not.toContain("confidence-and-lifecycle");
  });

  it("accepts an emerging note, which is the stage a new proposal belongs in", async () => {
    const result = await validateProposal(proposal(validNote()), contextFor(await makeVault()));
    expect(validators(result)).not.toContain("confidence-and-lifecycle");
  });
});

describe("secret-scan", () => {
  it("refuses a proposal carrying anything the redactor finds", async () => {
    const context = contextFor(await makeVault());
    const result = await validateProposal(
      proposal(note("DEV/leak.md", {}, `token ${providerToken("a")}\n`)),
      context,
    );

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("secret-scan");
    expect(JSON.stringify(result)).not.toContain("ghp_");
  });

  it("scans the proposed path as well as the note body", async () => {
    const context = contextFor(await makeVault());
    const result = await validateProposal(
      proposal({
        path: `DEV/${providerToken("b")}.md`,
        contents: noteText(),
        sourceCaptureId: CAPTURE_ID,
      }),
      context,
    );

    expect(validators(result)).toContain("secret-scan");
  });

  it("accepts a proposal the redactor finds nothing in", async () => {
    const result = await validateProposal(proposal(validNote()), contextFor(await makeVault()));
    expect(validators(result)).not.toContain("secret-scan");
  });
});

describe("deterministic-reindex", () => {
  it("refuses when a rebuild of the same projection is not byte-identical", async () => {
    /**
     * The trigger is not in the proposal — no payload makes a deterministic
     * builder non-deterministic. `BrainService.reindex` reads through injected
     * dependencies, so a `readFile` that answers differently on the second
     * read is the seam, and no filesystem is involved in the disagreement.
     */
    const vault = await makeVault();
    let reads = 0;
    const context: IngestValidationContext = {
      ...contextFor(vault),
      brain: {
        ...brainDeps(vault),
        readFile: async (path: string): Promise<string> => {
          reads += 1;
          return `${await readFile(path, "utf8")}\nread ${String(reads)}\n`;
        },
      },
    };

    const result = await validateProposal(proposal(validNote()), context);

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("deterministic-reindex");
  });

  it("rebuilds through a reversed directory reader, not the same order twice", async () => {
    /**
     * A second build through the same reader re-runs the same directory order
     * and proves almost nothing — it cannot catch an unsorted iteration or a
     * `Map` whose insertion order leaked, which is the regression this
     * validator exists to catch. `assertReadable` is called once per discovered
     * file in reader order, so the call log is where the reversal is
     * observable from outside.
     */
    const vault = await makeVault();
    await writeFile(join(vault, "content", "DEV", "b.md"), noteText({ title: "B" }), "utf8");
    await writeFile(join(vault, "content", "DEV", "c.md"), noteText({ title: "C" }), "utf8");

    const opened: string[] = [];
    const base = contextFor(vault);
    const context: IngestValidationContext = {
      ...base,
      brain: {
        ...base.brain,
        assertReadable: (path: string) => {
          opened.push(path);
          return Promise.resolve();
        },
      },
    };

    await validateProposal(proposal(validNote()), context);

    const half = opened.length / 2;
    expect(half).toBeGreaterThan(1);
    expect(opened.slice(half)).toStrictEqual([...opened.slice(0, half)].reverse());
  });

  it("accepts a projection a rebuild reproduces exactly", async () => {
    const result = await validateProposal(proposal(validNote()), contextFor(await makeVault()));
    expect(validators(result)).not.toContain("deterministic-reindex");
  });
});

describe("generated-output-consistency", () => {
  it("refuses a write targeting a generated artifact under the indexes directory", async () => {
    const result = await validateProposal(
      proposal(note("_indexes/index.json")),
      contextFor(await makeVault()),
    );

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("generated-output-consistency");
  });

  it("reads the indexes directory from configuration rather than hardcoding it", async () => {
    const vault = await makeVault();
    const base = contextFor(vault);
    const context: IngestValidationContext = {
      ...base,
      brain: { ...base.brain, config: { ...DEFAULT_BRAIN_CONFIG, indexesDir: "generated" } },
    };

    const result = await validateProposal(proposal(note("generated/index.json")), context);
    expect(validators(result)).toContain("generated-output-consistency");
  });

  it("accepts a note outside the indexes directory", async () => {
    const result = await validateProposal(proposal(validNote()), contextFor(await makeVault()));
    expect(validators(result)).not.toContain("generated-output-consistency");
  });
});

describe("write-scope", () => {
  const unsafe: [string, string][] = [
    ["resolves outside the content root", "../../etc/passwd"],
    ["names a private folder", "_raw/quarantine/evil.md"],
    ["names the indexes directory", "_indexes/index.json"],
    ["traverses at any segment", "DEV/../../escape.md"],
    ["is absolute", "/tmp/escape.md"],
  ];

  it.each(unsafe)("refuses a proposal whose path %s", async (_name, path) => {
    const result = await validateProposal(
      proposal(note(path)),
      contextFor(await makeVault()),
    );

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("write-scope");
  });

  it("refuses a path that resolves through a symlink out of the vault, checking the destination", async () => {
    const vault = await makeVault();
    const outside = await sandbox("dos-brain-outside-");
    await symlink(outside, join(vault, "content", "DEV", "escape"));

    const result = await validateProposal(
      proposal(note("DEV/escape/x.md")),
      contextFor(vault),
    );

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("write-scope");
  });

  it("resolves the destination with Foundation's canonicalizer, never an injected one", async () => {
    /**
     * `BrainServiceDependencies.canonicalize` exists so a wholly in-memory
     * build touches no real path, and Task 13 is exactly the caller that will
     * supply that bag. Honouring it here would let an indexing convenience
     * replace the security primitive the whole destination check rests on — so
     * this validator reads `canonicalizePlannedPath` unconditionally.
     *
     * The injected liar below is an identity function, so discovery does not
     * refuse the escaping symlink either. Nothing but `write-scope` can produce
     * the refusal, which is what isolates the property.
     */
    const vault = await makeVault();
    const outside = await sandbox("dos-brain-outside-");
    await symlink(outside, join(vault, "content", "DEV", "escape"));

    const base = contextFor(vault);
    const context: IngestValidationContext = {
      ...base,
      brain: {
        ...base.brain,
        canonicalize: (path: string) => Promise.resolve(path),
      },
    };

    const result = await validateProposal(proposal(note("DEV/escape/x.md")), context);

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("write-scope");
  });

  it("checks against the ingest workflow's declared write scopes, not a hardcoded root", async () => {
    const vault = await makeVault();
    const context = contextFor(vault);

    const allowed = await validateProposal(proposal(validNote()), context);
    expect(allowed.ok).toBe(true);
    expect(allowed.findings).toStrictEqual([]);

    /**
     * The same note against a contract whose declared write scopes were
     * narrowed. Nothing about the path changed, so a failure here can only
     * come from the declared scopes being what is consulted.
     */
    const narrowed: IngestValidationContext = {
      ...context,
      ingestContract: ["content/QA/**"],
    };
    const refused = await validateProposal(proposal(validNote()), narrowed);

    expect(refused.ok).toBe(false);
    expect(validators(refused)).toContain("write-scope");
  });

  it("refuses a generated or private path the declared write scopes permit", async () => {
    /**
     * `content/_indexes/**` is inside the contract's declared write scopes and
     * must still be refused, which is what makes the declared set a bound
     * rather than the check.
     */
    const context = contextFor(await makeVault());
    for (const path of ["_indexes/index.json", "_raw/quarantine/evil.md"]) {
      const result = await validateProposal(proposal(note(path)), context);
      expect(validators(result), path).toContain("write-scope");
    }
  });

  /**
   * **The private-folder subtraction on the resolved destination, which is the
   * twin `generated-output-consistency` already has.** Both cases below name a
   * path whose segments spell no private folder and whose destination is inside
   * the content root, so every check that reads the written path alone passes
   * them — and both land in `content/_raw/`, where the next run would read the
   * model's own output back as an `accepted` capture.
   */
  it("refuses a path whose case differs from the private folder it resolves into", async () => {
    const result = await validateProposal(
      proposal(note("_RAW/quarantine/aaaaaaaaaaaaaaaa.md")),
      contextFor(await makeVault()),
    );

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("write-scope");
  });

  it("refuses a path that resolves through a symlink into a private folder", async () => {
    const vault = await makeVault();
    await symlink(
      join(vault, "content", "_raw"),
      join(vault, "content", "notes"),
    );

    const result = await validateProposal(
      proposal(note("notes/quarantine/bbbbbbbbbbbbbbbb.md")),
      contextFor(vault),
    );

    expect(result.ok).toBe(false);
    expect(validators(result)).toContain("write-scope");
  });

  it("refuses a path naming a dot-segment, which discovery never indexes", async () => {
    const result = await validateProposal(
      proposal(note("DEV/.hidden/x.md")),
      contextFor(await makeVault()),
    );

    expect(validators(result)).toContain("write-scope");
  });

  it("names the offending path byte for byte, so the caller can act on it", async () => {
    const result = await validateProposal(
      proposal(note("_raw/quarantine/evil.md")),
      contextFor(await makeVault()),
    );

    const scope = result.findings.filter((f) => f.validator === "write-scope");
    expect(scope.map((f) => f.path)).toStrictEqual(["_raw/quarantine/evil.md"]);
  });
});
