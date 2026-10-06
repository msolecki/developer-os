/**
 * Regenerate a checked-in plugin tree (`plugins/claude/`, `plugins/codex/`) from
 * `workflows/` and the default `instructions/` (never user overrides;
 * `foundation.md` §12.1). `render-claude.ts` and `render-codex.ts` are the entry
 * points; this is the one copy of the guarded delete they share.
 *
 * **Not a CLI command, and that is a correction to the plan.** DOS-P4's Task 10
 * said to add `developer-os workflow render --vendor claude`. Taken literally the
 * step conflicts with the design it implements: the adapter writes to exactly one
 * directory — the plugin directory under the user's vendor home — and a shipped
 * verb that writes `./plugins/<vendor>` into whatever directory a user happens to
 * stand in writes somewhere else entirely, outside the manifest, outside a
 * transaction, and outside every guarantee Foundation makes about mutation.
 * `plugins/` exists only in a source checkout, so the tool that regenerates it
 * belongs to the repository rather than to the product.
 *
 * The composition is the vendor's `renderAllFor<Vendor>`, which
 * `tests/contracts/adapters/<vendor>/generated.test.ts` also calls. A generator
 * and its drift check that call different code are checking nothing. The Codex
 * tree is `renderCodexPlugin`'s plugin-root-relative composition; the marketplace
 * descriptor lives at the marketplace root, outside `plugins/codex/`.
 */
import { realpathSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { cwd } from "node:process";
import { fileURLToPath } from "node:url";

/** `tests/dist/tools/render-plugin.js` → the checkout that contains it. */
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * The guard on the only recursive deletes in this repository's tooling has to
 * be worth something.
 *
 * The first version checked that the target path *ended with* `plugins/claude`
 * — which the expression that built it guarantees, so it could never throw for
 * any working directory, including `/`. A fresh-context review demonstrated it:
 * a decoy directory with a `workflows/` tree and a `plugins/claude/` of its own,
 * entered directly with `node`, lost files. What actually needs checking is that
 * the working directory this tool derives every path from is the checkout the
 * tool itself was built into.
 */
export function assertRepositoryRoot(workingDirectory: string, repositoryRoot: string): void {
  if (resolve(workingDirectory) !== resolve(repositoryRoot)) {
    throw new Error(
      `refusing to regenerate: this tool reads workflows/ and instructions/ and replaces a plugins/ tree relative to the working directory, which is ${workingDirectory} rather than the checkout it belongs to, ${repositoryRoot}`,
    );
  }
}

export interface RegenerateOptions {
  readonly render: () => Promise<readonly { readonly path: string; readonly contents: string }[]>;
  readonly generatedRoot: string;
  readonly workingDirectory?: string;
  readonly repositoryRoot?: string;
}

/**
 * Every root is a parameter, so a test can drive this against a temporary tree
 * and prove the guard runs **before** the delete. The first version took none:
 * its tests exercised `assertRepositoryRoot` as a pure function, so deleting the
 * call from here left them all green while restoring exactly the behaviour that
 * lost a decoy directory's files. Found by fresh-context review, 2026-08-11.
 */
export async function regenerate(options: RegenerateOptions): Promise<number> {
  assertRepositoryRoot(options.workingDirectory ?? cwd(), options.repositoryRoot ?? REPOSITORY_ROOT);

  const artifacts = await options.render();
  if (artifacts.length === 0) {
    throw new Error(
      "rendered no artifacts; writing an empty tree would delete the plugin and pass every scan that reads it",
    );
  }

  // Removed before it is written, so a workflow that stops existing takes its
  // artifact with it rather than leaving one nothing regenerates.
  await rm(options.generatedRoot, { recursive: true, force: true });
  for (const artifact of artifacts) {
    const destination = join(options.generatedRoot, artifact.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, artifact.contents, "utf8");
  }
  return artifacts.length;
}

/**
 * True only when `entry` (`argv[1]`) is the module at `moduleUrl`, so importing
 * an entry point — from a test, say — can never rewrite `plugins/`.
 *
 * Through `realpath`, because Node resolves `import.meta.url` to the real path
 * while `argv[1]` keeps whatever symlink was invoked. Comparing them raw made a
 * symlinked entry point exit 0 having done nothing at all, which is a worse
 * failure than refusing: the maintainer reads success and gets a stale tree.
 */
export function isEntryPoint(entry: string | undefined, moduleUrl: string): boolean {
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
}
