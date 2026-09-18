import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decodeCanonicalJson, encodeCanonicalJson } from "../lifecycle/canonical-json.js";
import { loadConfig, serializeConfig } from "./loader.js";
import {
  SCHEDULED_JOB_IDS,
  encodeLifecycleActivationRecord,
  gitScopeFingerprint,
  lifecycleConfigHash,
  parseLifecycleActivationRecord,
  parseNormalizedRemoteUrl,
  parseValidatedGitBranch,
  type AutomationConfigV1,
  type GitScopeSnapshotV1,
  type GitSyncConfigV1,
  type LifecycleActivationRecordV1,
} from "./lifecycle.js";

const encoder = new TextEncoder();

const SPEC_GIT_RECORD =
  '{"branch":"main","remote":{"declaredUrl":"file:///Users/test/git/brain.git","effectivePushUrl":"file:///Users/test/git/brain.git","name":"developer-os","transport":"local"},"repositoryRoot":"/Users/test/DeveloperBrain","schemaVersion":1,"scope":{"brainPath":"/Users/test/DeveloperBrain","contentRoot":"content","fingerprint":"beb2e2591f459a3bc58969ec3b82171dcd3f37525e9149520a1a12851135d794","indexesDir":"_indexes","topicAliases":{"PROJEKTY":"PROJECTS"},"topicFolders":["DEV","PROJECTS"]}}';
const SPEC_GIT_EXAMPLE = `${SPEC_GIT_RECORD}\n`;

const SPEC_AUTOMATION_RECORD =
  '{"schedules":[{"job":"brain-reindex","schedule":{"cadence":"daily","hour":2,"minute":0}},{"job":"brain-lint","schedule":{"cadence":"daily","hour":2,"minute":30}},{"job":"doctor","schedule":{"cadence":"weekly","day":"mon","hour":3,"minute":0}},{"job":"git-sync","schedule":{"cadence":"hourly","minute":15}}],"schemaVersion":1}';
const SPEC_AUTOMATION_EXAMPLE = `${SPEC_AUTOMATION_RECORD}\n`;

const BRAIN_PATH = "/Users/test/DeveloperBrain";

/** The exact bytes a pre-DOS-P7 `init` wrote: `defaultConfig` through the shipped `serializeConfig`. */
const LEGACY_TOML = `schemaVersion = 1
brainPath = "${BRAIN_PATH}"
telemetry = false

[adapters]
claude = false
codex = false

[git]
enabled = false

[automation]
enabled = false
`;

const CONFIG_HEAD = `schemaVersion = 1
brainPath = "${BRAIN_PATH}"
telemetry = false

[adapters]
claude = false
codex = false
`;

interface ScopeSource {
  readonly brainPath?: string;
  readonly contentRoot: string;
  readonly topicFolders: readonly string[];
  readonly topicAliases: Readonly<Record<string, string>>;
  readonly indexesDir: string;
}

function tomlKey(key: string): string {
  return JSON.stringify(key);
}

/**
 * Builds the `[git.lifecycle]` configuration for one scope, with the fingerprint the
 * scope actually hashes to, so a cardinality or folding case refuses for its own reason
 * rather than for a stale digest. The fingerprint value itself is pinned independently
 * against Spec 1 §2.2's printed example below.
 */
function gitLifecycleTomlFor(scope: ScopeSource): string {
  const brainPath = scope.brainPath ?? BRAIN_PATH;
  const fingerprint = gitScopeFingerprint({
    brainPath,
    contentRoot: scope.contentRoot,
    topicFolders: scope.topicFolders,
    topicAliases: scope.topicAliases,
    indexesDir: scope.indexesDir,
  } as unknown as Omit<GitScopeSnapshotV1, "fingerprint">);
  const aliases = Object.entries(scope.topicAliases)
    .map(([alias, target]) => `${tomlKey(alias)} = ${JSON.stringify(target)}`)
    .join("\n");
  return `${CONFIG_HEAD}
[git]
enabled = true

[git.lifecycle]
schemaVersion = 1
repositoryRoot = "${BRAIN_PATH}"
branch = "main"

[git.lifecycle.remote]
name = "developer-os"
transport = "local"
declaredUrl = "file:///Users/test/git/brain.git"
effectivePushUrl = "file:///Users/test/git/brain.git"

[git.lifecycle.scope]
brainPath = "${brainPath}"
contentRoot = ${JSON.stringify(scope.contentRoot)}
topicFolders = [${scope.topicFolders.map((folder) => JSON.stringify(folder)).join(", ")}]
indexesDir = ${JSON.stringify(scope.indexesDir)}
fingerprint = "${fingerprint}"

[git.lifecycle.scope.topicAliases]
${aliases}

[automation]
enabled = false
`;
}

