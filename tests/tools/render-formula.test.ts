import { describe, expect, it } from "vitest";

import { licenseOf, renderFormula, sumsOf } from "./render-formula.js";

const ARM = "a".repeat(64);
const X64 = "b".repeat(64);

const EXPECTED = `class DeveloperOs < Formula
  desc "Shared workflows and a local-first knowledge base for Claude Code and Codex"
  homepage "https://github.com/msolecki/developer-os"
  version "0.1.0"
  license "MIT"
  on_arm do
    url "https://github.com/msolecki/developer-os/releases/download/v0.1.0/developer-os-0.1.0-darwin-arm64.tar.gz"
    sha256 "${ARM}"
  end
  on_intel do
    url "https://github.com/msolecki/developer-os/releases/download/v0.1.0/developer-os-0.1.0-darwin-x64.tar.gz"
    sha256 "${X64}"
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

describe("renderFormula (A16 §3.1 as amended by §3.3)", () => {
  it("renders the exact formula", () => {
    expect(renderFormula({ version: "0.1.0", license: "MIT", sha256: { arm64: ARM, x64: X64 } })).toBe(EXPECTED);
  });

  it("never renders a revision, a post_install, a node dependency or a libexec-only install", () => {
    const text = renderFormula({ version: "1.2.0", license: "MIT", sha256: { arm64: ARM, x64: X64 } });
    for (const forbidden of ["revision", "post_install", 'depends_on "node"', "libexec.install", "install_symlink"]) expect(text).not.toContain(forbidden);
  });

  it.each([
    ["a prerelease version", { version: "1.0.0-rc.1" }, /version/u],
    ["an upper-case hash", { sha256: { arm64: ARM.toUpperCase(), x64: X64 } }, /sha256/u],
    ["a short hash", { sha256: { arm64: "a".repeat(63), x64: X64 } }, /sha256/u],
    ["a license that could break out of the Ruby string", { license: 'MIT" do system "x' }, /license/u],
  ])("refuses %s", (_label, override, message) => {
    expect(() => renderFormula({ version: "0.1.0", license: "MIT", sha256: { arm64: ARM, x64: X64 }, ...override })).toThrow(message);
  });
});

describe("sumsOf", () => {
  const sums = `${ARM}  developer-os-0.1.0-darwin-arm64.tar.gz\n${X64}  developer-os-0.1.0-darwin-x64.tar.gz\n`;

  it("reads both tarball hashes", () => {
    expect(sumsOf(sums, "0.1.0")).toEqual({ arm64: ARM, x64: X64 });
  });

  it.each([
    ["another version's file names", sums.replaceAll("0.1.0", "0.2.0")],
    ["a missing x64 line", `${ARM}  developer-os-0.1.0-darwin-arm64.tar.gz\n`],
    ["an unknown extra line", `${sums}${ARM}  other.tar.gz\n`],
    ["a duplicated line", `${sums}${X64}  developer-os-0.1.0-darwin-x64.tar.gz\n`],
    ["a single-space separator", sums.replace("  developer-os-0.1.0-darwin-arm64", " developer-os-0.1.0-darwin-arm64")],
  ])("refuses %s", (_label, text) => {
    expect(() => sumsOf(text, "0.1.0")).toThrow(/SHA256SUMS/u);
  });
});

describe("licenseOf", () => {
  it("reads the root package.json license and refuses its absence until L1", () => {
    expect(licenseOf('{"name":"developer-os","license":"MIT"}')).toBe("MIT");
    expect(() => licenseOf('{"name":"developer-os"}')).toThrow(/no license.*L1/u);
  });
});
