import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, release, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES, resolveRuntimePaths } from "@developer-os/core";
import {
  redactText,
  type ProcessRequest,
  type ProcessResult,
  type ProcessRunner,
} from "@developer-os/security";

import type { AgentDiscovery, PlatformFacts } from "./types.js";
import {
  MacOsPlatformAdapter,
  type MacOsPlatformAdapterOptions,
  type MacOsPlatformEnvironment,
  MacOsPlatformDiscoveryError,
  MacOsPlatformInputError,
  MacOsPlatformTrustError,
  MacOsPlatformUnsupportedError,
} from "./macos.js";

const REDACTION_KEY = new Uint8Array(32).fill(7);

const DARWIN_ENVIRONMENT: MacOsPlatformEnvironment = {
  platform: "darwin",
  architecture: "arm64",
  release: "25.5.0",
  userHome: "/Users/example",
};

function processResult(overrides: Partial<ProcessResult>): ProcessResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
    timedOut: false,
    ...overrides,
  };
}

class RecordingRunner implements ProcessRunner {
  readonly requests: ProcessRequest[] = [];

  readonly #reply: (request: ProcessRequest) => ProcessResult;

  constructor(reply: (request: ProcessRequest) => ProcessResult) {
    this.#reply = reply;
  }

  run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    return Promise.resolve(this.#reply(request));
  }
}

function runnerReturning(result: Partial<ProcessResult>): RecordingRunner {
  return new RecordingRunner(() => processResult(result));
}

function createAdapter(
  overrides: Partial<MacOsPlatformAdapterOptions> = {},
): MacOsPlatformAdapter {
  return new MacOsPlatformAdapter({
    environment: DARWIN_ENVIRONMENT,
    runner: runnerReturning({ exitCode: 1 }),
    searchPath: "/usr/bin:/bin",
    ...overrides,
  });
}

async function captureRejection(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the operation to reject");
}

function captureThrow(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the operation to throw");
}

describe("MacOsPlatformAdapter.inspect", () => {
  it("reports Darwin facts for a supported architecture", async () => {
    const adapter = createAdapter();

    const facts: PlatformFacts = await adapter.inspect();

    expect(facts).toStrictEqual({
      platform: "darwin",
      architecture: "arm64",
      release: "25.5.0",
      userHome: "/Users/example",
    });
  });

  it("supports Intel Macs", async () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, architecture: "x64" },
    });

    const facts = await adapter.inspect();

    expect(facts.architecture).toBe("x64");
  });

  it("refuses a non-Darwin platform with the capability-unavailable code", async () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, platform: "linux" },
    });

    const error = await captureRejection(adapter.inspect());

    expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
    expect((error as MacOsPlatformUnsupportedError).code).toBe(
      EXIT_CODES.capabilityUnavailable,
    );
  });

  it("refuses an unsupported architecture with the capability-unavailable code", async () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, architecture: "ia32" },
    });

    const error = await captureRejection(adapter.inspect());

    expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
    expect((error as MacOsPlatformUnsupportedError).code).toBe(
      EXIT_CODES.capabilityUnavailable,
    );
  });

  it("refuses an empty OS release", async () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, release: "" },
    });

    const error = await captureRejection(adapter.inspect());

    expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
  });

  it("canonicalizes a symlinked home directory", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "developer-os-platform-")),
    );
    const realHome = join(root, "real-home");
    const linkedHome = join(root, "linked-home");
    await mkdir(realHome);
    await symlink(realHome, linkedHome);

    try {
      const adapter = createAdapter({
        environment: { ...DARWIN_ENVIRONMENT, userHome: linkedHome },
      });

      const facts = await adapter.inspect();

      expect(facts.userHome).toBe(realHome);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a relative home directory as invalid input", async () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, userHome: "relative/home" },
    });

    const error = await captureRejection(adapter.inspect());

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
    expect((error as MacOsPlatformInputError).code).toBe(
      EXIT_CODES.invalidInput,
    );
  });

  it("refuses an upward-traversing home directory before canonicalizing", async () => {
    let canonicalized = false;
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, userHome: "/Users/example/.." },
      canonicalize: (path: string) => {
        canonicalized = true;
        return Promise.resolve(path);
      },
    });

    const error = await captureRejection(adapter.inspect());

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
    expect(canonicalized).toBe(false);
  });

  it("refuses the filesystem root as a home directory", async () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, userHome: "/" },
    });

    const error = await captureRejection(adapter.inspect());

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
  });

  it.runIf(process.platform === "darwin")(
    "reads host facts when no environment is injected",
    async () => {
      const adapter = new MacOsPlatformAdapter({
        runner: runnerReturning({ exitCode: 1 }),
      });

      const facts = await adapter.inspect();

      expect(facts.architecture).toBe(process.arch);
      expect(facts.release).toBe(release());
      expect(facts.userHome).toBe(await realpath(homedir()));
    },
  );

  it.skipIf(process.platform === "darwin")(
    "refuses host facts on a non-Darwin host",
    async () => {
      const adapter = new MacOsPlatformAdapter({
        runner: runnerReturning({ exitCode: 1 }),
      });

      const error = await captureRejection(adapter.inspect());

      expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
    },
  );

  it("starts no process", async () => {
    const runner = runnerReturning({ exitCode: 1 });
    const adapter = createAdapter({ runner });

    await adapter.inspect();

    expect(runner.requests).toStrictEqual([]);
  });
});