const SPEC_SCOPE: ScopeSource = {
  contentRoot: "content",
  topicFolders: ["DEV", "PROJECTS"],
  topicAliases: { PROJEKTY: "PROJECTS" },
  indexesDir: "_indexes",
};

const gitToml = gitLifecycleTomlFor(SPEC_SCOPE);

const automationToml = `${CONFIG_HEAD}
[git]
enabled = false

[automation]
enabled = true

[automation.lifecycle]
schemaVersion = 1

[[automation.lifecycle.schedules]]
job = "brain-reindex"
schedule = { cadence = "daily", hour = 2, minute = 0 }

[[automation.lifecycle.schedules]]
job = "brain-lint"
schedule = { cadence = "daily", hour = 2, minute = 30 }

[[automation.lifecycle.schedules]]
job = "doctor"
schedule = { cadence = "weekly", day = "mon", hour = 3, minute = 0 }

[[automation.lifecycle.schedules]]
job = "git-sync"
schedule = { cadence = "hourly", minute = 15 }
`;

function loadedGitLifecycle(source: string): GitSyncConfigV1 {
  const lifecycle = loadConfig(source).git.lifecycle;
  if (lifecycle === undefined) throw new Error("fixture has no git lifecycle record");
  return lifecycle;
}

function loadedAutomationLifecycle(source: string): AutomationConfigV1 {
  const lifecycle = loadConfig(source).automation.lifecycle;
  if (lifecycle === undefined) throw new Error("fixture has no automation lifecycle record");
  return lifecycle;
}

type Transport = "local" | "https" | "ssh";

const TRANSPORTS: readonly Transport[] = ["local", "https", "ssh"];

const dnsName = (labels: readonly number[]): string =>
  labels.map((length) => "a".repeat(length)).join(".");

const ACCEPTED_URLS: readonly (readonly [Transport, string])[] = [
  ["local", "file:///Users/test/git/brain.git"],
  ["local", "file:///Users/test/git/caf%C3%A9.git"],
  ["https", "https://example.com/org/repo.git"],
  ["https", "https://example.com:8443/"],
  ["https", "https://192.0.2.1/repo"],
  ["https", `https://${dnsName([63, 63, 63, 61])}/`],
  ["https", `https://${dnsName([63])}.com/`],
  ["https", `https://example.com/${"a".repeat(4076)}`],
  ["ssh", "ssh://git@example.com/org/repo.git"],
  ["ssh", "ssh://example.com:2222/repo"],
  ["ssh", `ssh://example.com/${Array.from({ length: 32 }, () => "s").join("/")}`],
  ["ssh", "git@example.com:org/repo.git"],
  ["ssh", "example.com:/srv/repo.git"],
];

