/**
 * A16 §3.2 and §2 step 5: the release sequence a version stamps, and the CHANGELOG.md section that
 * becomes its release notes. `node tests/dist/tools/release-metadata.js sequence|notes <X.Y.Z>`.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { parseStableSemver } from "@developer-os/core";

const COMPONENT_BOUND = 1000n;

export function releaseSequenceOf(version: string): string {
  let parts: readonly bigint[];
  try {
    parts = parseStableSemver(version).split(".").map(BigInt);
  } catch (error) {
    throw new Error(`refusing the release: ${version} is not stable semver X.Y.Z`, { cause: error });
  }
  const [major = 0n, minor = 0n, patch = 0n] = parts;
  if (minor >= COMPONENT_BOUND || patch >= COMPONENT_BOUND) throw new Error(`refusing the release: ${version} has a minor or patch of 1000 or more`);
  const sequence = major * 1_000_000n + minor * 1_000n + patch;
  if (sequence === 0n) throw new Error(`refusing the release: ${version} has release sequence 0`);
  return sequence.toString(10);
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function releaseNotesOf(changelog: string, version: string): string {
  const heading = new RegExp(`^## \\[${escaped(version)}\\](?: - \\d{4}-\\d{2}-\\d{2})?$`, "u");
  const lines = changelog.split("\n");
  const starts = lines.flatMap((line, index) => (heading.test(line) ? [index] : []));
  if (starts.length === 0) throw new Error(`refusing the release: no CHANGELOG.md section for ${version}`);
  if (starts.length > 1) throw new Error(`refusing the release: more than one CHANGELOG.md section for ${version}`);
  const start = (starts[0] as number) + 1;
  const next = lines.findIndex((line, index) => index >= start && line.startsWith("## "));
  const body = lines.slice(start, next === -1 ? lines.length : next).join("\n").trim();
  if (body.length === 0) throw new Error(`refusing the release: the CHANGELOG.md section for ${version} is empty`);
  return body;
}

function repositoryRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: "utf8" }).trim();
}

function isEntryPoint(entry: string | undefined): boolean {
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint(argv[1])) {
  const [command, version] = argv.slice(2);
  if (version === undefined || argv.length !== 4) throw new Error("usage: release-metadata.js sequence|notes <X.Y.Z>");
  if (command === "sequence") stdout.write(`${releaseSequenceOf(version)}\n`);
  else if (command === "notes") stdout.write(`${releaseNotesOf(await readFile(join(repositoryRoot(), "CHANGELOG.md"), "utf8"), version)}\n`);
  else throw new Error("usage: release-metadata.js sequence|notes <X.Y.Z>");
}
