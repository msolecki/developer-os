import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { env as processEnv } from "node:process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addedPaths,
  createTempHome,
  inventory,
  removeTempHome,
} from "../../helpers/temp-home.js";
import type { Inventory, TempHome } from "../../helpers/temp-home.js";
import { renderAllForClaude } from "../../contracts/adapters/claude/render-all.js";

const run = promisify(execFile);

/**
 * Resolved once, from `PATH`, in the parent. A machine without Claude Code must
 * still pass `npm run check` — a test that fails there converts "not installed"
 * into "broken", and CI runs on a runner that has no agent at all.
 */
async function findClaude(): Promise<string | null> {
  try {
    const { stdout } = await run("/usr/bin/which", ["claude"]);
    const path = stdout.trim();
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/**
 * Resolved at module load, **not** in `beforeAll`.
 *
 * `it.skipIf(...)` is evaluated while the suite is being constructed, which
 * happens before any hook runs. Assigning `claude` in `beforeAll` left it null
 * at every `skipIf`, so all four cases skipped unconditionally on every machine
 * — a suite that could never run, which is worse than no suite because it
 * reports as green. Caught by running it on a machine that does have Claude
 * Code installed and seeing four skips.
 */
const claude: string | null = await findClaude();

let temp: TempHome | null = null;
let before: Inventory = new Map();
/**
 * Captured after this suite writes the plugin and **before** any Claude
 * invocation, because `claude plugin validate` mutates the home it is pointed
 * at — see the write-scope test below.
 */
let afterOurWrites: Inventory = new Map();

beforeAll(async () => {
  if (claude === null) return;
  temp = await createTempHome();
  before = await inventory(temp.root);
  for (const artifact of await renderAllForClaude()) {
    const target = join(
      temp.home,
      ".claude",
      "skills",
      "developer-os",
      artifact.path,
    );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, artifact.contents, "utf8");
  }
  afterOurWrites = await inventory(temp.root);
}, 120_000);

afterAll(async () => {
  if (temp !== null) await removeTempHome(temp);
});

/**
 * `temp?.home ?? ""` appeared six times, and an empty string is a *relative*
 * path: had `beforeAll` failed after `claude` resolved, these cases would have
 * invoked a real Claude Code with `HOME: ""` and a plugin path resolved against
 * the repository's own working directory. Refusing once is shorter and safe.
 * Found by fresh-context review, 2026-08-11.
 */
function temporary(): TempHome {
  if (temp === null) {
    throw new Error("the temporary HOME was not created; refusing to run against a real installation without one");
  }
  return temp;
}

/**
 * The parent's `PATH`, not a fixed one.
 *
 * `PATH: "/usr/bin:/bin"` broke the npm distribution of Claude Code, which is a
 * Node script with an `env node` shebang — on a machine with `node` under nvm,
 * `/usr/bin/node` does not exist, so the command exits 127 and the suite
 * *fails* on a machine where Claude Code is installed and working. That is the
 * "not installed becomes broken" conversion this file exists to avoid, one
 * install shape over. `HOME` and `TMPDIR` stay pinned, which is what the
 * isolation actually depends on.
 */
function isolatedEnv(home: TempHome): Record<string, string> {
  return {
    HOME: home.home,
    PATH: processEnv.PATH ?? "/usr/bin:/bin",
    TMPDIR: home.tempDir,
  };
}

describe("the generated plugin against a real Claude Code installation", () => {
  it.skipIf(claude === null)(
    "validates with claude plugin validate",
    async () => {
      const home = temporary();
      const pluginDirectory = join(
        home.home,
        ".claude",
        "skills",
        "developer-os",
      );
      // Never `shell: true`, and the environment is not inherited wholesale.
      // `HOME` points at the temporary home so nothing this test does can reach
      // the developer's own `~/.claude`.
      const result = await run(
        claude ?? "",
        ["plugin", "validate", pluginDirectory],
        { env: isolatedEnv(home), timeout: 60_000 },
      );
      expect(result.stderr).not.toMatch(/error/iu);
    },
    120_000,
  );

  it.skipIf(claude === null)(
    "records the version it was proved against",
    async () => {
      // Isolated like every other invocation. This was the one call with no
      // `env`, so it inherited the developer's real `HOME` — and the sibling
      // case below documents that another subcommand writes into whatever home
      // it is given. One observation that `--version` writes nothing is not a
      // guarantee about the next release. Found by fresh-context review.
      const { stdout } = await run(claude ?? "", ["--version"], {
        env: isolatedEnv(temporary()),
        timeout: 30_000,
      });
      const version = /\b\d+\.\d+\.\d+\b/u.exec(stdout);
      expect(version).not.toBeNull();
      // Deliberately not asserted against a floor. Spec §15.1 records that the
      // skills-directory-plugin floor is established by probe, and one machine
      // is one observation rather than a range — so this proves the surface
      // works here and says nothing it cannot support.
      expect(version?.[0]).toMatch(/^\d+\.\d+\.\d+$/u);
    },
    60_000,
  );

  /**
   * Spec §4: the install writes one directory and no settings key. Measured
   * across *our* writes only — the snapshot is taken before any Claude
   * invocation, for the reason the next test records.
   */
  it.skipIf(claude === null)(
    "writes nothing outside the plugin directory",
    () => {
      const pluginRoot = join(
        temporary().home,
        ".claude",
        "skills",
        "developer-os",
      );
      const added = addedPaths(before, afterOurWrites);
      expect(added.length).toBeGreaterThan(0);
      // An ancestor of the plugin root is allowed — `.claude` and
      // `.claude/skills` have to exist for the plugin to live anywhere. Nothing
      // else may appear, and in particular no sibling of ours under `.claude`.
      const outside = added.filter(
        (path) => !path.startsWith(pluginRoot) && !pluginRoot.startsWith(path),
      );
      expect(outside).toEqual([]);
    },
    120_000,
  );

  it.skipIf(claude === null)(
    "writes no settings.json of its own",
    () => {
      expect(
        [...afterOurWrites.keys()].filter((path) =>
          path.endsWith("settings.json"),
        ),
      ).toEqual([]);
    },
    120_000,
  );

  /**
   * **`claude plugin validate` is not read-only.** Pointed at a fresh home it
   * creates `~/.claude.json` and a timestamped copy under `~/.claude/backups/`.
   * Found by this test failing, on 2026-08-11, against Claude Code as installed
   * on the author's machine.
   *
   * That matters beyond this file: `probeClaude` runs exactly this command, so
   * the capability probe spec §5 relies on **mutates the user's home**. It is
   * the vendor's own state and not ours, but "doctor writes nothing" would be a
   * false claim, and a probe with a side effect is worth stating rather than
   * discovering later. Recorded here as the observation, and in spec §14.1.
   */
  it.skipIf(claude === null)(
    "records that the vendor's own validate command mutates the home",
    async () => {
      const after = await inventory(temporary().root);
      const vendorWrites = addedPaths(afterOurWrites, after);
      // Not asserted as an exact list: it is the vendor's state, and pinning it
      // would make this test fail on their next release for no reason of ours.
      // `every` over an empty array is `true`, so this alone would keep
      // passing — and keep claiming an observation it no longer made — if a
      // future release made validate read-only. The count is what pins the
      // observation; the prefix is what pins the isolation.
      expect(
        vendorWrites.length,
        "validate no longer mutates the home it is pointed at: update spec §14.1, and reconsider whether doctor may probe",
      ).toBeGreaterThan(0);
      expect(
        vendorWrites.every((path) => path.startsWith(temporary().home)),
      ).toBe(true);
    },
    120_000,
  );

  /**
   * The skip is itself a result worth reporting. A silent skip on every machine
   * would make this file indistinguishable from one that never ran.
   */
  it("reports whether it ran against a real installation", () => {
    if (claude === null) {
      expect(claude).toBeNull();
      return;
    }
    expect(claude).toMatch(/claude$/u);
  });
});