const REFUSED_URLS: readonly (readonly [Transport, string])[] = [
  ["local", "FILE:///x"],
  ["local", "file://localhost/x"],
  ["local", "file:///a%2fb"],
  ["local", "file:///a%2Fb"],
  ["local", "file:///a%5Cb"],
  ["local", "file:///a%00b"],
  ["local", "file:///a/../b"],
  ["local", "/Users/test/git/brain.git"],
  ["https", "https://Example.com/"],
  ["https", "https://example.com"],
  ["https", "https://example.com:443/"],
  ["https", "https://example.com:0/"],
  ["https", "https://example.com:08443/"],
  ["https", "https://example.com:65536/"],
  ["https", "https://user@example.com/"],
  ["https", "https://user:secret@example.com/"],
  ["https", "https://example.com/?q"],
  ["https", "https://example.com/#f"],
  ["https", "https://[::1]/"],
  ["https", "https://01.2.3.4/"],
  ["https", "https://example.com/a/./b"],
  ["https", "https://example.com/a/../b"],
  ["https", "https://example.com/%41"],
  ["https", "https://example.com/%2f"],
  ["https", "https://exa_mple.com/"],
  ["https", "https://example.com./"],
  ["https", `https://${dnsName([63, 63, 63, 62])}/`],
  ["https", `https://${dnsName([64])}.com/`],
  ["https", `https://example.com/${"a".repeat(4077)}`],
  ["https", "https://example.com/\r"],
  ["https", "https://example.com/\n"],
  ["https", "https://example.com/\t"],
  ["https", "https://example.com/\u0000"],
  ["https", ""],
  ["ssh", "ssh://-user@example.com/r"],
  ["ssh", "ssh://example.com:22/r"],
  ["ssh", "ssh://example.com/"],
  ["ssh", `ssh://example.com/${Array.from({ length: 33 }, () => "s").join("/")}`],
  ["ssh", "ssh://user:secret@example.com/r"],
  ["ssh", "git@example.com:../x"],
  ["ssh", "git@example.com:./x"],
  ["ssh", "-user@example.com:x"],
  ["ssh", "Example.com:x"],
  ["ssh", "example.com:"],
  ["ssh", "example.com:a%20b"],
];

const ACCEPTED_BRANCHES: readonly string[] = ["main", "feature/a-b", "a".repeat(255)];

const REFUSED_BRANCHES: readonly string[] = [
  "-x",
  "@",
  "a/.b",
  "a.lock",
  "a..b",
  "a@{b",
  "a~b",
  "a^b",
  "a:b",
  "a?b",
  "a*b",
  "a[b",
  "a\\b",
  "a b",
  "a.",
  "a/",
  "a//b",
  "a\u0001b",
  "a\u007fb",
  "",
  "a".repeat(256),
];

describe("the lifecycle corpora", () => {
  it("is non-empty on every axis it later enumerates", () => {
    expect(ACCEPTED_URLS.length).toBeGreaterThan(0);
    expect(REFUSED_URLS.length).toBeGreaterThan(0);
    expect(ACCEPTED_BRANCHES.length).toBeGreaterThan(0);
    expect(REFUSED_BRANCHES.length).toBeGreaterThan(0);
    expect(TRANSPORTS.length).toBe(3);
  });
});

describe("the Git scope fingerprint", () => {
  it("reproduces the fingerprint Spec 1 §2.2 prints for its canonical Git example", () => {
    const record = decodeCanonicalJson(
      encoder.encode(SPEC_GIT_EXAMPLE),
      1_048_576,
    ) as unknown as GitSyncConfigV1;
    const { fingerprint, ...scope } = record.scope;
    expect(gitScopeFingerprint(scope)).toBe(fingerprint);
  });

  it("is the domain-separated digest of exactly the five displayed scope fields", () => {
    const projection =
      '{"brainPath":"/Users/test/DeveloperBrain","contentRoot":"content","indexesDir":"_indexes","topicAliases":{"PROJEKTY":"PROJECTS"},"topicFolders":["DEV","PROJECTS"]}\n';
    const expected = createHash("sha256")
      .update("developer-os:git-scope:v1\0", "ascii")
      .update(projection, "utf8")
      .digest("hex");
    expect(gitScopeFingerprint(loadedGitLifecycle(gitToml).scope)).toBe(expected);
  });
});

describe("lifecycleConfigHash", () => {
  it("hashes the git projection Spec 1 §2.2 names, under its own domain", () => {
    const expected = createHash("sha256")
      .update("developer-os:lifecycle:git:v1\0", "ascii")
      .update(`{"enabled":true,"lifecycle":${SPEC_GIT_RECORD}}\n`, "utf8")
      .digest("hex");
    expect(lifecycleConfigHash("git", loadedGitLifecycle(gitToml))).toBe(expected);
  });

  it("hashes the automation projection under a distinct domain", () => {
    const expected = createHash("sha256")
      .update("developer-os:lifecycle:automation:v1\0", "ascii")
      .update(`{"enabled":true,"lifecycle":${SPEC_AUTOMATION_RECORD}}\n`, "utf8")
      .digest("hex");
    expect(lifecycleConfigHash("automation", loadedAutomationLifecycle(automationToml))).toBe(
      expected,
    );
  });

  it("refuses a subsystem outside the closed pair", () => {
    expect(() => lifecycleConfigHash("brain" as never, loadedGitLifecycle(gitToml))).toThrow();
  });
});

