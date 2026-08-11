import { describe, expect, it } from "vitest";
import type { RenderedArtifact } from "@developer-os/workflow-schema";
import { proposeClaudeInstall, proposeClaudeUninstall } from "./install.js";

const tree: readonly RenderedArtifact[] = [
  {
    path: ".claude-plugin/plugin.json",
    contents: '{"name":"developer-os"}\n',
  },
  { path: "skills/developer-os-capture/SKILL.md", contents: "# capture\n" },
];

const context = { home: "/synthetic/home", productVersion: "0.1.0" };
const root = "/synthetic/home/.claude/skills/developer-os";

describe("proposeClaudeInstall", () => {
  it("writes every artifact under the one owned directory", () => {
    for (const operation of proposeClaudeInstall(tree, context).operations) {
      expect(operation.targetPath.startsWith(`${root}/`)).toBe(true);
    }
  });

  /**
   * Spec §4: the install writes no key into `~/.claude/settings.json`. That is
   * the property the whole install shape was chosen for, so it is asserted
   * rather than assumed.
   */
  it("never touches settings.json or anything outside the plugin directory", () => {
    const paths = proposeClaudeInstall(tree, context).operations.map(
      (operation) => operation.targetPath,
    );
    expect(paths.some((path) => path.includes("settings.json"))).toBe(false);
    expect(paths.every((path) => path.startsWith(`${root}/`))).toBe(true);
  });

  it("plans one operation per artifact and no more", () => {
    expect(proposeClaudeInstall(tree, context).operations).toHaveLength(
      tree.length,
    );
  });

  it("claims the artifacts as claude-owned dedicated files", () => {
    for (const operation of proposeClaudeInstall(tree, context).operations) {
      expect(operation.owner).toBe("claude");
      expect(operation.kind).toBe("file");
      expect(operation.mergeStrategy).toBe("dedicated");
    }
  });

  it("carries a content hash so a later drift check has something to compare", () => {
    for (const operation of proposeClaudeInstall(tree, context).operations) {
      expect(operation.proposedHash).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it("hashes the contents, not the path", () => {
    const [first] = proposeClaudeInstall(
      [{ path: "a/b.md", contents: "same" }],
      context,
    ).operations;
    const [second] = proposeClaudeInstall(
      [{ path: "c/d.md", contents: "same" }],
      context,
    ).operations;
    expect(first?.proposedHash).toBe(second?.proposedHash);
  });

  it("refuses an artifact path that escapes the plugin root", () => {
    for (const escape of [
      "../../escape.md",
      "..",
      "skills/../../escape.md",
      "/etc/passwd",
    ]) {
      expect(
        () => proposeClaudeInstall([{ path: escape, contents: "x" }], context),
        `${escape} must be refused`,
      ).toThrow(/escapes/u);
    }
  });

  it("refuses an empty tree, so applying a plan cannot silently do nothing", () => {
    expect(() => proposeClaudeInstall([], context)).toThrow(/empty/iu);
  });

  it("proposes a plan the validator's shape requires", () => {
    const proposal = proposeClaudeInstall(tree, context);
    expect(proposal.schemaVersion).toBe(1);
    expect(proposal.productVersion).toBe("0.1.0");
    expect(proposal.operations.length).toBeGreaterThan(0);
  });
});

describe("proposeClaudeUninstall", () => {
  /**
   * Spec §4.2: there is no uninstall step, because nothing was installed from a
   * marketplace. Removing the directory is the whole operation.
   */
  it("removes the plugin directory and nothing else", () => {
    const proposal = proposeClaudeUninstall(context);
    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0]?.targetPath).toBe(root);
    expect(proposal.operations[0]?.operation).toBe("remove");
    expect(proposal.operations[0]?.kind).toBe("directory");
  });

  it("proposes no hash for a removal", () => {
    expect(proposeClaudeUninstall(context).operations[0]?.proposedHash).toBeNull();
  });
});