/**
 * **The check `packages/platform-macos/src/types.ts` says is owed.** That file states the
 * contract in its own words — whoever executes a discovered binary owes an owner and mode
 * check first — and until 2026-08-17 nothing paid it: `ingest` spawned the PATH-resolved
 * vendor and `capture` probed it, with no `stat`, no uid comparison and no mode comparison
 * anywhere on either path (BACKLOG NEW-15).
 *
 * **The policy is the founder's, decided after a stricter one was built and withdrawn.**
 * Refusing symbolic links and refusing every group-writable ancestor is defensible on
 * paper and refuses this product's own vendors: `claude` and `codex` are both links on the
 * founder's machine and `/opt/homebrew/bin` is `drwxrwxr-x`, so shipped as specified
 * `capture` would record `unknown` forever and `ingest` would exit 5 on every run.
 * Resolving instead of refusing is not a loosening of the symlink rule — it is the correct
 * rule, because the kernel executes the resolved target and that is the file whose
 * ownership decides anything.
 */
describe("MacOsPlatformAdapter.assertTrustedExecutable", () => {
  const ROOT = { uid: 0, mode: 0o755 };
  const USER = { uid: 501, mode: 0o755 };
  /** `/opt/homebrew/bin` on an Apple-silicon install: group-writable, user-owned. */
  const USER_GROUP_WRITABLE = { uid: 501, mode: 0o775 };
  /** `/private/tmp`: world-writable with the sticky bit. */
  const STICKY_WORLD_WRITABLE = { uid: 0, mode: 0o1777 };
  /**
   * A regular file: `S_IFREG` plus its permissions. The fixture carries the type bits
   * because the guard checks them — a "trusted executable" that accepted a directory
   * would be promising more than it verified.
   */
  const FILE = { uid: 501, mode: 0o100755 };

  function adapterSeeing(
    entries: Readonly<Record<string, { uid: number; mode: number }>>,
    resolved?: string,
    declared?: string,
  ): MacOsPlatformAdapter {
    return createAdapter({
      currentUid: () => 501,
      /**
       * **A function of its argument, not a constant.** Returning `resolved` for every
       * input made `#canonicalize(declaredDirectory)` yield the resolved *file*, so the
       * third chain collapsed onto the first and was untestable here — and the fixture
       * described a filesystem where canonicalizing a directory returns a file. Only the
       * declared path resolves; everything else, directories included, is its own
       * canonical form, which is true of every fixture in this suite.
       */
      ...(resolved === undefined
        ? {}
        : {
            canonicalize: (candidate: string) =>
              Promise.resolve(candidate === declared ? resolved : candidate),
          }),
      /**
       * **Unlisted paths reject rather than defaulting to trusted.** A fake that answers
       * `{uid: 501, mode: 0o755}` for anything not in the map is fail-*open* inside the
       * guard's own suite: a case would pass while the walk visited components the author
       * never thought about, which is exactly how the declared-path hole survived its
       * first review. Every fixture below lists the whole chain it means to describe.
       */
      stat: (path: string) => {
        const entry = entries[path];
        return entry === undefined
          ? Promise.reject(
              Object.assign(new Error(`ENOENT: ${path} is not in the fixture`), {
                code: "ENOENT",
              }),
            )
          : Promise.resolve({ uid: entry.uid, mode: entry.mode });
      },
    });
  }

  /**
   * The chain both vendors actually have on the founder's machine, traced 2026-08-17:
   * `~/.local/bin/claude` is a link into `~/.local/share/claude/versions/…`, and every
   * ancestor of the resolved target is the user's at mode 755.
   */
  it("accepts a symlink whose resolved target and ancestors are the user's", async () => {
    const adapter = adapterSeeing(
      {
        "/": ROOT,
        "/Users": ROOT,
        "/Users/u": USER,
        "/Users/u/.local": USER,
        "/Users/u/.local/bin": USER,
        "/Users/u/.local/share": USER,
        "/Users/u/.local/share/claude": USER,
        "/Users/u/.local/share/claude/claude": FILE,
      },
      "/Users/u/.local/share/claude/claude",
      "/Users/u/.local/bin/claude",
    );

    await expect(
      adapter.assertTrustedExecutable("/Users/u/.local/bin/claude"),
    ).resolves.toBeUndefined();
  });

  /**
   * The clause that makes an ordinary Homebrew install pass, and the one the withdrawn
   * guard lacked. A user who owns a directory can write it whatever its group bit says,
   * so refusing on the bit alone buys nothing and costs every `brew install`.
   */
  it("accepts a group-writable ancestor the user owns, because that is Homebrew", async () => {
    const adapter = adapterSeeing(
      {
        "/": ROOT,
        "/opt": ROOT,
        "/opt/homebrew": USER_GROUP_WRITABLE,
        "/opt/homebrew/bin": USER_GROUP_WRITABLE,
        "/opt/homebrew/bin/codex": FILE,
      },
      "/opt/homebrew/bin/codex",
    );

    await expect(
      adapter.assertTrustedExecutable("/opt/homebrew/bin/codex"),
    ).resolves.toBeUndefined();
  });

  it("refuses a group-writable ancestor somebody else owns", async () => {
    const adapter = adapterSeeing(
      {
        "/": ROOT,
        "/opt": ROOT,
        "/opt/shared": { uid: 502, mode: 0o775 },
        "/opt/shared/claude": FILE,
      },
      "/opt/shared/claude",
    );

    await expect(
      adapter.assertTrustedExecutable("/opt/shared/claude"),
    ).rejects.toThrow(MacOsPlatformTrustError);
  });

  /**
   * **The group-writable rule, pinned by a case only it can refuse.** The neighbouring
   * "somebody else owns" fixture never reaches this rule — uid 502 is refused by the
   * owner rule first — so deleting the group clause left the whole suite green. This one
   * is **root-owned**, which the owner rule accepts, and group-writable, which only this
   * clause refuses.
   *
   * It is also the exact shape `BACKLOG.md` §1 **NEW-33** asks the founder about:
   * `/usr/local` and `/usr/local/bin` are `drwxrwxr-x root:admin` on some Intel and
   * legacy installs, so a `claude` under one is refused today. Group `admin` means any
   * admin user can plant a binary there, which is the threat — but it is the same class
   * of false refusal that got the strict guard withdrawn, so the rule stands until the
   * founder rules on it and this case records what "stands" means.
   */
  it("refuses a root-owned group-writable ancestor, which the owner rule permits", async () => {
    const adapter = adapterSeeing(
      {
        "/": ROOT,
        "/usr": ROOT,
        "/usr/local": { uid: 0, mode: 0o775 },
        "/usr/local/bin": { uid: 0, mode: 0o775 },
        "/usr/local/bin/claude": FILE,
      },
      "/usr/local/bin/claude",
    );

    await expect(
      adapter.assertTrustedExecutable("/usr/local/bin/claude"),
    ).rejects.toThrow(MacOsPlatformTrustError);
  });

  /**
   * **A sticky bit does not make a world-writable directory safe here**, and the argument
   * survives from the withdrawn attempt: sticky stops another user deleting or renaming a
   * file they do not own; it does not stop them **creating** one under a name nothing owns
   * yet, which is precisely the planted binary this refuses.
   */
  it("refuses a world-writable ancestor even with the sticky bit", async () => {
    const adapter = adapterSeeing(
      {
        "/": ROOT,
        "/private": ROOT,
        "/private/tmp": STICKY_WORLD_WRITABLE,
        "/private/tmp/bin": USER,
        "/private/tmp/bin/claude": FILE,
      },
      "/private/tmp/bin/claude",
    );

    await expect(
      adapter.assertTrustedExecutable("/private/tmp/bin/claude"),
    ).rejects.toThrow(MacOsPlatformTrustError);
  });

  it("refuses an ancestor owned by neither the user nor root", async () => {
    const adapter = adapterSeeing(
      { "/": ROOT, "/opt": { uid: 502, mode: 0o755 }, "/opt/claude": FILE },
      "/opt/claude",
    );

    await expect(adapter.assertTrustedExecutable("/opt/claude")).rejects.toThrow(
      MacOsPlatformTrustError,
    );
  });

  /**
   * **The hole the first version of this guard had, and the direction an attacker can
   * actually take.** It checked only the resolved chain while both callers execute the
   * *declared* path — so a symbolic link in a directory the attacker owns, pointing at a
   * perfectly trusted target, was **accepted**, while a real file in the same directory
   * was refused. The attacker then retargets the link between the check and the spawn,
   * and since they own that directory permanently they lose nothing by losing a round.
   *
   * Planting a link in a *trusted* directory is not the threat: an attacker who can write
   * there would overwrite the binary instead.
   */
  it("refuses a link whose own directory is world-writable, however trusted its target", async () => {
    const adapter = adapterSeeing(
      {
        "/": ROOT,
        "/private": ROOT,
        "/private/tmp": STICKY_WORLD_WRITABLE,
        "/opt": ROOT,
        "/opt/homebrew": USER,
        "/opt/homebrew/bin": USER,
        "/opt/homebrew/bin/real-claude": FILE,
      },
      "/opt/homebrew/bin/real-claude",
      "/private/tmp/claude",
    );

    await expect(
      adapter.assertTrustedExecutable("/private/tmp/claude"),
    ).rejects.toThrow(MacOsPlatformTrustError);
  });

  /**
   * The mirror of the case above: resolving is still what makes the *target* checkable.
   */
  it("checks the resolved target, not only the path it was handed", async () => {
    const adapter = adapterSeeing(
      {
        "/": ROOT,
        "/private": ROOT,
        "/private/tmp": STICKY_WORLD_WRITABLE,
        "/private/tmp/planted": USER,
        "/private/tmp/planted/claude": FILE,
      },
      "/private/tmp/planted/claude",
      "/opt/homebrew/bin/claude",
    );

    await expect(
      adapter.assertTrustedExecutable("/opt/homebrew/bin/claude"),
    ).rejects.toThrow(MacOsPlatformTrustError);
  });

  it("refuses a relative path rather than resolving it against cwd", async () => {
    const adapter = adapterSeeing({ "/": ROOT }, "/unused");

    await expect(adapter.assertTrustedExecutable("bin/claude")).rejects.toThrow(
      MacOsPlatformInputError,
    );
  });

  /**
   * **The loop's own fail-closed branch, which nothing reached.** Every other fixture
   * lists a complete chain, and `refuses when an ancestor cannot be inspected` rejects at
   * the *file-type* stat — a different `catch` — before the loop starts. Deleting the
   * try/catch inside the loop left the suite green while an `EACCES` on a mid-chain
   * directory became a raw filesystem error with a string `code`, falling through to exit
   * 1: the same leak the resolver wrapper had just closed, one branch over.
   *
   * The fixture lists the resolved file and every component **except** one directory in
   * the middle, so only the loop can refuse it, and the message must name that component.
   */
  it("refuses when a mid-chain directory cannot be inspected", async () => {
    const adapter = adapterSeeing(
      {
        "/": ROOT,
        "/opt": ROOT,
        /** `/opt/vendor` is deliberately absent: the fake rejects what it does not list. */
        "/opt/vendor/bin": USER,
        "/opt/vendor/bin/claude": FILE,
      },
      "/opt/vendor/bin/claude",
    );

    await expect(
      adapter.assertTrustedExecutable("/opt/vendor/bin/claude"),
    ).rejects.toThrow(/\/opt\/vendor cannot be inspected/u);
  });

  /** An unreadable ancestor is a refusal, not a pass: the check must fail closed. */
  it("refuses when an ancestor cannot be inspected", async () => {
    const adapter = createAdapter({
      currentUid: () => 501,
      stat: () => Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" })),
    });

    await expect(
      adapter.assertTrustedExecutable("/opt/homebrew/bin/claude"),
    ).rejects.toThrow(MacOsPlatformTrustError);
  });
});

