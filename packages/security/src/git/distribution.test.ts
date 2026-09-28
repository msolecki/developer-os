import { describe, expect, it } from "vitest";

import { admitGitCapability, admitGitExecutables, GIT_DISTRIBUTION_POLICY, parseGitVersionLine } from "./distribution.js";
import { DARWIN, PROBE_OK, stockHost } from "./distribution.test-fixtures.js";
import { expandGitArgv, GIT_DISTRIBUTION_POLICY_ID, hashGitProcessTable } from "./process-table.js";

describe("the Git distribution policy", () => {
  it("names no build, Xcode version or binary hash, and binds the process table to its ID", () => {
    expect(GIT_DISTRIBUTION_POLICY.id).toBe(GIT_DISTRIBUTION_POLICY_ID);
    expect(GIT_DISTRIBUTION_POLICY.processTable.distributionId).toBe(GIT_DISTRIBUTION_POLICY_ID);
    expect(GIT_DISTRIBUTION_POLICY.processTable.id).toBe("apple-git-process-v2");
    expect(hashGitProcessTable(GIT_DISTRIBUTION_POLICY.processTable)).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify({ ...GIT_DISTRIBUTION_POLICY, processTable: null })).not.toMatch(/Xcode|27A266a|[0-9a-f]{64}|certif/iu);
    expect(Object.isFrozen(GIT_DISTRIBUTION_POLICY)).toBe(true);
  });

  it("maps each distribution image to its system row, and the HTTPS helper to none", () => {
    expect(GIT_DISTRIBUTION_POLICY.executables).toEqual([
      { id: "git_main", system: "git" },
      { id: "git_receive_pack", system: "git-receive-pack" },
      { id: "git_remote_https", system: null },
      { id: "system_ssh", system: "ssh" },
    ]);
  });
});

describe("Git executables", () => {
  it("admits /usr/bin/git and /usr/bin/git-receive-pack for local", async () => {
    await expect(admitGitExecutables(DARWIN, stockHost(), "arm64", "local")).resolves.toMatchObject({
      git: { canonicalPath: "/usr/bin/git" },
      receivePack: { canonicalPath: "/usr/bin/git-receive-pack" },
      ssh: null,
    });
  });
  it.each(["https", "ssh"] as const)("refuses %s (D59 Q4-A)", async (transport) => {
    await expect(admitGitExecutables(DARWIN, stockHost(), "arm64", transport)).rejects.toThrow("unsupported_git_distribution");
  });
  it("refuses another architecture and maps a table refusal", async () => {
    await expect(admitGitExecutables(DARWIN, stockHost(), "x64", "local")).rejects.toThrow("unsupported_git_distribution");
    await expect(admitGitExecutables(DARWIN, stockHost({ "/usr/bin/git": { ownerUid: 501 } }), "arm64", "local")).rejects.toThrow("unsupported_git_distribution");
    await expect(admitGitExecutables(DARWIN, stockHost({ "/usr/bin/git-receive-pack": { mode: 0o775 } }), "arm64", "local")).rejects.toThrow(
      "unsupported_git_distribution",
    );
  });
  it("refuses when the table has no git-receive-pack row", async () => {
    await expect(admitGitExecutables([DARWIN[0], DARWIN[2]], stockHost(), "arm64", "local")).rejects.toThrow("unsupported_git_distribution");
  });
});

