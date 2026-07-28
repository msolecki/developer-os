import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_CODES } from "../result.js";
import type { InstallationManifestV1, ManagedArtifactV1 } from "../manifest/index.js";
import { validateChangePlan } from "./index.js";
import type { ChangePlanContext, ChangePlanOperationV1 } from "./index.js";

const PRODUCT_VERSION = "0.0.0";
const OWNED_ROOT = "/synthetic/home/.claude";
const SECOND_OWNED_ROOT = "/synthetic/home/.developer-os";
const BRAIN_ROOT = "/synthetic/home/DeveloperBrain";
const BACKUPS_ROOT = "/synthetic/home/.developer-os/backups";

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const INSTALLED_HASH = hashOf("synthetic-installed-content");
const BEFORE_HASH = hashOf("synthetic-before-content");
const PROPOSED_HASH = hashOf("synthetic-proposed-content");

function artifact(
  overrides: Partial<ManagedArtifactV1> = {},
): ManagedArtifactV1 {
  return {
    owner: "claude",
    path: `${OWNED_ROOT}/settings.json`,
    kind: "file",
    productVersion: PRODUCT_VERSION,
    existedBefore: true,
    beforeHash: BEFORE_HASH,
    backupRelativePath: "0.bin",
    installedHash: INSTALLED_HASH,
    source: "templates/claude/settings.json",
    mergeStrategy: "semantic-json",
    verifiedAt: "2026-07-27T12:00:00.000Z",
    ...overrides,
  };
}

function manifestOf(
  artifacts: readonly ManagedArtifactV1[],
): InstallationManifestV1 {
  return {
    schemaVersion: 1,
    productVersion: PRODUCT_VERSION,
    installedAt: "2026-07-27T12:00:00.000Z",
    artifacts,
  };
}

function contextOf(
  artifacts: readonly ManagedArtifactV1[] = [artifact()],
): ChangePlanContext {
  return {
    manifest: manifestOf(artifacts),
    ownedRoots: [OWNED_ROOT, SECOND_OWNED_ROOT],
    excludedRoots: [BRAIN_ROOT, BACKUPS_ROOT],
    canonicalize: (path: string) => Promise.resolve(resolve(path)),
  };
}

/** Models `<owned>/notes` being a symlink into the Brain. */
function symlinkedContextOf(): ChangePlanContext {
  const linkPrefix = `${OWNED_ROOT}/notes`;
  return {
    ...contextOf(),
    canonicalize: (path: string) => {
      const resolved = resolve(path);
      return Promise.resolve(
        resolved === linkPrefix || resolved.startsWith(`${linkPrefix}/`)
          ? `${BRAIN_ROOT}${resolved.slice(linkPrefix.length)}`
          : resolved,
      );
    },
  };
}

function createOperation(
  overrides: Partial<ChangePlanOperationV1> = {},
): ChangePlanOperationV1 {
  return {
    targetPath: `${OWNED_ROOT}/agents/developer-os.md`,
    operation: "create",
    owner: "claude",
    kind: "file",
    expectedBeforeHash: null,
    source: "templates/claude/agent.md",
    mergeStrategy: "dedicated",
    proposedHash: PROPOSED_HASH,
    ...overrides,
  };
}

function planOf(
  operations: readonly ChangePlanOperationV1[],
): unknown {
  return {
    schemaVersion: 1,
    productVersion: PRODUCT_VERSION,
    operations,
  };
}

