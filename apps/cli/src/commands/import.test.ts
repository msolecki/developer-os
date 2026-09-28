import { execFileSync } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ClaudeMemoryLayoutV1 } from "@developer-os/adapter-claude";
import { EXIT_CODES } from "@developer-os/core";
import type { CliResult } from "@developer-os/core";
import { parseCaptureFile } from "@developer-os/brain";
import type { CaptureEnvelopeV1 } from "@developer-os/brain";
import { createRedactor } from "@developer-os/security";

import { afterEach, describe, expect, it } from "vitest";

import { loadOrCreateRedactionKey, redactionKeyPath } from "../context.js";
import type { CliContext } from "../context.js";
import { LifecycleMutationRefusal } from "../lifecycle/mutation-gate.js";
import { run } from "../main.js";
import {
  IMPORT_MAX_DEPTH,
  IMPORT_MAX_ENTRIES_WALKED,
  IMPORT_MAX_FILES_PER_RUN,
  IMPORT_MAX_MEMORY_PROJECTS,
  renderImport,
  runImport,
} from "./import.js";
import type { ImportDependencies, ImportOptions, ImportResultV1 } from "./import.js";
import { runInit } from "./init.js";
import { fingerprintDirectory } from "./quarantine.js";
import {
  createCommandFixture,
  exists,
  inventoryDigest,
  RecordingIo,
  REAL_FILESYSTEM_TIMEOUT_MS,
  removeCommandFixtures,
} from "./testing.js";
import type { CommandFixture } from "./testing.js";

afterEach(removeCommandFixtures);

const ACCEPTED = { dryRun: false, assumeYes: true } as const;

/** The value `tests/security/helpers.ts` plants; synthetic, never a real token. */
const SENTINEL = `ghp_${"S3nt1nel".repeat(5)}`;

async function installed(label: string): Promise<CommandFixture> {
  const fixture = await createCommandFixture(label);
  const result = await runInit(fixture.context, ACCEPTED);
  expect(result.ok, "the fixture must install before it imports").toBe(true);
  return fixture;
}

const contentOf = (fixture: CommandFixture): string => join(fixture.paths.brain, "content");
const inboxOf = (fixture: CommandFixture): string => join(contentOf(fixture), "_raw", "inbox");
const quarantineOf = (fixture: CommandFixture): string =>
  join(contentOf(fixture), "_raw", "quarantine");
/** A working directory that is neither the user home nor inside the vault. */
const workOf = (fixture: CommandFixture): string => join(fixture.root, "work");

async function plant(
  root: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative);
    await nodeFs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await nodeFs.writeFile(path, content, { mode: 0o600 });
  }
}

function importWith(
  fixture: CommandFixture,
  options: Partial<ImportOptions> = {},
  context: CliContext = fixture.context,
  dependencies: Partial<ImportDependencies> = {},
): ReturnType<typeof runImport> {
  return runImport(
    context,
    { path: null, claudeMemory: false, limit: null, dryRun: false, ...options },
    { cwd: () => workOf(fixture), memoryLayout: null, ...dependencies },
  );
}