describe("a configuration that predates the lifecycle records", () => {
  it("keeps a configuration without lifecycle records byte-identical", () => {
    expect(serializeConfig(loadConfig(LEGACY_TOML))).toBe(LEGACY_TOML);
  });

  it("keeps an absent record distinguishable from a present-and-undefined one", () => {
    const config = loadConfig(LEGACY_TOML);
    expect(Object.hasOwn(config.git, "lifecycle")).toBe(false);
    expect(Object.hasOwn(config.automation, "lifecycle")).toBe(false);
    expect(serializeConfig(config)).not.toContain("lifecycle");
  });
});

describe("the strict lifecycle records at the configuration boundary", () => {
  it("loads the exact records Spec 1 §2.2 prints", () => {
    expect(encodeCanonicalJson(loadedGitLifecycle(gitToml) as never)).toBe(SPEC_GIT_EXAMPLE);
    expect(encodeCanonicalJson(loadedAutomationLifecycle(automationToml) as never)).toBe(
      SPEC_AUTOMATION_EXAMPLE,
    );
  });

  it("round-trips both records through serializeConfig", () => {
    expect(loadConfig(serializeConfig(loadConfig(gitToml)))).toStrictEqual(loadConfig(gitToml));
    expect(loadConfig(serializeConfig(loadConfig(automationToml)))).toStrictEqual(
      loadConfig(automationToml),
    );
  });

  it("loads an enabled subsystem that carries no record at all", () => {
    const enabledWithoutRecord = LEGACY_TOML.replace(
      "[git]\nenabled = false",
      "[git]\nenabled = true",
    ).replace("[automation]\nenabled = false", "[automation]\nenabled = true");
    const config = loadConfig(enabledWithoutRecord);
    expect(config.git.enabled).toBe(true);
    expect(config.git.lifecycle).toBeUndefined();
    expect(config.automation.lifecycle).toBeUndefined();
    expect(serializeConfig(config)).toBe(enabledWithoutRecord);
  });

  it.each([
    ["the record table", 'branch = "main"', 'branch = "main"\nextra = 1'],
    ["the remote table", 'transport = "local"', 'transport = "local"\nextra = 1'],
    ["the scope table", 'contentRoot = "content"', 'contentRoot = "content"\nextra = 1'],
    [
      "the alias table, as a nested table",
      '"PROJEKTY" = "PROJECTS"',
      '"PROJEKTY" = "PROJECTS"\n\n[git.lifecycle.scope.topicAliases.nested]\nkey = "value"',
    ],
  ])("refuses an unknown key at %s", (_name, from, to) => {
    expect(gitToml).toContain(from);
    expect(() => loadConfig(gitToml.replace(from, to))).toThrow();
  });

  it.each([
    ["the automation record table", "[automation.lifecycle]\nschemaVersion = 1"],
    ['the "doctor" schedule entry', 'job = "doctor"'],
  ])("refuses an unknown key at %s", (_name, from) => {
    expect(automationToml).toContain(from);
    expect(() => loadConfig(automationToml.replace(from, `${from}\nextra = 1`))).toThrow();
  });

  it("refuses an unknown key inside a normalized schedule", () => {
    expect(() =>
      loadConfig(
        automationToml.replace(
          "{ cadence = \"hourly\", minute = 15 }",
          "{ cadence = \"hourly\", minute = 15, extra = 1 }",
        ),
      ),
    ).toThrow();
  });

  it.each([
    ["a declared URL that is not the effective push URL", 'effectivePushUrl = "file:///Users/test/git/brain.git"', 'effectivePushUrl = "file:///Users/test/git/other.git"'],
    ["a remote name other than the fixed one", 'name = "developer-os"', 'name = "origin"'],
    ["a transport the URL grammar does not match", 'transport = "local"', 'transport = "https"'],
    ["an unsupported record schema version", "[git.lifecycle]\nschemaVersion = 1", "[git.lifecycle]\nschemaVersion = 2"],
    ["a branch the Git ref rules refuse", 'branch = "main"', 'branch = "a..b"'],
    ["a repository root that is not a canonical absolute path", 'repositoryRoot = "/Users/test/DeveloperBrain"', 'repositoryRoot = "Users/test"'],
    ["a fingerprint that does not recompute", "beb2e2591f459a3bc58969ec3b82171dcd3f37525e9149520a1a12851135d794", "0".repeat(64)],
    ["a fingerprint that is not lower-hex SHA-256", "beb2e2591f459a3bc58969ec3b82171dcd3f37525e9149520a1a12851135d794", "BEB2E2591F459A3BC58969EC3B82171DCD3F37525E9149520A1A12851135D794"],
  ])("refuses %s", (_name, from, to) => {
    expect(gitToml).toContain(from);
    expect(() => loadConfig(gitToml.replace(from, to))).toThrow();
  });

  it("refuses a record value TOML can express but canonical JSON cannot", () => {
    expect(() => loadConfig(gitToml.replace('branch = "main"', "branch = 2026-09-18"))).toThrow();
    expect(() =>
      loadConfig(gitToml.replace("[git.lifecycle]\nschemaVersion = 1", "[git.lifecycle]\nschemaVersion = 1.5")),
    ).toThrow();
  });

  it("refuses a record above the 1 MiB bound before the strict schema runs", () => {
    const oversized = gitToml.replace('branch = "main"', `branch = "${"x".repeat(1_100_000)}"`);
    expect(() => loadConfig(oversized)).toThrow(/1048576/);
  });

  it("refuses a stored remote URL that the configuration's own redaction patterns match", () => {
    const screened = `${gitToml}\n[redaction]\npatterns = ["brain.git"]\n`;
    expect(() => loadConfig(screened)).toThrow();
    const unmatched = `${gitToml}\n[redaction]\npatterns = ["acme-corp"]\n`;
    expect(loadConfig(unmatched).git.lifecycle).toBeDefined();
  });
});