describe("validateChangePlan structural contract", () => {
  it("accepts a well-formed create and replace plan and returns a detached copy", async () => {
    const operations = [
      createOperation(),
      createOperation({
        targetPath: `${OWNED_ROOT}/settings.json`,
        operation: "replace",
        expectedBeforeHash: INSTALLED_HASH,
        mergeStrategy: "semantic-json",
        source: "templates/claude/settings.json",
      }),
    ];
    const plan = await validateChangePlan(planOf(operations), contextOf());

    expect(plan.schemaVersion).toBe(1);
    expect(plan.operations).toHaveLength(2);
    expect(plan.operations[0]?.operation).toBe("create");
    expect(plan.operations[1]?.operation).toBe("replace");
    expect(plan.operations).not.toBe(operations);
  });

  it.each([
    { name: "a non-object plan", plan: "plan" },
    { name: "a wrong schema version", plan: { ...(planOf([createOperation()]) as object), schemaVersion: 2 } },
    { name: "an empty operation list", plan: planOf([]) },
    { name: "an unknown top-level key", plan: { ...(planOf([createOperation()]) as object), extra: true } },
    { name: "an empty product version", plan: { ...(planOf([createOperation()]) as object), productVersion: "" } },
    { name: "an unknown operation key", plan: planOf([{ ...createOperation(), extra: true } as never]) },
    { name: "a relative target path", plan: planOf([createOperation({ targetPath: "relative/path" })]) },
    { name: "a NUL byte in the target path", plan: planOf([createOperation({ targetPath: `${OWNED_ROOT}/a\0b` })]) },
    { name: "an unknown operation kind", plan: planOf([createOperation({ operation: "chmod" as never })]) },
    { name: "an unknown owner", plan: planOf([createOperation({ owner: "vendor" as never })]) },
    { name: "an unknown merge strategy", plan: planOf([createOperation({ mergeStrategy: "overwrite" as never })]) },
    { name: "a malformed proposed hash", plan: planOf([createOperation({ proposedHash: "not-a-hash" })]) },
  ])("rejects $name as invalid input", async ({ plan }) => {
    await expect(validateChangePlan(plan, contextOf())).rejects.toThrow(
      expect.objectContaining({ code: EXIT_CODES.invalidInput }),
    );
  });

  it("refuses two operations that target the same path", async () => {
    const plan = planOf([
      createOperation(),
      createOperation({ source: "templates/claude/other.md" }),
    ]);

    await expect(validateChangePlan(plan, contextOf())).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.invalidInput,
        reason: "duplicate_target",
      }),
    );
  });
});

describe("validateChangePlan ownership refusals", () => {
  it("refuses a target outside every owned root", async () => {
    const plan = planOf([
      createOperation({ targetPath: "/synthetic/home/.ssh/authorized_keys" }),
    ]);

    await expect(validateChangePlan(plan, contextOf())).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.securityRefusal,
        reason: "outside_owned_roots",
      }),
    );
  });

  it("refuses a target that only prefix-matches an owned root", async () => {
    const plan = planOf([
      createOperation({ targetPath: `${OWNED_ROOT}-evil/settings.json` }),
    ]);

    await expect(validateChangePlan(plan, contextOf())).rejects.toThrow(
      expect.objectContaining({ reason: "outside_owned_roots" }),
    );
  });

  it("refuses a target that traverses upward out of an owned root", async () => {
    const plan = planOf([
      createOperation({ targetPath: `${OWNED_ROOT}/../.ssh/config` }),
    ]);

    await expect(validateChangePlan(plan, contextOf())).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.securityRefusal,
        reason: "outside_owned_roots",
      }),
    );
  });

  it.each([
    { name: "the Brain", target: `${BRAIN_ROOT}/DEV/note.md` },
    { name: "transaction backups", target: `${BACKUPS_ROOT}/transactions/tx-1/0.bin` },
  ])("refuses a target inside $name even when a root would allow it", async ({ target }) => {
    const plan = planOf([createOperation({ targetPath: target })]);
    const context: ChangePlanContext = {
      ...contextOf(),
      ownedRoots: [OWNED_ROOT, SECOND_OWNED_ROOT, BRAIN_ROOT],
    };

    await expect(validateChangePlan(plan, context)).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.securityRefusal,
        reason: "excluded_root",
      }),
    );
  });

  it.each(["replace", "remove"] as const)(
    "refuses to %s a path the manifest does not own",
    async (operation) => {
      const plan = planOf([
        createOperation({
          targetPath: `${OWNED_ROOT}/not-ours.json`,
          operation,
          expectedBeforeHash: INSTALLED_HASH,
          source: operation === "remove" ? "" : "templates/claude/other.json",
          ...(operation === "remove" ? { proposedHash: null } : {}),
        }),
      ]);

      await expect(validateChangePlan(plan, contextOf())).rejects.toThrow(
        expect.objectContaining({
          code: EXIT_CODES.securityRefusal,
          reason: "unmanaged_target",
        }),
      );
    },
  );

  it("refuses to create a path the manifest already owns", async () => {
    const plan = planOf([
      createOperation({ targetPath: `${OWNED_ROOT}/settings.json` }),
    ]);

    await expect(validateChangePlan(plan, contextOf())).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.securityRefusal,
        reason: "already_owned",
      }),
    );
  });

  it("refuses an operation whose owner differs from the recorded owner", async () => {
    const plan = planOf([
      createOperation({
        targetPath: `${OWNED_ROOT}/settings.json`,
        operation: "replace",
        owner: "codex",
        expectedBeforeHash: INSTALLED_HASH,
      }),
    ]);

    await expect(validateChangePlan(plan, contextOf())).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.securityRefusal,
        reason: "ownership_mismatch",
      }),
    );
  });
});

