import { stat } from "node:fs/promises";
import { homedir, release } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";

import { EXIT_CODES } from "@developer-os/core";
import {
  canonicalizePlannedPath,
  type ProcessRunner,
} from "@developer-os/security";

import type {
  AgentDiscovery,
  AgentName,
  PlatformAdapter,
  PlatformFacts,
} from "./types.js";

const WHICH_PATH = "/usr/bin/which";
const DISCOVERY_CWD = "/";
const DISCOVERY_TIMEOUT_MS = 5_000;
const FALLBACK_SEARCH_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const PRODUCT_STATE_DIRECTORY = ".developer-os";
const PROPOSED_BRAIN_DIRECTORY = "DeveloperBrain";
const AGENT_NAMES: readonly string[] = ["claude", "codex"];
const UNUSABLE_PATH_CHARACTERS = /\p{Cc}/u;
const REDACTION_MARKER = "[REDACTED:";

export class MacOsPlatformUnsupportedError extends Error {
  readonly code = EXIT_CODES.capabilityUnavailable;

  constructor(message: string) {
    super(message);
    this.name = "MacOsPlatformUnsupportedError";
  }
}

export class MacOsPlatformInputError extends Error {
  readonly code = EXIT_CODES.invalidInput;

  constructor(message: string) {
    super(message);
    this.name = "MacOsPlatformInputError";
  }
}

/**
 * A discovered binary this product will not execute. Distinct from
 * `MacOsPlatformDiscoveryError`, which means "we could not find one": this means we found
 * one and refuse to run it, and the two lead a caller to different places.
 */
export class MacOsPlatformTrustError extends Error {
  readonly code = EXIT_CODES.securityRefusal;

  constructor(message: string) {
    super(message);
    this.name = "MacOsPlatformTrustError";
  }
}

export class MacOsPlatformDiscoveryError extends Error {
  readonly code = EXIT_CODES.operationalFailure;

  constructor(message: string) {
    super(message);
    this.name = "MacOsPlatformDiscoveryError";
  }
}

export interface MacOsPlatformEnvironment {
  readonly platform: string;
  readonly architecture: string;
  readonly release: string;
  readonly userHome: string;
}

export interface MacOsPlatformAdapterOptions {
  readonly environment?: MacOsPlatformEnvironment;
  readonly runner: ProcessRunner;
  readonly searchPath?: string;
  readonly canonicalize?: (path: string) => Promise<string>;
  /**
   * Injected so a test can drive a fake ownership tree, which is the discipline every
   * other dependency in this constructor already follows. Returns the two fields the
   * trust check reads and nothing else, so a fake cannot accidentally satisfy it with a
   * whole `Stats`.
   */
  readonly stat?: (path: string) => Promise<{ uid: number; mode: number }>;
  readonly currentUid?: () => number;
}

interface SupportedPlatform {
  readonly architecture: "arm64" | "x64";
  readonly release: string;
}

function nodeEnvironment(): MacOsPlatformEnvironment {
  return {
    platform: process.platform,
    architecture: process.arch,
    release: release(),
    userHome: homedir(),
  };
}

/**
 * The resolved path and every ancestor up to `/`, deepest first. Deepest first so a
 * refusal names the most specific offending component, which is the one a user can act on.
 */
function ancestorsOf(resolved: string): readonly string[] {
  const chain: string[] = [];
  let current = normalize(resolved);
  for (;;) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return chain;
}

function missingAgent(name: AgentName): AgentDiscovery {
  return { name, installed: false, executablePath: null, version: null };
}

/**
 * `/usr/bin/which` exits 0 only when it printed exactly one absolute path, so
 * anything else on a zero exit is an abnormal execution, not agent absence.
 * `ProcessRunner` redacts its own output, and a high-entropy path segment comes
 * back rewritten but still absolute — reporting that as an installed path would
 * record an executable that never existed. Every control character is rejected,
 * not just the line terminators: the directory component comes from the
 * caller's PATH, and Task 8 renders this value to a terminal and writes it into
 * the installation manifest.
 */
