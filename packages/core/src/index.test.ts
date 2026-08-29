import { describe, expect, it } from "vitest";
import * as door from "./index.js";

/**
 * Not an inventory — a door test. This package holds guarantees a guard
 * function enforces (`validateChangePlan`, `validateManifest`, `tablePermits`
 * and the rest), and a package with a guarantee must not export the raw
 * mechanism behind it alongside the guard: two import paths for one rule is
 * how a caller ends up depending on the wrong one. The only way that stays
 * true over time is a test that fails the moment the surface widens, rather
 * than one a reviewer has to remember to compare by hand.
 *
 * Modelled on `packages/adapter-codex/src/index.test.ts`, which both adapters
 * already carry; `core`, `security` and `workflow-schema` — the three
 * packages both adapters now enter through — had no equivalent.
 */
describe("the package's public door", () => {
  it("exports exactly this list, and nothing else", () => {
    expect(Object.keys(door).sort()).toEqual(
      [
        "parseAgentPromptArgs",
        "parseCanonicalStatePayloadRole",
        "CAPABILITY_STATES",
        "PROBE_OBSERVATIONS",
        "EXIT_CODES",
        "failure",
        "formatJsonResult",
        "success",
        "loadConfig",
        "pathSegmentViolation",
        "resolveRuntimePaths",
        "serializeConfig",
        "buildConflictEvidence",
        "BootstrapStateError",
        "bootstrapExternalShapeHash",
        "bootstrapPayloadSourceIdentityHash",
        "containsPath",
        "containsPathLoosely",
        "foldPath",
        "detectDrift",
        "deriveBootstrapCreationEvidencePaths",
        "deriveBootstrapEnvelopePaths",
        "deriveBootstrapPayloadEvidencePaths",
        "inspectDrift",
        "inspectBootstrapClosure",
        "hashBytes",
        "ManifestMissingError",
        "ManifestStateParticipant",
        "ManifestStateParticipantError",
        "ManifestStateError",
        "ManifestStore",
        "ManifestUnsupportedArtifactError",
        "ManifestV1NotMigratableError",
        "validateManifest",
        "validateBootstrapExternalShapeProjection",
        "validateBootstrapFoundationOrdinal",
        "validateBootstrapJournal",
        "validateBootstrapPayloadEvidence",
        "validateBootstrapPlan",
        "validateCreatedPathEvidence",
        "validateManifestStatePlan",
        "validateManifestBytes",
        "validateManifestV1",
        "validateManifestV2",
        "validateMigratableManifestV1",
        "ChangePlanError",
        "validateChangePlan",
        "compareVersions",
        "tablePermits",
        /**
         * The one door onto `RedactedPayload`, the brand on `CliError.data`. Exported
         * because the brand's `unique symbol` is unnameable outside `result.ts`, so a
         * caller cannot construct one and a producer has to be provided.
         */
        "publish",
        "redactPayload",
        "admitBootstrapFoundationInitialJournal",
        "recoverTransaction",
        "TransactionBackupRetentionError",
        "TransactionConflictError",
        "TransactionExecutor",
        "TransactionGuardError",
        "TransactionPlanError",
        "TransactionPreconditionError",
        "TransactionStateError",
        "TransactionStore",
        "admitCanonicalAbsolutePath",
        "admitOwnerRelativePath",
        "admitRollbackPayloadRelativePath",
        "admitReleaseAgainstTrust",
        "admitReleaseIdentity",
        "admitVaultFreeRelativePath",
        "advanceReleaseTrust",
        "validateJournal",
        "decodeCanonicalJson",
        "decodeTenDigitOrdinal",
        "deriveBootstrapPayloadPath",
        "deriveCanonicalStatePayloadPath",
        "deriveExactProductStatePath",
        "deriveFoundationInitialJournalPayloadPath",
        "deriveManifestPayloadPath",
        "deriveUpdatePayloadPath",
        "deriveUpdateRecoveryExecutorStagedPath",
        "encodeCanonicalJson",
        "encodeTenDigitOrdinal",
        "parseLowerHexSha256",
        "parseLowercaseAsciiDnsName",
        "parseLowercaseKebabId",
        "parseOfficialReleasePathPrefix",
        "parseOfficialReleaseRelativePath",
        "parsePositiveUInt32",
        "parseSafeReasonCode",
        "parseSchemaMigrationId",
        "parseStableSemver",
        "parseTenDigitZeroPaddedOrdinal",
        "parseUInt64Decimal",
        "parseUtcTimestamp",
        "releaseIdentityHash",
        "selectRelease",
        "signedReleaseDocumentSigningBytes",
        "validateActiveReleaseRecord",
        "validateBundleManifest",
        "validateFixedReleaseMetadataLocator",
        "validateOfflineReleaseTrust",
        "validateOfficialReleaseOrigin",
        "validateReleaseIdentity",
        "validateReleaseIndex",
        "validateReleaseKeyDelegation",
        "validateReleaseMetadataIdentity",
        "validateReleaseTrustState",
        "validateSignedReleaseDocument",
      ].sort(),
    );
  });
});
