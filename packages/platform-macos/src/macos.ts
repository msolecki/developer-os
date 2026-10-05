import { readlink, stat } from "node:fs/promises";
import { homedir, release } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";

import { EXIT_CODES } from "@developer-os/core";
import {
  canonicalizePlannedPath,
  type ProcessRunner,
  REDACTION_MARKER_PATTERN,
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
/** macOS `MAXSYMLINKS`: the kernel's own limit before `ELOOP`. */
const MAX_SYMLINK_HOPS = 32;

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
  /** A link's target, `null` when the path is not a link, and a rejection otherwise. */
  readonly readlink?: (path: string) => Promise<string | null>;
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

async function readlinkOrNull(path: string): Promise<string | null> {
  try {
    return await readlink(path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EINVAL") return null;
    throw error;
  }
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
    REDACTION_MARKER_PATTERN.test(candidate) ||
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
  readonly #readlink: (path: string) => Promise<string | null>;
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
    this.#readlink = options.readlink ?? readlinkOrNull;
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

  /**
   * **Resolves the way the kernel does, one component at a time**, and returns every real
   * directory the resolution passed through — among them the directory holding each
   * intermediate link, which canonicalizing the declared and resolved paths as wholes
   * never visits (BACKLOG NEW-32). `..` climbs from the real directory reached so far,
   * never lexically: `link/..` means the link target's parent, not the link's.
   *
   * **Every resolver failure is a refusal**, not a raw filesystem error: `ENOENT`,
   * `EACCES` and a loop past the kernel's own limit carry string codes that would
   * otherwise fall through `exitCodeOf` as an operational failure, and an attacker who
   * can write a PATH directory would pick which exit the user sees.
   */
  async #resolveStepwise(
    path: string,
  ): Promise<{ resolved: string; visited: readonly string[] }> {
    const pending = path.split("/");
    const visited = ["/"];
    let current = "/";
    let hops = 0;
    for (
      let component = pending.shift();
      component !== undefined;
      component = pending.shift()
    ) {
      if (component === "" || component === ".") continue;
      if (component === "..") {
        current = dirname(current);
        continue;
      }
      const candidate = join(current, component);
      let target: string | null;
      try {
        target = await this.#readlink(candidate);
      } catch {
        throw new MacOsPlatformTrustError(
          `The executable could not be verified: ${candidate} cannot be resolved`,
        );
      }
      if (target === null) {
        current = candidate;
        visited.push(current);
        continue;
      }
      hops += 1;
      if (hops > MAX_SYMLINK_HOPS) {
        throw new MacOsPlatformTrustError(
          `The executable could not be verified: ${path} has too many symbolic links`,
        );
      }
      if (isAbsolute(target)) current = "/";
      pending.unshift(...target.split("/"));
    }
    return { resolved: current, visited };
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
   * refused otherwise — and always refused when root owns it (D83 (3), NEW-33)**, even run
   * as root: a `root:admin 0775` `/usr/local/bin` lets every admin plant a binary.
   * `/opt/homebrew/bin` is `drwxrwxr-x` owned by the installing user, which is how these
   * CLIs ordinarily arrive. Admitting it is a usability trade-off accepted for Homebrew,
   * not a free one: the group bit lets every other member of that group (`admin` on this
   * Mac) plant a binary there. Refusing it would cost every `brew install`; the residual
   * awaits the founder's ruling.
   *
   * **Other-writable is refused with or without the sticky bit.** Sticky stops another
   * user deleting or renaming a file they do not own; it does not stop them *creating* one
   * under a name nothing owns yet, which is precisely the planted binary this refuses.
   *
   * **It fails closed.** An ancestor that cannot be inspected is a refusal, because a
   * check that treats "I could not look" as "it is fine" is not a check.
   *
   * **Every hop is inspected (BACKLOG NEW-32).** The first version walked three chains —
   * the resolved target's, the declared directory's, and that directory canonicalized —
   * and a declared path resolving *through* a directory the attacker owns before reaching
   * a trusted target was on none of them: a working bypass needing no race. The path is
   * now resolved component by component and every real directory the resolution enters
   * is checked, including the one holding each intermediate link, file or directory.
   *
   * **Two residuals, none of them closable here.** **macOS ACLs are invisible to mode
   * bits**: a directory can be `0755` and writable by another user through an ACL entry,
   * which `stat().mode` cannot see, so this check is a floor rather than a proof. And the
   * **check-then-use window** (BACKLOG NEW-35): the target is resolved and checked, then
   * executed by path, and closing it needs an exec-by-descriptor this runtime does not
   * offer. It is **not** NEW-20, which is `capture`'s quarantine race on a path only the
   * user can write.
   */
  async assertTrustedExecutable(path: string): Promise<void> {
    this.#assertSupportedPlatform();
    if (!isAbsolute(path)) {
      throw new MacOsPlatformInputError(
        "A trusted executable must be named by an absolute path",
      );
    }

    /**
     * **The directories the resolution entered, not the links it read, because the caller
     * executes the *declared* path.** A link in a directory the attacker owns is
     * retargeted after the check and before the spawn, however trusted its target was at
     * check time; they own that directory permanently, so they lose nothing by losing a
     * round. A link's own entry is skipped: its mode is not meaningful on macOS, and
     * refusing links is the policy that was withdrawn. Latest entered first, so a refusal
     * names the component nearest the executable, which is the one a user can act on.
     */
    const { resolved, visited } = await this.#resolveStepwise(path);
    const uid = this.#currentUid();
    const chain = [...new Set(visited)].reverse();

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
      if ((entry.mode & 0o020) !== 0 && (entry.uid === 0 || entry.uid !== uid)) {
        throw new MacOsPlatformTrustError(
          `The executable is not trusted: ${component} is group-writable and owned by ${entry.uid === 0 ? "root" : "another user"}`,
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
