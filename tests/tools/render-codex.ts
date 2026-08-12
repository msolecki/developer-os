/**
 * Regenerate `plugins/codex/` from `workflows/`.
 *
 * **Not a CLI command, and that is a correction to the plan.** The Claude
 * adapter's `render-claude.ts` records why: `plugins/codex/` exists only in a
 * source checkout, so the tool that regenerates it belongs to the repository
 * rather than to the product. `renderCodexPlugin` is the plugin-root-relative
 * composition — `.codex-plugin/plugin.json`, `skills/developer-os-<id>/SKILL.md`
 * — which is what gets checked in here. `renderCodexInstallTree` is a
 * different thing: it re-roots that same tree onto the marketplace root and
 * adds the marketplace descriptor, which carries a real absolute path
 * resolved against a product home at install time, so it has no place in a
 * checked-in tree and this tool never calls it.
 *
 * The composition itself is `renderCodexPlugin`, in the package, so this tool
 * and `tests/contracts/adapters/codex/generated.test.ts` regenerate through
 * the same function. A generator and its drift check that call different
 * code are checking nothing.
 *
 * Run it with `npm run render:codex`. The drift test is what makes forgetting
 * to run it a red build rather than a silent divergence.
 */
import { realpathSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { argv, cwd, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import {
  GENERATED_ROOT,
  renderAllForCodex,
} from "../contracts/adapters/codex/render-all.js";

/** `tests/dist/tools/render-codex.js` → the checkout that contains it. */
const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * The only recursive delete in this repository beside the Claude adapter's
 * own, and the guard on it has to be worth something.
 *
 * See `render-claude.ts`'s `assertRepositoryRoot` for the full record: a
 * guard that only checks the target path *ends with* `plugins/codex` can
 * never throw for any working directory, because the expression that builds
 * that path already guarantees it. What actually needs checking is that the
 * working directory this tool derives every path from is the checkout the
 * tool itself was built into.
 */
export function assertRepositoryRoot(
  workingDirectory: string,
  repositoryRoot: string,
): void {
  if (resolve(workingDirectory) !== resolve(repositoryRoot)) {
    throw new Error(
      `refusing to regenerate: this tool reads workflows/ and replaces plugins/codex/ relative to the working directory, which is ${workingDirectory} rather than the checkout it belongs to, ${repositoryRoot}`,
    );
  }
}

export interface RegenerateOptions {
  readonly workingDirectory?: string;
  readonly repositoryRoot?: string;
  readonly generatedRoot?: string;
}

/**
 * Every root is a parameter with a default, so a test can drive this against
 * a temporary tree and prove the guard runs **before** the delete. See
 * `render-claude.ts`'s `regenerate` for why: a version that exercised
 * `assertRepositoryRoot` only as a pure function could have its call site
 * deleted from here and stay green.
 */
export async function regenerate(
  options: RegenerateOptions = {},
): Promise<number> {
  const generatedRoot = options.generatedRoot ?? GENERATED_ROOT;
  assertRepositoryRoot(
    options.workingDirectory ?? cwd(),
    options.repositoryRoot ?? REPOSITORY_ROOT,
  );

  const artifacts = await renderAllForCodex();
  if (artifacts.length === 0) {
    throw new Error(
      "rendered no artifacts; writing an empty tree would delete the plugin and pass every scan that reads it",
    );
  }

  // Removed before it is written, so a workflow that stops existing takes its
  // artifact with it rather than leaving one nothing regenerates.
  await rm(generatedRoot, { recursive: true, force: true });
  for (const artifact of artifacts) {
    const destination = join(generatedRoot, artifact.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, artifact.contents, "utf8");
  }
  return artifacts.length;
}

/**
 * Run only when this file is the entry point, so importing it — which the
 * test beside it does — cannot delete a directory.
 *
 * Through `realpath`, because Node resolves `import.meta.url` to the real
 * path while `argv[1]` keeps whatever symlink was invoked. Comparing them raw
 * made a symlinked entry point exit 0 having done nothing at all, which is a
 * worse failure than refusing: the maintainer reads success and gets a stale
 * tree.
 */
function isEntryPoint(entry: string | undefined): boolean {
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint(argv[1])) {
  const written = await regenerate();
  stdout.write(`wrote ${String(written)} artifacts to plugins/codex\n`);
}
