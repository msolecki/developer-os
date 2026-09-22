/**
 * Relink `tests/node_modules/@developer-os/*` to this checkout's workspace
 * packages (NEW-98). A linked worktree could resolve those links into another
 * checkout and silently test that checkout's code.
 *
 * Run it with `npm run link:tests`, once per new worktree. It never installs.
 */
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath, symlink, unlink } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { exit, stderr, stdout } from "node:process";
import { promisify } from "node:util";

const runProcess = promisify(execFile);

const inside = (root: string, path: string): boolean => path.startsWith(`${root}${sep}`);

async function resolvedOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/** `packages:` list of `pnpm-workspace.yaml`; stops at the first non-list line. */
function workspaceDirectories(yaml: string): string[] {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === "packages:");
  const directories: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+-\s+(\S+)\s*$/u.exec(line);
    if (match?.[1] === undefined) break;
    directories.push(match[1]);
  }
  return directories;
}

async function main(): Promise<number> {
  const root = await realpath((await runProcess("git", ["rev-parse", "--show-toplevel"])).stdout.trim());
  const packages = new Map<string, string>();
  for (const directory of workspaceDirectories(await readFile(join(root, "pnpm-workspace.yaml"), "utf8"))) {
    const absolute = join(root, directory);
    const manifest = JSON.parse(await readFile(join(absolute, "package.json"), "utf8")) as { name: string };
    packages.set(manifest.name, absolute);
  }

  const tests = JSON.parse(await readFile(join(root, "tests/package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  let status = 0;
  for (const name of Object.keys(tests.dependencies).filter((dep) => dep.startsWith("@developer-os/"))) {
    const target = packages.get(name);
    if (target === undefined) {
      stderr.write(`no workspace package for ${name}\n`);
      status = 1;
      continue;
    }
    const link = join(root, "tests/node_modules", name);
    const current = await resolvedOrNull(link);
    if (current !== null && inside(root, current)) continue;

    await mkdir(dirname(link), { recursive: true });
    // A symlinked tests/node_modules would make the write below land in another checkout.
    if (!inside(root, await realpath(dirname(link)))) {
      stderr.write(`${relative(root, dirname(link))} resolves outside this checkout; not touched\n`);
      status = 1;
      continue;
    }
    const entry = await lstat(link).catch(() => null);
    if (entry !== null) {
      if (!entry.isSymbolicLink()) {
        stderr.write(`${relative(root, link)} is not a symlink; not touched\n`);
        status = 1;
        continue;
      }
      await unlink(link);
    }
    const value = relative(dirname(link), target);
    await symlink(value, link);
    stdout.write(`linked ${name} -> ${value}\n`);
  }
  return status;
}

exit(await main());
