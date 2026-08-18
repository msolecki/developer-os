import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const runProcess = promisify(execFile);
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/**
 * **One production entry to `redactText`, and this is what keeps it one.**
 *
 * Spec §8.2 describes a user-extensible redaction class — the one a founder uses for a
 * client name no generic pattern catches. It was specified and never wired: `redactText`
 * took a `userPatterns` option that **no production caller passed**, and `configSchema`
 * was `.strict()` with no table a user could set (BACKLOG NEW-16, closed 2026-08-17).
 * Fourteen call sites each passed two arguments, and adding the fifteenth correctly would
 * have meant finding and changing all of them — which is the shape this gate now prevents
 * recurring. The table exists (`packages/core/src/config/loader.ts:208`); the present
 * tense above described the state this file was written to end.
 *
 * `createRedactor` binds the key and the patterns once, where the configuration is in
 * scope. Without this gate a new call site can reach for `redactText` directly, compile,
 * pass every test, and silently opt out of the user's own redaction patterns — a failure
 * whose symptom is a client name reaching a vendor model.
 *
 * **The key is the second reason and the older one.** Binding it into a closure stops a
 * `Uint8Array` travelling as a parameter through capture, review, ingest and init, each
 * of which had to be trusted not to log, hash or persist it (spec §8.4).
 */
/**
 * **Every scope that structurally *can* call `redactText`, derived from the dependency
 * graph rather than guessed.** The first version of this list named `packages/core`,
 * which does not depend on `@developer-os/security` at all — an unfalsifiable floor — and
 * omitted all four packages that do. A new `redactText(text, key)` in
 * `packages/adapter-codex/src/invoke.ts`, which is precisely where text meets a vendor
 * model, would have passed.
 *
 * Verified 2026-08-17 against each `package.json`: `brain`, `adapter-claude`,
 * `adapter-codex`, `platform-macos` and `workflow-schema` declare the dependency; `core`
 * does not.
 *
 * **`tests/` is included where a harness redacts, and the rule is which harness rather
 * than which directory.** `tests/helpers` holds the sandbox builder that asks whether the
 * product's own redactor would rewrite a path; `tests/security` holds the suite harness,
 * which imports the security barrel and calls no redactor. Both are listed so the
 * distinction is enforced rather than asserted — if `tests/security/helpers.ts` ever
 * starts redacting, this gate has an opinion about it.
 */
const SCOPES = [
  "apps/cli/src",
  "packages/adapter-claude/src",
  "packages/adapter-codex/src",
  "packages/brain/src",
  "packages/platform-macos/src",
  "packages/security/src",
  "packages/workflow-schema/src",
  "tests/helpers",
  "tests/security",
] as const;

/**
 * The module that defines it, which necessarily calls it — plus one harness.
 * `tests/helpers/temp-home.ts` asks "would the product's redactor rewrite this path?" of
 * a sandbox path, which is a question about `redactText`'s own behaviour and has no
 * configuration to honour.
 */
const ALLOWED = [
  "packages/security/src/redaction.ts",
  "tests/helpers/temp-home.ts",
] as const;

/**
 * **Tests are out of scope, and the distinction is the point rather than a concession.**
 * This gate is about *production wiring*: a command that reaches for `redactText` opts
 * out of the user's configured patterns for real captures. A test constructing a
 * redaction closure to build a fixture opts out of nothing — it has no configuration to
 * honour, and several deliberately pin `redactText`'s own contract, which is where that
 * contract belongs. Requiring them to route through `createRedactor` would test the
 * wrapper instead of the thing wrapped.
 */
const TEST_FILE = /\.test\.ts$/u;

const DIRECT_CALL = /\bredactText\s*\(/u;

async function sourceFiles(): Promise<{
  readonly root: string;
  readonly paths: readonly string[];
}> {
  const { stdout: top } = await runProcess("git", ["rev-parse", "--show-toplevel"]);
  const root = top.trim();
  /**
   * Tracked **and** untracked-but-not-ignored, for the reason `control-bytes.test.ts`
   * gives: the gate runs before `git add`, which is exactly when a newly written
   * offending file exists and has never been staged.
   */
  const list = async (args: readonly string[]): Promise<readonly string[]> => {
    const { stdout } = await runProcess("git", [...args], {
      cwd: root,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    return stdout.split("\0").filter((path) => path.length > 0);
  };
  const [tracked, untracked] = await Promise.all([
    list(["ls-files", "-z"]),
    list(["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return {
    root,
    paths: [...new Set([...tracked, ...untracked])]
      .filter((path) => path.endsWith(".ts"))
      .sort(),
  };
}

describe("createRedactor is the only production entry to redactText", () => {
  it("finds no direct call outside the module that defines it, per package", async () => {
    const { root, paths } = await sourceFiles();
    const offenders: string[] = [];
    const scanned = new Map<string, number>();

    for (const path of paths) {
      const scope = SCOPES.find((candidate) => path.startsWith(candidate));
      if (scope === undefined || TEST_FILE.test(path)) continue;
      scanned.set(scope, (scanned.get(scope) ?? 0) + 1);
      if ((ALLOWED as readonly string[]).includes(path)) continue;

      const source = await readFile(join(root, path), "utf8");
      if (DIRECT_CALL.test(source)) {
        offenders.push(`${path} calls redactText directly; use createRedactor`);
      }
    }

    /**
     * **Per scope, not in total.** A sweep that scans nothing passes, and a single global
     * count is satisfied by whichever package happens to be largest while another goes
     * unread — which is how the network-capability scan missed that `packages/brain` was
     * absent from its list entirely (BACKLOG NEW-1).
     */
    for (const scope of SCOPES) {
      expect(scanned.get(scope) ?? 0, `${scope} enumerated no files`).toBeGreaterThan(0);
    }
    expect(offenders).toStrictEqual([]);
  });

  /**
   * The sweep above passes because the tree is clean, which means it would also pass if
   * the pattern matched nothing. This is what makes it evidence.
   */
  it("detects a direct call when one exists", () => {
    expect(DIRECT_CALL.test("const x = redactText(value, key);")).toBe(true);
    expect(DIRECT_CALL.test("const x = redactText (value, key);")).toBe(true);
    expect(DIRECT_CALL.test("createRedactor(key)(value)")).toBe(false);
    /** A mention in prose is not a call, and this gate must not fire on a docblock. */
    expect(DIRECT_CALL.test(" * `redactText` is the module's own entry.")).toBe(false);
    /**
     * **What it cannot see, stated so a green run is not over-read**: a renamed import
     * (`import { redactText as r }`) escapes a name grep. Closing that needs a parse, and
     * the rename is a deliberate act rather than the oversight this gate exists to catch.
     */
    expect(DIRECT_CALL.test("import { redactText as r } from '…'; r(t, k)")).toBe(false);
  });
});
