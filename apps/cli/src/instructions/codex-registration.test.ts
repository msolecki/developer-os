import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encodeCanonicalJson, EXIT_CODES, parseLowerHexSha256 } from "@developer-os/core";
import type { LowerHexSha256 } from "@developer-os/core";
import { SecurityRefusalError } from "@developer-os/security";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";

import {
  CODEX_CLI_ABSENT_WARNING,
  codexPluginTreeHash,
  CodexRegistrationFailedError,
  inspectCodexRegistration,
  registerCodexPlugin,
  unregisterCodexPlugin,
  validateCodexRegistrationRecord,
} from "./codex-registration.js";
import type { CodexRegistrationRecordV1 } from "./codex-registration.js";

const encoder = new TextEncoder();
const CODEX = "/usr/local/bin/codex";
const C = "/Users/synthetic/.codex";
const MARKETPLACE_ROOT = "/Users/synthetic/.developer-os/codex";
const PLUGIN_ROOT = `${MARKETPLACE_ROOT}/plugins/developer-os`;
const HASH_A = parseLowerHexSha256("a".repeat(64));
const HASH_B = parseLowerHexSha256("b".repeat(64));

const MARKETPLACE_LIST = "plugin marketplace list";
const MARKETPLACE_ADD = `plugin marketplace add ${MARKETPLACE_ROOT}`;
const PLUGIN_ADD = "plugin add developer-os@developer-os --json";
const PLUGIN_LIST = "plugin list --json";
const PLUGIN_REMOVE = "plugin remove developer-os@developer-os";
const MARKETPLACE_REMOVE = "plugin marketplace remove developer-os";

interface FakeCodexState {
  marketplaceRoot: string | null;
  installed: { enabled: boolean; path: string } | null;
}

/** A synthetic Codex with the observed effects of each command (`codex-adapter.md` §15). */
class FakeCodex implements ProcessRunner {
  readonly requests: ProcessRequest[] = [];
  readonly state: FakeCodexState;
  failOn: string | null = null;
  listedPath: string | null = null;
  listedEnabled = true;

  constructor(state: Partial<FakeCodexState> = {}) {
    this.state = { marketplaceRoot: null, installed: null, ...state };
  }

  get commands(): string[] {
    return this.requests.map((request) => request.args.join(" "));
  }

  run(request: ProcessRequest): Promise<ProcessResult> {
    this.requests.push(request);
    const command = request.args.join(" ");
    if (command === this.failOn) return Promise.resolve(result(1, ""));
    const state = this.state;
    switch (command) {
      case MARKETPLACE_LIST:
        return Promise.resolve(
          result(0, state.marketplaceRoot === null ? "No plugin marketplaces in scope.\n" : `developer-os  ${state.marketplaceRoot}\n`),
        );
      case MARKETPLACE_ADD:
        state.marketplaceRoot = MARKETPLACE_ROOT;
        return Promise.resolve(result(0, "Added marketplace `developer-os`.\n"));
      case PLUGIN_ADD:
        if (state.marketplaceRoot === null) return Promise.resolve(result(1, ""));
        state.installed = {
          enabled: this.listedEnabled,
          path: this.listedPath ?? `${state.marketplaceRoot}/plugins/developer-os`,
        };
        return Promise.resolve(result(0, JSON.stringify({ pluginId: "developer-os@developer-os" })));
      case PLUGIN_LIST:
        return Promise.resolve(
          result(
            0,
            JSON.stringify({
              installed:
                state.installed === null
                  ? []
                  : [{ name: "developer-os", enabled: state.installed.enabled, source: { source: "local", path: state.installed.path }, extra: 1 }],
              available: [{ malformed: true }],
            }),
          ),
        );
      case PLUGIN_REMOVE:
        state.installed = null;
        return Promise.resolve(result(0, "{}"));
      case MARKETPLACE_REMOVE:
        if (state.marketplaceRoot === null) return Promise.resolve(result(1, ""));
        state.marketplaceRoot = null;
        return Promise.resolve(result(0, "Removed marketplace `developer-os`.\n"));
      default:
        return Promise.resolve(result(2, ""));
    }
  }
}