/**
 * **One suite against the real filesystem, because the map-based fixture above cannot
 * express the bug that mattered.** That fake maps a *lexical* path to a mode, and a
 * symlinked directory is precisely the case where the lexical path and the thing `stat`
 * answers about diverge — there is no row you can add to a flat map that says
 * "`stat(bin)` describes `ww/sub` while `dirname(bin/claude)` is still `bin`". Both holes
 * this guard shipped with were invisible to it by construction, and both are forty lines
 * of real `symlink` away (BACKLOG NEW-15).
 *
 * The base prefers the user's private per-user temporary directory after checking that the
 * current user owns it, neither group nor other may write it, and this process can write it.
 * `os.tmpdir()` honors `TMPDIR`, so `/tmp` is not assumed private merely because that API
 * returned it. An unsafe override falls back to the original home-based fixture on hosts
 * where the home is writable.
 */
async function sandboxBase(
  candidatePath = tmpdir(),
  fallbackPath = homedir(),
): Promise<string> {
  try {
    const candidate = await realpath(candidatePath);
    const candidateStats = await stat(candidate);
    const currentUid = process.getuid?.() ?? -1;
    if (
      candidateStats.isDirectory() &&
      candidateStats.uid === currentUid &&
      (candidateStats.mode & 0o022) === 0
    ) {
      await access(candidate, constants.W_OK);
      return candidate;
    }
  } catch {
    // The original home fixture below remains the safe fallback.
  }

  const fallback = await realpath(fallbackPath);
  await access(fallback, constants.W_OK);
  return fallback;
}

