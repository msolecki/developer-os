/**
 * Regenerate `plugins/claude/` from `workflows/`.
 *
 * **Not a CLI command, and that is a correction to the plan.** DOS-P4's Task 10
 * said to add `developer-os workflow render --vendor claude`, and Task 10 shipped
 * without it, recording the debt rather than hiding it. Taken literally the step
 * conflicts with the design it implements: spec §10 says the adapter writes to
 * exactly one directory — the plugin directory under the user's `~/.claude` — and
 * a shipped verb that writes `./plugins/claude` into whatever directory a user
 * happens to stand in writes somewhere else entirely, outside the manifest,
 * outside a transaction, and outside every guarantee Foundation makes about
 * mutation. `plugins/claude/` exists only in a source checkout, so the tool that
 * regenerates it belongs to the repository rather than to the product.
 *
 * The composition itself is `renderClaudePlugin`, in the package, so this tool
 * and `tests/contracts/adapters/claude/generated.test.ts` regenerate through the
 * same function. A generator and its drift check that call different code are
 * checking nothing.
 *
 * Run it with `npm run render:claude`. The drift test is what makes forgetting
 * to run it a red build rather than a silent divergence.
 */
import { realpathSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { argv, cwd, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import {
  GENERATED_ROOT,
  renderAllForClaude,
} from "../contracts/adapters/claude/render-all.js";

/** `tests/dist/tools/render-claude.js` → the checkout that contains it. */
const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * One of two recursive deletes in this repository — `render-codex.ts` carries
 * the other, guarded the same way — and the guard on it has to be worth
 * something.
 *
 * The first version checked that the target path *ended with* `plugins/claude`
 * — which the expression that built it guarantees, so it could never throw for
 * any working directory, including `/`. A fresh-context review demonstrated it:
 * a decoy directory with a `workflows/` tree and a `plugins/claude/` of its own,
 * entered directly with `node`, lost files. What actually needs checking is that
 * the working directory this tool derives every path from is the checkout the
 * tool itself was built into.
 */
export function assertRepositoryRoot(
  workingDirectory: string,
  repositoryRoot: string,
): void {
  if (resolve(workingDirectory) !== resolve(repositoryRoot)) {
    throw new Error(
      `refusing to regenerate: this tool reads workflows/ and replaces plugins/claude/ relative to the working directory, which is ${workingDirectory} rather than the checkout it belongs to, ${repositoryRoot}`,
    );
  }
}

export interface RegenerateOptions {
  readonly workingDirectory?: string;
  readonly repositoryRoot?: string;
  readonly generatedRoot?: string;
}

/**
 * Every root is a parameter with a default, so a test can drive this against a
 * temporary tree and prove the guard runs **before** the delete. The first
 * version took none: its tests exercised `assertRepositoryRoot` as a pure
 * function, so deleting the call from here left them all green while restoring
 * exactly the behaviour that lost a decoy directory's files. Found by
 * fresh-context review, 2026-08-11.
 */
export async function regenerate(
  options: RegenerateOptions = {},
): Promise<number> {
  const generatedRoot = options.generatedRoot ?? GENERATED_ROOT;
  assertRepositoryRoot(
    options.workingDirectory ?? cwd(),
    options.repositoryRoot ?? REPOSITORY_ROOT,
  );

  const artifacts = await renderAllForClaude();
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
 * Run only when this file is the entry point, so importing it — which the test
 * beside it does — cannot delete a directory.
 *
 * Through `realpath`, because Node resolves `import.meta.url` to the real path
 * while `argv[1]` keeps whatever symlink was invoked. Comparing them raw made a
 * symlinked entry point exit 0 having done nothing at all, which is a worse
 * failure than refusing: the maintainer reads success and gets a stale tree.
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
  stdout.write(`wrote ${String(written)} artifacts to plugins/claude\n`);
}