function result(exitCode: number, stdout: string): ProcessResult {
  return { stdout, stderr: exitCode === 0 ? "" : "sentinel-stderr-must-not-leak", exitCode, signal: null, timedOut: false };
}

function registered(): FakeCodex {
  return new FakeCodex({ marketplaceRoot: MARKETPLACE_ROOT, installed: { enabled: true, path: PLUGIN_ROOT } });
}

async function register(codex: FakeCodex): Promise<void> {
  await registerCodexPlugin({ runner: codex, codexExecutable: CODEX, codexHome: C, marketplaceRoot: MARKETPLACE_ROOT, pluginRoot: PLUGIN_ROOT });
}

async function inspect(codex: FakeCodex, record: CodexRegistrationRecordV1 | null, treeHash: LowerHexSha256 = HASH_A) {
  return inspectCodexRegistration({ runner: codex, codexExecutable: CODEX, codexHome: C, pluginRoot: PLUGIN_ROOT, record, treeHash });
}

async function expectRegistrationFailure(promise: Promise<unknown>): Promise<CodexRegistrationFailedError> {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CodexRegistrationFailedError);
  const failure = error as CodexRegistrationFailedError;
  expect(failure.code).toBe(EXIT_CODES.operationalFailure);
  expect(failure.reason).toBe("codex_registration_failed");
  expect(failure.name).toBe("CodexRegistrationFailedError");
  expect(failure.message).not.toContain("sentinel");
  return failure;
}

const record = (treeHash: LowerHexSha256, codexHome = C): CodexRegistrationRecordV1 =>
  validateCodexRegistrationRecord(encoder.encode(encodeCanonicalJson({ codexHome, treeHash })));

describe("the runner contract", () => {
  it("passes argv arrays only and env exactly { CODEX_HOME: C } to every call", async () => {
    const codex = new FakeCodex();
    await register(codex);
    await inspect(codex, null);
    await unregisterCodexPlugin({ runner: codex, codexExecutable: CODEX, codexHome: C });
    expect(codex.requests.length).toBeGreaterThan(0);
    for (const request of codex.requests) {
      expect(request.executable).toBe(CODEX);
      expect(Array.isArray(request.args)).toBe(true);
      expect(request.env).toStrictEqual({ CODEX_HOME: C });
      expect(request.stdin).toBe("");
    }
  });

  it("lets a security refusal from the runner propagate unwrapped", async () => {
    const runner: ProcessRunner = { run: () => Promise.reject(new SecurityRefusalError("refused")) };
    await expect(
      registerCodexPlugin({ runner, codexExecutable: CODEX, codexHome: C, marketplaceRoot: MARKETPLACE_ROOT, pluginRoot: PLUGIN_ROOT }),
    ).rejects.toBeInstanceOf(SecurityRefusalError);
  });

  it("turns a spawn failure or a timeout into codex_registration_failed", async () => {
    const thrown: ProcessRunner = { run: () => Promise.reject(new Error("spawn ENOENT")) };
    await expectRegistrationFailure(inspectCodexRegistration({ runner: thrown, codexExecutable: CODEX, codexHome: C, pluginRoot: PLUGIN_ROOT, record: null, treeHash: HASH_A }));
    const timedOut: ProcessRunner = {
      run: () => Promise.resolve({ stdout: "", stderr: "", exitCode: null, signal: "SIGTERM", timedOut: true }),
    };
    await expectRegistrationFailure(inspectCodexRegistration({ runner: timedOut, codexExecutable: CODEX, codexHome: C, pluginRoot: PLUGIN_ROOT, record: null, treeHash: HASH_A }));
  });
});