describe("the Git scope snapshot", () => {
  it("accepts the cardinality and segment bounds Spec 1 §2.2 states", () => {
    const folders256 = Array.from({ length: 256 }, (_, index) => `T${index.toString(10)}`);
    const aliases256 = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [`A${index.toString(10)}`, "DEV"]),
    );
    expect(() =>
      loadConfig(gitLifecycleTomlFor({ ...SPEC_SCOPE, topicFolders: folders256, topicAliases: {} })),
    ).not.toThrow();
    expect(() =>
      loadConfig(
        gitLifecycleTomlFor({ ...SPEC_SCOPE, topicFolders: ["DEV"], topicAliases: aliases256 }),
      ),
    ).not.toThrow();
    expect(() =>
      loadConfig(gitLifecycleTomlFor({ ...SPEC_SCOPE, contentRoot: "a".repeat(255) })),
    ).not.toThrow();
  });

  it.each([
    [
      "257 topic folders",
      { topicFolders: Array.from({ length: 257 }, (_, index) => `T${index.toString(10)}`), topicAliases: {} },
    ],
    ["no topic folder at all", { topicFolders: [], topicAliases: {} }],
    [
      "257 topic aliases",
      {
        topicFolders: ["DEV"],
        topicAliases: Object.fromEntries(
          Array.from({ length: 257 }, (_, index) => [`A${index.toString(10)}`, "DEV"]),
        ),
      },
    ],
    ["folders that differ only by case", { topicFolders: ["DEV", "dev"], topicAliases: {} }],
    [
      "folders that differ only by Unicode form",
      { topicFolders: ["caf\u00e9", "cafe\u0301"], topicAliases: {} },
    ],
    [
      "an alias key JavaScript treats as special",
      { topicFolders: ["DEV"], topicAliases: { ["__proto__"]: "DEV" } },
    ],
    [
      "an alias target that is not a configured folder",
      { topicFolders: ["DEV"], topicAliases: { PROJEKTY: "ABSENT" } },
    ],
    [
      "an alias key that is also a configured folder",
      { topicFolders: ["DEV", "PROJECTS"], topicAliases: { PROJECTS: "DEV" } },
    ],
    ["a content root that is a path", { contentRoot: "a/b" }],
    ["a content root above 255 UTF-8 bytes", { contentRoot: "a".repeat(256) }],
    /** §2.2 types the alias key `VaultSegmentV1` too, so its bound is the value's bound. */
    [
      "an alias key above 255 UTF-8 bytes",
      { topicFolders: ["DEV"], topicAliases: { ["a".repeat(256)]: "DEV" } },
    ],
    ["an indexes directory that walks out of the vault", { indexesDir: ".." }],
    ["a brain path that is not canonical", { brainPath: "/Users/test/../test" }],
  ] as readonly (readonly [string, Partial<ScopeSource>])[])("refuses %s", (_name, overrides) => {
    expect(() => loadConfig(gitLifecycleTomlFor({ ...SPEC_SCOPE, ...overrides }))).toThrow();
  });
});