describe("MacOsPlatformAdapter.assertTrustedExecutable, against a real filesystem", () => {
  const roots: string[] = [];

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      /**
       * Tightened before removal so a killed run cannot leave a `0o777` directory in the
       * user's home — a smaller version of the thing this guard exists to refuse. The
       * root's own `0o700` shields it in the normal case; this covers the abnormal one.
       */
      await chmod(root, 0o700).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  async function sandbox(): Promise<string> {
    const root = await realpath(
      await mkdtemp(join(await sandboxBase(), ".dos-trust-")),
    );
    roots.push(root);
    return root;
  }

  it("falls back when the temporary-directory candidate is a regular file", async () => {
    const root = await sandbox();
    const candidate = join(root, "tmpdir-file");
    const fallback = join(root, "fallback");
    await writeFile(candidate, "not a directory", { mode: 0o600 });
    await mkdir(fallback, { mode: 0o700 });

    await expect(sandboxBase(candidate, fallback)).resolves.toBe(
      await realpath(fallback),
    );
  });

  function realAdapter(): MacOsPlatformAdapter {
    return new MacOsPlatformAdapter({
      environment: DARWIN_ENVIRONMENT,
      runner: runnerReturning({ exitCode: 1 }),
    });
  }

  it("accepts a binary whose whole chain is the user's", async () => {
    const root = await sandbox();
    await mkdir(join(root, "bin"), { mode: 0o755 });
    await writeFile(join(root, "bin", "claude"), "#!/bin/sh\n", { mode: 0o755 });

    await expect(
      realAdapter().assertTrustedExecutable(join(root, "bin", "claude")),
    ).resolves.toBeUndefined();
  });

  /**
   * The original hole: a link in a directory the attacker owns, pointing at a trusted
   * target. A real file in the same directory was already refused; the link was not.
   */
  it("refuses a link planted in a world-writable directory", async () => {
    const root = await sandbox();
    const open = join(root, "open");
    await mkdir(open);
    /** `mkdir`'s mode argument is masked by the umask, so the bit is set explicitly. */
    await chmod(open, 0o777);
    await symlink("/bin/ls", join(open, "claude"));

    await expect(
      realAdapter().assertTrustedExecutable(join(open, "claude")),
    ).rejects.toThrow(MacOsPlatformTrustError);
  });

  /**
   * The neighbour: the PATH directory is itself a symlink *into* a world-writable one.
   * Walking the declared parents lexically sees the target's mode and then climbs the
   * link's own parents, so the attacker's directory is visited by nobody — which is why
   * the declared directory is canonicalized before it is walked.
   */
  it("refuses when the directory holding the binary is a link into a world-writable one", async () => {
    const root = await sandbox();
    const open = join(root, "open");
    await mkdir(join(open, "sub"), { recursive: true });
    await chmod(open, 0o777);
    await symlink(join(open, "sub"), join(root, "bin"));
    await symlink("/bin/ls", join(open, "sub", "claude"));

    await expect(
      realAdapter().assertTrustedExecutable(join(root, "bin", "claude")),
    ).rejects.toThrow(MacOsPlatformTrustError);
  });

  /** A trusted *executable*: the resolved target must be a regular file. */
  it("refuses a directory, however trusted its chain", async () => {
    const root = await sandbox();
    await mkdir(join(root, "bin"), { mode: 0o755 });

    await expect(
      realAdapter().assertTrustedExecutable(join(root, "bin")),
    ).rejects.toThrow(MacOsPlatformTrustError);
  });

  /**
   * **The accept case that guards against over-refusing**, and the direction that got the
   * previous guard withdrawn. This is the founder's actual install shape — a link in a
   * `bin` directory resolving into a versioned directory two levels away — and nothing
   * else in this suite pins that three chains do not refuse it. A future attempt at
   * NEW-32's stepwise resolution is most likely to break exactly here.
   */
  it("accepts the vendor shape: a link resolving through two directories", async () => {
    const root = await sandbox();
    await mkdir(join(root, "share", "claude", "v1"), { recursive: true });
    await mkdir(join(root, "bin"));
    const real = join(root, "share", "claude", "v1", "claude");
    await writeFile(real, "#!/bin/sh\n", { mode: 0o755 });
    await symlink(real, join(root, "bin", "claude"));

    await expect(
      realAdapter().assertTrustedExecutable(join(root, "bin", "claude")),
    ).resolves.toBeUndefined();
  });

  /**
   * The Homebrew clause against a real directory: group-writable and owned by this user.
   * Its unit fixture is one of the five that refused for the wrong reason until the
   * resolved file was listed, so it is worth a case that cannot.
   */
  it("accepts a group-writable directory this user owns", async () => {
    const root = await sandbox();
    const bin = join(root, "bin");
    await mkdir(bin);
    await chmod(bin, 0o775);
    await writeFile(join(bin, "codex"), "#!/bin/sh\n", { mode: 0o755 });

    await expect(
      realAdapter().assertTrustedExecutable(join(bin, "codex")),
    ).resolves.toBeUndefined();
  });

  /**
   * `realpath` raises `ELOOP` here, whose `code` is a string — it escaped `exitCodeOf`'s
   * numeric check and surfaced as an operational failure until the resolver was wrapped.
   * An attacker who can write a PATH directory plants this and chooses the exit code.
   */
  it("refuses a symlink loop as a trust refusal, not an operational failure", async () => {
    const root = await sandbox();
    await symlink(join(root, "loopB"), join(root, "loopA"));
    await symlink(join(root, "loopA"), join(root, "loopB"));

    await expect(
      realAdapter().assertTrustedExecutable(join(root, "loopA")),
    ).rejects.toThrow(MacOsPlatformTrustError);
  });

  /**
   * **The case only the *lexical* declared chain refuses**, found by mutation testing —
   * deleting that chain left the whole suite green until this existed.
   *
   * The link lives in the directory the attacker owns and points at a perfectly trusted
   * one. Canonicalizing the declared directory yields `/usr/bin`, whose ancestors are all
   * root's, so the canonical chain is satisfied; the resolved chain is `/usr/bin` too.
   * Only walking the declared parents *as written* sees the `0777` directory the link
   * sits in — which is the directory the attacker replaces the link from.
   */
  it("refuses a link that lives in a world-writable directory but points at a trusted one", async () => {
    const root = await sandbox();
    const open = join(root, "open");
    await mkdir(open);
    await chmod(open, 0o777);
    await symlink("/usr/bin", join(open, "bin"));

    await expect(
      realAdapter().assertTrustedExecutable(join(open, "bin", "true")),
    ).rejects.toThrow(MacOsPlatformTrustError);
  });

  /**
   * **The exit code the class carries, pinned.** Every other assertion here checks the
   * *type*; none checked that `MacOsPlatformTrustError` maps to a security refusal. Change
   * its `code` to `operationalFailure` and the whole suite stayed green while `ingest`
   * began exiting 1 on an untrusted binary — which is the very distinction this class was
   * introduced to make.
   */
  it("carries the security-refusal exit code, not an operational one", async () => {
    const root = await sandbox();
    const open = join(root, "open");
    await mkdir(open);
    await chmod(open, 0o777);
    await writeFile(join(open, "claude"), "#!/bin/sh\n", { mode: 0o755 });

    await expect(
      realAdapter().assertTrustedExecutable(join(open, "claude")),
    ).rejects.toMatchObject({ code: EXIT_CODES.securityRefusal });
  });

  it("refuses a path that does not exist, failing closed", async () => {
    const root = await sandbox();

    await expect(
      realAdapter().assertTrustedExecutable(join(root, "bin", "absent")),
    ).rejects.toThrow(MacOsPlatformTrustError);
  });
});