function assertUsableDiscoveredPath(candidate: string): void {
  if (
    UNUSABLE_PATH_CHARACTERS.test(candidate) ||
    candidate.includes(REDACTION_MARKER) ||
    !isAbsolute(candidate)
  ) {
    throw new MacOsPlatformDiscoveryError(
      "Agent discovery returned an unusable executable path",
    );
  }
}

function assertHomeShape(userHome: string): string {
  if (userHome.includes("\0")) {
    throw new MacOsPlatformInputError(
      "The user home must not contain a NUL byte",
    );
  }
  if (!isAbsolute(userHome)) {
    throw new MacOsPlatformInputError("The user home must be an absolute path");
  }
  if (userHome.split("/").includes("..")) {
    throw new MacOsPlatformInputError("The user home must not traverse upward");
  }

  const normalized = normalize(userHome);
  if (normalized === "/") {
    throw new MacOsPlatformInputError(
      "The user home must not be the filesystem root",
    );
  }

  return normalized;
}

export class MacOsPlatformAdapter implements PlatformAdapter {
  readonly #environment: MacOsPlatformEnvironment;

  readonly #runner: ProcessRunner;

  readonly #searchPath: string;

  readonly #canonicalize: (path: string) => Promise<string>;
  readonly #stat: (path: string) => Promise<{ uid: number; mode: number }>;
  readonly #currentUid: () => number;

  constructor(options: MacOsPlatformAdapterOptions) {
    this.#environment = options.environment ?? nodeEnvironment();
    this.#runner = options.runner;
    const searchPath = options.searchPath ?? process.env.PATH ?? "";
    this.#searchPath =
      searchPath.length > 0 ? searchPath : FALLBACK_SEARCH_PATH;
    this.#canonicalize = options.canonicalize ?? canonicalizePlannedPath;
    this.#stat =
      options.stat ??
      (async (path: string) => {
        const stats = await stat(path);
        return { uid: stats.uid, mode: stats.mode };
      });
    this.#currentUid = options.currentUid ?? (() => process.getuid?.() ?? -1);
  }

  async inspect(): Promise<PlatformFacts> {
    const supported = this.#assertSupportedPlatform();
    const userHome = assertHomeShape(this.#environment.userHome);

    return {
      platform: "darwin",
      architecture: supported.architecture,
      release: supported.release,
      userHome: await this.#canonicalize(userHome),
    };
  }

  async discoverExecutable(name: AgentName): Promise<AgentDiscovery> {
    this.#assertSupportedPlatform();

    if (!AGENT_NAMES.includes(name)) {
      throw new MacOsPlatformInputError(
        "Agent discovery accepts only the claude and codex agents",
      );
    }
    if (this.#searchPath.includes("\0")) {
      throw new MacOsPlatformInputError(
        "The executable search path must not contain a NUL byte",
      );
    }

    const result = await this.#runner.run({
      executable: WHICH_PATH,
      args: [name],
      cwd: DISCOVERY_CWD,
      stdin: "",
      timeoutMs: DISCOVERY_TIMEOUT_MS,
      env: { PATH: this.#searchPath },
    });

    if (result.timedOut || result.signal !== null) {
      throw new MacOsPlatformDiscoveryError(
        "Agent discovery did not complete",
      );
    }
    if (result.exitCode !== 0) {
      return missingAgent(name);
    }

    const executablePath = result.stdout.trim();
    if (executablePath.length === 0) {
      return missingAgent(name);
    }
    assertUsableDiscoveredPath(executablePath);

    return { name, installed: true, executablePath, version: null };
  }

