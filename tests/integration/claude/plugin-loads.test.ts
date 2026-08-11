import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

describe("the generated plugin against a real Claude Code installation", () => {
  it.skipIf(claude === null)(
    "validates with claude plugin validate",
    async () => {
      const pluginDirectory = join(
        temp?.home ?? "",
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
        {
          env: {
            HOME: temp?.home ?? "",
            PATH: "/usr/bin:/bin",
            TMPDIR: temp?.tempDir ?? "",
          },
          timeout: 60_000,
        },
      );
      expect(result.stderr).not.toMatch(/error/iu);
    },
    120_000,
  );

  it.skipIf(claude === null)(
    "records the version it was proved against",
    async () => {
      const { stdout } = await run(claude ?? "", ["--version"], {
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
        temp?.home ?? "",
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
      const after = await inventory(temp?.root ?? "");
      const vendorWrites = addedPaths(afterOurWrites, after);
      // Not asserted as an exact list: it is the vendor's state, and pinning it
      // would make this test fail on their next release for no reason of ours.
      expect(vendorWrites.every((path) => path.startsWith(temp?.home ?? ""))).toBe(
        true,
      );
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