function dataOf(result: CliResult<ImportResultV1>): ImportResultV1 {
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`);
  return result.data;
}

function failureDataOf(result: CliResult<ImportResultV1>): ImportResultV1 {
  if (result.ok) throw new Error("expected a failure");
  expect(result.error.data, "a batch failure carries the full result").toBeDefined();
  return result.error.data as unknown as ImportResultV1;
}

function kindOf(result: CliResult<ImportResultV1>): string {
  if (result.ok) throw new Error("expected a failure");
  return result.error.kind;
}

async function importJournals(fixture: CommandFixture): Promise<readonly string[]> {
  let entries: readonly string[];
  try {
    entries = await nodeFs.readdir(join(fixture.paths.stateDir, "transactions"));
  } catch {
    return [];
  }
  const phases: string[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const journal = await fixture.context.transactions.read(entry.slice(0, -".json".length));
    if (journal.kind === "import") phases.push(journal.phase);
  }
  return phases;
}

async function envelopeOf(fixture: CommandFixture, captureId: string): Promise<CaptureEnvelopeV1> {
  const fileName = `${captureId}.md`;
  const text = await nodeFs.readFile(join(quarantineOf(fixture), fileName), "utf8");
  const outcome = parseCaptureFile(
    fileName,
    text,
    createRedactor(loadOrCreateRedactionKey(fixture.paths.stateDir)),
  );
  if (!outcome.ok) throw new Error(`the capture did not parse: ${outcome.reason}`);
  return outcome.envelope;
}

async function captureFiles(fixture: CommandFixture): Promise<readonly string[]> {
  return (await nodeFs.readdir(quarantineOf(fixture))).filter((name) => !name.startsWith("."));
}

/** Every call to `guards.readText`, `fs.readdir` and `fs.lstat`, by path. */
function spied(context: CliContext): {
  readonly context: CliContext;
  readonly reads: string[];
  readonly listings: string[];
  readonly stats: string[];
} {
  const reads: string[] = [];
  const listings: string[] = [];
  const stats: string[] = [];
  const readdir = ((path: string, ...rest: unknown[]) => {
    listings.push(path);
    return (context.fs.readdir as (...args: unknown[]) => unknown)(path, ...rest);
  }) as CliContext["fs"]["readdir"];
  const lstat = ((path: string, ...rest: unknown[]) => {
    stats.push(path);
    return (context.fs.lstat as (...args: unknown[]) => unknown)(path, ...rest);
  }) as CliContext["fs"]["lstat"];
  return {
    reads,
    listings,
    stats,
    context: {
      ...context,
      fs: { ...context.fs, readdir, lstat },
      guards: {
        ...context.guards,
        readText: (path, reader) => {
          reads.push(path);
          return context.guards.readText(path, reader);
        },
      },
    },
  };
}

async function digests(fixture: CommandFixture): Promise<readonly (readonly string[])[]> {
  return [await inventoryDigest(fixture.paths.home), await inventoryDigest(fixture.paths.brain)];
}

describe("import from the inbox", () => {
  it("imports accepted files in byte order, skips the rest, and leaves the inbox untouched", async () => {
    const fixture = await installed("import-happy");
    await plant(inboxOf(fixture), {
      "a.md": "alpha observation",
      "nested/b.markdown": "beta observation",
      "nested/deeper/c.txt": "gamma observation",
      ".hidden.md": "hidden observation",
      "d.pdf": "not text we accept",
    });
    const inboxBefore = await inventoryDigest(inboxOf(fixture));
    const indexesBefore = await inventoryDigest(join(contentOf(fixture), "_indexes"));

    const data = dataOf(await importWith(fixture));

    const imported = data.files.filter((file) => file.outcome === "imported");
    expect(imported.map((file) => file.path)).toEqual([
      "a.md",
      "nested/b.markdown",
      "nested/deeper/c.txt",
    ]);
    expect(data.files).toContainEqual({
      path: "d.pdf",
      outcome: "skipped",
      captureId: null,
      reason: "unsupported_type",
      redactionCount: 0,
    });
    expect(data.files.some((file) => file.path.split("/").some((part) => part.startsWith(".")))).toBe(false);
    expect(data.source).toBe("inbox");

    for (const file of imported) {
      expect(file.captureId).not.toBeNull();
      const envelope = await envelopeOf(fixture, file.captureId ?? "");
      expect(envelope).toMatchObject({
        captureMethod: "import",
        projectSlug: "inbox",
        sourceAgent: "unknown",
        status: "quarantined",
      });
    }
    expect(await inventoryDigest(inboxOf(fixture))).toEqual(inboxBefore);
    expect(await inventoryDigest(join(contentOf(fixture), "_indexes"))).toEqual(indexesBefore);
  });

  it("imports nothing on an unchanged rerun and opens no transaction", async () => {
    const fixture = await installed("import-rerun");
    await plant(inboxOf(fixture), { "a.md": "one", "b.md": "two", "c.md": "three" });
    expect(dataOf(await importWith(fixture)).files).toHaveLength(3);
    const journals = await importJournals(fixture);
    expect(journals).toHaveLength(3);

    const result = await importWith(fixture);

    expect(result.code).toBe(EXIT_CODES.success);
    expect(dataOf(result)).toMatchObject({ files: [], duplicateCount: 3, remaining: 0 });
    expect(await importJournals(fixture)).toEqual(journals);
  });

  it("advances --limit batches past what earlier runs imported", async () => {
    const fixture = await installed("import-limit");
    await plant(inboxOf(fixture), {
      "1.md": "first",
      "2.md": "second",
      "3.md": "third",
      "4.md": "fourth",
      "5.md": "fifth",
    });

    const first = dataOf(await importWith(fixture, { limit: 2 }));
    expect(first.files.map((file) => file.path)).toEqual(["1.md", "2.md"]);
    expect(first).toMatchObject({ remaining: 3, duplicateCount: 0 });

    const second = dataOf(await importWith(fixture, { limit: 2 }));
    expect(second.files.map((file) => file.path)).toEqual(["3.md", "4.md"]);
    expect(second).toMatchObject({ remaining: 1, duplicateCount: 2 });

    const third = dataOf(await importWith(fixture, { limit: 2 }));
    expect(third.files.map((file) => file.path)).toEqual(["5.md"]);
    expect(third.remaining).toBe(0);
  });
});

describe("import from a path", () => {
  it("imports a directory outside the vault, resolved against cwd, and leaves it unchanged", async () => {
    const fixture = await installed("import-path");
    const elsewhere = join(fixture.root, "elsewhere");
    await plant(elsewhere, { "one.md": "one observation", "sub/two.md": "two observation" });
    await plant(fixture.root, { "lone.md": "a lone observation" });
    await nodeFs.mkdir(workOf(fixture), { recursive: true, mode: 0o700 });
    const before = await inventoryDigest(elsewhere);
    const key = loadOrCreateRedactionKey(fixture.paths.stateDir);

    const data = dataOf(await importWith(fixture, { path: "../elsewhere" }));

    expect(data.source).toBe("path");
    const imported = data.files.filter((file) => file.outcome === "imported");
    expect(imported.map((file) => file.path)).toEqual(["one.md", "sub/two.md"]);
    for (const file of imported) {
      const envelope = await envelopeOf(fixture, file.captureId ?? "");
      expect(envelope.projectSlug).toBe("import");
      expect(envelope.workingDirectoryFingerprint).toBe(fingerprintDirectory(elsewhere, key));
    }
    expect(await inventoryDigest(elsewhere)).toEqual(before);

    const single = dataOf(await importWith(fixture, { path: "../lone.md" }));
    expect(single.files.map((file) => [file.path, file.outcome])).toEqual([["lone.md", "imported"]]);
  });

  it("resolves a relative path against cwd, never the user home", async () => {
    const fixture = await installed("import-relative");
    await plant(join(workOf(fixture), "notes"), { "from-cwd.md": "the cwd copy" });
    await plant(join(fixture.userHome, "notes"), { "from-home.md": "the home copy" });

    const data = dataOf(await importWith(fixture, { path: "notes" }));

    expect(data.files.map((file) => file.path)).toEqual(["from-cwd.md"]);
  });

  it.each([
    ["a vault path outside the inbox", "import_source_in_vault", EXIT_CODES.invalidInput],
    ["a path inside the product home", "import_source_in_product_home", EXIT_CODES.securityRefusal],
    ["a missing path", "import_source_not_found", EXIT_CODES.invalidInput],
  ] as const)("refuses %s and writes nothing", async (_label, kind, code) => {
    const fixture = await installed(`import-policy-${kind}`);
    const inVault = join(contentOf(fixture), "elsewhere-in-vault");
    await plant(inVault, { "a.md": "in the vault" });
    const target = {
      import_source_in_vault: inVault,
      import_source_in_product_home: fixture.paths.stateDir,
      import_source_not_found: join(fixture.root, "missing"),
    }[kind];
    const before = await digests(fixture);

    const result = await importWith(fixture, { path: target });

    expect(result.code).toBe(code);
    expect(kindOf(result)).toBe(kind);
    expect(await digests(fixture)).toEqual(before);
  });

  it("refuses an ancestor of the product home without listing it", async () => {
    const fixture = await installed("import-policy-home-ancestor");
    await plant(workOf(fixture), { "a.md": "beside the product" });
    const probe = spied(fixture.context);
    const before = await digests(fixture);

    const result = await importWith(fixture, { path: fixture.userHome }, probe.context);

    expect(result.code).toBe(EXIT_CODES.securityRefusal);
    expect(kindOf(result)).toBe("import_source_in_product_home");
    expect(probe.listings).toEqual([]);
    expect(await digests(fixture)).toEqual(before);
  });

  it("refuses an ancestor of the vault without listing it", async () => {
    const scratch = await createCommandFixture("import-policy-vault-ancestor-root");
    const vaults = join(scratch.root, "shared", "vaults");
    const fixture = await createCommandFixture("import-policy-vault-ancestor", {
      root: join(scratch.root, "shared"),
      env: { DEVELOPER_OS_BRAIN: join(vaults, "brain") },
    });
    expect((await runInit(fixture.context, ACCEPTED)).ok).toBe(true);
    await plant(vaults, { "loose.md": "beside the vault" });
    const probe = spied(fixture.context);
    const before = await digests(fixture);

    const result = await importWith(fixture, { path: vaults }, probe.context);

    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(kindOf(result)).toBe("import_source_in_vault");
    expect(probe.listings).toEqual([]);
    expect(await digests(fixture)).toEqual(before);
  });

  it("refuses a quarantine directory replaced by a link out of the content root", async () => {
    const fixture = await installed("import-quarantine-link");
    await plant(inboxOf(fixture), { "a.md": "an observation" });
    const outside = join(fixture.root, "outside-quarantine");
    await nodeFs.mkdir(outside, { mode: 0o700 });
    await nodeFs.rm(quarantineOf(fixture), { recursive: true });
    await nodeFs.symlink(outside, quarantineOf(fixture));
    const before = await digests(fixture);

    const result = await importWith(fixture);

    expect(result.code).toBe(EXIT_CODES.securityRefusal);
    expect(await digests(fixture)).toEqual(before);
    expect(await nodeFs.readdir(outside)).toEqual([]);
  });

  /**
   * NEW-20, as `capture` pins it: the content-root link is retargeted once
   * both proofs have resolved it. A read or write through the declared
   * quarantine would follow the link into `elsewhere`.
   */
  it("refuses at exit 5 and writes nowhere when the content root is retargeted after the proof", async () => {
    const fixture = await installed("import-symlink-swap");
    await plant(inboxOf(fixture), { "a.md": "an observation" });
    const content = contentOf(fixture);
    const real = join(fixture.paths.brain, "real-content");
    await nodeFs.rename(content, real);
    await nodeFs.symlink(real, content);
    const elsewhere = join(fixture.root, "elsewhere");
    await nodeFs.mkdir(join(elsewhere, "_raw", "quarantine"), { recursive: true, mode: 0o700 });
    const before = await nodeFs.readdir(join(real, "_raw", "quarantine"));

    let swapped = false;
    const canonicalize = async (path: string): Promise<string> => {
      const resolved = await fixture.context.guards.canonicalize(path);
      if (!swapped && path === inboxOf(fixture)) {
        swapped = true;
        await nodeFs.unlink(content);
        await nodeFs.symlink(elsewhere, content);
      }
      return resolved;
    };
    const context: CliContext = {
      ...fixture.context,
      guards: { ...fixture.context.guards, canonicalize },
    };

    const result = await importWith(fixture, {}, context);

    expect(swapped, "the swap must happen for the test to mean anything").toBe(true);
    expect(result.code).toBe(EXIT_CODES.securityRefusal);
    expect(await nodeFs.readdir(join(elsewhere, "_raw", "quarantine"))).toEqual([]);
    expect(await nodeFs.readdir(join(real, "_raw", "quarantine"))).toEqual(before);
    expect(await importJournals(fixture)).toEqual([]);
  });
});

describe("per-file and protected refusals", () => {
  it("refuses bad files one by one, imports the good one, and exits with the most severe code", async () => {
    const fixture = await installed("import-per-file");
    const inbox = inboxOf(fixture);
    const target = join(fixture.root, "link-target.md");
    await plant(fixture.root, { "link-target.md": "never read" });
    await plant(inbox, {
      "big.md": "a".repeat(65_537),
      "bad.md": new Uint8Array([0x66, 0xff, 0xfe, 0x66]),
      "blank.md": "  \n\t\n",
      "good.md": "a good observation",
    });
    await nodeFs.symlink(target, join(inbox, "link.md"));
    execFileSync("mkfifo", ["-m", "600", join(inbox, "pipe.md")]);
    const probe = spied(fixture.context);

    const result = await importWith(fixture, {}, probe.context);

    expect(result.ok).toBe(false);
    expect(result.code).toBe(EXIT_CODES.securityRefusal);
    const data = failureDataOf(result);
    const byPath = new Map(data.files.map((file) => [file.path, file]));
    expect(byPath.size).toBeGreaterThan(0);
    expect(byPath.get("link.md")).toMatchObject({ outcome: "refused", reason: "import_source_symlink" });
    expect(byPath.get("big.md")).toMatchObject({ outcome: "refused", reason: "import_source_too_large" });
    expect(byPath.get("bad.md")).toMatchObject({ outcome: "refused", reason: "import_source_not_text" });
    expect(byPath.get("blank.md")).toMatchObject({ outcome: "refused", reason: "import_source_empty" });
    expect(byPath.get("pipe.md")).toMatchObject({ outcome: "skipped", reason: "unsupported_type" });
    expect(byPath.get("good.md")).toMatchObject({ outcome: "imported" });
    expect(await captureFiles(fixture)).toHaveLength(1);

    expect(probe.reads.length).toBeGreaterThan(0);
    expect(probe.reads).not.toContain(join(inbox, "link.md"));
    expect(probe.reads).not.toContain(target);
    expect(probe.reads).not.toContain(join(inbox, "pipe.md"));
  });

  it.each([
    ["a single-file .env root", "cwd-env"],
    ["a protected directory root", "home-aws"],
  ] as const)("refuses %s at run level without listing it", async (_label, which) => {
    const fixture = await installed(`import-protected-${which}`);
    await plant(workOf(fixture), { ".env.md": "SECRET=value" });
    await plant(join(fixture.userHome, ".aws"), { "notes.md": "cloud notes" });
    const target =
      which === "cwd-env" ? join(workOf(fixture), ".env.md") : join(fixture.userHome, ".aws");
    const probe = spied(fixture.context);
    const before = await digests(fixture);

    const result = await importWith(fixture, { path: target }, probe.context);

    expect(result.code).toBe(EXIT_CODES.securityRefusal);
    expect(kindOf(result)).toBe("import_source_protected");
    expect(probe.listings).not.toContain(join(fixture.userHome, ".aws"));
    expect(probe.reads.filter((path) => path.startsWith(target))).toEqual([]);
    expect(await digests(fixture)).toEqual(before);
  });
});

describe("redaction precedes everything", () => {
  it("keeps a planted secret out of the capture and the result", async () => {
    const fixture = await installed("import-sentinel-unit");
    await plant(inboxOf(fixture), { "secret.md": `the token is ${SENTINEL} here` });

    const result = await importWith(fixture);

    const data = dataOf(result);
    const [file] = data.files;
    expect(file?.redactionCount).toBeGreaterThanOrEqual(1);
    const written = await nodeFs.readFile(
      join(quarantineOf(fixture), `${file?.captureId ?? ""}.md`),
      "utf8",
    );
    expect(written).not.toContain(SENTINEL);
    /** `parseCaptureFile` re-derives `redaction` from the already-redacted body, so read the stored findings. */
    const stored = /^redaction:\n((?: {2}.*\n)+)/mu.exec(written)?.[1] ?? "";
    const findings = stored.split(/^ {2}- /mu).filter((chunk) => chunk !== "");
    expect(findings.length).toBe(file?.redactionCount);
    for (const finding of findings) {
      expect([...finding.matchAll(/^\s*(\w+):/gmu)].map((match) => match[1]).sort()).toEqual(["class", "fingerprint"]);
    }
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it("warns, by index and never by value, about a pattern that covers much of a file (NEW-24)", async () => {
    const fixture = await installed("import-over-broad-redaction");
    await nodeFs.appendFile(
      fixture.paths.configFile,
      '\n[redaction]\npatterns = ["Northwind Traders", "e"]\n',
      "utf8",
    );
    await plant(inboxOf(fixture), { "broad.md": "see ".repeat(80) });

    const result = await importWith(fixture);

    expect(dataOf(result).files.map((file) => file.outcome)).toEqual(["imported"]);
    if (!result.ok) return;
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain("patterns[1]");
    expect(warnings).toContain("over-broad");
    expect(warnings).not.toContain("patterns[0]");
    expect(warnings).not.toContain("Northwind");
  });

  it.each([["--json"], ["human"]] as const)(
    "redacts a secret in a refused file's name (%s output)",
    async (mode) => {
      const fixture = await installed(`import-sentinel-${mode.replace("--", "")}`);
      await plant(inboxOf(fixture), {
        "secret.md": `the token is ${SENTINEL} here`,
        [`${SENTINEL}.md`]: "   \n",
      });
      const io = new RecordingIo();

      const code = await run(
        mode === "--json" ? ["import", "--json"] : ["import"],
        io,
        () => fixture.context,
      );

      expect(code).toBe(EXIT_CODES.operationalFailure);
      const output = [...io.out, ...io.err].join("\n");
      expect(output.length).toBeGreaterThan(0);
      expect(output).not.toContain(SENTINEL);
    },
  );
});

describe("bounds", () => {
  it("imports a 64 KiB file and refuses one byte more", async () => {
    const fixture = await installed("import-bound-bytes");
    const atBound = `${"word ".repeat(13_107)}x`;
    expect(Buffer.byteLength(atBound)).toBe(65_536);
    await plant(inboxOf(fixture), { "at.md": atBound, "over.md": `${atBound}y` });

    const data = failureDataOf(await importWith(fixture));

    expect(data.files.find((file) => file.path === "at.md")?.outcome).toBe("imported");
    expect(data.files.find((file) => file.path === "over.md")?.reason).toBe(
      "import_source_too_large",
    );
  });

  it.each([
    [IMPORT_MAX_ENTRIES_WALKED, true],
    [IMPORT_MAX_ENTRIES_WALKED + 1, false],
  ] as const)(
    "walks %i entries: admitted %s",
    async (count, admitted) => {
      const fixture = await installed(`import-bound-entries-${String(count)}`);
      const many = join(fixture.root, "many");
      await nodeFs.mkdir(many, { mode: 0o700 });
      const names = Array.from({ length: count }, (_, index) => `f${String(index).padStart(5, "0")}.pdf`);
      expect(names.length).toBe(count);
      for (let start = 0; start < names.length; start += 500) {
        await Promise.all(
          names.slice(start, start + 500).map((name) => nodeFs.writeFile(join(many, name), "x")),
        );
      }
      const before = await digests(fixture);

      const result = await importWith(fixture, { path: many });

      if (admitted) {
        expect(dataOf(result).files).toHaveLength(count);
      } else {
        expect(result.code).toBe(EXIT_CODES.invalidInput);
        expect(kindOf(result)).toBe("import_enumeration_limit");
        expect(await digests(fixture)).toEqual(before);
      }
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it.each([
    [IMPORT_MAX_DEPTH, true],
    [IMPORT_MAX_DEPTH + 1, false],
  ] as const)("reaches a file at depth %i: admitted %s", async (depth, admitted) => {
    const fixture = await installed(`import-bound-depth-${String(depth)}`);
    const deep = join(fixture.root, "deep");
    const segments = [...Array.from({ length: depth - 1 }, (_, index) => `d${String(index)}`), "leaf.md"];
    expect(segments).toHaveLength(depth);
    await plant(deep, { [segments.join("/")]: "a deep observation" });

    const result = await importWith(fixture, { path: deep, dryRun: true });

    if (admitted) {
      expect(dataOf(result).files.map((file) => file.outcome)).toEqual(["would_import"]);
    } else {
      expect(result.code).toBe(EXIT_CODES.invalidInput);
      expect(kindOf(result)).toBe("import_enumeration_limit");
    }
  });

  it.each([
    [IMPORT_MAX_FILES_PER_RUN, 0],
    [IMPORT_MAX_FILES_PER_RUN + 1, 1],
  ] as const)(
    "caps a run of %i new files, leaving %i remaining",
    async (count, remaining) => {
      const fixture = await installed(`import-bound-files-${String(count)}`);
      const batch = join(fixture.root, "batch");
      await nodeFs.mkdir(batch, { mode: 0o700 });
      for (let index = 0; index < count; index += 1) {
        await nodeFs.writeFile(join(batch, `n${String(index).padStart(4, "0")}.md`), `observation ${String(index)}`);
      }
      expect(await exists(redactionKeyPath(fixture.paths.stateDir))).toBe(true);

      const data = dataOf(await importWith(fixture, { path: batch, dryRun: true }));

      expect(data.files.filter((file) => file.outcome === "would_import")).toHaveLength(
        IMPORT_MAX_FILES_PER_RUN,
      );
      expect(data.remaining).toBe(remaining);
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );
});

describe("dry run", () => {
  it("writes nothing and creates no key when the key is absent", async () => {
    const fixture = await installed("import-dry-no-key");
    await nodeFs.rm(redactionKeyPath(fixture.paths.stateDir));
    await plant(inboxOf(fixture), { "a.md": "one", "b.md": "two" });
    const before = await digests(fixture);

    const data = dataOf(await importWith(fixture, { dryRun: true }));

    expect(data.files).toHaveLength(2);
    for (const file of data.files) {
      expect(file).toMatchObject({ outcome: "would_import", captureId: null });
    }
    expect(data).not.toHaveProperty("transactionId");
    expect(await exists(redactionKeyPath(fixture.paths.stateDir))).toBe(false);
    expect(await digests(fixture)).toEqual(before);
  });

  it("reports duplicates with the key present and still writes nothing", async () => {
    const fixture = await installed("import-dry-key");
    await plant(inboxOf(fixture), { "a.md": "one" });
    dataOf(await importWith(fixture));
    await plant(inboxOf(fixture), { "b.md": "two" });
    const before = await digests(fixture);

    const data = dataOf(await importWith(fixture, { dryRun: true }));

    expect(data.duplicateCount).toBe(1);
    expect(data.files).toHaveLength(1);
    expect(data.files[0]).toMatchObject({ path: "b.md", outcome: "would_import" });
    expect(data.files[0]?.captureId).toMatch(/^[0-9a-f]{16}$/u);
    expect(await digests(fixture)).toEqual(before);
  });
});

describe("run-level stops", () => {
  it("stops at a mid-run gate refusal with earlier captures finalized", async () => {
    const fixture = await installed("import-gate-refusal");
    await plant(inboxOf(fixture), { "a.md": "first", "b.md": "second", "c.md": "third" });
    let calls = 0;
    const inner = fixture.context.executor;
    const probe = spied({
      ...fixture.context,
      executor: {
        execute: (plan) => {
          calls += 1;
          if (calls === 2) {
            return Promise.reject(
              new LifecycleMutationRefusal({
                reason: "lifecycle_closure_not_clear",
                code: EXIT_CODES.recoveryRequired,
                paths: [],
              }),
            );
          }
          return inner.execute(plan);
        },
        resume: (id) => inner.resume(id),
        rollback: (id) => inner.rollback(id),
      },
    });

    const result = await importWith(fixture, {}, probe.context);

    expect(result.code).toBe(EXIT_CODES.recoveryRequired);
    expect(failureDataOf(result).remaining).toBe(2);
    expect(await captureFiles(fixture)).toHaveLength(1);
    expect(await importJournals(fixture)).toEqual(["finalized"]);
    expect(probe.reads).not.toContain(join(inboxOf(fixture), "c.md"));
  });
});

/** Synthetic: never the observed vendor row, which Task 14 records. */
const LAYOUT: ClaudeMemoryLayoutV1 = {
  claudeVersion: "0.0.0",
  observedOn: "2026-01-01",
  observedIn: "synthetic test layout",
  projectsDirectory: "projects",
  memoryDirectory: "memory",
  extension: ".md",
  indexFileName: "INDEX.md",
};

const vendorOf = (fixture: CommandFixture): string => join(fixture.userHome, ".claude");
const projectsOf = (fixture: CommandFixture): string => join(vendorOf(fixture), "projects");

function importMemory(
  fixture: CommandFixture,
  context: CliContext = fixture.context,
  layout: ClaudeMemoryLayoutV1 | null = LAYOUT,
): ReturnType<typeof runImport> {
  return importWith(fixture, { claudeMemory: true }, context, { memoryLayout: layout });
}

async function plantMemoryTree(fixture: CommandFixture): Promise<void> {
  const projects = projectsOf(fixture);
  await plant(projects, {
    "-synthetic-alpha/memory/one.md": "alpha memory one",
    "-synthetic-alpha/memory/two.md": "alpha memory two",
    "-synthetic-alpha/memory/INDEX.md": "- one\n- two",
    "-synthetic-alpha/memory/notes.txt": "not a memory file",
    "-synthetic-alpha/session-0001.jsonl": '{"type":"user","text":"a session line"}\n',
    "-synthetic-beta/memory/three.md": "beta memory three",
  });
  await nodeFs.mkdir(join(projects, "-synthetic-gamma"), { mode: 0o700 });
  await plant(fixture.root, { "memory-link-target.md": "never read" });
  await nodeFs.mkdir(join(projects, "-synthetic-delta", "memory"), { recursive: true, mode: 0o700 });
  await nodeFs.symlink(
    join(fixture.root, "memory-link-target.md"),
    join(projects, "-synthetic-delta", "memory", "link.md"),
  );
}

describe("import --claude-memory", () => {
  it("refuses while the layout is unobserved and touches nothing under the vendor home", async () => {
    const fixture = await installed("import-memory-unobserved");
    await plantMemoryTree(fixture);
    const probe = spied(fixture.context);

    const result = await importMemory(fixture, probe.context, null);

    expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
    expect(kindOf(result)).toBe("claude_memory_layout_unobserved");
    const touched = [...probe.listings, ...probe.stats, ...probe.reads];
    expect(touched.filter((path) => path.startsWith(vendorOf(fixture)))).toEqual([]);
  });

  it("refuses while CLAUDE_CONFIG_DIR is set and touches nothing under the vendor home", async () => {
    const fixture = await installed("import-memory-config-dir");
    await plantMemoryTree(fixture);
    const probe = spied({
      ...fixture.context,
      env: { ...fixture.context.env, CLAUDE_CONFIG_DIR: "/synthetic/claude-config" },
    });
    const before = await digests(fixture);

    const result = await importMemory(fixture, probe.context);

    expect(result.code).toBe(EXIT_CODES.capabilityUnavailable);
    expect(kindOf(result)).toBe("claude_config_dir_not_followed");
    expect([...probe.listings, ...probe.stats, ...probe.reads]).toEqual([]);
    expect(await digests(fixture)).toEqual(before);
  });

  it("never follows a project directory that is a symbolic link", async () => {
    const fixture = await installed("import-memory-project-link");
    const outside = join(fixture.root, "outside-project");
    await plant(outside, { "memory/escaped.md": "outside the vendor home" });
    await plant(projectsOf(fixture), { "-synthetic-alpha/memory/one.md": "alpha memory one" });
    await nodeFs.symlink(outside, join(projectsOf(fixture), "-synthetic-link"));
    const probe = spied(fixture.context);

    const data = dataOf(await importMemory(fixture, probe.context));

    expect(data.files.map((file) => file.path.split("/").pop())).toEqual(["one.md"]);
    const touched = [...probe.listings, ...probe.stats, ...probe.reads];
    expect(touched.filter((path) => path.includes("-synthetic-link/"))).toEqual([]);
  });

  it("imports memory files, never lists a project directory, and names no vendor path", async () => {
    const fixture = await installed("import-memory");
    await plantMemoryTree(fixture);
    const probe = spied(fixture.context);

    const result = await importMemory(fixture, probe.context);

    expect(result.code).toBe(EXIT_CODES.securityRefusal);
    const data = failureDataOf(result);
    expect(data.source).toBe("claude-memory");
    const byName = new Map(data.files.map((file) => [file.path.split("/").pop(), file]));
    expect([...byName.keys()].sort()).toEqual(["link.md", "one.md", "three.md", "two.md"]);
    for (const file of data.files) expect(file.path).toMatch(/^[0-9a-f]{16}\/[a-z]+\.md$/u);
    expect(byName.get("link.md")).toMatchObject({
      outcome: "refused",
      reason: "import_source_symlink",
    });

    const imported = data.files.filter((file) => file.outcome === "imported");
    expect(imported).toHaveLength(3);
    for (const file of imported) {
      const envelope = await envelopeOf(fixture, file.captureId ?? "");
      expect(envelope).toMatchObject({
        captureMethod: "import-claude-memory",
        projectSlug: "claude-memory",
        sourceAgent: "unknown",
        status: "quarantined",
      });
      expect(JSON.stringify(envelope)).not.toContain("synthetic");
    }
    expect(JSON.stringify(result)).not.toContain("synthetic");
    expect(renderImport(data).join("\n")).not.toContain("synthetic");

    // Transcripts untouched: only the projects directory and each memory directory are listed.
    const projects = projectsOf(fixture);
    const listed = new Set(probe.listings.filter((path) => path.startsWith(vendorOf(fixture))));
    const expected = new Set([
      projects,
      join(projects, "-synthetic-alpha", "memory"),
      join(projects, "-synthetic-beta", "memory"),
      join(projects, "-synthetic-delta", "memory"),
    ]);
    expect(expected.size).toBeGreaterThan(0);
    expect(listed).toEqual(expected);
    const touched = [...probe.listings, ...probe.stats, ...probe.reads];
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.filter((path) => path.includes("session-0001.jsonl"))).toEqual([]);
    expect(probe.reads).not.toContain(join(fixture.root, "memory-link-target.md"));
  });

  it("uses the content hash as its cursor", async () => {
    const fixture = await installed("import-memory-cursor");
    await plant(projectsOf(fixture), {
      "-synthetic-alpha/memory/one.md": "alpha memory one",
      "-synthetic-alpha/memory/two.md": "alpha memory two",
      "-synthetic-beta/memory/three.md": "beta memory three",
    });
    expect(dataOf(await importMemory(fixture)).files).toHaveLength(3);
    const journals = await importJournals(fixture);
    expect(journals).toHaveLength(3);

    const rerun = await importMemory(fixture);

    expect(rerun.code).toBe(EXIT_CODES.success);
    expect(dataOf(rerun)).toMatchObject({ files: [], duplicateCount: 3, remaining: 0 });
    expect(await importJournals(fixture)).toEqual(journals);

    await nodeFs.writeFile(join(projectsOf(fixture), "-synthetic-alpha", "memory", "two.md"), "alpha memory two, edited");
    const edited = dataOf(await importMemory(fixture));
    expect(edited.files.map((file) => [file.path.split("/").pop(), file.outcome])).toEqual([
      ["two.md", "imported"],
    ]);
    expect(edited.duplicateCount).toBe(2);
  });

  it.each([
    [IMPORT_MAX_MEMORY_PROJECTS, true],
    [IMPORT_MAX_MEMORY_PROJECTS + 1, false],
  ] as const)(
    "enumerates %i project directories: admitted %s",
    async (count, admitted) => {
      const fixture = await installed(`import-memory-bound-${String(count)}`);
      const projects = projectsOf(fixture);
      await plant(projects, { "-p0000/memory/kept.md": "a kept memory" });
      const names = Array.from({ length: count - 1 }, (_, index) => `-p${String(index + 1).padStart(4, "0")}`);
      expect(names.length).toBe(count - 1);
      await Promise.all(names.map((name) => nodeFs.mkdir(join(projects, name), { mode: 0o700 })));
      const probe = spied(fixture.context);

      const result = await importMemory(fixture, probe.context);

      if (admitted) {
        expect(dataOf(result).files.map((file) => file.outcome)).toEqual(["imported"]);
      } else {
        expect(result.code).toBe(EXIT_CODES.invalidInput);
        expect(kindOf(result)).toBe("import_enumeration_limit");
        expect(probe.reads.filter((path) => path.startsWith(vendorOf(fixture)))).toEqual([]);
        expect(await captureFiles(fixture)).toEqual([]);
      }
    },
    REAL_FILESYSTEM_TIMEOUT_MS,
  );

  it("refuses a vendor home without a projects directory", async () => {
    const fixture = await installed("import-memory-no-projects");
    await nodeFs.mkdir(vendorOf(fixture), { mode: 0o700 });

    const result = await importMemory(fixture);

    expect(result.code).toBe(EXIT_CODES.invalidInput);
    expect(kindOf(result)).toBe("import_source_not_found");
  });
});