  /** Canonicalizes, or refuses: a path that cannot be resolved cannot be vouched for. */
  async #resolveOrRefuse(path: string): Promise<string> {
    try {
      return await this.#canonicalize(path);
    } catch {
      throw new MacOsPlatformTrustError(
        `The executable could not be verified: ${path} cannot be resolved`,
      );
    }
  }

  /**
   * **The check `types.ts` says every executor owes, paid here rather than at each call
   * site** — beside the promise, so an executor meets both in one interface (BACKLOG
   * NEW-15).
   *
   * **That is not the same as being unmissable, and the first version of this docblock
   * claimed it was.** Putting the method beside `discoverExecutable` does not call it;
   * three executors existed and the review of this change found the third — `doctor`,
   * whose `--probe` hands the path to capability probes that spawn it, one of them running
   * a subcommand that *mutates state* under the user's home. `discoverEachAgent` pays it
   * now. A fourth would arrive just as quietly, so the enumeration is the thing to keep
   * current, not the interface.
   *
   * **Resolve first, then check what the kernel will actually execute.** The founder
   * decided this on 2026-08-17 against refusing a symbolic link outright: `claude` and
   * `codex` arrive as links on an ordinary install, and refusing the link refuses this
   * product's own vendors while saying nothing about the file that runs.
   *
   * **Group-writable is accepted when the directory's owner is the current uid, and
   * refused otherwise.** `/opt/homebrew/bin` is `drwxrwxr-x` owned by the installing user,
   * which is how these CLIs ordinarily arrive; a user who owns a directory can write it
   * whatever its group bit says, so refusing on the bit alone buys nothing and costs every
   * `brew install`.
   *
   * **Other-writable is refused with or without the sticky bit.** Sticky stops another
   * user deleting or renaming a file they do not own; it does not stop them *creating* one
   * under a name nothing owns yet, which is precisely the planted binary this refuses.
   *
   * **It fails closed.** An ancestor that cannot be inspected is a refusal, because a
   * check that treats "I could not look" as "it is fine" is not a check.
   *
   * **Three residuals, none of them closable here, in the order a reader should fix
   * them** — an earlier version led with the least of the three. **A middle symlink hop**
   * (BACKLOG NEW-32) is a working bypass and needs no race: a declared path resolving
   * through a directory the attacker owns before reaching a trusted target is on none of
   * the three chains, because closing it needs stepwise `readlink` resolution rather than
   * two canonicalizations. **macOS ACLs are invisible to mode bits**: a directory can be
   * `0755` and writable by another user through an ACL entry, which `stat().mode` cannot
   * see, so this check is a floor rather than a proof. And the **check-then-use window**
   * (BACKLOG NEW-35) is the weakest: the target is resolved and checked, then executed by
   * path, and closing it needs an exec-by-descriptor this runtime does not offer. It is
   * **not** NEW-20 — this sentence said it was, and NEW-32's own row corrects the
   * conflation: NEW-20 is `capture`'s quarantine race, on a path only the user can write.
   */
  async assertTrustedExecutable(path: string): Promise<void> {
    this.#assertSupportedPlatform();
    if (!isAbsolute(path)) {
      throw new MacOsPlatformInputError(
        "A trusted executable must be named by an absolute path",
      );
    }

    /**
     * **The resolver is wrapped too, and leaving it unwrapped made "fails closed" only
     * half true.** `realpath` raises `ELOOP` on a symlink loop and `EACCES` on an
     * unsearchable directory, and those errors carry a *string* `code` — so they fell
     * through `exitCodeOf`'s numeric check and surfaced as an operational failure at
     * exit 1 rather than the security refusal at exit 5. An attacker who can write a
     * directory on `PATH` plants a loop named `claude` and picks which of those the user
     * sees. Nothing untrusted ran either way; what leaked was the product's own account
     * of why it stopped.
     */
    const resolved = await this.#resolveOrRefuse(path);
    const uid = this.#currentUid();

    /**
     * **Both chains, because the caller executes the *declared* path.** Checking only the
     * resolved chain left the hole this guard exists to close: a symlink in a directory
     * the attacker owns, pointing at a trusted target, passed — a real file in the same
     * directory was refused — and the attacker retargets the link after the check and
     * before the spawn. They own that directory permanently, so they lose nothing by
     * losing a round.
     *
     * The declared path's own entry is skipped: a symbolic link's mode is not meaningful
     * on macOS and refusing links is the policy that was withdrawn. What matters is the
     * **directory holding it, and the real directory that one resolves to** — see the
     * third chain below, and the residual for what a *middle* hop can still hide.
     */
    /**
     * **Three chains, and the third exists because `ancestorsOf` is string arithmetic
     * while `stat` follows links.** Walking the declared path's parents *lexically* sees
     * a symlinked directory component's **target** mode and then keeps climbing the
     * link's own parents — so an attacker-owned directory the link points *into* is
     * visited by nobody. A PATH directory that is itself a symlink into a world-writable
     * one was accepted with the first two chains alone.
     *
     * Canonicalizing the declared directory drags that target's real parents into the
     * walk. On an ordinary install it changes nothing — `~/.local/bin` and
     * `/opt/homebrew/bin` canonicalize to themselves — so both vendors and every
     * `brew install` still pass.
     */
    const declaredDirectory = dirname(normalize(path));
    const chain = new Set([
      ...ancestorsOf(resolved),
      ...ancestorsOf(declaredDirectory),
      ...ancestorsOf(await this.#resolveOrRefuse(declaredDirectory)),
    ]);

    /**
     * **A trusted *executable*, not merely a trusted path.** Without this,
     * `assertTrustedExecutable("/")` resolves happily, and a directory, a FIFO or a
     * device would satisfy a method whose name promises a file. Cheap to check, and this
     * sits on a public interface that will grow callers.
     */
    let target: { uid: number; mode: number };
    try {
      target = await this.#stat(resolved);
    } catch {
      throw new MacOsPlatformTrustError(
        `The executable could not be verified: ${resolved} cannot be inspected`,
      );
    }
    if ((target.mode & 0o170000) !== 0o100000) {
      throw new MacOsPlatformTrustError(
        `The executable is not trusted: ${resolved} is not a regular file`,
      );
    }

    for (const component of chain) {
      let entry: { uid: number; mode: number };
      try {
        entry = await this.#stat(component);
      } catch {
        throw new MacOsPlatformTrustError(
          `The executable could not be verified: ${component} cannot be inspected`,
        );
      }

      if (entry.uid !== uid && entry.uid !== 0) {
        throw new MacOsPlatformTrustError(
          `The executable is not trusted: ${component} is owned by neither this user nor root`,
        );
      }
      if ((entry.mode & 0o002) !== 0) {
        throw new MacOsPlatformTrustError(
          `The executable is not trusted: ${component} is writable by any user`,
        );
      }
      if ((entry.mode & 0o020) !== 0 && entry.uid !== uid) {
        throw new MacOsPlatformTrustError(
          `The executable is not trusted: ${component} is group-writable and owned by another user`,
        );
      }
    }
  }

  productStateRoot(userHome: string): string {
    this.#assertDarwin();
    return join(assertHomeShape(userHome), PRODUCT_STATE_DIRECTORY);
  }

  proposedBrainRoot(userHome: string): string {
    this.#assertDarwin();
    return join(assertHomeShape(userHome), PROPOSED_BRAIN_DIRECTORY);
  }

  #assertDarwin(): void {
    const { platform } = this.#environment;
    if (platform !== "darwin") {
      throw new MacOsPlatformUnsupportedError(
        `Developer OS supports macOS only; this host reports ${platform}`,
      );
    }
  }

  #assertSupportedPlatform(): SupportedPlatform {
    this.#assertDarwin();

    const { architecture } = this.#environment;
    const osRelease = this.#environment.release;

    if (architecture !== "arm64" && architecture !== "x64") {
      throw new MacOsPlatformUnsupportedError(
        `Developer OS supports arm64 and x64 only; this host reports ${architecture}`,
      );
    }
    if (osRelease.length === 0 || osRelease.includes("\0")) {
      throw new MacOsPlatformUnsupportedError(
        "The macOS release could not be determined",
      );
    }

    return { architecture, release: osRelease };
  }
}
