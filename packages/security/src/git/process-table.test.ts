import { hashCanonicalJson, type CanonicalJsonValue } from "@developer-os/core";
import { describe, expect, it } from "vitest";

import { SecurityRefusalError } from "../paths.js";
import { GIT_DISTRIBUTION_POLICY } from "./distribution.js";
import { mutatedProcessRows } from "./distribution.test-fixtures.js";
import {
  expandGitArgv,
  GIT_DISTRIBUTION_POLICY_ID,
  GIT_PACK_OBJECT_COUNT_MAX,
  hashGitProcessTable,
  parseGitAlternateObjectDirectory,
  parseGitConfigQuotedPath,
  validateSupportedGitProcessTable,
  type GitArgSlotValuesV1,
} from "./process-table.js";
import {
  CLOSED_GIT_ENVIRONMENT_NAMES,
  CLOSED_GIT_PROCESS_EDGE_IDS,
  CLOSED_GIT_PROCESS_NODE_IDS,
  GIT_ENVIRONMENT_PROFILE_IDS,
  GIT_PROCESS_IO_PROFILE_IDS,
  GIT_PROCESS_PHASE_BUDGET_IDS,
  type GitArgvGrammarV1,
  type GitProcessEdgeV1,
} from "./types.js";

const table = GIT_DISTRIBUTION_POLICY.processTable;

