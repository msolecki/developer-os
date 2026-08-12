import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

import { redactText } from "@developer-os/security";

/**
 * Deliberately `/tmp` and not `os.tmpdir()`. On macOS the per-user temporary
 * directory is `/var/folders/<2>/<30 random chars>/T/`, and an executable path
 * beneath it is long and high-entropy enough that the product's redactor
 * rewrites it — at which point `MacOsPlatformAdapter` correctly refuses to
 * report a path it can no longer vouch for, and agent discovery reports nothing.
 *
 * That is not fatal: `doctor` grades the refusal as a warning and `init`
 * completes. But it is fatal *to these tests*, which assert that a planted fake
 * `claude` is discovered and that every check passes. Under `os.tmpdir()` the
 * lifecycle case fails on `agents` reporting absence — a much quieter and more
 * confusing signal than the one this guard produces. Foundation is macOS-only,
 * so `/tmp` is always present.
 */
const SANDBOX_BASE = "/tmp";
const PREFIX = "dos";
const SANDBOX_NAME = /^dos[A-Za-z0-9]{6}$/u;

/**
 * Any 32 bytes. The redactor's verdict depends on the text, never on the key —
 * the key only fingerprints what it found — so a fixed one is enough to ask
 * "would this path survive?".
 */
const PROBE_KEY = new Uint8Array(32).fill(7);

/**
 * The harness depends on a property of its own paths, so it checks that
 * property instead of trusting it. Without this, moving the sandbox one
 * directory deeper makes the lifecycle case fail on an agent it planted itself
 * being reported absent, and nothing in that failure points here.
 */
function assertDiscoverablePath(path: string): void {
  if (redactText(path, PROBE_KEY).text === path) return;

  throw new Error(
    `the sandbox executable path ${path} is rewritten by the product redactor, ` +
      "so agent discovery would refuse it. Keep the sandbox root short and low-entropy.",
  );
}

export interface TempHome {
  /** The one directory these tests may delete. Everything else lives under it. */
  readonly root: string;
  /** `HOME` for the child process. */
  readonly home: string;
  /** `DEVELOPER_OS_HOME`. */
  readonly productHome: string;
  /** `DEVELOPER_OS_BRAIN`. */
  readonly brain: string;
  /** The entire `PATH` the child process gets. */
  readonly binDir: string;
  /** `TMPDIR`, inside the inventory, so a stray temp file is a visible failure. */
  readonly tempDir: string;
}

/**
 * Creates an isolated environment for one test. The name is random and
 * deliberately uninformative: `mkdtemp` already adds six characters, and every
 * character spent on a label is a character closer to the redaction threshold
 * that `assertDiscoverablePath` guards.
 *
 * The root is canonicalized because macOS resolves `/tmp` to `/private/tmp` and
 * the product canonicalizes every path it records. Handing a test the
 * uncanonical form would make every declared path disagree with every recorded
 * path, for a reason that has nothing to do with the product.
 */
