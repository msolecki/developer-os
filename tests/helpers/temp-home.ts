import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { MacOsPlatformAdapter } from "@developer-os/platform-macos";
import { redactText } from "@developer-os/security";

/**
 * **A short alias under the repository; the bytes normally live there too.**
 *
 * It was `/tmp` and deliberately not `os.tmpdir()`: on macOS the per-user temporary
 * directory is `/var/folders/<2>/<30 random chars>/T/`, and an executable path beneath it
 * is long and high-entropy enough that the product's redactor rewrites it — at which point
 * `MacOsPlatformAdapter` correctly refuses to report a path it can no longer vouch for,
 * and agent discovery reports nothing. `assertDiscoverablePath` below still guards that
 * property, and it is why the sandbox root must stay short and low-entropy.
 *
 * **What `/tmp` cannot survive is the trust check.** It resolves to `/private/tmp`, mode
 * `1777` — world-writable — and `assertTrustedExecutable` refuses a binary with a
 * world-writable ancestor, sticky bit or not, because sticky stops another user *deleting*
 * a file they do not own and does not stop them *creating* one under a name nothing owns
 * yet (BACKLOG NEW-15). The two suites that spawn a planted binary went red on a correct
 * refusal, which is the guard working rather than a harness to exempt.
 *
 * **Whether the repository root satisfies the trust check is a claim about the reader's
 * machine, and this file does not make it — it tests it.** `assertTrustedPath` below runs
 * the product's own `assertTrustedExecutable` against every planted binary.
 *
 * A managed Codex workspace adds one more constraint: it can permit `mkdir`, symlink and
 * unlink below the checkout while refusing regular-file creation and `rmdir`. A one-time
 * capability probe detects that host. There, ordinary HOME bytes live under `/tmp` (short,
 * writable and removable), executable bytes live under the user's private `os.tmpdir()`
 * (not world-writable), and `.tmp-home/dosXXXXXX` is only the short lexical symlink placed
 * on `PATH`. The trust guard checks both the declared and resolved chains, so this remains
 * a real trust test rather than an exemption. `.tmp-home/` is git-ignored and every backing
 * directory plus its alias is removed after the case.
 */
const SANDBOX_BASE = fileURLToPath(new URL("../../.tmp-home", import.meta.url));
const PREFIX = "dos";
const SANDBOX_NAME = /^dos[A-Za-z0-9]{6}$/u;

interface SplitSandboxCleanup {
  readonly root: string;
  readonly executableRoot: string;
  readonly alias: string;
  validated: boolean;
  rootRemoved: boolean;
  executableRootRemoved: boolean;
  aliasRemoved: boolean;
}

const SPLIT_SANDBOXES = new WeakMap<TempHome, SplitSandboxCleanup>();
const SPLIT_SANDBOXES_BY_ROOT = new Map<string, SplitSandboxCleanup>();
let canCreateWorkspaceFiles: Promise<boolean> | null = null;

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

async function probeWorkspaceFileCreation(): Promise<boolean> {
  await mkdir(SANDBOX_BASE, { recursive: true, mode: 0o700 });
  const probeDirectory = join(SANDBOX_BASE, ".capability-probe");
  await mkdir(probeDirectory, { recursive: true, mode: 0o700 });
  const probe = join(
    probeDirectory,
    `.write-probe-${randomBytes(8).toString("hex")}`,
  );
  try {
    await writeFile(probe, "", { flag: "wx", mode: 0o600 });
    await unlink(probe);
    await rmdir(probeDirectory);
    return true;
  } catch (error) {
    await unlink(probe).catch(() => undefined);
    if (isDenied(error)) return false;
    throw error;
  }
}

