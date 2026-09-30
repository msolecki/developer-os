import { describe, expect, it } from "vitest";
import * as door from "./index.js";

/**
 * Not an inventory — a door test. This package holds the guards two
 * adapters cross the vendor-CLI boundary through — `screenValueArgument`,
 * `parseStructuredPayload`, `discoverCli` among them — and a package with a
 * guarantee must not export the raw mechanism behind it alongside the guard:
 * two import paths for one rule is how a caller ends up depending on the
 * wrong one. The only way that stays true over time is a test that fails the
 * moment the surface widens, rather than one a reviewer has to remember to
 * compare by hand.
 *
 * Modelled on `packages/adapter-codex/src/index.test.ts`, which both adapters
 * already carry; `core`, `security` and `workflow-schema` — the three
 * packages both adapters now enter through — had no equivalent.
 */
describe("the package's public door", () => {
  it("exports exactly this list, and nothing else", () => {
    expect(Object.keys(door).sort()).toEqual(
      [
        "assertDisjointPaths",
        "canonicalizePlannedPath",
        "resolveOwnedPath",
        "SecurityRefusalError",
        "ProtectedPathPolicy",
        "PROTECTED_PATH_RULES",
        "redactText",
        "createRedactor",
        "REDACTION_CLASSES",
        "assertSafeCommand",
        "NodeProcessRunner",
        "normalizeShellCommand",
        "discoverCli",
        "parseStructuredPayload",
        "screenDerivedPathArgument",
        "screenProseArgument",
        "screenValueArgument",
        "capGraphemes",
        "screenAndCap",
        "screenControlCharacters",
        "isVisuallyBlank",
        "perceptualKey",
        "boundedProse",
        "fenced",
        "screenParagraphs",
        "FixedReleaseTransport",
        "nodeReleaseExchange",
        "ReleaseTransportError",
        "readOfflineReleaseTrustFd",
        "renderOfflineReleaseTrustPipe",
        "verifyReleaseMetadataChain",
        "verifySignedReleaseDocument",
        "SupervisedProcessRunner",
        "nodeSupervisedProcessDependencies",
        "admitGitCapability",
        "admitGitExecutables",
        "expandGitArgv",
        "GIT_DISTRIBUTION_POLICY",
        "GIT_DISTRIBUTION_POLICY_ID",
        "hashGitProcessTable",
        "parseGitAlternateObjectDirectory",
        "parseGitConfigQuotedPath",
        "parseGitVersionLine",
        "validateSupportedGitProcessTable",
        "PERSISTED_GIT_PUSH_PLAN_CODEC",
        "validateGitSyncPlan",
        "GuardedSha1PackReader",
        "materializeSanitizedBareDestinationShadow",
        "prepareLocalReceive",
        "validateShadowConfigTemplate",
        "GitProcessSupervisor",
        "ReleasePlanningScratchAttempt",
        "ReleasePlanningScratchStore",
        "TargetPlannerSupervisor",
        "ZstdUstarAdmission",
        "admittingGitIdentityProbe",
        "inspectPlannerGraph",
        "sampleNodePlannerProcess",
        "spawnNodePlannerChild",
        "createOpaqueGitLocalToken",
        "hashShadowConfigTemplate",
        "materializeGitExecGateway",
        "materializeSanitizedGitShadow",
        "runGitGateway",
        "SanitizedLocalRemoteHelper",
        "sanitizedGitEnvironment",
        "TargetVerifierSupervisor",
        "admitPosixRootOwned",
        "recheckSystemExecutable",
        "recheckSystemExecutableSync",
        "SystemExecutableRefusalError",
      ].sort(),
    );
  });
});