describe("the automation schedule registry", () => {
  it("names the four jobs in reconciliation order", () => {
    expect(SCHEDULED_JOB_IDS).toStrictEqual(["brain-reindex", "brain-lint", "doctor", "git-sync"]);
  });

  it("accepts the three mandatory entries without the optional fourth", () => {
    const withoutGitSync = automationToml.replace(
      '\n[[automation.lifecycle.schedules]]\njob = "git-sync"\nschedule = { cadence = "hourly", minute = 15 }\n',
      "\n",
    );
    expect(withoutGitSync).not.toContain("git-sync");
    expect(loadedAutomationLifecycle(withoutGitSync).schedules).toHaveLength(3);
  });

  it.each([
    [
      "a missing mandatory job",
      automationToml.replace(
        '\n[[automation.lifecycle.schedules]]\njob = "brain-lint"\nschedule = { cadence = "daily", hour = 2, minute = 30 }\n',
        "\n",
      ),
    ],
    [
      "the mandatory jobs out of order",
      automationToml
        .replace('job = "brain-reindex"', 'job = "PLACEHOLDER"')
        .replace('job = "brain-lint"', 'job = "brain-reindex"')
        .replace('job = "PLACEHOLDER"', 'job = "brain-lint"'),
    ],
    [
      "git-sync anywhere but fourth",
      automationToml
        .replace('job = "doctor"', 'job = "PLACEHOLDER"')
        .replace('job = "git-sync"', 'job = "doctor"')
        .replace('job = "PLACEHOLDER"', 'job = "git-sync"'),
    ],
    ["a duplicated job", automationToml.replace('job = "git-sync"', 'job = "doctor"')],
    ["an unknown job", automationToml.replace('job = "git-sync"', 'job = "brain-capture"')],
    ["a minute above the hour", automationToml.replace("minute = 15", "minute = 60")],
    ["an hour above the day", automationToml.replace("hour = 3", "hour = 24")],
    ["a capitalized weekday", automationToml.replace('day = "mon"', 'day = "Mon"')],
    ["a weekday on an hourly cadence", automationToml.replace('{ cadence = "hourly", minute = 15 }', '{ cadence = "hourly", day = "mon", minute = 15 }')],
    ["an hourly cadence carrying an hour", automationToml.replace('{ cadence = "hourly", minute = 15 }', '{ cadence = "hourly", hour = 1, minute = 15 }')],
    ["a daily cadence with no hour", automationToml.replace('{ cadence = "daily", hour = 2, minute = 0 }', '{ cadence = "daily", minute = 0 }')],
    ["an unknown cadence", automationToml.replace('cadence = "hourly"', 'cadence = "monthly"')],
    ["a fractional minute", automationToml.replace("minute = 15", "minute = 15.5")],
    ["a negative minute", automationToml.replace("minute = 15", "minute = -1")],
    ["an unsupported record schema version", automationToml.replace("[automation.lifecycle]\nschemaVersion = 1", "[automation.lifecycle]\nschemaVersion = 2")],
  ])("refuses %s", (_name, source) => {
    expect(() => loadConfig(source)).toThrow();
  });
});

describe("parseValidatedGitBranch", () => {
  it.each(ACCEPTED_BRANCHES)("accepts the Git-legal branch %s", (branch) => {
    expect(parseValidatedGitBranch(branch)).toBe(branch);
  });

  it.each(REFUSED_BRANCHES)("refuses %j", (branch) => {
    expect(() => parseValidatedGitBranch(branch)).toThrow();
  });

  it("refuses a value that is not a string", () => {
    expect(() => parseValidatedGitBranch(1)).toThrow();
  });
});