describe("registerCodexPlugin", () => {
  it("adds the marketplace only when absent, always runs plugin add, then verifies with plugin list", async () => {
    const fresh = new FakeCodex();
    await register(fresh);
    expect(fresh.commands).toStrictEqual([MARKETPLACE_LIST, MARKETPLACE_ADD, PLUGIN_ADD, PLUGIN_LIST]);

    const again = registered();
    await register(again);
    expect(again.commands).toStrictEqual([MARKETPLACE_LIST, PLUGIN_ADD, PLUGIN_LIST]);
  });

  it.each([
    ["a foreign source path", (codex: FakeCodex) => { codex.listedPath = "/Users/synthetic/elsewhere/developer-os"; }],
    ["a disabled plugin", (codex: FakeCodex) => { codex.listedEnabled = false; }],
  ])("refuses exit 1 when plugin list shows %s", async (_label, arrange) => {
    const codex = new FakeCodex();
    arrange(codex);
    await expectRegistrationFailure(register(codex));
    expect(await inspect(codex, null)).toBe("unregistered");
  });

  it("refuses an unreadable listing instead of reading it as absent", async () => {
    const runner: ProcessRunner = {
      run: (request) => Promise.resolve(result(0, request.args.join(" ") === PLUGIN_LIST ? "{\"plugins\":[]}" : "")),
    };
    await expectRegistrationFailure(inspectCodexRegistration({ runner, codexExecutable: CODEX, codexHome: C, pluginRoot: PLUGIN_ROOT, record: null, treeHash: HASH_A }));
  });
});

describe("the spec §6.4 partial states, by fault injection", () => {
  it.each([MARKETPLACE_LIST, MARKETPLACE_ADD, PLUGIN_ADD, PLUGIN_LIST])(
    "tree installed, not registered: a fresh registration failing at `%s` is unregistered",
    async (failOn) => {
      const codex = new FakeCodex();
      codex.failOn = failOn;
      const failure = await expectRegistrationFailure(register(codex));
      expect(failure.message).toContain(failOn);
      expect(failure.paths).toStrictEqual([C]);
      codex.failOn = null;
      expect(await inspect(codex, null)).toBe("unregistered");
    },
  );

  it("registered, tree changed since: a reconcile whose plugin add fails is stale", async () => {
    const codex = registered();
    codex.failOn = PLUGIN_ADD;
    await expectRegistrationFailure(register(codex));
    codex.failOn = null;
    expect(await inspect(codex, record(HASH_A), HASH_B)).toBe("stale");
  });

  it("unregistered, tree present: a completed unregistration before a failed detach is unregistered", async () => {
    const codex = registered();
    expect(await unregisterCodexPlugin({ runner: codex, codexExecutable: CODEX, codexHome: C })).toStrictEqual({ warning: null });
    expect(await inspect(codex, record(HASH_A))).toBe("unregistered");
  });

  it("is registered only when the listing, the record hash and the record home all agree", async () => {
    const codex = registered();
    expect(await inspect(codex, record(HASH_A))).toBe("registered");
    expect(await inspect(codex, null)).toBe("unregistered");
    expect(await inspect(codex, record(HASH_A, "/Users/synthetic/other-codex"))).toBe("stale");
    expect(await inspect(codex, record(HASH_A), HASH_B)).toBe("stale");
  });
});

describe("unregisterCodexPlugin", () => {
  it("removes the plugin then the marketplace, skipping each one already absent", async () => {
    const full = registered();
    await unregisterCodexPlugin({ runner: full, codexExecutable: CODEX, codexHome: C });
    expect(full.commands).toStrictEqual([PLUGIN_LIST, PLUGIN_REMOVE, MARKETPLACE_LIST, MARKETPLACE_REMOVE]);

    const marketplaceOnly = new FakeCodex({ marketplaceRoot: MARKETPLACE_ROOT });
    await unregisterCodexPlugin({ runner: marketplaceOnly, codexExecutable: CODEX, codexHome: C });
    expect(marketplaceOnly.commands).toStrictEqual([PLUGIN_LIST, MARKETPLACE_LIST, MARKETPLACE_REMOVE]);

    const nothing = new FakeCodex();
    await unregisterCodexPlugin({ runner: nothing, codexExecutable: CODEX, codexHome: C });
    expect(nothing.commands).toStrictEqual([PLUGIN_LIST, MARKETPLACE_LIST]);
  });

  it("warns and runs nothing when the codex CLI is absent", async () => {
    const codex = registered();
    expect(await unregisterCodexPlugin({ runner: codex, codexExecutable: null, codexHome: C })).toStrictEqual({
      warning: CODEX_CLI_ABSENT_WARNING,
    });
    expect(CODEX_CLI_ABSENT_WARNING).toBe("codex registration not removed: codex CLI absent");
    expect(codex.requests).toStrictEqual([]);
  });

  // `plugin remove` exits 0 for anything (`codex-adapter.md` §11.12), so the injected failure is
  // the marketplace step's.
  it.each([PLUGIN_LIST, PLUGIN_REMOVE, MARKETPLACE_LIST, MARKETPLACE_REMOVE])("throws exit 1 when `%s` fails, before any caller mutation", async (failOn) => {
    const codex = registered();
    codex.failOn = failOn;
    let callerMutated = false;
    await expectRegistrationFailure(
      unregisterCodexPlugin({ runner: codex, codexExecutable: CODEX, codexHome: C }).then(() => {
        callerMutated = true;
      }),
    );
    expect(callerMutated).toBe(false);
  });
});