export async function createTempHome(): Promise<TempHome> {
  const base = await realpath(SANDBOX_BASE);
  const root = await realpath(await mkdtemp(join(base, PREFIX)));

  const home = join(root, "home");
  const binDir = join(root, "bin");
  const tempDir = join(root, "tmp");
  for (const directory of [home, binDir, tempDir]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  assertDiscoverablePath(join(binDir, "claude"));

  return {
    root,
    home,
    productHome: join(home, ".developer-os"),
    brain: join(home, "DeveloperBrain"),
    binDir,
    tempDir,
  };
}

/**
 * Deletes the exact directory this helper created and nothing else. The name
 * check is the guard: a recursive delete driven by a value a test computed is
 * the one operation in this suite that could reach outside the sandbox.
 */
export async function removeTempHome(home: TempHome): Promise<void> {
  const base = await realpath(SANDBOX_BASE);
  if (
    !isAbsolute(home.root) ||
    dirname(home.root) !== base ||
    !SANDBOX_NAME.test(basename(home.root))
  ) {
    throw new Error(
      `refusing to remove ${home.root}: not a temporary home this helper created`,
    );
  }
  await rm(home.root, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * Plants a fake agent binary on the child's `PATH`. It is a shell script that
 * prints and exits.
 *
 * **It is executed, and it was not always.** Foundation's discovery never ran
 * an executable, and this comment used to say that anything the fake wrote
 * would be evidence of a boundary violation. DOS-P4's `doctor` capability check
 * runs `claude --version` through the discovered path, so the fake now runs on
 * every `doctor` invocation in the end-to-end suite — which is why its default
 * body exits non-zero and writes nothing but a line on stderr. A body that
 * touches the filesystem would now be a real side effect, not a tripwire.
 */
export async function installFakeExecutable(
  home: TempHome,
  name: string,
  body = `#!/bin/sh\necho "fake ${name} must never be executed" >&2\nexit 97\n`,
): Promise<string> {
  const path = join(home.binDir, name);
  await writeFile(path, body, { mode: 0o755 });
  return path;
}

/**
 * Absolute path to a description of what is at it: `dir`, `file:<sha256>`,
 * `link:<target>`, `unreadable`, or `other`. Absolute rather than relative so a
 * snapshot compares directly against the absolute paths the CLI declares.
 */
export type Inventory = ReadonlyMap<string, string>;

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function isDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "EACCES" || error.code === "EPERM")
  );
}

async function walk(directory: string, into: Map<string, string>): Promise<void> {
  let names: readonly string[];
  try {
    names = (await readdir(directory)).sort();
  } catch (error) {
    if (isDenied(error)) {
      into.set(directory, "unreadable");
      return;
    }
    if (isMissing(error)) return;
    throw error;
  }

  for (const name of names) {
    const path = join(directory, name);
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }

    /**
     * Symlinks are recorded, never followed. Following one would inventory the
     * target as though it lived inside the sandbox, which is precisely the
     * confusion the symlink-escape cases exist to detect.
     */
    if (stats.isSymbolicLink()) {
      into.set(path, `link:${await readlink(path)}`);
      continue;
    }
    if (stats.isDirectory()) {
      into.set(path, "dir");
      await walk(path, into);
      continue;
    }
    if (stats.isFile()) {
      try {
        into.set(
          path,
          `file:${createHash("sha256").update(await readFile(path)).digest("hex")}`,
        );
      } catch (error) {
        if (!isDenied(error)) throw error;
        into.set(path, "unreadable");
      }
      continue;
    }
    into.set(path, "other");
  }
}

/**
 * Every path beneath `root`, with a content hash for every regular file. The
 * root itself is excluded so that comparing two snapshots reports only what the
 * command under test did.
 */
export async function inventory(root: string): Promise<Inventory> {
  const entries = new Map<string, string>();
  await walk(root, entries);
  return entries;
}

export function addedPaths(
  before: Inventory,
  after: Inventory,
): readonly string[] {
  return [...after.keys()].filter((path) => !before.has(path)).sort();
}

export function removedPaths(
  before: Inventory,
  after: Inventory,
): readonly string[] {
  return [...before.keys()].filter((path) => !after.has(path)).sort();
}

export function changedPaths(
  before: Inventory,
  after: Inventory,
): readonly string[] {
  return [...before.entries()]
    .filter(([path, value]) => after.has(path) && after.get(path) !== value)
    .map(([path]) => path)
    .sort();
}

/**
 * Every regular file beneath `root` whose bytes contain `needle`.
 *
 * Decoded as `latin1` rather than `utf8` on purpose: it maps every byte to a
 * character without loss, so an ASCII marker is still found inside a file that
 * is not valid UTF-8. A sentinel scan that silently skipped binary output would
 * be worse than no scan.
 */
export async function filesContaining(
  root: string,
  needle: string,
): Promise<readonly string[]> {
  const hits: string[] = [];
  for (const [path, kind] of await inventory(root)) {
    if (!kind.startsWith("file:")) continue;
    if ((await readFile(path, "latin1")).includes(needle)) hits.push(path);
  }
  return hits.sort();
}

/** True when `candidate` is `root` itself or lies beneath it. */
export function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}
