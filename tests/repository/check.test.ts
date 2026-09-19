import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * The compiled entry, exercised as the lint gate actually invokes it. The unit
 * tests cover the matcher; nothing covered the *enumerator* until a reviewer
 * found that it could skip a file — or every file — and still exit 0. That is
 * the same "passes by scanning nothing" failure the matcher's own tests exist to
 * prevent, one module over, so it gets the same treatment.
 */
const CHECK_ENTRY = fileURLToPath(new URL("../dist/repository/check.js", import.meta.url));

/**
 * The forbidden spellings, assembled rather than written out, so this file stays
 * *inside* the rule it tests.
 *
 * `self-containment.ts` and its unit tests are allowlisted because they cannot
 * express the patterns without containing them. This file can: it only needs the
 * strings in fixture *content*, never in its own source. Every allowlist entry is
 * a permanent hole in the rule, and the file that proves the enumerator works is
 * the last one that should be exempt from it.
 */
const VAULT_TILDE = ["~", "brain"].join("/");
const VAULT_ABSOLUTE = ["/Users/example", "brain"].join("/");

const sandboxes: string[] = [];

afterEach(async () => {
  while (sandboxes.length > 0) {
    const path = sandboxes.pop();
    if (path !== undefined) await rm(path, { recursive: true, force: true });
  }
});

interface CheckOutcome {
  readonly exitCode: number;
  readonly stderr: string;
}

/**
 * A throwaway git repository. The checker resolves its own root with
 * `git rev-parse --show-toplevel` from the working directory, which is what lets
 * this run it against a fixture instead of against the repository under test.
 */
async function sandbox(
  files: Readonly<Record<string, string>>,
  options: { readonly stage?: boolean; readonly name?: string } = {},
): Promise<string> {
  const root = await mkdtemp(join("/tmp", options.name ?? "dosSc"));
  sandboxes.push(root);

  await run("git", ["init", "-q"], { cwd: root });
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
  if (options.stage !== false) {
    await run("git", ["add", "-A"], { cwd: root });
  }
  return root;
}

async function check(cwd: string): Promise<CheckOutcome> {
  try {
    const { stderr } = await run(process.execPath, [CHECK_ENTRY], { cwd });
    return { exitCode: 0, stderr };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    return { exitCode: failure.code ?? -1, stderr: failure.stderr ?? "" };
  }
}