describe("validateCodexRegistrationRecord", () => {
  it("round-trips the canonical encoding", () => {
    const bytes = encoder.encode(encodeCanonicalJson({ codexHome: C, treeHash: HASH_A }));
    const value = validateCodexRegistrationRecord(bytes);
    expect(value).toStrictEqual({ codexHome: C, treeHash: HASH_A });
    expect(encoder.encode(encodeCanonicalJson({ ...value }))).toStrictEqual(bytes);
  });

  it.each([
    ["an extra key", `{"codexHome":"${C}","extra":1,"treeHash":"${HASH_A}"}\n`],
    ["a missing key", `{"treeHash":"${HASH_A}"}\n`],
    ["reordered keys", `{"treeHash":"${HASH_A}","codexHome":"${C}"}\n`],
    ["pretty-printed bytes", `{ "codexHome": "${C}", "treeHash": "${HASH_A}" }\n`],
    ["a second LF", `{"codexHome":"${C}","treeHash":"${HASH_A}"}\n\n`],
    ["no LF", `{"codexHome":"${C}","treeHash":"${HASH_A}"}`],
    ["a relative home", `{"codexHome":"relative/.codex","treeHash":"${HASH_A}"}\n`],
    ["an uppercase hash", `{"codexHome":"${C}","treeHash":"${"A".repeat(64)}"}\n`],
    ["an array", "[]\n"],
  ])("refuses %s", (_label, text) => {
    expect(() => validateCodexRegistrationRecord(encoder.encode(text))).toThrow();
  });
});

describe("codexPluginTreeHash", () => {
  const skillB = { path: "skills/b/SKILL.md", sha256: HASH_B };
  const manifest = { path: ".codex-plugin/plugin.json", sha256: HASH_A };
  const skillA = { path: "skills/a/SKILL.md", sha256: HASH_A };
  const files = [skillB, manifest, skillA];

  it("is the domain-separated digest of the path-sorted canonical entries", () => {
    const sorted = [...files].sort((left, right) => (left.path < right.path ? -1 : 1)).map(({ path, sha256 }) => ({ path, sha256 }));
    const expected = createHash("sha256")
      .update("developer-os:codex-plugin-tree:v1\0", "ascii")
      .update(encodeCanonicalJson(sorted), "utf8")
      .digest("hex");
    expect(codexPluginTreeHash(files)).toBe(expected);
  });

  it("is independent of input order and changes with any file hash", () => {
    expect(codexPluginTreeHash([...files].reverse())).toBe(codexPluginTreeHash(files));
    expect(codexPluginTreeHash([{ ...skillB, sha256: HASH_A }, manifest, skillA])).not.toBe(codexPluginTreeHash(files));
  });

  it("changes when the hook manifest is added or its bytes change, so re-registration covers it (NEW-61)", () => {
    const hooks = { path: "hooks/hooks.json", sha256: HASH_A };
    expect(codexPluginTreeHash([...files, hooks])).not.toBe(codexPluginTreeHash(files));
    expect(codexPluginTreeHash([...files, { ...hooks, sha256: HASH_B }])).not.toBe(codexPluginTreeHash([...files, hooks]));
  });

  it("refuses an empty tree, a duplicate path and a malformed digest", () => {
    expect(() => codexPluginTreeHash([])).toThrow();
    expect(() => codexPluginTreeHash([skillB, { ...skillB, sha256: HASH_A }])).toThrow();
    expect(() => codexPluginTreeHash([{ path: "x", sha256: "A".repeat(64) as LowerHexSha256 }])).toThrow();
  });
});
