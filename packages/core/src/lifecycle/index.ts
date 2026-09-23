export {
  ABSENT_MANIFEST_WALK_BOUNDS,
  inspectAbsentManifestProductHome,
  USER_DATA_HOME_ENTRIES,
} from "./absent-manifest.js";
export type {
  AbsentManifestEvidenceV1,
  AbsentManifestInspectionV1,
  AbsentManifestShapeV1,
} from "./absent-manifest.js";
export {
  cleanLifecycleAllocatorTemp,
  inspectLifecycleAllocator,
  reserveLifecycleIdBlock,
} from "./allocator.js";
export type {
  LifecycleAllocatorBoundaryV1,
  LifecycleAllocatorStateV1,
  LifecycleIdBlockV1,
} from "./allocator.js";
export {
  inspectLifecycleBookkeepingShape,
  LIFECYCLE_BOOKKEEPING_RELATIVE_PATHS,
  lifecycleBookkeepingPaths,
  MANIFEST_ANCHOR_BYTES,
  MANIFEST_ANCHOR_RELATIVE_PATH,
} from "./bookkeeping.js";
export type {
  LifecycleBookkeepingObservationV1,
  LifecycleBookkeepingResidueV1,
  LifecycleBookkeepingShapeResultV1,
} from "./bookkeeping.js";
export { hashCanonicalJson } from "./canonical-json.js";
export {
  createLifecycleCodecs,
  foundationParticipantPlanHash,
  lifecyclePreviewHash,
  validateFoundationParticipantPair,
  validateFoundationParticipantRef,
} from "./codecs.js";
export { LifecycleCoordinator } from "./coordinator.js";
export type {
  LifecycleCoordinatorBoundaryV1,
  LifecycleCoordinatorDependenciesV1,
  LifecycleCoordinatorOutcomeV1,
  LifecycleEffectAdapterV1,
  LifecycleEffectStateV1,
  LifecycleParticipantAdaptersV1,
} from "./coordinator.js";
export {
  compactTerminalCoordinator,
  completeCoordinatorEnvelope,
} from "./coordinator-compaction.js";
export type { LifecycleCoordinatorCompactionDependenciesV1 } from "./coordinator-compaction.js";
export { LifecycleRecoveryRefusalError, LifecycleRecoveryService } from "./recovery.js";
export type {
  LifecycleRecoveryDependenciesV1,
  LifecycleRecoveryPolicyV1,
} from "./recovery.js";
export type {
  LifecycleCodecContextV1,
  LifecycleHashedValueCodec,
  LifecycleLeafCodecsV1,
  LifecycleValueCodec,
} from "./codecs.js";
export {
  compactTerminalFoundationTransaction,
  deriveFoundationTerminalCompaction,
  removeFoundationOrphan,
} from "./foundation-compaction.js";
export type { FoundationCompactionDependenciesV1 } from "./foundation-compaction.js";
export { deriveLifecycleLedgerRoots, inspectFoundationLedger } from "./foundation-ledger.js";
export type {
  FoundationLedgerDependenciesV1,
  FoundationLedgerFindingV1,
  FoundationLedgerHeldJournalV1,
  FoundationLedgerOrphanV1,
  FoundationLedgerV1,
  LifecycleLedgerRootsV1,
} from "./foundation-ledger.js";
export { FoundationParticipantExecutor } from "./foundation-participant.js";
export type {
  FoundationParticipantDependenciesV1,
  FoundationParticipantMutationInputV1,
  FoundationParticipantStageInputV1,
  FoundationParticipantStateV1,
} from "./foundation-participant.js";
export {
  LIFECYCLE_POINT_OF_NO_RETURN,
  LIFECYCLE_STEP_GRAMMAR,
  LIFECYCLE_UNINSTALL_ARTIFACT_STEPS,
  deriveLifecycleOperationVariant,
  deriveTerminalCompaction,
  deriveUninstallLaunchdEvidence,
  derivedCoordinatorPhase,
  lifecycleReservationOrder,
  pointOfNoReturnStepIndex,
  validateCoordinatorJournalForPlan,
  validateLifecyclePlanGrammar,
} from "./grammar.js";
export type {
  LifecycleOperationVariantV1,
  LifecyclePointOfNoReturnV1,
  LifecycleReservationSlotV1,
  LifecycleRequiredRecoveryV1,
  LifecycleStepTemplateV1,
  LifecycleUninstallLaunchdEvidenceV1,
  LifecycleVariantFactsV1,
} from "./grammar.js";
export {
  LifecycleRecoveryRequiredError,
  createNodeLifecycleGuardedFileSystem,
} from "./guarded-fs.js";
export type {
  LifecycleGuardedEntryV1,
  LifecycleGuardedFileSystemV1,
  LifecycleGuardedKindV1,
} from "./guarded-fs.js";
export {
  LIFECYCLE_LEDGER_BOUNDS,
  UINT64_MAX,
  allocatedCounterOf,
  formatAllocatedLifecycleId,
  parseAllocatedFoundationMutationIndex,
  parseAllocatedLifecycleId,
  parseEffectiveUid,
  parseFoundationTransactionId,
  parseLegacyFoundationMutationIndex,
  parseLifecycleCoordinatorId,
  parseManifestParticipantId,
} from "./ids.js";
export type {
  AllocatedLifecycleIdV1,
  EffectiveUidV1,
  FoundationTransactionIdV1,
  GitEffectIdV1,
  LaunchdEffectIdV1,
  LegacyFoundationMutationIndexV1,
  LegacyFoundationTransactionIdV1,
  LifecycleIdPrefixV1,
  LifecycleLedgerBoundsV1,
} from "./ids.js";
export { inspectLifecycleLedger } from "./ledger.js";
export type {
  LifecycleCoordinatorRecordV1,
  LifecycleLedgerDependenciesV1,
  LifecycleLedgerSnapshotV1,
} from "./ledger.js";
export {
  LIFECYCLE_LEASE_DRAIN_MS,
  LIFECYCLE_LOCK_RETRY_MS,
  LifecycleLockBusyError,
  LifecycleLockMissingError,
  LifecycleLockShapeError,
  LifecycleLockUnavailableError,
} from "./locks.js";
export type {
  HeldLifecycleStableLockV1,
  LifecycleLockDeadlineV1,
  LifecycleStableLockProviderV1,
} from "./locks.js";
export {
  encodeLifecycleIdAllocator,
  encodeUninstallingMarker,
  parseLifecycleBootstrapLock,
  parseLifecycleIdAllocator,
  parseLifecycleInstallNonce,
  parseUninstallingMarker,
} from "./records.js";
export type { UninstallingMarkerV1 } from "./records.js";
export {
  LifecycleCoordinatorStore,
  LifecycleInfeasiblePlanError,
  assertLifecycleCapacity,
  assertLifecycleExecutionFeasible,
  longestLegalAllocatedId,
  maximumCoordinatorJournalBytes,
  maximumFoundationJournalBytes,
  standaloneFoundationLeafReservation,
} from "./store.js";
export type {
  LifecycleCoordinatorStoreDependenciesV1,
  LifecycleExecutionBuilderV1,
  LifecycleLeafReservationV1,
  LifecycleStoreBoundaryV1,
} from "./store.js";
export type {
  FoundationParticipantRefV1,
  FoundationParticipantSlotV1,
  FoundationTerminalCompactionV1,
  LifecycleCompactionEntryV1,
  LifecycleCoordinatorJournalV1,
  LifecycleCoordinatorOperationV1,
  LifecycleCoordinatorPhaseV1,
  LifecycleCoordinatorPlanCoreV1,
  LifecycleCoordinatorStepV1,
  LifecycleEffectRefV1,
  LifecycleJournalClosureV1,
  LifecyclePlanPreviewCoreV1,
  LifecyclePreviewFileChangeV1,
  LifecyclePreviewFileStateV1,
  LifecycleSubsystemV1,
  LifecycleTerminalCompactionV1,
  LifecycleTerminalOutcomeV1,
} from "./types.js";
export {
  GIT_EFFECT_STAGING_SIDES,
  LAUNCHD_BOOTSTRAP_SNAPSHOT_CHILD,
  LAUNCHD_PROCESS_STAGING_CHILDREN,
  MAX_GIT_EFFECT_JOURNAL_BYTES,
  MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES,
  MAX_LAUNCHD_EFFECT_JOURNAL_BYTES,
  effectJournalBinding,
  parseEffectStagingChildren,
} from "./effect-ledger.js";
export type {
  GitEffectStagingSideV1,
  LifecycleEffectLedgerCodecV1,
  LifecycleEffectTerminalV1,
} from "./effect-ledger.js";
export { parseGitEffectId, parseLaunchdEffectId } from "./ids.js";
export {
  LIFECYCLE_COMPACTION_ENTRY_KINDS,
  LIFECYCLE_COORDINATOR_OPERATIONS,
  LIFECYCLE_COORDINATOR_PHASES,
  LIFECYCLE_COORDINATOR_STEP_KINDS,
  LIFECYCLE_HASH_DOMAINS,
  LIFECYCLE_JOURNAL_CLOSURE_KINDS,
  LIFECYCLE_MANIFEST_STEP_TRANSITIONS,
  LIFECYCLE_PLAN_BOUNDS,
  LIFECYCLE_PREVIEW_COMMANDS,
  LIFECYCLE_PREVIEW_EXECUTION_OPERATIONS,
  LIFECYCLE_PREVIEW_FILE_OPERATIONS,
  LIFECYCLE_PREVIEW_FILE_ROLES,
  LIFECYCLE_PREVIEW_FILE_STATES,
  LIFECYCLE_REDACTION_KEY_STEP_TRANSITIONS,
  LIFECYCLE_SUBSYSTEMS,
  LIFECYCLE_TERMINAL_OUTCOMES,
} from "./types.js";