describe("MacOsPlatformAdapter.discoverExecutable", () => {
  it("locates an agent through /usr/bin/which", async () => {
    const runner = runnerReturning({
      exitCode: 0,
      stdout: "/opt/homebrew/bin/claude\n",
    });
    const adapter = createAdapter({ runner });

    const discovery: AgentDiscovery =
      await adapter.discoverExecutable("claude");

    expect(discovery).toStrictEqual({
      name: "claude",
      installed: true,
      executablePath: "/opt/homebrew/bin/claude",
      version: null,
    });
    expect(runner.requests).toHaveLength(1);
    expect(runner.requests[0]?.executable).toBe("/usr/bin/which");
    expect(runner.requests[0]?.args).toStrictEqual(["claude"]);
    expect(runner.requests[0]?.stdin).toBe("");
    expect(runner.requests[0]?.cwd).toBe("/");
    expect(runner.requests[0]?.timeoutMs).toBeGreaterThanOrEqual(1_000);
  });

  it("forwards only PATH to the discovery process", async () => {
    const runner = runnerReturning({ exitCode: 1 });
    const adapter = createAdapter({ runner, searchPath: "/opt/homebrew/bin" });

    await adapter.discoverExecutable("codex");

    expect(runner.requests[0]?.env).toStrictEqual({
      PATH: "/opt/homebrew/bin",
    });
  });

  it.runIf((process.env.PATH ?? "").length > 0)(
    "defaults the search path to the inherited PATH",
    async () => {
      const runner = runnerReturning({ exitCode: 1 });
      const adapter = new MacOsPlatformAdapter({
        environment: DARWIN_ENVIRONMENT,
        runner,
      });

      await adapter.discoverExecutable("claude");

      expect(runner.requests[0]?.env["PATH"]).toBe(process.env.PATH);
    },
  );

  it("falls back to a usable search path when PATH is empty", async () => {
    const runner = runnerReturning({ exitCode: 1 });
    const adapter = createAdapter({ runner, searchPath: "" });

    await adapter.discoverExecutable("claude");

    expect(runner.requests[0]?.env["PATH"]).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("refuses discovery on an unsupported architecture", async () => {
    const runner = runnerReturning({ exitCode: 0 });
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, architecture: "ia32" },
      runner,
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
    expect(runner.requests).toStrictEqual([]);
  });

  it("reports a missing executable as data rather than an error", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: 1, stdout: "" }),
    });

    const discovery = await adapter.discoverExecutable("codex");

    expect(discovery).toStrictEqual({
      name: "codex",
      installed: false,
      executablePath: null,
      version: null,
    });
  });

  it("reports empty output as a missing executable", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: 0, stdout: "\n" }),
    });

    const discovery = await adapter.discoverExecutable("claude");

    expect(discovery.installed).toBe(false);
    expect(discovery.executablePath).toBeNull();
  });

  it("fails operationally on a relative discovery result", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: 0, stdout: "bin/claude\n" }),
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
  });

  it("fails operationally on a multi-line discovery result", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({
        exitCode: 0,
        stdout: "/opt/homebrew/bin/claude\n/usr/local/bin/claude\n",
      }),
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
  });

  it("fails operationally on a NUL-bearing discovery result", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: 0, stdout: "/usr/local/bin/cl\0aude\n" }),
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
  });

  it("fails operationally on a control-character discovery result", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({
        exitCode: 0,
        stdout: "/usr/local/bin/cl\u001baude\n",
      }),
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
  });

  it("never reports a redacted path as an installed executable", async () => {
    const redactedStdout = `${
      redactText("/Users/u/.cache/Qk3mZ9pLxV7wR2tYn4Bc8FdHj6Ks1AeU5Gv0/bin/claude", REDACTION_KEY).text
    }\n`;
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: 0, stdout: redactedStdout }),
    });

    expect(redactedStdout).toContain("[REDACTED:");

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
  });

  it("fails operationally when discovery times out", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: null, timedOut: true }),
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
    expect((error as MacOsPlatformDiscoveryError).code).toBe(
      EXIT_CODES.operationalFailure,
    );
  });

  it("fails operationally when discovery is killed by a signal", async () => {
    const adapter = createAdapter({
      runner: runnerReturning({ exitCode: null, signal: "SIGKILL" }),
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformDiscoveryError);
  });

  it("refuses an unknown agent name", async () => {
    const runner = runnerReturning({ exitCode: 0 });
    const adapter = createAdapter({ runner });

    const error = await captureRejection(
      adapter.discoverExecutable("launchctl" as "claude"),
    );

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
    expect((error as MacOsPlatformInputError).code).toBe(
      EXIT_CODES.invalidInput,
    );
    expect(runner.requests).toStrictEqual([]);
  });

  it("refuses a search path containing a NUL byte", async () => {
    const runner = runnerReturning({ exitCode: 0 });
    const adapter = createAdapter({ runner, searchPath: "/usr/bin\0/bin" });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
    expect(runner.requests).toStrictEqual([]);
  });

  it("refuses discovery on a non-Darwin platform", async () => {
    const runner = runnerReturning({ exitCode: 0 });
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, platform: "linux" },
      runner,
    });

    const error = await captureRejection(adapter.discoverExecutable("claude"));

    expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
    expect(runner.requests).toStrictEqual([]);
  });

  it("runs no Keychain, scheduler, or discovered executable", async () => {
    const runner = runnerReturning({
      exitCode: 0,
      stdout: "/opt/homebrew/bin/claude\n",
    });
    const adapter = createAdapter({ runner });

    await adapter.discoverExecutable("claude");
    await adapter.discoverExecutable("codex");

    const executables = runner.requests.map((request) => request.executable);
    expect(executables).toStrictEqual(["/usr/bin/which", "/usr/bin/which"]);
    expect(
      runner.requests.every((request) => request.args.length === 1),
    ).toBe(true);
  });
});