function workspaceAcceptsRegularFiles(): Promise<boolean> {
  canCreateWorkspaceFiles ??= probeWorkspaceFileCreation();
  return canCreateWorkspaceFiles;
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
  await mkdir(SANDBOX_BASE, { recursive: true, mode: 0o700 });
  const base = await realpath(SANDBOX_BASE);
  if (!(await workspaceAcceptsRegularFiles())) {
    return createSplitTempHome(base);
  }

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

async function createSplitTempHome(aliasBase: string): Promise<TempHome> {
  const dataBase = await realpath("/tmp");
  const root = await realpath(await mkdtemp(join(dataBase, PREFIX)));
  const executableBase = await realpath(tmpdir());
  const executableRoot = await realpath(
    await mkdtemp(join(executableBase, `${basename(root)}-bin-`)),
  );
  const alias = join(aliasBase, basename(root));

  try {
    await symlink(executableRoot, alias, "dir");
    const home = join(root, "home");
    const tempDir = join(root, "tmp");
    for (const directory of [home, tempDir]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
    }
    assertDiscoverablePath(join(alias, "claude"));

    const sandbox: TempHome = {
      root,
      home,
      productHome: join(home, ".developer-os"),
      brain: join(home, "DeveloperBrain"),
      binDir: alias,
      tempDir,
    };
    const cleanup: SplitSandboxCleanup = {
      root,
      executableRoot,
      alias,
      validated: false,
      rootRemoved: false,
      executableRootRemoved: false,
      aliasRemoved: false,
    };
    SPLIT_SANDBOXES.set(sandbox, cleanup);
    SPLIT_SANDBOXES_BY_ROOT.set(root, cleanup);
    return sandbox;
  } catch (error) {
    const cleanupFailures = await cleanupSplitTargets({
      root,
      executableRoot,
      alias,
      validated: true,
      rootRemoved: false,
      executableRootRemoved: false,
      aliasRemoved: false,
    });
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        "split sandbox creation and cleanup both failed",
      );
    }
    throw error;
  }
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function cleanupSplitTargets(
  cleanup: SplitSandboxCleanup,
): Promise<readonly unknown[]> {
  const results = await Promise.allSettled([
    cleanup.rootRemoved
      ? Promise.resolve()
      : rm(cleanup.root, { recursive: true, force: true, maxRetries: 3 }).then(
          () => {
            cleanup.rootRemoved = true;
          },
        ),
    cleanup.executableRootRemoved
      ? Promise.resolve()
      : rm(cleanup.executableRoot, {
          recursive: true,
          force: true,
          maxRetries: 3,
        }).then(() => {
          cleanup.executableRootRemoved = true;
        }),
    cleanup.aliasRemoved
      ? Promise.resolve()
      : unlinkIfPresent(cleanup.alias).then(() => {
          cleanup.aliasRemoved = true;
        }),
  ]);
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === "rejected") failures.push(result.reason as unknown);
  }
  return failures;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/**
 * Deletes the exact directory this helper created and nothing else. The name
 * check is the guard: a recursive delete driven by a value a test computed is
 * the one operation in this suite that could reach outside the sandbox.
 */
export async function removeTempHome(home: TempHome): Promise<void> {
  const split = SPLIT_SANDBOXES.get(home);
  if (split !== undefined) {
    if (home.root !== split.root || home.binDir !== split.alias) {
      throw new Error(
        `refusing to remove split sandbox ${home.root}: its roots or alias changed`,
      );
    }
    if (!split.validated) {
      const dataBase = await realpath("/tmp");
      const executableBase = await realpath(tmpdir());
      const executableName = basename(split.executableRoot);
      if (
        !isAbsolute(split.root) ||
        dirname(split.root) !== dataBase ||
        !SANDBOX_NAME.test(basename(split.root)) ||
        split.alias !== home.binDir ||
        dirname(split.alias) !== (await realpath(SANDBOX_BASE)) ||
        basename(split.alias) !== basename(split.root) ||
        dirname(split.executableRoot) !== executableBase ||
        !executableName.startsWith(`${basename(split.root)}-bin-`) ||
        (await realpath(split.alias)) !== split.executableRoot
      ) {
        throw new Error(
          `refusing to remove split sandbox ${home.root}: its roots or alias changed`,
        );
      }
      split.validated = true;
    }

    const cleanupFailures = await cleanupSplitTargets(split);
    const [rootExists, executableRootExists, aliasExists] = await Promise.all([
      pathExists(split.root),
      pathExists(split.executableRoot),
      pathExists(split.alias),
    ]);
    split.rootRemoved = !rootExists;
    split.executableRootRemoved = !executableRootExists;
    split.aliasRemoved = !aliasExists;
    const targetsRemain = rootExists || executableRootExists || aliasExists;
    if (!targetsRemain) {
      SPLIT_SANDBOXES.delete(home);
      SPLIT_SANDBOXES_BY_ROOT.delete(split.root);
    }
    if (cleanupFailures.length > 0 || targetsRemain) {
      throw new AggregateError(
        cleanupFailures,
        `split sandbox cleanup left one or more targets for ${home.root}`,
      );
    }
    return;
  }

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
  await assertTrustedPath(path);
  return path;
}

