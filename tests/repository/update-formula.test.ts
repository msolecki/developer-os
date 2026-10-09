import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { renderFormula } from "../tools/render-formula.js";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const script = join(root, ".github/release/update-formula.sh");
const dir = mkdtempSync(join(tmpdir(), "update-formula-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const OLD = { version: "0.1.0", license: "MIT", sha256: { arm64: "a".repeat(64), x64: "b".repeat(64) } };
const sums = (version: string, arm = "c", x64 = "d"): string =>
  `${arm.repeat(64)}  developer-os-${version}-darwin-arm64.tar.gz\n${x64.repeat(64)}  developer-os-${version}-darwin-x64.tar.gz\n`;

let n = 0;
function run(formula: string, sumsText: string, tag = "v0.2.0"): { status: number | null; stderr: string; after: string; before: string } {
  const base = join(dir, String(n++));
  const f = `${base}.rb`;
  const s = `${base}.sums`;
  writeFileSync(f, formula);
  writeFileSync(s, sumsText);
  const result = spawnSync("bash", [script, tag, s, f], { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "", GITHUB_REPOSITORY: "msolecki/developer-os" } });
  return { status: result.status, stderr: result.stderr, after: readFileSync(f, "utf8"), before: formula };
}

const good = renderFormula(OLD);
const refuses = (formula: string, sumsText = sums("0.2.0"), tag?: string): void => {
  const r = run(formula, sumsText, tag);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("update-formula:");
  expect(r.after).toBe(r.before);
};

describe("update-formula.sh (A16 §2 step 7)", () => {
  it("updates exactly the five lines and equals a fresh render", () => {
    const r = run(good, sums("0.2.0"));
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.after).toBe(renderFormula({ ...OLD, version: "0.2.0", sha256: { arm64: "c".repeat(64), x64: "d".repeat(64) } }));
  });

  it("refuses a formula with an extra resource block", () => {
    refuses(good.replace("  depends_on :macos\n", `  depends_on :macos\n  resource "x" do\n    url "https://example.com/x.tgz"\n    sha256 "${"e".repeat(64)}"\n  end\n`));
  });
  it("refuses a url with using: :curl", () => {
    refuses(good.replace(/(url "[^"]*arm64\.tar\.gz")/u, "$1, using: :curl"));
  });
  it("refuses a custom def install", () => {
    refuses(good.replace('prefix.install Dir["*"]', 'system "echo hi"\n    prefix.install Dir["*"]'));
  });
  it("refuses a revision line (spec §3.3: a 1.2.0_1 keg removes the fallback)", () => {
    refuses(good.replace(/( {2}version "[^"]*"\n)/u, "$1  revision 1\n"));
  });
  it("refuses a third url", () => {
    refuses(good.replace("  depends_on :macos\n", '  url "https://github.com/msolecki/developer-os/releases/download/v0.1.0/developer-os-0.1.0-darwin-arm64.tar.gz"\n  depends_on :macos\n'));
  });
  it("refuses a missing or duplicated version line", () => {
    refuses(good.replace('  version "0.1.0"\n', ""));
    refuses(good.replace('  version "0.1.0"\n', '  version "0.1.0"\n  version "0.1.1"\n'));
  });

  it("refuses malformed or extra SHA256SUMS lines", () => {
    refuses(good, `${sums("0.2.0")}${"e".repeat(64)}  extra.tar.gz\n`);
    refuses(good, sums("0.2.0").replace("c".repeat(64), "C".repeat(64)));
    refuses(good, sums("0.2.0").replace("  developer-os", " developer-os"));
    refuses(good, sums("0.2.0").split("\n").reverse().join("\n"));
    refuses(good, sums("0.3.0"));
    refuses(good, sums("0.2.0").trimEnd());
    refuses(good, "");
  });

  it("refuses a tag that is not vX.Y.Z", () => {
    refuses(good, sums("0.2.0"), "v0.2.0; id");
    refuses(good, sums("0.2.0"), "0.2.0");
  });
});
