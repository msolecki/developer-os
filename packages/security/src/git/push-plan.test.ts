import { describe, expect, it } from "vitest";

import { hashCanonicalJson, type CanonicalJsonValue } from "@developer-os/core";

import { hashGitProcessTable, SUPPORTED_GIT_DISTRIBUTION_ID, SUPPORTED_GIT_PROCESS_TABLE } from "./process-table.js";
import { PERSISTED_GIT_PUSH_PLAN_CODEC } from "./push-plan.js";

const COMMIT = "c".repeat(40);
const PARENT = "d".repeat(40);
const hex = (character: string): string => character.repeat(64);

const sourceBefore = {
  configHash: hex("1"),
  index: { state: "present", bytesHash: hex("2") },
  head: { state: "present", bytesHash: hex("3"), semantic: { kind: "symbolic_ref", value: "refs/heads/main" } },
  headReflog: { state: "present", bytesHash: hex("4"), size: 120 },
  branchReflog: { state: "present", bytesHash: hex("5"), size: 120 },
  branchRef: { state: "present", oid: PARENT, bytesHash: hex("6") },
};
const sourceAfter = {
  ...sourceBefore,
  index: { state: "present", bytesHash: hex("7") },
  headReflog: { state: "present", bytesHash: hex("8"), size: 240 },
  branchReflog: { state: "present", bytesHash: hex("9"), size: 240 },
  branchRef: { state: "present", oid: COMMIT, bytesHash: hex("a") },
};

const httpsPlan = {
  schemaVersion: 1,
  repositoryRoot: "/tmp/developer-os-test/brain",
  branchRef: "refs/heads/main",
  commitOid: COMMIT,
  remoteName: "developer-os",
  sourceShadowConfigTemplateHash: hex("b"),
  destination: { transport: "https", effectivePushUrl: "https://example.invalid/synthetic/brain.git" },
  sourceBefore,
  sourceAfter,
  distributionId: SUPPORTED_GIT_DISTRIBUTION_ID,
  processTableHash: hashGitProcessTable(SUPPORTED_GIT_PROCESS_TABLE),
};

const pushPlanFixture = {
  ...httpsPlan,
  destination: {
    transport: "local",
    effectivePushUrl: "file:///tmp/developer-os-test/remote.git",
    repositoryRoot: "/tmp/developer-os-test/remote.git",
    configHash: hex("c"),
    head: { state: "present", bytesHash: hex("d"), semantic: { kind: "symbolic_ref", value: "refs/heads/main" } },
    targetRef: { state: "absent" },
    targetReflog: { state: "absent" },
    destinationShadowConfigTemplateHash: hex("e"),
    destinationGitEffect: { id: `ge_${hex("f")}_7`, planHash: hex("0") },
  },
};

describe("PersistedGitPushPlanV1", () => {
  it("strictly round-trips PersistedGitPushPlanV1 and refuses an unknown key", () => {
    expect(PERSISTED_GIT_PUSH_PLAN_CODEC.validate(pushPlanFixture)).toEqual(pushPlanFixture);
    expect(() => PERSISTED_GIT_PUSH_PLAN_CODEC.validate({ ...pushPlanFixture, extra: 1 })).toThrow();
  });

  it("round-trips the HTTPS arm through its canonical encoding", () => {
    const plan = PERSISTED_GIT_PUSH_PLAN_CODEC.validate(httpsPlan);
    expect(PERSISTED_GIT_PUSH_PLAN_CODEC.validate(JSON.parse(PERSISTED_GIT_PUSH_PLAN_CODEC.encode(plan)))).toEqual(httpsPlan);
  });

  it("hashes over the domain-separated canonical bytes", () => {
    const plan = PERSISTED_GIT_PUSH_PLAN_CODEC.validate(pushPlanFixture);
    expect(PERSISTED_GIT_PUSH_PLAN_CODEC.hash(plan)).toBe(
      hashCanonicalJson("developer-os:git-push-plan:v1", pushPlanFixture as unknown as CanonicalJsonValue),
    );
    expect(PERSISTED_GIT_PUSH_PLAN_CODEC.hash(plan)).not.toBe(PERSISTED_GIT_PUSH_PLAN_CODEC.hash(PERSISTED_GIT_PUSH_PLAN_CODEC.validate(httpsPlan)));
  });

  const refused: readonly { readonly name: string; readonly value: unknown }[] = [
    { name: "an unknown destination key", value: { ...httpsPlan, destination: { ...httpsPlan.destination, pushurl: "x" } } },
    { name: "HTTPS carrying a local-only field", value: { ...httpsPlan, destination: { ...pushPlanFixture.destination, transport: "https" } } },
    { name: "an http:// destination", value: { ...httpsPlan, destination: { transport: "https", effectivePushUrl: "http://example.invalid/a.git" } } },
    { name: "a remote-helper transport", value: { ...httpsPlan, destination: { transport: "ext", effectivePushUrl: "ext::sh" } } },
    { name: "another remote name", value: { ...httpsPlan, remoteName: "origin" } },
    { name: "another distribution", value: { ...httpsPlan, distributionId: "apple-git-155-arm64-xcode-26.6-17F113" } },
    { name: "a non-hex process-table hash", value: { ...httpsPlan, processTableHash: "Z".repeat(64) } },
    { name: "a sourceAfter branch not at commitOid", value: { ...httpsPlan, sourceAfter: { ...sourceAfter, branchRef: sourceBefore.branchRef } } },
    {
      name: "a sourceAfter HEAD on another branch",
      value: {
        ...httpsPlan,
        sourceAfter: { ...sourceAfter, head: { ...sourceAfter.head, semantic: { kind: "symbolic_ref", value: "refs/heads/other" } } },
      },
    },
    { name: "an unallocated destination effect id", value: { ...pushPlanFixture, destination: { ...pushPlanFixture.destination, destinationGitEffect: { id: "le_x_1", planHash: hex("0") } } } },
    { name: "a destination that is the source repository", value: { ...pushPlanFixture, destination: { ...pushPlanFixture.destination, repositoryRoot: httpsPlan.repositoryRoot } } },
    { name: "a schema version 2", value: { ...httpsPlan, schemaVersion: 2 } },
    { name: "a credential-shaped extra field", value: { ...httpsPlan, credential: "token" } },
  ];

  it.each(refused)("refuses $name", ({ value }) => {
    expect(refused.length).toBeGreaterThan(0);
    expect(() => PERSISTED_GIT_PUSH_PLAN_CODEC.validate(value)).toThrow();
  });

  it("carries no temporary path, token, capability or author identity", () => {
    const encoded = PERSISTED_GIT_PUSH_PLAN_CODEC.encode(PERSISTED_GIT_PUSH_PLAN_CODEC.validate(pushPlanFixture));
    for (const forbidden of ["developer-os-local::", "capability", "author", "hooks", "deadline"]) {
      expect(encoded).not.toContain(forbidden);
    }
  });
});