/**
 * **Runs the product's own trust check against the planted binary, rather than restating
 * its rule.** `assertDiscoverablePath` is strong precisely because it calls the real
 * `redactText` instead of re-implementing the entropy heuristic, so it cannot drift; this
 * is the same move for the second property the sandbox now depends on.
 *
 * The sandbox moved off `/tmp` on 2026-08-17 because `/private/tmp` is mode `1777` and
 * `assertTrustedExecutable` refuses a world-writable ancestor (BACKLOG NEW-15). The
 * replacement is under the repository — but **that is a claim about the reader's machine
 * that this repository cannot make**: a checkout under `/private/tmp`, which agent
 * worktrees and some CI runners produce, puts a `1777` ancestor above every planted
 * binary again. Without this the failure would surface as an agent reported absent or
 * `ingest` exiting 5, which is exactly the quiet, misdirecting signal
 * `assertDiscoverablePath` exists to prevent.
 */
async function assertTrustedPath(path: string): Promise<void> {
  const adapter = new MacOsPlatformAdapter({
    runner: {
      run: () =>
        Promise.reject(new Error("the trust probe spawns nothing")),
    },
  });
  try {
    await adapter.assertTrustedExecutable(path);
  } catch (error) {
    throw new Error(
      `the sandbox executable ${path} is refused by the product's own trust check, ` +
        "so agent discovery would decline it. The sandbox base must sit under a chain " +
        "of user- or root-owned, non-world-writable directories — see SANDBOX_BASE in " +
        `tests/helpers/temp-home.ts. Underlying refusal: ${String(error)}`,
    );
  }
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

async function walk(
  directory: string,
  into: Map<string, string>,
  visibleDirectory = directory,
): Promise<void> {
  let names: readonly string[];
  try {
    names = (await readdir(directory)).sort();
  } catch (error) {
    if (isDenied(error)) {
      into.set(visibleDirectory, "unreadable");
      return;
    }
    if (isMissing(error)) return;
    throw error;
  }

  for (const name of names) {
    const path = join(directory, name);
    const visiblePath = join(visibleDirectory, name);
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
      into.set(visiblePath, `link:${await readlink(path)}`);
      continue;
    }
    if (stats.isDirectory()) {
      into.set(visiblePath, "dir");
      await walk(path, into, visiblePath);
      continue;
    }
    if (stats.isFile()) {
      try {
        into.set(
          visiblePath,
          `file:${createHash("sha256").update(await readFile(path)).digest("hex")}`,
        );
      } catch (error) {
        if (!isDenied(error)) throw error;
        into.set(visiblePath, "unreadable");
      }
      continue;
    }
    into.set(visiblePath, "other");
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
  const split = SPLIT_SANDBOXES_BY_ROOT.get(root);
  if (split !== undefined) {
    const visibleBin = join(root, "bin");
    entries.set(visibleBin, "dir");
    await walk(split.executableRoot, entries, visibleBin);
  }
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
