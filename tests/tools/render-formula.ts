/**
 * A16 §3.1 as amended by §3.3: the tap's `Formula/developer-os.rb`, rendered from exact values.
 * `node tests/dist/tools/render-formula.js --version <X.Y.Z> --sums <SHA256SUMS>`
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { parseStableSemver } from "@developer-os/core";

type Architecture = "arm64" | "x64";
const HEX = /^[0-9a-f]{64}$/u;
const SPDX = /^[A-Za-z0-9.+-]+$/u;
const RELEASES = "https://github.com/msolecki/developer-os/releases/download";

export interface FormulaInput {
  readonly version: string;
  readonly license: string;
  readonly sha256: Readonly<Record<Architecture, string>>;
}

function tarballName(version: string, architecture: Architecture): string {
  return `developer-os-${version}-darwin-${architecture}.tar.gz`;
}

function checked(input: FormulaInput): FormulaInput {
  try {
    parseStableSemver(input.version);
  } catch (error) {
    throw new Error(`refusing to render: version ${input.version} is not stable semver`, { cause: error });
  }
  if (!SPDX.test(input.license)) throw new Error(`refusing to render: license ${input.license} is not a simple SPDX identifier`);
  if (!HEX.test(input.sha256.arm64) || !HEX.test(input.sha256.x64)) throw new Error("refusing to render: a sha256 is not 64 lowercase hex digits");
  return input;
}

export function renderFormula(input: FormulaInput): string {
  const { version, license, sha256 } = checked(input);
  return `class DeveloperOs < Formula
  desc "Shared workflows and a local-first knowledge base for Claude Code and Codex"
  homepage "https://github.com/msolecki/developer-os"
  version "${version}"
  license "${license}"
  on_arm do
    url "${RELEASES}/v${version}/${tarballName(version, "arm64")}"
    sha256 "${sha256.arm64}"
  end
  on_intel do
    url "${RELEASES}/v${version}/${tarballName(version, "x64")}"
    sha256 "${sha256.x64}"
  end
  depends_on :macos

  def install
    prefix.install Dir["*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/developer-os --version")
  end
end
`;
}

export function sumsOf(text: string, version: string): Readonly<Record<Architecture, string>> {
  const found = new Map<string, string>();
  for (const line of text.split("\n").filter((row) => row !== "")) {
    const match = /^([0-9a-f]{64}) {2}(\S+)$/u.exec(line);
    const name = match?.[2];
    if (match === null || name === undefined || found.has(name)) throw new Error(`refusing to render: SHA256SUMS line "${line}" is malformed or repeated`);
    found.set(name, match[1] as string);
  }
  const arm64 = found.get(tarballName(version, "arm64"));
  const x64 = found.get(tarballName(version, "x64"));
  if (arm64 === undefined || x64 === undefined || found.size !== 2) throw new Error(`refusing to render: SHA256SUMS does not list exactly the two ${version} tarballs`);
  return { arm64, x64 };
}

export function licenseOf(packageJson: string): string {
  const license = (JSON.parse(packageJson) as { readonly license?: unknown }).license;
  if (typeof license !== "string" || license === "") throw new Error("refusing to render: the root package.json has no license (founder gate L1)");
  return license;
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
  const { values } = parseArgs({ args: argv.slice(2), strict: true, allowPositionals: false, options: { version: { type: "string" }, sums: { type: "string" } } });
  if (values.version === undefined || values.sums === undefined) throw new Error("usage: render-formula.js --version <X.Y.Z> --sums <SHA256SUMS>");
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: "utf8" }).trim();
  stdout.write(renderFormula({ version: values.version, license: licenseOf(await readFile(join(root, "package.json"), "utf8")), sha256: sumsOf(await readFile(values.sums, "utf8"), values.version) }));
}