describe("the repository check gate", () => {
  it("passes a repository that names nothing forbidden", async () => {
    const root = await sandbox({
      "src/fine.ts": 'export const brainPath = "DeveloperBrain";\n',
      "docs/notes.md": "The Brain is the user's vault.\n",
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  it("fails, and names file and line, on a tracked violation", async () => {
    const root = await sandbox({
      "src/bad.ts": `const a = 1;\nexport const v = "${VAULT_ABSOLUTE}";\n`,
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("src/bad.ts:2");
  });

  /**
   * The bug this file was written for. `#` terminates a URL path, so splicing a
   * filename into a `file://` URL made `readFile` miss it — and the error was
   * swallowed, so the run reported success.
   */
  it("scans a file whose name would truncate a URL", async () => {
    const root = await sandbox({
      "src/issue#12.ts": `export const v = "${VAULT_TILDE}/x";\n`,
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("issue#12.ts");
  });

  /**
   * The same defect at the other end: when the *repository root* contained a
   * `#`, every `readFile` resolved to the wrong place, every file was skipped,
   * and the gate went green on a repository full of violations.
   */
  it("scans everything when the repository root would truncate a URL", async () => {
    const parent = await mkdtemp(join("/tmp", "dosHash"));
    sandboxes.push(parent);
    const root = join(parent, "re#po");
    await mkdir(root, { recursive: true });
    await run("git", ["init", "-q"], { cwd: root });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/bad.ts"), `const v = "${VAULT_TILDE}";\n`);
    await run("git", ["add", "-A"], { cwd: root });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("src/bad.ts");
  });

  it("scans a file that has been written but never staged", async () => {
    const root = await sandbox(
      { "src/new.ts": `export const v = "${VAULT_TILDE}/x";\n` },
      { stage: false },
    );

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("src/new.ts");
  });

  it("respects .gitignore, which is why git does the enumerating", async () => {
    const root = await sandbox({
      ".gitignore": "generated/\n",
      "generated/vendored.ts": `const v = "${VAULT_TILDE}";\n`,
    });

    expect((await check(root)).exitCode).toBe(0);
  });

  it("tolerates a file deleted from the tree but still in the index", async () => {
    const root = await sandbox({ "src/fine.ts": "export const a = 1;\n" });
    await rm(join(root, "src/fine.ts"));

    expect((await check(root)).exitCode).toBe(0);
  });

  it("ignores binary content rather than reading paths out of it", async () => {
    const root = await sandbox({
      "assets/blob.bin": `PNG${String.fromCharCode(0)}${VAULT_TILDE}\n`,
    });

    expect((await check(root)).exitCode).toBe(0);
  });

  it("fails when it cannot read a file at all, rather than skipping it", async () => {
    const root = await sandbox({ "src/secret.ts": "export const a = 1;\n" });
    await run("chmod", ["000", join(root, "src/secret.ts")]);

    const outcome = await check(root);

    try {
      expect(outcome.exitCode).toBe(1);
      expect(outcome.stderr).toContain("could not be read");
    } finally {
      await run("chmod", ["644", join(root, "src/secret.ts")]);
    }
  });

  it("fails, and names file and line, on an identity rendered through a number", async () => {
    const root = await sandbox({
      "src/record.ts": `const stats = await lstat(path);\nconst ino = String(stats.ino);\n`,
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("src/record.ts:2");
  });

  it("accepts the exact encoding, and the banned spelling in prose", async () => {
    const root = await sandbox({
      "src/record.ts":
        `// String(stats.ino) rounds above 2^53.\n` +
        `const message = "String(stats.dev)";\n` +
        `const ino = stats.ino.toString(10);\n`,
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  /**
   * The three shapes the rendering rule cannot see. Each is as lossy as the
   * banned spelling and compiles clean, so the stat call itself is what has to
   * fail.
   */
  it.each([
    { name: "an exact-looking rendering of a number", body: "const ino = stats.ino.toString(10);" },
    { name: "template interpolation", body: "const key = `${stats.dev}:${stats.ino}`;" },
    { name: "destructuring", body: "const { dev, ino } = stats;" },
  ])("fails on a number-valued stat behind $name", async ({ body }) => {
    const root = await sandbox({
      "src/record.ts": `const stats = await nodeFs.lstat(path);\n${body}\n`,
    });

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("src/record.ts:1");
  });

  it("accepts the same module once the stat asks for bigint fields", async () => {
    const root = await sandbox({
      "src/record.ts":
        "const stats = await nodeFs.lstat(path, { bigint: true });\n" +
        "const key = `${stats.dev}:${stats.ino}`;\n",
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  it("leaves a module that records no identity alone", async () => {
    const root = await sandbox({
      "src/read.ts": `const stats = await nodeFs.lstat(path);\nexport const big = stats.size > 10;\n`,
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  it("accepts a call that states why it must stay on number-valued stats", async () => {
    const root = await sandbox({
      "src/record.ts":
        `// identity-free stat: mtimeMs's fraction, never dev/ino.\n` +
        `const stats = await nodeFs.stat(path);\n` +
        `export const when = stats.mtimeMs;\nexport const ino = other.ino;\n`,
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  /**
   * The one path exemption the bigint rule needs, exercised so that removing it
   * breaks a test rather than silently widening the rule: this port's `lstat`
   * takes a path and nothing else.
   */
  it("exempts the lifecycle guarded port's own callers", async () => {
    const root = await sandbox({
      "packages/core/src/lifecycle/allocator.ts":
        `const entry = await fs.lstat(path);\nexport const ino = entry.ino;\n`,
    });

    expect(await check(root)).toStrictEqual({ exitCode: 0, stderr: "" });
  });

  it("fails outside a git checkout instead of finding nothing", async () => {
    const root = await mkdtemp(join("/tmp", "dosNoGit"));
    sandboxes.push(root);

    const outcome = await check(root);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain("git checkout");
  });
});