describe("version floor and capability", () => {
  it.each([
    ["git version 2.54.0 (Apple Git-157)", true],
    ["git version 2.55.1 (Apple Git-160)", true],
    ["git version 3.0.0 (Apple Git-157)", true],
    ["git version 2.53.9 (Apple Git-157)", false],
    ["git version 2.54.0 (Apple Git-156)", false],
    ["git version 2.54.0", false],
    ["git version 2.54.0 (Homebrew)", false],
    ["git version 02.54.0 (Apple Git-157)", false],
  ])("%s admits: %s", async (line, admits) => {
    const admitted = await admitGitExecutables(DARWIN, stockHost(), "arm64", "local");
    const run = () => admitGitCapability(admitted, `${line}\n${PROBE_OK}`, 0);
    if (admits) expect(run().gitVersionLine).toBe(line);
    else expect(run).toThrow("unsupported_git_distribution");
  });
  it.each(["cpu: arm64", "shell-path: /bin/sh", "default-hash: sha1", "default-ref-format: files"])("refuses without %s", async (required) => {
    const admitted = await admitGitExecutables(DARWIN, stockHost(), "arm64", "local");
    const probe = PROBE_OK.split("\n").filter((line) => line !== required).join("\n");
    expect(() => admitGitCapability(admitted, `git version 2.54.0 (Apple Git-157)\n${probe}`, 0)).toThrow("unsupported_git_distribution");
  });
  it("ignores changed library lines, refuses duplicates, over-long output and a non-zero exit", async () => {
    const admitted = await admitGitExecutables(DARWIN, stockHost(), "arm64", "local");
    const head = "git version 2.54.0 (Apple Git-157)";
    expect(() => admitGitCapability(admitted, `${head}\n${PROBE_OK}\nlibcurl: 9.9.9\nfeature: new`, 0)).not.toThrow();
    expect(() => admitGitCapability(admitted, `${head}\n${PROBE_OK}\ndefault-hash: sha1`, 0)).toThrow("unsupported_git_distribution");
    expect(() => admitGitCapability(admitted, `${head}\n${PROBE_OK}\n${"x: y\n".repeat(40)}`, 0)).toThrow("unsupported_git_distribution");
    expect(() => admitGitCapability(admitted, "xcrun: error: invalid active developer path", 1)).toThrow("unsupported_git_distribution");
    expect(() => admitGitCapability(admitted, `${head}\n${PROBE_OK}\r\n`, 0)).toThrow("unsupported_git_distribution");
    expect(() => admitGitCapability(admitted, "", 0)).toThrow("unsupported_git_distribution");
  });
  it("carries the admitted files into the distribution record", async () => {
    const admitted = await admitGitExecutables(DARWIN, stockHost(), "arm64", "local");
    expect(admitGitCapability(admitted, `git version 2.54.0 (Apple Git-157)\n${PROBE_OK}\n`, 0)).toEqual({
      ...admitted,
      gitVersionLine: "git version 2.54.0 (Apple Git-157)",
    });
  });
  it("parses the vendor build only where the row names one", () => {
    expect(parseGitVersionLine("git version 2.54.0 (Apple Git-157)", "Apple Git-")).toEqual({ major: 2, minor: 54, patch: 0, vendorBuild: 157 });
    expect(parseGitVersionLine("git version 2.54.0", null)).toEqual({ major: 2, minor: 54, patch: 0, vendorBuild: null });
    expect(parseGitVersionLine("git version 2.54.0 (Apple Git-157) extra", "Apple Git-")).toBeNull();
    expect(parseGitVersionLine("git version 2.54.0 (Apple Git-157)", null)).toBeNull();
  });
});

describe("process table under the shim", () => {
  it("every environment profile is free of xcrun inputs", () => {
    for (const profile of GIT_DISTRIBUTION_POLICY.processTable.environmentProfiles) {
      for (const { name } of profile.entries) expect(name).not.toMatch(/^(DEVELOPER_DIR|SDKROOT|TOOLCHAINS|xcrun_.*)$/u);
    }
  });
  it("execs receive-pack as the git-receive-pack fixed path with the gateway's unchanged argv", () => {
    const node = GIT_DISTRIBUTION_POLICY.processTable.nodes.find((candidate) => candidate.id === "real_receive_pack");
    expect(node?.image).toEqual({ kind: "distribution", executableId: "git_receive_pack", argv0: "git-receive-pack" });
    const edges = GIT_DISTRIBUTION_POLICY.processTable.edges;
    const exec = edges.find((candidate) => candidate.id === "exec_receive_pack");
    const spawn = edges.find((candidate) => candidate.id === "spawn_receive_pack_gateway");
    expect(exec?.argvAlternatives).toEqual(spawn?.argvAlternatives);
    const [grammar] = exec?.argvAlternatives ?? [];
    if (grammar === undefined) throw new Error("exec_receive_pack has no argv");
    expect(expandGitArgv(grammar, { private_destination_shadow: "/x/shadow.git" })).toEqual([
      "git-receive-pack",
      "--skip-connectivity-check",
      "/x/shadow.git",
    ]);
  });
});
