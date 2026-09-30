import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { PRODUCT_VERSION } from "@developer-os/cli/dist/context.js";
import { LOCAL_BUNDLE_CLI_ENTRY } from "@developer-os/cli/dist/update/local-release.js";
import { admitUnsignedLocalPackagedRelease } from "@developer-os/cli/dist/update/packaged-release.js";

import { checkoutIndependentInput, collectTree, pack,THIRD_PARTY_LICENSES, thirdPartyPackageDirectory } from "./pack-local-release.js";

/** This file is `tests/tools/…`, whether run from source or from `tests/dist/tools/…`'s sibling. */
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OPTIONS = { workingDirectory: REPOSITORY_ROOT, repositoryRoot: REPOSITORY_ROOT };

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

async function temporary(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "developer-os-pack-")));
  roots.push(root);
  return root;
}

/** Relative path → mode and content digest, for every regular file under `root`. */
async function tree(root: string): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const digest = createHash("sha256").update(await readFile(path)).digest("hex");
    files.set(relative(root, path), `${((await stat(path)).mode & 0o777).toString(8)}:${digest}`);
  }
  return files;
}

describe("release trees", () => {
  function git(root: string, ...args: string[]): void {
    const result = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  }

  async function checkout(): Promise<string> {
    const root = await temporary();
    git(root, "init", "-q");
    await mkdir(join(root, "instructions", "nested"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "instructions/.DS_Store\n");
    await writeFile(join(root, "instructions", "nested", "tracked.md"), "tracked\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "fixture");
    return root;
  }

  it("packs only tracked files, never an ignored or untracked one", async () => {
    const root = await checkout();
    await writeFile(join(root, "instructions", ".DS_Store"), "finder\n");
    await writeFile(join(root, "instructions", "draft.md"), "private draft\n");

    const files = await collectTree(root, "instructions");

    expect(files.map((file) => file.relativePath)).toStrictEqual(["instructions/nested/tracked.md"]);
  });

  it("refuses a tree with uncommitted changes to a tracked file", async () => {
    const root = await checkout();
    await writeFile(join(root, "instructions", "nested", "tracked.md"), "edited\n");

    await expect(collectTree(root, "instructions")).rejects.toThrow(/uncommitted/u);
  });

  it("packs the committed bytes of a file whose working-tree edit git status hides", async () => {
    const root = await checkout();
    git(root, "update-index", "--skip-worktree", "instructions/nested/tracked.md");
    await writeFile(join(root, "instructions", "nested", "tracked.md"), "hidden edit\n");

    const files = await collectTree(root, "instructions");

    expect(files.map((file) => Buffer.from(file.bytes).toString("utf8"))).toStrictEqual(["tracked\n"]);
  });
});

describe("third-party package directory", () => {
  it("finds the installed package of a bundled input, scoped or not, and skips workspace files", () => {
    expect(thirdPartyPackageDirectory("node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js"))
      .toBe("node_modules/.pnpm/zod@4.4.3/node_modules/zod");
    expect(thirdPartyPackageDirectory("node_modules/.pnpm/@a+b@1.0.0/node_modules/@a/b/index.js"))
      .toBe("node_modules/.pnpm/@a+b@1.0.0/node_modules/@a/b");
    expect(thirdPartyPackageDirectory("packages/core/dist/index.js")).toBeUndefined();
  });
});

describe("checkout-independent input (NEW-107)", () => {
  it("cuts a store path outside the checkout back to its node_modules tail", () => {
    expect(checkoutIndependentInput("../developer-os/node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js"))
      .toBe("node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js");
    expect(checkoutIndependentInput("node_modules/.pnpm/yaml@2.8.1/node_modules/yaml/dist/index.js"))
      .toBe("node_modules/.pnpm/yaml@2.8.1/node_modules/yaml/dist/index.js");
    expect(checkoutIndependentInput("packages/core/dist/index.js")).toBe("packages/core/dist/index.js");
  });

  it("refuses a workspace input outside the checkout", () => {
    expect(() => checkoutIndependentInput("../developer-os/packages/core/dist/index.js")).toThrow(/outside the checkout/u);
    expect(() => checkoutIndependentInput("/elsewhere/packages/core/dist/index.js")).toThrow(/outside the checkout/u);
  });
});

describe("pack (D55: one bundled CLI module)", () => {
  it("packs the CLI as one module plus its third-party licences, and nothing else outside the release trees", async () => {
    const root = await temporary();
    const out = await pack(join(root, "pkg"), OPTIONS);
    const files = [...(await tree(join(out, "bundle"))).keys()];

    const rest = files.filter((path) => !path.startsWith("workflows/") && !path.startsWith("instructions/")).sort();
    expect(rest).toStrictEqual([THIRD_PARTY_LICENSES, LOCAL_BUNDLE_CLI_ENTRY].sort());
    expect(files.filter((path) => path.endsWith(".js"))).toStrictEqual([LOCAL_BUNDLE_CLI_ENTRY]);
    expect(files).toContain("workflows/capture/workflow.yaml");
    expect(files).toContain("instructions/catalog.json");

    const licenses = await readFile(join(out, "bundle", THIRD_PARTY_LICENSES), "utf8");
    for (const dependency of ["zod", "yaml", "smol-toml"]) {
      expect(licenses, dependency).toMatch(new RegExp(`^${dependency}@\\d`, "mu"));
    }

    const modes = new Set([...(await tree(out)).values()].map((value) => value.split(":")[0]));
    expect(modes).toStrictEqual(new Set(["600"]));
    await expect(admitUnsignedLocalPackagedRelease(out, PRODUCT_VERSION)).resolves.toBeDefined();
  });

  it("packs byte-identical releases from the same checkout", async () => {
    const root = await temporary();
    const first = await tree(await pack(join(root, "a"), OPTIONS));
    const second = await tree(await pack(join(root, "b"), OPTIONS));
    expect(first.size).toBeGreaterThan(0);
    expect(second).toStrictEqual(first);
  });

  /**
   * NEW-107: the second checkout is laid out like a linked worktree — its `node_modules` links into
   * this checkout's pnpm store, so esbuild resolves every third-party input to a path outside it.
   */
  it("packs byte-identical releases from two checkouts of one commit", async () => {
    const root = await temporary();
    const second = join(root, "second");
    const git = (...args: string[]): string => {
      const result = spawnSync("git", args, { encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    };
    git("clone", "-q", "--shared", "--no-checkout", REPOSITORY_ROOT, second);
    git("-C", second, "checkout", "-q", "--detach", git("-C", REPOSITORY_ROOT, "rev-parse", "HEAD"));
    for (const group of ["apps", "packages"]) {
      for (const member of await readdir(join(REPOSITORY_ROOT, group))) {
        for (const built of ["dist", "node_modules"]) {
          const source = join(REPOSITORY_ROOT, group, member, built);
          if ((await stat(source).catch(() => null)) === null) continue;
          await cp(source, join(second, group, member, built), { recursive: true, verbatimSymlinks: true });
        }
      }
    }
    await symlink(await realpath(join(REPOSITORY_ROOT, "node_modules")), join(second, "node_modules"));

    const first = await tree(await pack(join(root, "a"), OPTIONS));
    const other = await tree(await pack(join(root, "b"), { workingDirectory: second, repositoryRoot: second }));
    expect(first.size).toBeGreaterThan(0);
    expect(other).toStrictEqual(first);
  });

  it("packs a CLI that runs from the bundle alone", async () => {
    const root = await temporary();
    const out = await pack(join(root, "pkg"), OPTIONS);
    const home = join(root, "home");
    await mkdir(home, { mode: 0o700 });

    const result = spawnSync(process.execPath, [join(out, "bundle", LOCAL_BUNDLE_CLI_ENTRY), "status"], {
      cwd: "/",
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("product home");
  });

  // NEW-115: a successful `init --yes` from a local release printed its result and then never exited.
  it("exits after a successful init --yes from the packed release", async () => {
    const root = await temporary();
    const out = await pack(join(root, "pkg"), OPTIONS);
    const home = join(root, "home");
    await mkdir(home, { mode: 0o700 });

    const reports = join(root, "reports");
    await mkdir(reports);

    // A fresh init takes ~100 s locally and about twice that on a hosted runner;
    // the defect (NEW-115) never exits at all, so a generous bound still catches it.
    const result = await runWithHangReport(
      process.execPath,
      [join(out, "bundle", LOCAL_BUNDLE_CLI_ENTRY), "init", "--yes", "--local-release", out, "--adapters", "none"],
      { HOME: home, PATH: "/usr/bin:/bin" },
      reports,
      600_000,
    );

    expect(result.hang, `init did not exit within 600 s\n${result.diagnostic}`).toBeNull();
    expect(result.status, result.diagnostic).toBe(0);
  }, 900_000);
});

interface HangAwareResult {
  readonly status: number | null;
  /** The node report taken on the hang, or `null` when the child exited within the bound. */
  readonly hang: string | null;
  readonly diagnostic: string;
}

const tail = (text: string): string => text.slice(-4_000);

/**
 * `spawnSync` with the same stdio (stdin closed at once), except that a child still alive at the
 * bound is asked for a node diagnostic report (SIGUSR2) before it is killed, so a hang on a hosted
 * runner names the handle it waits on.
 */
async function runWithHangReport(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  reportDirectory: string,
  timeoutMs: number,
): Promise<HangAwareResult> {
  const child = spawn(command, args, {
    cwd: "/",
    env: { ...env, NODE_OPTIONS: `--report-on-signal --report-signal=SIGUSR2 --report-compact --report-directory=${reportDirectory}` },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  // `exit`, not `close`: an orphaned grandchild holding the pipes must not hide the report.
  const exited = new Promise<number | null>((resolve) => { child.once("exit", (code) => { resolve(code); }); });
  const drained = new Promise<void>((resolve) => { child.once("close", () => { resolve(); }); });

  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<"timeout">((resolve) => { timer = setTimeout(() => { resolve("timeout"); }, timeoutMs); });
  const first = await Promise.race([exited, timedOut]);
  clearTimeout(timer);

  let hang: string | null = null;
  if (first === "timeout") {
    child.kill("SIGUSR2");
    hang = await awaitReport(reportDirectory, 10_000);
    child.kill("SIGKILL");
  }
  const status = await exited;
  await Promise.race([drained, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  return {
    status,
    hang,
    diagnostic: [`hang report:\n${hang ?? "none"}`, `stdout tail:\n${tail(stdout)}`, `stderr tail:\n${tail(stderr)}`].join("\n"),
  };
}

async function awaitReport(directory: string, waitMs: number): Promise<string> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const name = (await readdir(directory)).find((entry) => entry.endsWith(".json"));
    if (name !== undefined) {
      try {
        return summarizeReport(JSON.parse(await readFile(join(directory, name), "utf8")) as NodeReport);
      } catch {
        // The report is still being written; the next poll reads it whole.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return `no node report within ${String(waitMs)} ms`;
}

interface NodeReport {
  readonly javascriptStack?: { readonly message?: string; readonly stack?: readonly string[] };
  readonly libuv?: readonly Record<string, unknown>[];
  readonly resourceUsage?: { readonly userCpuSeconds?: number; readonly kernelCpuSeconds?: number };
}

function summarizeReport(report: NodeReport): string {
  const stack = report.javascriptStack;
  const handles = (report.libuv ?? [])
    .filter((handle) => handle.is_active === true || handle.is_referenced === true)
    .map((handle) => `  ${JSON.stringify(handle)}`);
  // Pending threadpool work (an fsync) is no libuv handle; CPU seconds tell "still working" from "idle".
  const usage = report.resourceUsage;
  return [
    `cpu seconds: user ${String(usage?.userCpuSeconds ?? "?")}, kernel ${String(usage?.kernelCpuSeconds ?? "?")}`,
    `javascriptStack: ${stack?.message ?? ""}`,
    ...(stack?.stack ?? []).map((frame) => `  ${frame}`),
    "active or referenced libuv handles:",
    ...handles,
  ].join("\n");
}

describe("hang report", () => {
  it("names the handle a child that never exits is waiting on", async () => {
    const root = await temporary();
    const result = await runWithHangReport(process.execPath, ["-e", "setInterval(() => undefined, 60_000)"], { PATH: "/usr/bin:/bin" }, root, 2_000);

    expect(result.hang).toMatch(/"type":"timer"/u);
    expect(result.status).toBeNull();
  }, 30_000);
});