function edge(id: string): GitProcessEdgeV1 {
  const found = table.edges.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing edge ${id}`);
  return found;
}

function grammar(id: string, index = 0): GitArgvGrammarV1 {
  const found = edge(id).argvAlternatives[index];
  if (found === undefined) throw new Error(`missing argv ${id}[${String(index)}]`);
  return found;
}

function expectSortedUnique(values: readonly string[]): void {
  expect(values.length).toBeGreaterThan(0);
  expect(new Set(values).size).toBe(values.length);
  expect([...values].sort()).toEqual(values);
}

const KEEP = "receive-pack 4242 on build-host.local";
const TOKEN = "a".repeat(64);
const OID = "b".repeat(40);

describe("the closed Git process table", () => {
  it("validates and hashes the compiled table under its own domain", () => {
    expect(validateSupportedGitProcessTable(structuredClone(table))).toEqual(table);
    expect(hashGitProcessTable(table)).toBe(
      hashCanonicalJson("developer-os:git-process-table:v1", table as unknown as CanonicalJsonValue),
    );
    expect(hashGitProcessTable(table)).not.toBe(hashCanonicalJson("developer-os:git-push-plan:v1", table as unknown as CanonicalJsonValue));
  });

  it("pins the twelve environment maps, seven I/O profiles, four budgets, 21 nodes and 21 edges in id order", () => {
    const sets = [
      [table.environmentProfiles.map((profile) => profile.id), GIT_ENVIRONMENT_PROFILE_IDS, 12],
      [table.ioProfiles.map((profile) => profile.id), GIT_PROCESS_IO_PROFILE_IDS, 7],
      [table.phaseBudgets.map((budget) => budget.id), GIT_PROCESS_PHASE_BUDGET_IDS, 4],
      [table.nodes.map((node) => node.id), CLOSED_GIT_PROCESS_NODE_IDS, 21],
      [table.edges.map((candidate) => candidate.id), CLOSED_GIT_PROCESS_EDGE_IDS, 21],
    ] as const;
    for (const [ids, closed, count] of sets) {
      expectSortedUnique(ids);
      expect(ids).toEqual([...closed]);
      expect(ids).toHaveLength(count);
    }
  });

  it("pins the four inherited phase budgets", () => {
    expect(Object.fromEntries(table.phaseBudgets.map((budget) => [budget.id, budget.wallDeadlineMs]))).toEqual({
      distribution_probe: 30000,
      config_candidate: 30000,
      source_build: 1800000,
      push: 600000,
    });
  });

  it("pins the seven I/O profiles", () => {
    const rows = Object.fromEntries(
      table.ioProfiles.map((profile) => [
        profile.id,
        [profile.stdinMaxBytes, profile.stdoutMaxBytes, profile.stderrMaxBytes, profile.wallDeadlineMs, profile.idleDeadlineMs],
      ]),
    );
    expect(rows).toEqual({
      metadata: [0, 4194304, 4194304, 30000, 30000],
      source_build: [16777216, 4194304, 4194304, 30000, 30000],
      root_push: [0, 4194304, 4194304, 600000, 120000],
      pack_stream: [16777216, 2147483648, 4194304, 600000, 120000],
      transport_stream: [2147483648, 2147483648, 4194304, 600000, 120000],
      receive_stream: [2147483648, 4194304, 4194304, 600000, 120000],
      index_stream: [2147483648, 4194304, 4194304, 600000, 120000],
    });
  });

  it("uses exactly the closed environment names, each profile sorted and without inherited keys", () => {
    const names = new Set<string>();
    for (const profile of table.environmentProfiles) {
      const entryNames = profile.entries.map((entry) => entry.name);
      expectSortedUnique(entryNames);
      for (const name of entryNames) names.add(name);
    }
    expect([...names].sort()).toEqual([...CLOSED_GIT_ENVIRONMENT_NAMES]);
    for (const forbidden of ["GIT_ASKPASS", "SSH_ASKPASS", "GIT_EDITOR", "VISUAL", "EDITOR", "GIT_PAGER", "PAGER"]) {
      expect(names.has(forbidden)).toBe(false);
    }
  });

  it("binds every supervised profile to this distribution and its phase", () => {
    const literal = (profileId: string, name: string): string | undefined => {
      const value = table.environmentProfiles.find((profile) => profile.id === profileId)?.entries.find((entry) => entry.name === name)?.value;
      return value?.kind === "literal" ? value.value : undefined;
    };
    const phases = {
      distribution_probe: "distribution_probe",
      config_candidate: "config_candidate",
      source_build: "source_build",
      push_https: "push_transport",
      https_helper: "push_transport",
      push_ssh: "push_transport",
      ssh_bridge: "push_transport",
      push_local: "push_transport",
      local_helper: "push_transport",
      destination_receive: "destination_receive",
    };
    for (const [profileId, phase] of Object.entries(phases)) {
      expect(literal(profileId, "DEVELOPER_OS_GIT_DISTRIBUTION")).toBe(GIT_DISTRIBUTION_POLICY_ID);
      expect(literal(profileId, "DEVELOPER_OS_GIT_PHASE")).toBe(phase);
    }
    expect(literal("push_ssh", "GIT_SSH_VARIANT")).toBe("ssh");
  });

  it("gives only the coordinator an empty profile list and pins the multi-profile nodes", () => {
    const profiles = Object.fromEntries(table.nodes.map((node) => [node.id, node.environmentProfiles]));
    for (const node of table.nodes) expect(node.environmentProfiles.length === 0).toBe(node.id === "coordinator");
    expect(profiles.source_build_git).toEqual(["config_candidate", "source_build"]);
    expect(profiles.source_push_git).toEqual(["push_https", "push_local", "push_ssh"]);
    expect(profiles.gateway_pack_git).toEqual(["push_https", "push_local", "push_ssh"]);
    expect(profiles.real_pack_git).toEqual(["push_https", "push_local", "push_ssh"]);
    expect(profiles.real_system_ssh).toEqual(["system_ssh_agent", "system_ssh_no_agent"]);
  });

  it("orders every child edge after exactly one parent that ends at its source node", () => {
    for (const candidate of table.edges) {
      if (candidate.from === "coordinator") continue;
      expect(candidate.orderAfter.filter((id) => edge(id).to === candidate.from)).toHaveLength(1);
    }
    expect(edge("direct_source_push").orderAfter).toEqual(["direct_distribution_probe", "direct_source_build"]);
  });

  it("expands two to 200,001 source-build permits and exactly one of everything else", () => {
    expect([edge("direct_source_build").minUses, edge("direct_source_build").maxUses]).toEqual([2, GIT_PACK_OBJECT_COUNT_MAX]);
    for (const candidate of table.edges.filter((item) => item.id !== "direct_source_build")) {
      expect([candidate.minUses, candidate.maxUses]).toEqual([1, 1]);
    }
  });

  it.each(mutatedProcessRows)("refuses $name before process authority", ({ value }) => {
    expect(() => validateSupportedGitProcessTable(value)).toThrow();
  });

  it("has a non-empty mutation corpus", () => {
    expect(mutatedProcessRows.length).toBeGreaterThan(0);
  });
});

describe("argv grammar expansion", () => {
  it("expands literal tokens verbatim", () => {
    expect(expandGitArgv(grammar("direct_distribution_probe"), {})).toEqual(["git", "--version", "--build-options"]);
  });

  it("expands semantic slots into their own argv element", () => {
    expect(expandGitArgv(grammar("direct_source_build", 3), { candidate_tree_oid: OID, parent_commit_oid: "c".repeat(40) })).toEqual([
      "git",
      "commit-tree",
      OID,
      "-p",
      "c".repeat(40),
    ]);
    expect(expandGitArgv(grammar("exec_local_dispatch_git"), { opaque_local_token: TOKEN })).toEqual([
      "git",
      "remote-developer-os-local",
      "developer-os",
      TOKEN,
    ]);
  });

  it("expands joined tokens without a separator", () => {
    expect(expandGitArgv(grammar("exec_index_git"), { pack_object_count: "0", receive_keep_marker: KEEP })).toEqual([
      "git",
      "index-pack",
      "--stdin",
      "--pack_header=2,0",
      `--keep=${KEEP}`,
      "--report-end-of-input",
      "--fix-thin",
    ]);
  });

  it.each(["0", "1", "200000", String(GIT_PACK_OBJECT_COUNT_MAX)])("admits pack object count %s", (count) => {
    expect(expandGitArgv(grammar("exec_index_git"), { pack_object_count: count, receive_keep_marker: KEEP })[3]).toBe(
      `--pack_header=2,${count}`,
    );
  });

  it.each(["200002", "-1", "01", "1e3", " 1", "1.0", ""])("refuses pack object count %j", (count) => {
    expect(() => expandGitArgv(grammar("exec_index_git"), { pack_object_count: count, receive_keep_marker: KEEP })).toThrow(
      SecurityRefusalError,
    );
  });

  it.each<[string, GitArgSlotValuesV1]>([
    ["a missing slot", {}],
    ["an option-shaped SSH target", { ssh_target: "-oProxyCommand=sh", ssh_receive_pack_command: "git-receive-pack 'brain.git'" }],
    ["a quoted SSH repository path", { ssh_target: "git@example.com", ssh_receive_pack_command: "git-receive-pack 'a'b'" }],
    ["a traversing SSH repository path", { ssh_target: "git@example.com", ssh_receive_pack_command: "git-receive-pack '../x'" }],
    ["a tilde SSH repository path", { ssh_target: "git@example.com", ssh_receive_pack_command: "git-receive-pack '~/x'" }],
  ])("refuses %s", (_name, values) => {
    expect(() => expandGitArgv(grammar("enter_ssh_bridge"), values)).toThrow(SecurityRefusalError);
  });

  it("admits the one normalized SSH destination", () => {
    expect(
      expandGitArgv(grammar("exec_system_ssh", 1), {
        ssh_port: "2222",
        ssh_target: "git@example.com",
        ssh_receive_pack_command: "git-receive-pack 'team/brain.git'",
      }).slice(-4),
    ).toEqual(["-p", "2222", "git@example.com", "git-receive-pack 'team/brain.git'"]);
  });

  it.each(["0", "65536", "022"])("refuses SSH port %s", (port) => {
    expect(() =>
      expandGitArgv(grammar("exec_system_ssh", 1), {
        ssh_port: port,
        ssh_target: "git@example.com",
        ssh_receive_pack_command: "git-receive-pack 'brain.git'",
      }),
    ).toThrow(SecurityRefusalError);
  });

  it.each(["http://example.com/brain.git", "https://user:secret@example.com/brain.git", "--upload-pack=sh"])(
    "refuses HTTPS URL %s",
    (url) => {
      expect(() => expandGitArgv(grammar("exec_https_helper"), { validated_https_url: url })).toThrow(SecurityRefusalError);
    },
  );

  it.each(["A".repeat(64), "a".repeat(63), "g".repeat(64)])("refuses local token %s", (token) => {
    expect(() => expandGitArgv(grammar("enter_local_helper"), { opaque_local_token: token })).toThrow(SecurityRefusalError);
  });

  it.each([`${OID}:refs/heads/main`, `${OID}:refs/heads/feature/x`])("admits refspec %s", (refspec) => {
    expect(expandGitArgv(grammar("direct_source_push"), { commit_to_branch_refspec: refspec }).at(-1)).toBe(refspec);
  });

  it.each([`+${OID}:refs/heads/main`, `${OID}:refs/tags/v1`, `${OID.toUpperCase()}:refs/heads/main`, `:refs/heads/main`])(
    "refuses refspec %s",
    (refspec) => {
      expect(() => expandGitArgv(grammar("direct_source_push"), { commit_to_branch_refspec: refspec })).toThrow(SecurityRefusalError);
    },
  );

  it.each(["receive-pack 0 on host", "receive-pack 12 on -host", "receive-pack 12 on host name", "receive-pack 12 at host"])(
    "refuses keep marker %j",
    (marker) => {
      expect(() => expandGitArgv(grammar("exec_index_git"), { pack_object_count: "1", receive_keep_marker: marker })).toThrow(
        SecurityRefusalError,
      );
    },
  );

  it("refuses a grammar that is not closed", () => {
    expect(() => expandGitArgv({ argv: [{ kind: "literal", value: "*" }] }, {})).toThrow();
    expect(() => expandGitArgv({ argv: [] }, {})).toThrow();
  });
});

describe("Git path scalar types", () => {
  it("admits spaces, non-ASCII, quote and ampersand in a config-quoted path", () => {
    expect(parseGitConfigQuotedPath('/tmp/Zoë Test/My "Brain" & <notes>')).toBe('/tmp/Zoë Test/My "Brain" & <notes>');
  });

  it.each(["/tmp/a\nb", "/tmp/a\rb", "/tmp/a\u0085b", "/tmp/a b", "/tmp/a\u0001b", "relative/path"])(
    "refuses config-quoted path %j",
    (path) => {
      expect(() => parseGitConfigQuotedPath(path)).toThrow();
    },
  );

  it("admits a plain alternate object directory", () => {
    expect(parseGitAlternateObjectDirectory("/tmp/developer-os-test/vault/.git/objects")).toBe("/tmp/developer-os-test/vault/.git/objects");
  });

  it.each(["/tmp/a:b", '/tmp/"a', "/tmp/a\\b", "/tmp/a\nb", "/tmp/a\u009fb", '"/tmp/a"'])(
    "refuses alternate object directory %j",
    (path) => {
      expect(() => parseGitAlternateObjectDirectory(path)).toThrow();
    },
  );
});