describe("parseNormalizedRemoteUrl", () => {
  it.each(ACCEPTED_URLS)("accepts the already-normalized %s %s", (transport, url) => {
    expect(parseNormalizedRemoteUrl(url, transport)).toBe(url);
  });

  it.each(REFUSED_URLS)("refuses %s %j as not normalized or not admitted", (transport, url) => {
    expect(() => parseNormalizedRemoteUrl(url, transport)).toThrow();
  });

  it.each(
    ACCEPTED_URLS.flatMap(([transport, url]) =>
      TRANSPORTS.filter((other) => other !== transport).map(
        (other) => [other, url] as readonly [Transport, string],
      ),
    ),
  )("refuses %j under the wrong transport %s", (transport, url) => {
    expect(() => parseNormalizedRemoteUrl(url, transport)).toThrow();
  });

  it("refuses a transport outside the closed set", () => {
    expect(() => parseNormalizedRemoteUrl("https://example.com/", "git" as never)).toThrow();
  });
});

describe("LifecycleActivationRecordV1", () => {
  const configHash = "a".repeat(64);
  const record: LifecycleActivationRecordV1 = {
    schemaVersion: 1,
    git: { state: "active", configHash: configHash as never },
    automation: { state: "inactive" },
  };
  const canonical = `{"automation":{"state":"inactive"},"git":{"configHash":"${configHash}","state":"active"},"schemaVersion":1}\n`;

  it("encodes to the canonical bytes and reads them back", () => {
    expect(encodeLifecycleActivationRecord(record)).toBe(canonical);
    expect(parseLifecycleActivationRecord(encoder.encode(canonical))).toStrictEqual(record);
  });

  it("reads both arms inactive", () => {
    const bothInactive = '{"automation":{"state":"inactive"},"git":{"state":"inactive"},"schemaVersion":1}\n';
    expect(parseLifecycleActivationRecord(encoder.encode(bothInactive))).toStrictEqual({
      schemaVersion: 1,
      git: { state: "inactive" },
      automation: { state: "inactive" },
    });
  });

  it.each([
    ["an inactive arm carrying a hash", `{"automation":{"state":"inactive"},"git":{"configHash":"${configHash}","state":"inactive"},"schemaVersion":1}\n`],
    ["an active arm with no hash", '{"automation":{"state":"inactive"},"git":{"state":"active"},"schemaVersion":1}\n'],
    ["an arm state outside the pair", '{"automation":{"state":"inactive"},"git":{"state":"draining"},"schemaVersion":1}\n'],
    ["an uppercase hash", `{"automation":{"state":"inactive"},"git":{"configHash":"${"A".repeat(64)}","state":"active"},"schemaVersion":1}\n`],
    ["an unknown key on an arm", '{"automation":{"state":"inactive"},"git":{"state":"inactive","extra":1},"schemaVersion":1}\n'],
    ["an unknown key on the record", '{"automation":{"state":"inactive"},"extra":1,"git":{"state":"inactive"},"schemaVersion":1}\n'],
    ["a missing arm", '{"git":{"state":"inactive"},"schemaVersion":1}\n'],
    ["an unsupported schema version", '{"automation":{"state":"inactive"},"git":{"state":"inactive"},"schemaVersion":2}\n'],
    ["a non-canonical key order", '{"schemaVersion":1,"git":{"state":"inactive"},"automation":{"state":"inactive"}}\n'],
    ["insignificant whitespace", '{"automation": {"state":"inactive"},"git":{"state":"inactive"},"schemaVersion":1}\n'],
    ["no trailing LF", '{"automation":{"state":"inactive"},"git":{"state":"inactive"},"schemaVersion":1}'],
  ])("refuses %s", (_name, text) => {
    expect(() => parseLifecycleActivationRecord(encoder.encode(text))).toThrow();
  });

  it("refuses to encode a record the reader would refuse", () => {
    expect(() =>
      encodeLifecycleActivationRecord({
        schemaVersion: 1,
        git: { state: "active" } as never,
        automation: { state: "inactive" },
      }),
    ).toThrow();
  });
});
