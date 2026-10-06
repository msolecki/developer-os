import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { HookRuntime } from "../registry.js";
import { guardPath, HOOK_PROTECTED_PATH_RULES } from "./path.js";

let home: string;
let project: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "developer-os-guard-path-")));
  project = join(home, "p");
  await mkdir(join(project, ".git"), { recursive: true });
  await mkdir(join(project, "sub"), { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function runtime(userHome: string | null, cwd = project): HookRuntime {
  return {
    vendor: "claude",
    env: {},
    userHome,
    cwd,
    runner: { run: () => Promise.reject(new Error("no child in a path guard test")) },
    nodeExecutable: "/synthetic/node",
    redact: (text) => text,
    now: () => new Date(0),
    io: {
      stdout: () => undefined,
      stderr: () => undefined,
      confirm: () => Promise.resolve(false),
      readStdin: () => Promise.resolve(null),
    },
    createContext: () => {
      throw new Error("guards build no context");
    },
  };
}

// Each path is a thunk because `home` is created per test.
const HOOK_BLOCKS: readonly (readonly [string, () => string])[] = [
  ["credential-file", () => ".git-credentials"],
  ["credential-file", () => "sub/.netrc"],
  ["credential-file", () => ".pgpass"],
  ["credential-file", () => "public/.htpasswd"],
  ["credential-file", () => ".envrc"],
  ["private-key", () => "keys/id_rsa"],
  ["private-key", () => "id_dsa"],
  ["private-key", () => "deploy/id_ecdsa"],
  ["private-key", () => "id_ed25519"],
  ["credentials-json", () => "config/credentials.json"],
  ["secrets-dir", () => "secrets/db.txt"],
  ["secrets-dir", () => "config/secret/token"],
  ["home-config", () => join(home, ".npmrc")],
  ["home-config", () => join(home, ".docker", "config.json")],
  ["home-config", () => join(home, ".kube", "config")],
  ["key-material", () => "certs/server.key"],
  ["key-material", () => "certs/server.pem"],
  ["key-material", () => "client.p12"],
  ["key-material", () => "client.pfx"],
  ["key-material", () => "infra/prod.tfvars"],
];

const HOOK_ALLOWS: readonly (readonly [string, () => string])[] = [
  ["credential-file", () => "docs/netrc-setup.md"],
  ["private-key", () => "keys/id_ed25519.pub"],
  ["credentials-json", () => "config/credentials.json.example"],
  ["secrets-dir", () => "src/secret-manager.ts"],
  ["home-config", () => ".npmrc"],
  ["home-config", () => "docker/config.json"],
  ["key-material", () => "docs/keys.md"],
];

const run = (filePath: string | null, toolName = "Edit", userHome: string | null = home, cwd = project) =>
  guardPath({ cwd, toolName, command: null, filePath, prompt: null, stopHookActive: null }, runtime(userHome, cwd));

describe("guard path", () => {
  it("blocks every protected path, relative ones resolved against the project root (G7)", async () => {
    const blocked = [
      ".env",
      ".env.local",
      join(home, ".ssh", "id_ed25519"),
      join(home, ".claude", ".credentials.json"),
      join(home, ".aws", "config"),
      "sub/.env",
    ];
    expect(blocked.length).toBeGreaterThan(0);
    for (const filePath of blocked) {
      expect(await run(filePath)).toMatchObject({ kind: "block", ruleId: "protected-path" });
    }
  });

  it("resolves a relative path from a subdirectory cwd against the project root", async () => {
    expect(await run("sub/.env", "Write", home, join(project, "sub"))).toMatchObject({
      kind: "block",
      ruleId: "protected-path",
    });
  });

  it("blocks a project symlink named .env even though it resolves to an ordinary file", async () => {
    await writeFile(join(project, "plain.txt"), "synthetic\n");
    await symlink(join(project, "plain.txt"), join(project, ".env"));
    expect(await run(".env", "Write")).toMatchObject({ kind: "block", ruleId: "protected-path" });
  });

  it("allows an ordinary source file", async () => {
    expect(await run("src/index.ts")).toStrictEqual({ kind: "allow" });
    expect(await run("src/index.ts", "MultiEdit")).toStrictEqual({ kind: "allow" });
  });

  // D67: a committed `.env` template is exempt; a real variant is not.
  it("allows an .env template and blocks .env.production", async () => {
    expect(await run(".env.example")).toStrictEqual({ kind: "allow" });
    expect(await run("sub/.env.dist")).toStrictEqual({ kind: "allow" });
    expect(await run(".env.production")).toMatchObject({ kind: "block", ruleId: "protected-path" });
  });

  // D67 option (c): the hook-only table, outside PROTECTED_PATH_RULES and CLAUDE_DENY_RULES.
  it("has a block fixture and a near-miss allow fixture for every hook-only rule", () => {
    expect(HOOK_PROTECTED_PATH_RULES.length).toBeGreaterThan(0);
    for (const { id } of HOOK_PROTECTED_PATH_RULES) {
      expect(HOOK_BLOCKS.some(([rule]) => rule === id), id).toBe(true);
      expect(HOOK_ALLOWS.some(([rule]) => rule === id), id).toBe(true);
    }
  });

  it.each(HOOK_BLOCKS)("blocks a %s path", async (_rule, filePath) => {
    expect(await run(filePath(), "Write")).toMatchObject({ kind: "block", ruleId: "protected-path" });
  });

  it.each(HOOK_ALLOWS)("allows a %s near miss", async (_rule, filePath) => {
    expect(await run(filePath(), "Write")).toStrictEqual({ kind: "allow" });
  });

  // NEW-154: APFS is case-insensitive, so a case variant names the same file once it is created.
  it.each([
    () => join(home, ".SSH", "authorized_keys"),
    () => ".Env",
    () => "sub/.ENV.local",
    () => join(home, ".Codex", "Auth.json"),
    () => "sub/.NETRC",
    () => "keys/ID_RSA",
    () => "Secrets/db.txt",
    () => "certs/server.PEM",
    () => join(home, ".NPMRC"),
  ])("blocks the case variant %#", async (filePath) => {
    expect(await run(filePath(), "Write")).toMatchObject({ kind: "block", ruleId: "protected-path" });
  });

  // NEW-154 fix round: APFS's full Unicode case folding (ſ→s, ß/ẞ→ss, ﬁ→fi, ﬆ/ﬅ→st), against missing targets.
  it.each([
    () => join(home, ".awſ", "credentials"),
    () => join(home, ".ſsh", "authorized_keys"),
    () => join(home, ".kube", "conﬁg"),
    () => join(home, ".config", "gh", "hoﬆs.yml"),
    () => join(home, ".config", "gh", "hoﬅs.yml"),
    () => join(home, ".codex", "auth.jſon"),
    () => ".pgpaß",
    () => ".pgpaẞ",
    () => "public/.htpaßwd",
    () => join(home, ".docker", "conﬁg.json"),
    () => "keys/id_rſa",
    () => "ſecrets/db.txt",
    () => "config/credentialſ.json",
    () => "infra/prod.tfvarſ",
  ])("blocks the full-case-fold variant %#", async (filePath) => {
    expect(await run(filePath(), "Write")).toMatchObject({ kind: "block", ruleId: "protected-path" });
  });

  it("allows a case-variant .env template", async () => {
    expect(await run(".Env.Example", "Write")).toStrictEqual({ kind: "allow" });
  });

  it("blocks a project symlink that resolves to a home credential file", async () => {
    await writeFile(join(home, ".npmrc"), "synthetic\n");
    await symlink(join(home, ".npmrc"), join(project, "npmrc-link"));
    expect(await run("npmrc-link", "Write")).toMatchObject({ kind: "block", ruleId: "protected-path" });
  });

  // CRITIC-2: `CODEX_HOME` and the home a Codex attach recorded both hold the Codex credential.
  it("blocks auth.json under CODEX_HOME and under the recorded Codex home", async () => {
    await mkdir(join(home, ".developer-os", "codex"), { recursive: true });
    await writeFile(join(home, ".developer-os", "codex", "codex-home"), `${join(home, "recorded")}\n`);
    const withCodexHome = { ...runtime(home), env: { CODEX_HOME: join(home, "ch") } };
    const guard = (filePath: string) =>
      guardPath({ cwd: project, toolName: "Write", command: null, filePath, prompt: null, stopHookActive: null }, withCodexHome);
    expect(await guard(join(home, "ch", "auth.json"))).toMatchObject({ kind: "block", ruleId: "protected-path" });
    expect(await guard(join(home, "recorded", "auth.json"))).toMatchObject({ kind: "block", ruleId: "protected-path" });
    expect(await guard(join(home, ".codex", "auth.json"))).toMatchObject({ kind: "block", ruleId: "protected-path" });
    expect(await guard(join(home, "ch", "config.toml"))).toStrictEqual({ kind: "allow" });
  });

  // Audit follow-up to CRITIC-2: an agent that rewrites the Codex-home record could redirect C.
  it("blocks writes to the product home's codex/ and state/ records, under DEVELOPER_OS_HOME too", async () => {
    expect(await run(join(home, ".developer-os", "codex", "codex-home"), "Write")).toMatchObject({ kind: "block", ruleId: "product-state" });
    expect(await run(join(home, ".Developer-OS", "State", "journal.json"), "Write")).toMatchObject({ kind: "block", ruleId: "product-state" });
    await mkdir(join(home, ".developer-os", "codex"), { recursive: true });
    await symlink(join(home, ".developer-os", "codex"), join(project, "codex-link"));
    expect(await run("codex-link/codex-home", "Write")).toMatchObject({ kind: "block", ruleId: "product-state" });
    const custom = { ...runtime(home), env: { DEVELOPER_OS_HOME: join(home, "dos") } };
    const guard = (filePath: string) =>
      guardPath({ cwd: project, toolName: "Write", command: null, filePath, prompt: null, stopHookActive: null }, custom);
    expect(await guard(join(home, "dos", "codex", "codex-home"))).toMatchObject({ kind: "block", ruleId: "product-state" });
    expect(await run(join(home, ".developer-os", "notes.md"), "Write")).toStrictEqual({ kind: "allow" });
  });

  it("ignores a tool that is not a file matcher", async () => {
    expect(await run(".env", "Read")).toStrictEqual({ kind: "allow" });
  });

  it("blocks a file tool whose path field is missing (fail closed)", async () => {
    expect(await run(null)).toMatchObject({ kind: "block", ruleId: "payload-malformed" });
  });

  it("blocks when the user home is unknown (fail closed)", async () => {
    expect(await run("src/index.ts", "Edit", null)).toMatchObject({ kind: "block", ruleId: "hook-failed-closed" });
  });

  describe("on Codex, from apply_patch headers", () => {
    const codex = (command: string, toolName = "apply_patch", cwd = project) =>
      guardPath(
        { cwd, toolName, command, filePath: null, prompt: null, stopHookActive: null },
        { ...runtime(home, cwd), vendor: "codex" },
      );
    const patch = (...lines: string[]): string => ["*** Begin Patch", ...lines, "*** End Patch", ""].join("\n");

    it("blocks a patch that names a protected path in any header", async () => {
      expect(await codex(patch("*** Add File: a.txt", "+x", "*** Add File: sub/.env", "+A=1"))).toMatchObject({
        kind: "block",
        ruleId: "protected-path",
      });
      expect(await codex(patch("*** Update File: a.txt", "*** Move to: .env.local", "@@", "-x", "+y"))).toMatchObject({
        kind: "block",
        ruleId: "protected-path",
      });
      expect(await codex(patch("*** Delete File: .env"))).toMatchObject({ kind: "block", ruleId: "protected-path" });
    });

    it("allows a patch of ordinary files", async () => {
      expect(await codex(patch("*** Add File: note.txt", "+synthetic"))).toStrictEqual({ kind: "allow" });
    });

    it("blocks a patch outside the observed grammar", async () => {
      expect(await codex(patch("*** Add File: /etc/hosts", "+x"))).toMatchObject({ kind: "block", ruleId: "patch-malformed" });
      expect(await codex("not a patch")).toMatchObject({ kind: "block", ruleId: "patch-malformed" });
    });

    it("blocks a header whose path ends in whitespace Codex trims away", async () => {
      expect(await codex(patch("*** Update File: .env\u0085", "@@", "-S=1", "+S=2"))).toMatchObject({
        kind: "block",
        ruleId: "patch-malformed",
      });
    });

    it("blocks a .env header hidden behind a leading space as a context line", async () => {
      expect(
        await codex(patch("*** Add File: new.txt", "+x", " *** Update File: .env", "@@", "-S=1", "+S=pwned")),
      ).toMatchObject({ kind: "block", ruleId: "patch-malformed" });
    });

    it("resolves a relative header against the session cwd, not the project root", async () => {
      await mkdir(join(home, ".aws"), { recursive: true });
      await symlink(join(home, ".aws"), join(project, "sub", "link"));
      expect(await codex(patch("*** Update File: link/config", "@@", "-x", "+y"), "apply_patch", join(project, "sub"))).toMatchObject({
        kind: "block",
        ruleId: "protected-path",
      });
    });

    it("ignores the Bash tool", async () => {
      expect(await codex("echo synthetic > .env", "Bash")).toStrictEqual({ kind: "allow" });
    });
  });
});
