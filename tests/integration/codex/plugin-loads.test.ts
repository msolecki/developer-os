import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { env as processEnv } from "node:process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertInstructionBlock, renderInstructionBlock } from "@developer-os/core";
import type { ManagedArtifactV2 } from "@developer-os/core";
import {
  CODEX_ROOT_SEGMENT,
  PLUGIN_NAME,
  PLUGIN_TREE_SEGMENTS,
  proposeCodexInstall,
  proposeCodexUninstall,
  renderCodexInstallTree,
  renderCodexVendorTree,
  renderInstructionTree,
} from "@developer-os/adapter-codex";
import type { CodexInstructionRenderV1, ManagedByPath } from "@developer-os/adapter-codex";
import { registerCodexPlugin } from "@developer-os/cli/dist/instructions/codex-registration.js";
import type { ProcessRunner } from "@developer-os/security";
import { loadWorkflow } from "@developer-os/workflow-schema";
import type { WorkflowContractV1 } from "@developer-os/workflow-schema";
import {
  addedPaths,
  createTempHome,
  inventory,
  removeTempHome,
} from "../../helpers/temp-home.js";
import type { Inventory, TempHome } from "../../helpers/temp-home.js";
import { WORKFLOWS_ROOT } from "../../contracts/adapters/codex/render-all.js";
import { loadDefaultInstructionSources } from "../../contracts/adapters/claude/render-all.js";

const run = promisify(execFile);

/**
 * Resolved once, from `PATH`, in the parent. Same reasoning as the Claude
 * adapter's own `plugin-loads.test.ts`: `it.skipIf(...)` is evaluated while
 * the suite is constructed, before any hook runs, so resolving `codex` in
 * `beforeAll` would leave every case skipped on every machine, including one
 * with Codex installed, and report green.
 */
