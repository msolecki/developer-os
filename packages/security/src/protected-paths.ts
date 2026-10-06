import { constants } from "node:fs";
import { open, stat, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  canonicalizePlannedPath,
  SecurityRefusalError,
} from "./paths.js";

export type ProtectedPathRuleId =
  | "read-env"
  | "read-env-variants"
  | "read-ssh"
  | "read-aws"
  | "read-gnupg"
  | "read-gh-hosts"
  | "read-codex-auth"
  | "read-claude-credentials";

export type ProtectedPathMatchV1 =
  /** Any path segment equal to `name`. */
  | { readonly kind: "segment"; readonly name: string }
  /** Any path segment starting with `prefix`, except a segment equal to one of `except`. */
  | {
      readonly kind: "segment-prefix";
      readonly prefix: string;
      readonly except?: readonly string[];
    }
  /** Exactly `<home>/<relativePath>`. */
  | { readonly kind: "home-exact"; readonly relativePath: string };

export interface ProtectedPathRuleV1 {
  readonly id: ProtectedPathRuleId;
  readonly match: ProtectedPathMatchV1;
}

/** The single source every `ProtectedPathPolicy` refusal is derived from. */
export const PROTECTED_PATH_RULES: readonly ProtectedPathRuleV1[] = Object.freeze([
  { id: "read-env", match: { kind: "segment", name: ".env" } },
  {
    id: "read-env-variants",
    // D67: committed templates hold no secret. Claude's `Read(//**/.env.*)` still denies them.
    match: {
      kind: "segment-prefix",
      prefix: ".env.",
      except: [".env.example", ".env.sample", ".env.template", ".env.dist"],
    },
  },
  { id: "read-ssh", match: { kind: "segment", name: ".ssh" } },
  { id: "read-aws", match: { kind: "segment", name: ".aws" } },
  { id: "read-gnupg", match: { kind: "segment", name: ".gnupg" } },
  { id: "read-gh-hosts", match: { kind: "home-exact", relativePath: ".config/gh/hosts.yml" } },
  { id: "read-codex-auth", match: { kind: "home-exact", relativePath: ".codex/auth.json" } },
  {
    id: "read-claude-credentials",
    match: { kind: "home-exact", relativePath: ".claude/.credentials.json" },
  },
]);

/**
 * The name fold every protected-path comparison runs on (NEW-154). APFS compares names under full
 * Unicode case folding and normalization, so `.SSH`, `.ſsh`, `.ßh` and `.ssh` are one directory once
 * any of them exists. `toLowerCase` alone misses the full folds (ſ→s, ß/ẞ→ss, ﬁ→fi, ﬆ/ﬅ→st, Greek
 * iota-subscripts); the upper-then-lower round trip applies them, and the leading `toLowerCase`
 * is what folds ẞ. A sweep of every assigned code point on APFS found no name APFS merges that this
 * fold keeps apart; it over-merges only U+0131 ı with i, which adds refusals and nothing else.
 */
export function foldPathName(value: string): string {
  return value.normalize("NFC").toLowerCase().toUpperCase().toLowerCase().normalize("NFC");
}

function matchesSegmentRule(
  match: ProtectedPathMatchV1,
  segments: readonly string[],
): boolean {
  switch (match.kind) {
    case "segment":
      return segments.includes(foldPathName(match.name));
    case "segment-prefix":
      return segments.some(
        (segment) =>
          segment.startsWith(foldPathName(match.prefix)) &&
          !(match.except ?? []).some((name) => foldPathName(name) === segment),
      );
    case "home-exact":
      return false;
  }
}

function splitLexicalSegments(path: string): readonly string[] {
  return path.split(/[\\/]/u).filter((segment) => segment.length > 0);
}

async function defaultUtf8Reader(handle: FileHandle): Promise<string> {
  return handle.readFile({ encoding: "utf8" });
}

export class ProtectedPathPolicy {
  readonly #home: string;

  constructor(home: string) {
    if (home.includes("\0") || !isAbsolute(home)) {
      throw new SecurityRefusalError("Home path must be an absolute safe path");
    }
    this.#home = resolve(home);
  }

  async assertReadable(path: string): Promise<void> {
    await this.#resolveAllowed(path);
  }

  async assertWritable(path: string): Promise<void> {
    await this.#resolveAllowed(path);
  }

  async readText(
    path: string,
    reader: (handle: FileHandle) => Promise<string> = defaultUtf8Reader,
  ): Promise<string> {
    const canonicalPath = await this.#resolveAllowed(path);
    let expectedIdentity: Awaited<ReturnType<typeof stat>>;
    try {
      expectedIdentity = await stat(canonicalPath, { bigint: true });
    } catch {
      throw new SecurityRefusalError("Unable to verify readable file identity");
    }

    let handle: FileHandle;
    try {
      handle = await open(
        canonicalPath,
        // O_NONBLOCK: a FIFO with no writer would otherwise block open() forever,
        // before any caller could see that the entry is not a regular file.
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (cause) {
      // The errno rides on `cause` (never published) so a caller can tell a permission denial from a race.
      throw new SecurityRefusalError("Unable to open verified readable file", { cause });
    }

    try {
      let openedIdentity: Awaited<ReturnType<FileHandle["stat"]>>;
      try {
        openedIdentity = await handle.stat({ bigint: true });
      } catch {
        throw new SecurityRefusalError("Unable to verify opened file identity");
      }

      if (
        openedIdentity.dev !== expectedIdentity.dev ||
        openedIdentity.ino !== expectedIdentity.ino
      ) {
        throw new SecurityRefusalError("Readable file identity changed");
      }

      return await reader(handle);
    } finally {
      await handle.close();
    }
  }

  async #resolveAllowed(path: string): Promise<string> {
    const absolutePath = isAbsolute(path)
      ? resolve(path)
      : resolve(this.#home, path);

    this.#assertAllowed(absolutePath);
    const [canonicalHome, canonicalPath] = await Promise.all([
      canonicalizePlannedPath(this.#home),
      canonicalizePlannedPath(absolutePath),
    ]);
    this.#assertAllowed(canonicalPath, canonicalHome);
    return canonicalPath;
  }

  #assertAllowed(path: string, policyHome = this.#home): void {
    if (path.includes("\0")) {
      throw new SecurityRefusalError("Path contains a NUL byte");
    }

    const rawSegments = splitLexicalSegments(foldPathName(path));
    if (
      PROTECTED_PATH_RULES.some((rule) =>
        matchesSegmentRule(rule.match, rawSegments),
      )
    ) {
      throw new SecurityRefusalError("Path is protected");
    }

    // An exact match implies the path is within home, so no separate within-home test is needed.
    const absolutePath = foldPathName(resolve(path));
    const isProtectedExactPath = PROTECTED_PATH_RULES.some(
      (rule) =>
        rule.match.kind === "home-exact" &&
        foldPathName(resolve(policyHome, rule.match.relativePath)) === absolutePath,
    );
    if (isProtectedExactPath) {
      throw new SecurityRefusalError("Path is protected");
    }
  }
}