describe("validateChangePlan forged-manifest defense", () => {
  it.each([
    { name: "a system path", forgedPath: "/etc/hosts" },
    { name: "the Brain", forgedPath: `${BRAIN_ROOT}/DEV/note.md` },
    { name: "transaction backups", forgedPath: `${BACKUPS_ROOT}/transactions/tx-1/0.bin` },
  ])("grants no ownership over $name by listing it in the manifest", async ({ forgedPath }) => {
    const forged = artifact({ path: forgedPath });
    const plan = planOf([
      createOperation({
        targetPath: forgedPath,
        operation: "replace",
        mergeStrategy: "semantic-json",
        expectedBeforeHash: INSTALLED_HASH,
      }),
    ]);

    await expect(validateChangePlan(plan, contextOf([forged]))).rejects.toThrow(
      expect.objectContaining({ code: EXIT_CODES.securityRefusal }),
    );
  });

  it("grants no ownership over an in-root path by listing a different path in the manifest", async () => {
    const forged = artifact({ path: "/etc/hosts" });
    const plan = planOf([
      createOperation({
        targetPath: `${OWNED_ROOT}/unclaimed.json`,
        operation: "replace",
        mergeStrategy: "semantic-json",
        expectedBeforeHash: INSTALLED_HASH,
      }),
    ]);

    await expect(validateChangePlan(plan, contextOf([forged]))).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.securityRefusal,
        reason: "unmanaged_target",
      }),
    );
  });

  it("refuses a case-varied path that would evade an excluded root on a case-insensitive volume", async () => {
    const plan = planOf([
      createOperation({
        targetPath: `${SECOND_OWNED_ROOT}/BACKUPS/transactions/tx-1/0.bin`,
      }),
    ]);

    await expect(validateChangePlan(plan, contextOf())).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.securityRefusal,
        reason: "excluded_root",
      }),
    );
  });

  it.each([
    { name: "no excluded roots", patch: { excludedRoots: [] } },
    { name: "the filesystem root as an owned root", patch: { ownedRoots: ["/"] } },
  ])("refuses a context declaring $name", async ({ patch }) => {
    const context: ChangePlanContext = { ...contextOf(), ...patch };

    await expect(
      validateChangePlan(planOf([createOperation()]), context),
    ).rejects.toThrow(
      expect.objectContaining({ code: EXIT_CODES.invalidInput }),
    );
  });

  it.each([
    { name: "the filesystem root", canonicalRoot: "/" },
    { name: "the home directory", canonicalRoot: "/synthetic/home" },
  ])("refuses a plan whose owned root canonicalizes to $name", async ({ canonicalRoot }) => {
    // Exactly one owned root, so the refusal cannot come from the nested-root
    // rule; it must come from canonicalization having widened authority.
    const context: ChangePlanContext = {
      ...contextOf(),
      ownedRoots: [OWNED_ROOT],
      canonicalize: (path: string) => {
        const resolved = resolve(path);
        return Promise.resolve(
          resolved === OWNED_ROOT ? canonicalRoot : resolved,
        );
      },
    };
    const plan = planOf([
      createOperation({ targetPath: "/synthetic/home/.unrelated/data.bin" }),
    ]);

    await expect(validateChangePlan(plan, context)).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.securityRefusal,
        reason: "outside_owned_roots",
      }),
    );
  });

  it("reports two manifest artifacts that canonicalize to one path as corruption", async () => {
    const context: ChangePlanContext = {
      ...contextOf([
        artifact({ path: `${OWNED_ROOT}/a.json` }),
        artifact({ path: `${OWNED_ROOT}/link/a.json` }),
      ]),
      canonicalize: (path: string) =>
        Promise.resolve(resolve(path).replace("/link/", "/")),
    };

    await expect(
      validateChangePlan(planOf([createOperation()]), context),
    ).rejects.toThrow(
      expect.objectContaining({ code: EXIT_CODES.recoveryRequired }),
    );
  });

  it("still allows an owned root relocated sideways by a symlink", async () => {
    const relocated = "/synthetic/home/Dropbox/claude";
    const context: ChangePlanContext = {
      ...contextOf([]),
      ownedRoots: [OWNED_ROOT],
      canonicalize: (path: string) => {
        const resolved = resolve(path);
        return Promise.resolve(
          resolved === OWNED_ROOT
            ? relocated
            : resolved.startsWith(`${OWNED_ROOT}/`)
              ? `${relocated}${resolved.slice(OWNED_ROOT.length)}`
              : resolved,
        );
      },
    };

    const plan = await validateChangePlan(planOf([createOperation()]), context);

    expect(plan.operations[0]?.canonicalTargetPath).toBe(
      `${relocated}/agents/developer-os.md`,
    );
  });

  it("returns the canonical path that ownership was actually decided on", async () => {
    const context: ChangePlanContext = {
      ...contextOf(),
      canonicalize: (path: string) =>
        Promise.resolve(resolve(path).replace("/agents/", "/real-agents/")),
    };
    const plan = await validateChangePlan(planOf([createOperation()]), context);

    expect(plan.operations[0]?.canonicalTargetPath).toBe(
      `${OWNED_ROOT}/real-agents/developer-os.md`,
    );
  });

  it("refuses a symlink inside an owned root that resolves into the Brain", async () => {
    const plan = planOf([
      createOperation({ targetPath: `${OWNED_ROOT}/notes/DEV/note.md` }),
    ]);

    await expect(validateChangePlan(plan, symlinkedContextOf())).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.securityRefusal,
        reason: "outside_owned_roots",
      }),
    );
  });

  it.each([
    { name: "a case-varied", targetPath: `${OWNED_ROOT}/Settings.json` },
    { name: "an NFD-encoded", targetPath: `${OWNED_ROOT}/settings.json`.normalize("NFD") },
  ])("refuses $name create over a path the manifest already owns", async ({ targetPath }) => {
    await expect(
      validateChangePlan(planOf([createOperation({ targetPath })]), contextOf()),
    ).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.securityRefusal,
        reason: "already_owned",
      }),
    );
  });

  it("refuses a config-entry operation as invalid input rather than as corruption", async () => {
    await expect(
      validateChangePlan(
        planOf([createOperation({ kind: "config-entry" })]),
        contextOf(),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: EXIT_CODES.invalidInput }));
  });

  it("refuses a replace that declares a different artifact kind than the manifest records", async () => {
    const plan = planOf([
      createOperation({
        targetPath: `${OWNED_ROOT}/settings.json`,
        operation: "replace",
        kind: "directory",
        mergeStrategy: "semantic-json",
        expectedBeforeHash: INSTALLED_HASH,
      }),
    ]);

    await expect(validateChangePlan(plan, contextOf())).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.securityRefusal,
        reason: "ownership_mismatch",
      }),
    );
  });

  it("refuses a replace whose expected hash does not match the recorded install", async () => {
    const plan = planOf([
      createOperation({
        targetPath: `${OWNED_ROOT}/settings.json`,
        operation: "replace",
        mergeStrategy: "semantic-json",
        expectedBeforeHash: hashOf("stale-expectation"),
      }),
    ]);

    await expect(validateChangePlan(plan, contextOf())).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.securityRefusal,
        reason: "hash_expectation",
      }),
    );
  });

  it("refuses a create that declares a prior hash", async () => {
    const plan = planOf([
      createOperation({ expectedBeforeHash: INSTALLED_HASH }),
    ]);

    await expect(validateChangePlan(plan, contextOf())).rejects.toThrow(
      expect.objectContaining({
        code: EXIT_CODES.invalidInput,
        reason: "hash_expectation",
      }),
    );
  });

  it("refuses a remove that stages a source or proposes a hash", async () => {
    const base = {
      targetPath: `${OWNED_ROOT}/settings.json`,
      operation: "remove" as const,
      expectedBeforeHash: INSTALLED_HASH,
      mergeStrategy: "semantic-json" as const,
    };

    await expect(
      validateChangePlan(
        planOf([createOperation({ ...base, source: "templates/x.json", proposedHash: null })]),
        contextOf(),
      ),
    ).rejects.toThrow(
      expect.objectContaining({ code: EXIT_CODES.invalidInput }),
    );

    await expect(
      validateChangePlan(
        planOf([createOperation({ ...base, source: "", proposedHash: PROPOSED_HASH })]),
        contextOf(),
      ),
    ).rejects.toThrow(
      expect.objectContaining({ code: EXIT_CODES.invalidInput }),
    );
  });

  it("carries no target path or hash in the refusal message", async () => {
    const plan = planOf([
      createOperation({ targetPath: "/synthetic/home/.ssh/authorized_keys" }),
    ]);
    const error: unknown = await validateChangePlan(plan, contextOf()).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("authorized_keys");
    expect(String(error)).not.toContain(INSTALLED_HASH);
  });
});