async function findCodex(): Promise<string | null> {
  try {
    const { stdout } = await run("/usr/bin/which", ["codex"]);
    const path = stdout.trim();
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

const codex: string | null = await findCodex();

/**
 * The canonical workflow contracts, loaded the same way
 * `tests/contracts/adapters/codex/render-all.ts` does — this file needs the
 * contracts themselves, not `renderCodexPlugin`'s plugin-root-relative output,
 * because `renderCodexInstallTree` re-roots and adds the marketplace
 * descriptor from the contracts directly.
 */
async function loadContracts(): Promise<readonly WorkflowContractV1[]> {
  const entries = await readdir(WORKFLOWS_ROOT, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const contracts: WorkflowContractV1[] = [];
  for (const name of directories) {
    const file = join("workflows", name, "workflow.yaml");
    const text = await readFile(join(WORKFLOWS_ROOT, name, "workflow.yaml"), "utf8");
    const result = loadWorkflow({ file, text });
    if (result.contract === null) {
      throw new Error(
        `${file} did not validate: ${result.findings.map((f) => f.message).join("; ")}`,
      );
    }
    contracts.push(result.contract);
  }
  return contracts;
}

let temp: TempHome | null = null;
/** A second temporary root, isolated from `temp.home`, for `CODEX_HOME`. */
let codexHome: string | null = null;
let before: Inventory = new Map();
/** Captured after this suite writes the plugin tree and before any `codex` invocation. */
let afterOurWrites: Inventory = new Map();
/** The instruction defaults as installed: plugin skills, `C/agents/*.toml`, and the `C/AGENTS.md` block. */
let instructions: CodexInstructionRenderV1 | null = null;
/** The whole `C/AGENTS.md` this suite wrote: one user line and the product's block. */
let agentsFile = "";
let marketplaceExit: number | null = null;
let pluginAddExit: number | null = null;
let pluginAddStderr = "";
let marketplaceStderr = "";

function temporary(): TempHome {
  if (temp === null) {
    throw new Error(
      "the temporary HOME was not created; refusing to run against a real installation without one",
    );
  }
  return temp;
}

function temporaryCodexHome(): string {
  if (codexHome === null) {
    throw new Error(
      "the temporary CODEX_HOME was not created; refusing to run against a real installation without one",
    );
  }
  return codexHome;
}

/**
 * The parent's `PATH`, not a fixed one — see the Claude adapter's identical
 * `isolatedEnv` for why a pinned `/usr/bin:/bin` breaks an npm-installed CLI
 * with an `env node` shebang. `HOME`, `CODEX_HOME` and `TMPDIR` are the three
 * variables this file's isolation depends on; nothing else is passed through.
 */
function isolatedEnv(home: TempHome): Record<string, string> {
  return {
    HOME: home.home,
    CODEX_HOME: temporaryCodexHome(),
    PATH: processEnv.PATH ?? "/usr/bin:/bin",
    TMPDIR: home.tempDir,
  };
}

/**
 * `registerCodexPlugin`'s own runner hands the child `env: { CODEX_HOME }` alone, which through a
 * real spawn would resolve the developer's live home. This runner keeps the function's argv and
 * sequencing and swaps in the isolated environment; nothing is redacted, so the listed plugin
 * path reaches `registeredAt` unchanged.
 */
const isolatedRunner: ProcessRunner = {
  async run(request) {
    try {
      const { stdout, stderr } = await runCodex(request.args);
      return { stdout, stderr, exitCode: 0, signal: null, timedOut: false };
    } catch (error) {
      const failure = error as { code?: unknown; signal?: NodeJS.Signals | null; killed?: boolean; stdout?: string; stderr?: string };
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? "",
        exitCode: typeof failure.code === "number" ? failure.code : 1,
        signal: failure.signal ?? null,
        timedOut: failure.killed === true,
      };
    }
  },
};

/**
 * `codex debug prompt-input` prints the input messages as JSON (observed 0.155.1); every string
 * in it, joined, is the model-visible text with JSON escaping undone.
 */
async function promptInputText(): Promise<string> {
  const { stdout } = await runCodex(["debug", "prompt-input", "probe"]);
  const texts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") texts.push(value);
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(walk);
  };
  walk(JSON.parse(stdout));
  return texts.join("\n");
}

function installedInstructions(): CodexInstructionRenderV1 {
  if (instructions === null) throw new Error("the instruction tree was not installed");
  return instructions;
}

/** Instruction skill ids, from the installed tree itself. */
function instructionSkillIds(): string[] {
  return installedInstructions().pluginFiles.flatMap(
    (artifact) => /^plugins\/developer-os\/skills\/([^/]+)\/SKILL\.md$/u.exec(artifact.path)?.[1] ?? [],
  );
}

async function runCodex(args: readonly string[]) {
  return run(codex ?? "", [...args], {
    env: isolatedEnv(temporary()),
    cwd: temporary().root,
    timeout: 60_000,
  });
}

beforeAll(async () => {
  if (codex === null) return;
  temp = await createTempHome();
  codexHome = join(temp.root, "codex-home");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  before = await inventory(temp.root);

  const contracts = await loadContracts();
  const { defaults, none } = await loadDefaultInstructionSources("codex", contracts);
  instructions = renderInstructionTree(defaults, none);
  const tree = renderCodexVendorTree(contracts, instructions, { home: temp.productHome });
  const proposal = proposeCodexInstall(tree, {
    home: temp.productHome,
    productVersion: "0.0.0",
  });
  for (let index = 0; index < tree.length; index += 1) {
    const artifact = tree[index];
    const operation = proposal.operations[index];
    if (artifact === undefined || operation === undefined) {
      throw new Error("renderCodexInstallTree and proposeCodexInstall disagree on artifact count");
    }
    if (!operation.targetPath.endsWith(`/${artifact.path}`)) {
      throw new Error(`proposeCodexInstall is not index-aligned with the tree at ${artifact.path}`);
    }
    await mkdir(dirname(operation.targetPath), { recursive: true });
    await writeFile(operation.targetPath, artifact.contents, "utf8");
  }
  for (const agent of instructions.agentFiles) {
    await mkdir(dirname(join(codexHome, agent.path)), { recursive: true });
    await writeFile(join(codexHome, agent.path), agent.contents, "utf8");
  }
  const block = renderInstructionBlock({
    productHome: temp.productHome,
    vendor: "codex",
    body: instructions.block.body,
  });
  agentsFile = new TextDecoder().decode(
    insertInstructionBlock(new TextEncoder().encode("A user line outside the block.\n"), block),
  );
  await writeFile(join(codexHome, "AGENTS.md"), agentsFile, "utf8");
  afterOurWrites = await inventory(temp.root);

  const marketplaceStep = proposal.registration[0];
  const pluginAddStep = proposal.registration[1];
  if (marketplaceStep === undefined || pluginAddStep === undefined) {
    throw new Error("proposeCodexInstall produced fewer than two registration steps");
  }

  try {
    const result = await runCodex(marketplaceStep.args);
    marketplaceExit = 0;
    marketplaceStderr = result.stderr;
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    marketplaceExit = failure.code ?? 1;
    marketplaceStderr = failure.stderr ?? "";
  }

  try {
    const result = await runCodex(pluginAddStep.args);
    pluginAddExit = 0;
    pluginAddStderr = result.stderr;
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    pluginAddExit = failure.code ?? 1;
    pluginAddStderr = failure.stderr ?? "";
  }
}, 120_000);

afterAll(async () => {
  if (temp !== null) await removeTempHome(temp);
});

describe("the generated install tree against a real Codex installation", () => {
  /**
   * The skip is itself a result worth reporting — see the Claude adapter's
   * identical case. A silent skip on every machine would make this file
   * indistinguishable from one that never ran.
   */
  it("reports whether it ran against a real installation", () => {
    if (codex === null) {
      expect(codex).toBeNull();
      return;
    }
    expect(codex).toMatch(/codex$/u);
  });

  /**
   * The marketplace document `renderMarketplace` produces, run through the
   * exact argv `proposeCodexInstall` returns. **If the real CLI refuses
   * either step, that refusal is the finding** — this case reports what
   * happened rather than softening the expectation, per the founder's
   * instruction for this task. As shipped (after Task 17's own fix to
   * `installRegistration`'s argv and `renderMarketplace`'s `source.path`,
   * both amended in Codex architecture former §14.4), both steps exit 0 against 0.147.0.
   */
  it.skipIf(codex === null)(
    "registers the marketplace and installs the plugin, both exiting 0",
    () => {
      expect(marketplaceExit, `marketplace add stderr: ${marketplaceStderr}`).toBe(0);
      expect(pluginAddExit, `plugin add stderr: ${pluginAddStderr}`).toBe(0);
    },
  );

  /**
   * The property the whole install shape (Codex architecture former §4) was chosen for: a local
   * marketplace resolves an installed plugin to the real on-disk path this
   * adapter wrote, not to the cache copy `codex plugin add` also stages under
   * `$CODEX_HOME/plugins/cache/...` — confirmed to exist separately by Task
   * 17's manual probing, but never what `plugin list --json` reports back.
   */
  it.skipIf(codex === null)(
    "reports the plugin enabled and resolved to the path we wrote, not a cache copy",
    async () => {
      const { stdout } = await runCodex(["plugin", "list", "--json"]);
      const listing = JSON.parse(stdout) as {
        installed?: readonly {
          name?: string;
          enabled?: boolean;
          source?: { path?: string };
        }[];
      };
      const ours = (listing.installed ?? []).find((entry) => entry.name === PLUGIN_NAME);
      expect(ours, `installed: ${JSON.stringify(listing.installed)}`).toBeDefined();
      expect(ours?.enabled).toBe(true);
      const expectedPath = posix.join(temporary().productHome, ...PLUGIN_TREE_SEGMENTS);
      expect(ours?.source?.path).toBe(expectedPath);
      const cacheCopy = join(temporaryCodexHome(), "plugins", "cache");
      expect(ours?.source?.path?.startsWith(cacheCopy)).toBe(false);
    },
  );

  /**
   * `codex debug prompt-input` renders exactly what would be sent to the
   * model without sending it — no `codex exec`, no model invocation, no cost,
   * and safe under the founder's 2026-08-12 deferral of Step 2b. Skill
   * entries from a plugin are prefixed `plugin_name:` in the model-visible
   * list (Codex architecture former §14.3); Task 17 confirmed this offline-safe command as the
   * only way found to verify skill discoverability without an exec run.
   */
  it.skipIf(codex === null)(
    "surfaces every workflow skill, prefixed with the plugin name, in the model-visible skill list",
    async () => {
      const contracts = await loadContracts();
      const { stdout } = await runCodex(["debug", "prompt-input"]);
      expect(contracts.length).toBeGreaterThan(0);
      for (const contract of contracts) {
        expect(stdout, `missing skill for ${contract.id}`).toContain(
          `${PLUGIN_NAME}:developer-os-${contract.id}`,
        );
      }
    },
  );

  /**
   * NEW-65 (A12's "loading is asserted" gate): every instruction skill reaches the model-visible
   * skill list, and the whole `C/AGENTS.md` (the user's bytes and the product's block) is carried
   * verbatim (codex-adapter.md §15). Agent roles are not in `prompt-input`; the isolation test
   * observes them through the request instead.
   */
  it.skipIf(codex === null)(
    "surfaces every instruction skill and the whole AGENTS.md block in the prompt input",
    async () => {
      const skills = instructionSkillIds();
      expect(skills.length).toBeGreaterThan(0);
      expect(installedInstructions().block.members.length).toBeGreaterThan(0);
      const text = await promptInputText();
      for (const id of skills) {
        expect(text, `missing instruction skill ${id}`).toContain(`${PLUGIN_NAME}:${id}`);
      }
      expect(text).toContain(agentsFile);
    },
  );

  /**
   * codex-adapter.md §16: Codex reads its cache copy, so an in-place change to the installed tree stays
   * invisible until `plugin add` runs again, which `registerCodexPlugin` always does
   * (codex-adapter.md §15 "`plugin add` over a registered plugin"). The description is what
   * changes because `prompt-input` carries a skill's name and description, not its body.
   */
  it.skipIf(codex === null)(
    "keeps an in-place skill change invisible until registerCodexPlugin re-registers",
    async () => {
      const [id] = instructionSkillIds();
      if (id === undefined) throw new Error("no instruction skill to change");
      const productHome = temporary().productHome;
      const pluginRoot = posix.join(productHome, ...PLUGIN_TREE_SEGMENTS);
      const skillFile = join(pluginRoot, "skills", id, "SKILL.md");
      const token = "A12 in-place change probe 7c1d.";
      const original = await readFile(skillFile, "utf8");
      const edited = original.replace(/^description: .*$/mu, `description: "${token}"`);
      expect(edited).not.toBe(original);
      await writeFile(skillFile, edited, "utf8");
      const visible = `${PLUGIN_NAME}:${id}: ${token}`;

      expect(await promptInputText()).not.toContain(visible);
      await registerCodexPlugin({
        runner: isolatedRunner,
        codexExecutable: codex ?? "",
        codexHome: temporaryCodexHome(),
        marketplaceRoot: join(productHome, CODEX_ROOT_SEGMENT),
        pluginRoot,
      });
      expect(await promptInputText()).toContain(visible);
    },
    120_000,
  );

  /**
   * Codex architecture former §4: the install writes one tree, under the product home, plus
   * whatever the vendor's own CLI writes under `CODEX_HOME` — and nothing
   * else. Measured across the whole registration sequence, not just our own
   * writes, because the vendor's CLI is expected to write under `CODEX_HOME`
   * (config.toml, its plugin cache, its bundled system skills) and that is
   * accounted for, not merely tolerated.
   */
  it.skipIf(codex === null)("writes nothing outside CODEX_HOME and the product home", async () => {
    const after = await inventory(temporary().root);
    const added = addedPaths(before, after);
    expect(added.length).toBeGreaterThan(0);
    const productHome = temporary().productHome;
    const home = temporaryCodexHome();
    const outside = added.filter(
      (path) =>
        path !== productHome &&
        !path.startsWith(`${productHome}/`) &&
        path !== home &&
        !path.startsWith(`${home}/`),
    );
    expect(outside).toEqual([]);
  });

  /**
   * `~/.codex/config.toml`, here `$CODEX_HOME/config.toml`, is the vendor's
   * own file (Codex architecture former §4.1: "we never parse, edit, or merge" it). Proven by
   * ordering: `afterOurWrites` is captured before any `codex` invocation, so
   * if this adapter had written the file itself it would already be present
   * there. It is not — the vendor's `plugin marketplace add` creates it.
   */
  it.skipIf(codex === null)(
    "never writes config.toml itself; only the vendor's CLI does",
    async () => {
      expect(
        [...afterOurWrites.keys()].filter((path) => path.endsWith("config.toml")),
      ).toEqual([]);
      const after = await inventory(temporary().root);
      const configPath = join(temporaryCodexHome(), "config.toml");
      // Present after the vendor's own registration steps ran — recorded as
      // an observation, not a fixed requirement of a future Codex release.
      expect(after.has(configPath)).toBe(true);
    },
  );

  /**
   * Uninstall reverses both CLI steps and then removes the tree (Codex architecture former §4.2).
   * Run last, deliberately: it mutates the shared installed state every case
   * above depends on.
   *
   * The simulated failure targets the *second* step, `plugin marketplace
   * remove`, not the first. `codex plugin remove <plugin-that-was-never-
   * installed>@<marketplace>` was tried first and turned out to be a
   * real-CLI no-op that still exits 0 — it does not verify the plugin was
   * ever installed, only that it is absent afterward, so it cannot stand in
   * for a failing step. `plugin marketplace remove <unregistered-name>` does
   * refuse, with exit 1 and "marketplace ... is not configured or
   * installed" — a real, reproducible failure from 0.147.0, not a mock. This
   * case runs the real `plugin remove` (step one, succeeds), then a
   * deliberately wrong `plugin marketplace remove` (standing in for step two
   * failing), and asserts the tree survives that failure even though step
   * one already completed — only once *both* correct steps have succeeded
   * does this test delete the tree, matching what an apply-phase caller must
   * do.
   */
  it.skipIf(codex === null)(
    "a simulated failure of the marketplace-remove step leaves the tree in place, and a real uninstall then removes it",
    async () => {
      const productHome = temporary().productHome;
      const treeRoot = join(productHome, CODEX_ROOT_SEGMENT);
      const beforeUninstall = await inventory(productHome);
      expect(beforeUninstall.size).toBeGreaterThan(0);

      const contracts = await loadContracts();
      const tree = renderCodexInstallTree(contracts, { home: productHome });
      const proposal = proposeCodexInstall(tree, { home: productHome, productVersion: "0.0.0" });
      const managed: ManagedByPath = new Map(
        proposal.operations.map((operation): [string, ManagedArtifactV2] => [
          operation.targetPath,
          {
            owner: "codex",
            path: operation.targetPath,
            kind: "file",
            productVersion: "0.0.0",
            existedBefore: false,
            beforeHash: null,
            backupRelativePath: null,
            source: operation.source,
            mergeStrategy: operation.mergeStrategy,
            verifiedAt: new Date().toISOString(),
            verification: { mode: "content", installedHash: operation.proposedHash ?? "" },
          } as ManagedArtifactV2,
        ]),
      );
      const uninstall = proposeCodexUninstall(
        { home: productHome, productVersion: "0.0.0" },
        managed,
      );
      const [removeStep, unregisterStep] = uninstall.registration;
      if (removeStep === undefined || unregisterStep === undefined) {
        throw new Error("proposeCodexUninstall produced fewer than two registration steps");
      }

      // Step one, real and correct: succeeds. `runCodex` rejects on a
      // non-zero exit, so the `await` completing without throwing is the
      // success check; there is no `exitCode` field on the resolved value
      // to assert against.
      await runCodex(removeStep.args);

      // Step two, deliberately wrong: a marketplace name nothing registered.
      // A real refusal from 0.147.0, not a mock.
      let simulatedFailureExit: number | null = null;
      try {
        await runCodex(["plugin", "marketplace", "remove", "not-a-registered-marketplace"]);
        simulatedFailureExit = 0;
      } catch (error) {
        simulatedFailureExit = (error as { code?: number }).code ?? 1;
      }
      expect(simulatedFailureExit).not.toBe(0);
      // Step one already succeeded, step two (simulated) failed — the tree
      // must still survive, exactly as Codex architecture former §4.2 requires.
      expect(await inventory(productHome)).toEqual(beforeUninstall);

      // Now the real step two, correct: succeeds — same reasoning as step
      // one above, the `await` not throwing is the success check.
      await runCodex(unregisterStep.args);

      // Both real CLI steps have now succeeded — remove the tree, exactly as
      // Codex architecture former §4.2 orders it.
      await rm(treeRoot, { recursive: true, force: true });
      expect(await inventory(productHome)).toEqual(new Map());

      const { stdout } = await runCodex(["plugin", "list", "--json"]);
      const listing = JSON.parse(stdout) as { installed?: readonly { name?: string }[] };
      expect((listing.installed ?? []).some((entry) => entry.name === PLUGIN_NAME)).toBe(false);
    },
  );
});
