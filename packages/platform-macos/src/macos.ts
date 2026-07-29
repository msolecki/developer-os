import { homedir, release } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

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

  constructor(options: MacOsPlatformAdapterOptions) {
    this.#environment = options.environment ?? nodeEnvironment();
    this.#runner = options.runner;
    const searchPath = options.searchPath ?? process.env.PATH ?? "";
    this.#searchPath =
      searchPath.length > 0 ? searchPath : FALLBACK_SEARCH_PATH;
    this.#canonicalize = options.canonicalize ?? canonicalizePlannedPath;
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