describe("MacOsPlatformAdapter path defaults", () => {
  it("places product state below the user home", () => {
    const adapter = createAdapter();

    expect(adapter.productStateRoot("/Users/example")).toBe(
      "/Users/example/.developer-os",
    );
  });

  it("proposes a Brain root beside the product state", () => {
    const adapter = createAdapter();

    expect(adapter.proposedBrainRoot("/Users/example")).toBe(
      "/Users/example/DeveloperBrain",
    );
  });

  it("keeps the product state and the proposed Brain root distinct", () => {
    const adapter = createAdapter();

    expect(adapter.productStateRoot("/Users/example")).not.toBe(
      adapter.proposedBrainRoot("/Users/example"),
    );
  });

  it("agrees with the core runtime path resolver", () => {
    const adapter = createAdapter();
    const userHome = "/Users/example";
    const runtimePaths = resolveRuntimePaths({ HOME: userHome });

    expect(adapter.productStateRoot(userHome)).toBe(runtimePaths.home);
    expect(adapter.proposedBrainRoot(userHome)).toBe(runtimePaths.brain);
  });

  it("resolves path defaults without an architecture or release check", () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, architecture: "ia32", release: "" },
    });

    expect(adapter.productStateRoot("/Users/example")).toBe(
      "/Users/example/.developer-os",
    );
  });

  it("refuses the filesystem root as a home", () => {
    const adapter = createAdapter();

    const error = captureThrow(() => adapter.proposedBrainRoot("/"));

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
  });

  it("normalizes a trailing separator", () => {
    const adapter = createAdapter();

    expect(adapter.productStateRoot("/Users/example/")).toBe(
      "/Users/example/.developer-os",
    );
  });

  it("refuses a relative home", () => {
    const adapter = createAdapter();

    const error = captureThrow(() => adapter.productStateRoot("Users/example"));

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
    expect((error as MacOsPlatformInputError).code).toBe(
      EXIT_CODES.invalidInput,
    );
  });

  it("refuses an upward-traversing home", () => {
    const adapter = createAdapter();

    const error = captureThrow(() =>
      adapter.proposedBrainRoot("/Users/example/.."),
    );

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
  });

  it("refuses a NUL-bearing home", () => {
    const adapter = createAdapter();

    const error = captureThrow(() =>
      adapter.productStateRoot("/Users/exa\0mple"),
    );

    expect(error).toBeInstanceOf(MacOsPlatformInputError);
  });

  it("refuses path defaults on a non-Darwin platform", () => {
    const adapter = createAdapter({
      environment: { ...DARWIN_ENVIRONMENT, platform: "linux" },
    });

    const error = captureThrow(() => adapter.productStateRoot("/Users/example"));

    expect(error).toBeInstanceOf(MacOsPlatformUnsupportedError);
  });
});
