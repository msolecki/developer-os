import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { LifecycleCoordinatorIdV1 } from "../manifest/manifest-state.js";
import { encodeFoundationJournalJsonV1 } from "../transactions/store.js";
import type { TransactionJournalV1, TransactionPhase } from "../transactions/types.js";
import { parseCanonicalAbsolutePathText, type CanonicalAbsolutePathV1 } from "../update/paths.js";
import {
  parseLowerHexSha256,
  parseUInt64Decimal,
  parseUtcTimestamp,
  type LowerHexSha256,
} from "../update/scalars.js";
import type { LifecycleBookkeepingResidueV1 } from "./bookkeeping.js";
import {
  encodeCanonicalJson,
  hashCanonicalJson,
  type CanonicalJsonV1,
  type CanonicalJsonValue,
} from "./canonical-json.js";
import {
  createLifecycleCodecs,
  foundationParticipantPlanHash,
  type LifecycleLeafCodecsV1,
  type LifecycleValueCodec,
} from "./codecs.js";
import type { LifecycleEffectLedgerCodecV1 } from "./effect-ledger.js";
import { deriveLifecycleLedgerRoots, type LifecycleLedgerRootsV1 } from "./foundation-ledger.js";
import {
  LIFECYCLE_STEP_GRAMMAR,
  deriveTerminalCompaction,
  pointOfNoReturnStepIndex,
  type LifecycleOperationVariantV1,
  type LifecycleStepTemplateV1,
  type LifecycleVariantFactsV1,
} from "./grammar.js";
import type { LifecycleGuardedEntryV1, LifecycleGuardedFileSystemV1 } from "./guarded-fs.js";
import {
  formatAllocatedLifecycleId,
  parseAllocatedLifecycleId,
  parseLifecycleCoordinatorId,
  type AllocatedLifecycleIdV1,
  type GitEffectIdV1,
  type LaunchdEffectIdV1,
} from "./ids.js";
import {
  inspectLifecycleLedger,
  type LifecycleLedgerDependenciesV1,
  type LifecycleLedgerSnapshotV1,
} from "./ledger.js";
import { encodeLifecycleIdAllocator } from "./records.js";
import { createInMemoryLifecycleGuardedFileSystem } from "./testing.js";
import type { FoundationMutationRefV1 } from "../manifest/bootstrap.js";
import {
  LIFECYCLE_HASH_DOMAINS,
  type FoundationParticipantRefV1,
  type LifecycleCoordinatorJournalV1,
  type LifecycleCoordinatorPlanCoreV1,
  type LifecycleCoordinatorStepV1,
  type LifecycleEffectRefV1,
} from "./types.js";

const UID = process.getuid?.() ?? 0;
const HOME = parseCanonicalAbsolutePathText("/product");
const ROOTS = deriveLifecycleLedgerRoots(HOME);
const NONCE = parseLowerHexSha256("3f".repeat(32));
const TIMESTAMP = parseUtcTimestamp("2026-09-19T00:00:00.000Z");
const DEV = parseUInt64Decimal("16777232");
const INO = parseUInt64Decimal("184467440737095516");
const MANIFEST_PATH = parseCanonicalAbsolutePathText("/product/state/installation.json");
const LEASE_JOBS = ["brain-reindex", "brain-lint", "doctor", "git-sync"] as const;
const MANIFEST_BYTES = "{}\n";

const encoder = new TextEncoder();

/** The guarded port hashes raw bytes, so the manifest preimage is a plain digest, not a domain-separated one. */
function fileHash(text: string): LowerHexSha256 {
  return parseLowerHexSha256(createHash("sha256").update(encoder.encode(text)).digest("hex"));
}

const MANIFEST_HASH = fileHash(MANIFEST_BYTES);

const ROOT_DIRECTORIES = [
  "state",
  "state/transactions",
  "state/lifecycle-journals",
  "state/git-effect-journals",
  "state/launchd-effect-journals",
  "staging",
  "staging/transactions",
  "staging/lifecycle",
  "backups",
  "backups/transactions",
] as const;

const NO_RESIDUE: LifecycleBookkeepingResidueV1 = {
  retainedPaths: new Set(),
  bootstrapParticipantIds: new Set(),
};

function path(text: string): CanonicalAbsolutePathV1 {
  return parseCanonicalAbsolutePathText(text);
}

function hash(seed: string): LowerHexSha256 {
  return parseLowerHexSha256(seed.repeat(64).slice(0, 64));
}

interface SyntheticLeaf {
  readonly marker: string;
}
interface SyntheticPush extends SyntheticLeaf {
  readonly planHash: LowerHexSha256;
}

type SyntheticPlan = LifecycleCoordinatorPlanCoreV1<
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticPush
>;

function leafCodec<T extends SyntheticLeaf>(label: string): LifecycleValueCodec<T> {
  return {
    validate(value: unknown): T {
      if (typeof value !== "object" || value === null || !("marker" in value)) {
        throw new Error(`invalid synthetic ${label} leaf`);
      }
      return value as T;
    },
    encode: (value) => encodeCanonicalJson(value as unknown as CanonicalJsonValue),
  };
}

const LEAVES: LifecycleLeafCodecsV1<
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticPush,
  SyntheticLeaf,
  SyntheticLeaf,
  SyntheticLeaf & { readonly tableHashes: { readonly observation: LowerHexSha256; readonly mutationTemplate: LowerHexSha256 } }
> = {
  manifest: leafCodec("manifest"),
  launchd: leafCodec("launchd"),
  redactionKey: leafCodec("redactionKey"),
  push: leafCodec<SyntheticPush>("push"),
  pushPlanHash: (push) => push.planHash,
  projection: leafCodec("projection"),
  gitPreview: leafCodec("gitPreview"),
  launchdPreview: leafCodec("launchdPreview"),
  projectionSubsystem: () => "git",
  launchdPreviewTableHashes: (preview) => preview.tableHashes,
};

const CODECS = createLifecycleCodecs(LEAVES, { productHome: HOME, nonce: NONCE });
const PUSH_HASH = hash("2");

function transactionId(counter: bigint): AllocatedLifecycleIdV1<"tx"> {
  return parseAllocatedLifecycleId("tx", formatAllocatedLifecycleId("tx", NONCE, counter), NONCE);
}

function coordinatorId(counter: bigint): LifecycleCoordinatorIdV1 {
  return parseLifecycleCoordinatorId(formatAllocatedLifecycleId("lc", NONCE, counter), NONCE);
}

function gitEffectId(counter: bigint): GitEffectIdV1 {
  return parseAllocatedLifecycleId("ge", formatAllocatedLifecycleId("ge", NONCE, counter), NONCE);
}

function launchdEffectId(counter: bigint): LaunchdEffectIdV1 {
  return parseAllocatedLifecycleId("le", formatAllocatedLifecycleId("le", NONCE, counter), NONCE);
}

function participantRef(options: {
  readonly id: AllocatedLifecycleIdV1<"tx">;
  readonly coordinator: LifecycleCoordinatorIdV1;
  readonly slot: FoundationParticipantRefV1["slot"];
  readonly role: FoundationParticipantRefV1["role"];
}): FoundationParticipantRefV1 {
  const { id, coordinator, slot, role } = options;
  const mutations: readonly FoundationMutationRefV1[] =
    role.kind === "forward"
      ? [
          {
            targetPath: path(`/product/state/${slot}.json`),
            operation: "create",
            expectedBeforeHash: null,
            contentHash: hash("4"),
            contentSize: 16,
            stagedPath: path(`/product/staging/transactions/${id}/0.bin`),
          },
        ]
      : [
          {
            targetPath: path(`/product/state/${slot}.json`),
            operation: "remove",
            expectedBeforeHash: hash("4"),
            contentHash: null,
            contentSize: null,
            stagedPath: null,
          },
        ];
  const core = {
    slot,
    role,
    mutations,
    maximumJournalBytes: 4096,
    initialJournal: {
      finalPath: path(`/product/state/transactions/${id}.json`),
      plannedBytesHash: hash("6"),
      stagedPath: path(`/product/staging/lifecycle/${coordinator}/foundation/${id}/journal.json`),
      stagedIdentity: { hash: hash("7"), size: 512, mode: 384 as const, dev: DEV, ino: INO },
    },
  };
  return { id, ...core, planHash: foundationParticipantPlanHash(core) };
}

interface SyntheticCoordinatorV1 {
  readonly plan: SyntheticPlan;
  readonly id: LifecycleCoordinatorIdV1;
  readonly planHash: LowerHexSha256;
  readonly forwardIds: readonly AllocatedLifecycleIdV1<"tx">[];
  readonly steps: readonly LifecycleCoordinatorStepV1[];
}

/**
 * Counters stay single-digit so decimal order equals the unsigned byte order the
 * plan codec requires of `participants.foundation`.
 */
function syntheticCoordinator(
  variant: LifecycleOperationVariantV1,
  base: bigint,
  artifactSteps = 1,
): SyntheticCoordinatorV1 {
  /** D45: the row's one `F(uninstall_artifacts)` repeated in place, as a chunked uninstall plans it. */
  const templates = LIFECYCLE_STEP_GRAMMAR[variant].flatMap((template) =>
    template.kind === "F" && template.slot === "uninstall_artifacts"
      ? Array.from({ length: artifactSteps }, () => template)
      : [template],
  );
  const id = coordinatorId(base);
  let next = base + 1n;
  const reserve = (): bigint => {
    const counter = next;
    next += 1n;
    if (counter > 9n) throw new Error("fixture counters must stay single-digit");
    return counter;
  };
  const forwardIds = templates
    .filter((template) => template.kind === "F")
    .map(() => transactionId(reserve()));
  const sourceGitEffect: LifecycleEffectRefV1<GitEffectIdV1> | null = templates.some(
    (template) => template.kind === "S",
  )
    ? { id: gitEffectId(reserve()), planHash: hashCanonicalJson(LIFECYCLE_HASH_DOMAINS.gitEffectPlan, { marker: "source-git" }) }
    : null;
  const destinationGitEffect: LifecycleEffectRefV1<GitEffectIdV1> | null = templates.some(
    (template) => template.kind === "D",
  )
    ? { id: gitEffectId(reserve()), planHash: hashCanonicalJson(LIFECYCLE_HASH_DOMAINS.gitEffectPlan, { marker: "destination-git" }) }
    : null;
  const launchdBeforeFiles: LifecycleEffectRefV1<LaunchdEffectIdV1> | null = templates.some(
    (template) => template.kind === "P",
  )
    ? { id: launchdEffectId(reserve()), planHash: hashCanonicalJson(LIFECYCLE_HASH_DOMAINS.launchdEffectPlan, { marker: "before-files" }) }
    : null;
  const launchdAfterFiles: LifecycleEffectRefV1<LaunchdEffectIdV1> | null = templates.some(
    (template) => template.kind === "Q",
  )
    ? { id: launchdEffectId(reserve()), planHash: hashCanonicalJson(LIFECYCLE_HASH_DOMAINS.launchdEffectPlan, { marker: "after-files" }) }
    : null;

  let forwardCursor = 0;
  const steps: LifecycleCoordinatorStepV1[] = templates.map((template) => {
    switch (template.kind) {
      case "F": {
        const participantId = forwardIds[forwardCursor];
        forwardCursor += 1;
        if (participantId === undefined) throw new Error("fixture lost a forward participant");
        return { kind: "foundation", slot: template.slot, participantId };
      }
      case "M":
        return { kind: "manifest", transition: template.transition };
      case "K":
        return { kind: "redaction_key", transition: template.transition };
      case "S": {
        if (sourceGitEffect === null) throw new Error("fixture lost its source Git effect");
        return { kind: "source_git_effect", participantId: sourceGitEffect.id };
      }
      case "D": {
        if (destinationGitEffect === null) throw new Error("fixture lost its destination Git effect");
        return {
          kind: "destination_git_effect",
          participantId: destinationGitEffect.id,
          pushPlanHash: PUSH_HASH,
        };
      }
      case "P": {
        if (launchdBeforeFiles === null) throw new Error("fixture lost its before-files effect");
        return { kind: "launchd_before_files", participantId: launchdBeforeFiles.id };
      }
      case "Q": {
        if (launchdAfterFiles === null) throw new Error("fixture lost its after-files effect");
        return { kind: "launchd_after_files", participantId: launchdAfterFiles.id };
      }
      case "N":
        return { kind: "network_push", pushPlanHash: PUSH_HASH };
      case "R":
        return { kind: "drain_runners" };
    }
  });

  const boundary = pointOfNoReturnStepIndex(variant, steps);
  const foundation: FoundationParticipantRefV1[] = [];
  forwardCursor = 0;
  for (const [index, template] of templates.entries()) {
    if (template.kind !== "F") continue;
    const forwardId = forwardIds[forwardCursor];
    forwardCursor += 1;
    if (forwardId === undefined) throw new Error("fixture lost a forward participant");
    const compensationId = index < boundary ? transactionId(reserve()) : null;
    foundation.push(
      participantRef({ id: forwardId, coordinator: id, slot: template.slot, role: { kind: "forward", compensationId } }),
    );
    if (compensationId !== null) {
      foundation.push(
        participantRef({
          id: compensationId,
          coordinator: id,
          slot: template.slot,
          role: { kind: "compensation", forwardId },
        }),
      );
    }
  }

  const has = (kind: LifecycleStepTemplateV1["kind"]): boolean =>
    templates.some((template) => template.kind === kind);
  const launchd = kindsWithLaunchdPlan.has(variant) ? { marker: "launchd" } : null;
  const plan: SyntheticPlan = {
    schemaVersion: 1,
    id,
    previewHash: null,
    operation: variant.split("/")[0] as SyntheticPlan["operation"],
    maximumJournalBytes: 8192,
    authority: {
      productHome: HOME,
      configPath: path("/product/config.toml"),
      activationPath: path("/product/state/lifecycle-activation.json"),
      manifestPath: MANIFEST_PATH,
      repositoryRoot: variant.startsWith("git_") ? path("/brain") : null,
      plistPaths: launchd === null ? [] : [path("/Library/LaunchAgents/com.developer-os.doctor.plist")],
    },
    participants: {
      foundation: [...foundation].sort((left, right) => (left.id < right.id ? -1 : 1)),
      manifest: has("M") ? { marker: "manifest" } : null,
      sourceGitEffect,
      destinationGitEffect,
      launchdBeforeFiles,
      launchdAfterFiles,
      launchd,
      redactionKey: has("K") ? { marker: "redaction-key" } : null,
    },
    push: has("N") || has("D") ? { marker: "push", planHash: PUSH_HASH } : null,
    steps,
  };
  return { plan, id, planHash: CODECS.executionPlan.hash(plan), forwardIds, steps };
}

const kindsWithLaunchdPlan: ReadonlySet<LifecycleOperationVariantV1> = new Set([
  "automation_enable",
  "automation_reconcile/files",
  "automation_reconcile/live_only",
  "automation_disable",
  "uninstall/present_manifest",
]);

function variantFacts(plan: SyntheticPlan): LifecycleVariantFactsV1 {
  if (plan.operation === "git_sync") {
    const network = plan.steps.some((step) => step.kind === "network_push");
    return {
      gitSync: {
        newCommit: plan.participants.sourceGitEffect !== null,
        transport: network ? "network" : "local",
        noChanges: !network && plan.participants.destinationGitEffect === null,
      },
      automationReconcile: null,
      uninstallLaunchdEvidence: null,
    };
  }
  if (plan.operation === "automation_reconcile") {
    return {
      gitSync: null,
      automationReconcile: plan.participants.launchdBeforeFiles === null ? "live_only" : "files",
      uninstallLaunchdEvidence: null,
    };
  }
  if (plan.operation === "uninstall") {
    return {
      gitSync: null,
      automationReconcile: null,
      uninstallLaunchdEvidence: plan.participants.launchd !== null,
    };
  }
  return { gitSync: null, automationReconcile: null, uninstallLaunchdEvidence: null };
}

function journalFor(
  coordinator: SyntheticCoordinatorV1,
  overrides: Partial<LifecycleCoordinatorJournalV1> = {},
): LifecycleCoordinatorJournalV1 {
  return {
    schemaVersion: 1,
    id: coordinator.id,
    operation: coordinator.plan.operation,
    phase: "finalized",
    planHash: coordinator.planHash,
    pushPlanHash: coordinator.plan.push === null ? null : coordinator.plan.push.planHash,
    nextStep: coordinator.steps.length,
    compensationNext: null,
    compactionNext: null,
    terminalOutcome: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

interface HomeV1 {
  readonly fs: LifecycleGuardedFileSystemV1;
  readonly roots: LifecycleLedgerRootsV1;
}

async function write(home: HomeV1, relative: string, text: string | Uint8Array): Promise<LifecycleGuardedEntryV1> {
  return home.fs.writeExclusive(
    path(`${HOME}/${relative}`),
    typeof text === "string" ? encoder.encode(text) : text,
  );
}

async function mkdir(home: HomeV1, relative: string): Promise<void> {
  await home.fs.mkdirExclusive(path(`${HOME}/${relative}`));
}

async function newHome(
  options: {
    readonly nonce?: boolean;
    readonly allocator?: boolean;
    readonly omit?: readonly string[];
  } = {},
): Promise<HomeV1> {
  const fs = createInMemoryLifecycleGuardedFileSystem({ effectiveUid: UID, root: HOME });
  const home: HomeV1 = { fs, roots: ROOTS };
  const omit = new Set(options.omit ?? []);
  for (const relative of ROOT_DIRECTORIES) {
    if (!omit.has(relative)) await mkdir(home, relative);
  }
  if (options.nonce !== false) await write(home, "state/lifecycle-install-nonce", `${NONCE}\n`);
  if (options.allocator !== false) {
    await write(
      home,
      "state/lifecycle-id-allocator.json",
      encodeLifecycleIdAllocator({
        schemaVersion: 1,
        installNonce: NONCE,
        nextCounter: parseUInt64Decimal("100"),
      }),
    );
  }
  return home;
}

interface DependencyOptionsV1 {
  readonly gitEffectPlanCodec?: LifecycleEffectLedgerCodecV1 | null;
  readonly launchdEffectPlanCodec?: LifecycleEffectLedgerCodecV1 | null;
  readonly residue?: LifecycleBookkeepingResidueV1;
  readonly fs?: LifecycleGuardedFileSystemV1;
  readonly manifestBeforeHash?: (plan: SyntheticPlan) => LowerHexSha256 | null;
}

function dependenciesFor(
  home: HomeV1,
  options: DependencyOptionsV1 = {},
): LifecycleLedgerDependenciesV1<SyntheticPlan> {
  return {
    fs: options.fs ?? home.fs,
    effectiveUid: UID,
    executionPlanCodec: CODECS.executionPlan,
    coordinatorJournalCodec: CODECS.coordinatorJournal,
    variantFacts,
    pushPlanHash: (plan) => (plan.push === null ? null : plan.push.planHash),
    gitEffectPlanCodec: options.gitEffectPlanCodec ?? null,
    launchdEffectPlanCodec: options.launchdEffectPlanCodec ?? null,
    residue: options.residue ?? NO_RESIDUE,
    manifestBeforeHash: options.manifestBeforeHash ?? (() => MANIFEST_HASH),
    leasePaths: () => LEASE_JOBS.map((job) => path(`/product/state/.automation-${job}.lock`)),
  };
}

function inspect(
  home: HomeV1,
  options: DependencyOptionsV1 = {},
): Promise<LifecycleLedgerSnapshotV1<SyntheticPlan>> {
  return inspectLifecycleLedger(dependenciesFor(home, options), home.roots);
}

function reasons(snapshot: LifecycleLedgerSnapshotV1<SyntheticPlan>): readonly string[] {
  return snapshot.findings.map((finding) => finding.reason);
}

async function plantPlan(home: HomeV1, coordinator: SyntheticCoordinatorV1): Promise<void> {
  await write(
    home,
    `state/lifecycle-journals/${coordinator.id}.plan.json`,
    CODECS.executionPlan.encode(coordinator.plan),
  );
}

async function plantJournal(
  home: HomeV1,
  journal: LifecycleCoordinatorJournalV1,
): Promise<void> {
  await write(
    home,
    `state/lifecycle-journals/${journal.id}.json`,
    CODECS.coordinatorJournal.encode(journal),
  );
}

async function plantCoordinator(
  home: HomeV1,
  coordinator: SyntheticCoordinatorV1,
  journal: LifecycleCoordinatorJournalV1 | null = journalFor(coordinator),
  options: { readonly lock?: boolean } = {},
): Promise<void> {
  await plantPlan(home, coordinator);
  if (journal !== null) await plantJournal(home, journal);
  if (options.lock === true) {
    await write(home, `state/lifecycle-journals/.${coordinator.id}.lock`, new Uint8Array(0));
  }
}

function foundationJournal(
  id: string,
  phase: TransactionPhase = "finalized",
): TransactionJournalV1 {
  return {
    schemaVersion: 1,
    id,
    kind: "lifecycle_participant",
    phase,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:01.000Z",
    mutations: [
      {
        targetPath: "/product/state/uninstall_artifacts.json",
        operation: "create",
        expectedBeforeHash: null,
        stagedRelativePath: "0.bin",
      },
    ],
  };
}

async function plantFoundationJournal(
  home: HomeV1,
  id: string,
  phase: TransactionPhase = "finalized",
): Promise<void> {
  await write(
    home,
    `state/transactions/${id}.json`,
    encodeFoundationJournalJsonV1(foundationJournal(id, phase)),
  );
}

async function plantLeases(home: HomeV1, present: number): Promise<void> {
  for (const job of LEASE_JOBS.slice(0, present)) {
    await write(home, `state/.automation-${job}.lock`, new Uint8Array(0));
  }
}

/**
 * A terminal uninstall coordinator whose envelope is already collected: no
 * coordinator leaf, no participant leaf, no effect leaf, no staging.
 */
async function terminalUninstallEnvelopeAbsent(): Promise<HomeV1> {
  return newHome();
}

const UNINSTALL = syntheticCoordinator("uninstall/present_manifest_without_launchd", 1n);
const PUSH = syntheticCoordinator("git_sync/existing_network", 6n);

function artifactsStepIndex(coordinator: SyntheticCoordinatorV1): number {
  const index = coordinator.steps.findIndex(
    (step) => step.kind === "foundation" && step.slot === "uninstall_artifacts",
  );
  if (index < 0) throw new Error("fixture has no uninstall_artifacts step");
  return index;
}

function artifactsParticipantId(coordinator: SyntheticCoordinatorV1): string {
  const step = coordinator.steps[artifactsStepIndex(coordinator)];
  if (step === undefined || step.kind !== "foundation") throw new Error("fixture lost its artifacts step");
  return step.participantId;
}

function compensationOf(coordinator: SyntheticCoordinatorV1, forwardId: string): string {
  const ref = coordinator.plan.participants.foundation.find((candidate) => candidate.id === forwardId);
  const compensationId = ref?.role.kind === "forward" ? ref.role.compensationId : null;
  if (compensationId === null) {
    throw new Error("fixture has no compensation for that forward participant");
  }
  return compensationId;
}

function markerParticipantId(coordinator: SyntheticCoordinatorV1): string {
  const step = coordinator.steps[0];
  if (step === undefined || step.kind !== "foundation") throw new Error("fixture lost its marker step");
  return step.participantId;
}

/**
 * The cursor §2.4 admits for `uninstall_draining`: the artifacts participant is
 * terminal, the coordinator sits on `K(stage)`, and the manifest is still at its
 * preimage because `M(commit_absence)` has not run.
 */
async function uninstallAtArtifacts(options: {
  readonly leasePathsRemoved: number;
  readonly artifactsJournal?: boolean;
  readonly markerJournal?: boolean | TransactionPhase;
  readonly manifest?: boolean;
  readonly manifestBytes?: string;
  readonly nextStep?: number;
}): Promise<HomeV1> {
  const home = await newHome();
  const cursor = options.nextStep ?? artifactsStepIndex(UNINSTALL) + 1;
  await plantCoordinator(
    home,
    UNINSTALL,
    journalFor(UNINSTALL, { phase: "participants_applying", nextStep: cursor }),
  );
  if (options.artifactsJournal !== false) {
    await plantFoundationJournal(home, artifactsParticipantId(UNINSTALL));
  }
  const marker = options.markerJournal ?? true;
  if (marker !== false) {
    await plantFoundationJournal(
      home,
      markerParticipantId(UNINSTALL),
      marker === true ? "finalized" : marker,
    );
  }
  if (options.manifest !== false) {
    await write(home, "state/installation.json", options.manifestBytes ?? MANIFEST_BYTES);
  }
  await plantLeases(home, LEASE_JOBS.length - options.leasePathsRemoved);
  return home;
}

async function pushPendingHome(coordinators: readonly SyntheticCoordinatorV1[]): Promise<HomeV1> {
  const home = await newHome();
  for (const coordinator of coordinators) {
    const cursor = coordinator.steps.findIndex((step) => step.kind === "network_push");
    await plantCoordinator(
      home,
      coordinator,
      journalFor(coordinator, { phase: "push_pending", nextStep: cursor }),
    );
  }
  return home;
}

/**
 * A synthetic effect codec: plans are `{ marker }` leaves, journals carry the
 * `EffectJournalV1` identity fields plus a phase, and staging ownership is
 * whatever list the test hands in.
 */
function effectLedgerCodec(children: readonly string[] = []): LifecycleEffectLedgerCodecV1 {
  const encode = (value: unknown): CanonicalJsonV1 => encodeCanonicalJson(value as CanonicalJsonValue);
  return {
    plan: {
      validate: (value) => {
        if (typeof value !== "object" || value === null || !("marker" in value)) {
          throw new Error("invalid synthetic effect plan");
        }
        return value;
      },
      encode,
    },
    journal: {
      validate: (value) => {
        if (typeof value !== "object" || value === null || !("phase" in value) || typeof value.phase !== "string") {
          throw new Error("invalid synthetic effect journal");
        }
        return value;
      },
      encode,
    },
    terminal: (journal) => {
      const phase = (journal as { readonly phase: string }).phase;
      return phase === "finalized" || phase === "rolled_back" ? phase : null;
    },
    stagingChildren: () => children,
  };
}

describe("the lifecycle ledger closure", () => {
  it("is clear only for a fully valid terminal ledger", async () => {
    const home = await terminalUninstallEnvelopeAbsent();

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "clear" });
    expect(snapshot.allocator).not.toBeNull();
  });

  it("is clear for a present terminal coordinator beside its terminal participants", async () => {
    const home = await newHome();
    await plantCoordinator(home, UNINSTALL);
    expect(UNINSTALL.forwardIds.length).toBeGreaterThan(0);
    for (const id of UNINSTALL.forwardIds) await plantFoundationJournal(home, id);

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinators.map((record) => record.state)).toStrictEqual(["terminal"]);
    expect(snapshot.standaloneTerminalFoundation).toHaveLength(UNINSTALL.forwardIds.length);
    expect(snapshot.closure).toStrictEqual({ kind: "clear" });
  });

  it("returns retry_only for exactly one bound push_pending coordinator", async () => {
    const home = await pushPendingHome([PUSH]);

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({
      kind: "retry_only",
      transactionId: PUSH.id,
      pushPlanHash: PUSH_HASH,
    });
  });

  it("returns lifecycle_recovery_required for two push_pending coordinators", async () => {
    const second = syntheticCoordinator("git_sync/existing_network", 8n);
    const home = await pushPendingHome([PUSH, second]);

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinators).toHaveLength(2);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses one push_pending coordinator beside any other non-terminal journal", async () => {
    const home = await pushPendingHome([PUSH]);
    await plantFoundationJournal(home, transactionId(9n), "applied");

    const snapshot = await inspect(home);

    expect(snapshot.standaloneNonTerminalFoundation).toHaveLength(1);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("returns uninstall_draining only after the artifacts participant removed every bound lease path", async () => {
    for (const removed of [0, 1, 2, 3]) {
      const home = await uninstallAtArtifacts({ leasePathsRemoved: removed });
      const snapshot = await inspect(home);
      expect(snapshot.closure.kind).toBe("lifecycle_recovery_required");
    }

    const drained = await inspect(await uninstallAtArtifacts({ leasePathsRemoved: 4 }));

    expect(drained.findings).toStrictEqual([]);
    expect(drained.closure).toStrictEqual({ kind: "uninstall_draining", transactionId: UNINSTALL.id });
  });

  it("never returns uninstall_draining while the artifacts journal is absent", async () => {
    const home = await uninstallAtArtifacts({
      leasePathsRemoved: 4,
      artifactsJournal: false,
      nextStep: artifactsStepIndex(UNINSTALL),
    });

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinators).toHaveLength(1);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("never returns uninstall_draining while the manifest is absent before M(commit_absence)", async () => {
    const home = await uninstallAtArtifacts({ leasePathsRemoved: 4, manifest: false });

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinators).toHaveLength(1);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("never returns uninstall_draining while the manifest survives past M(commit_absence)", async () => {
    const commitAbsence = UNINSTALL.steps.findIndex(
      (step) => step.kind === "manifest" && step.transition === "commit_absence",
    );
    expect(commitAbsence).toBeGreaterThanOrEqual(0);

    const home = await uninstallAtArtifacts({ leasePathsRemoved: 4, nextStep: commitAbsence + 1 });
    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinators).toHaveLength(1);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses an uninstall drain whose manifest does not hash to the plan's before state", async () => {
    const home = await uninstallAtArtifacts({
      leasePathsRemoved: 4,
      manifestBytes: "not-the-planned-manifest\n",
    });

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinators).toHaveLength(1);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("returns uninstall_draining while the manifest still hashes to the plan's before state", async () => {
    const home = await uninstallAtArtifacts({ leasePathsRemoved: 4 });

    const snapshot = await inspect(home, { manifestBeforeHash: () => MANIFEST_HASH });

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({
      kind: "uninstall_draining",
      transactionId: UNINSTALL.id,
    });
  });

  it("never returns uninstall_draining while the plan binds no manifest preimage", async () => {
    const home = await uninstallAtArtifacts({ leasePathsRemoved: 4 });

    const snapshot = await inspect(home, { manifestBeforeHash: () => null });

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinators).toHaveLength(1);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses an uninstall drain whose consumed marker participant journal is missing", async () => {
    const home = await uninstallAtArtifacts({ leasePathsRemoved: 4, markerJournal: false });

    const snapshot = await inspect(home);

    expect(reasons(snapshot).length).toBeGreaterThan(0);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses an uninstall drain whose consumed marker participant is not terminal", async () => {
    const home = await uninstallAtArtifacts({ leasePathsRemoved: 4, markerJournal: "applied" });

    const snapshot = await inspect(home);

    expect(reasons(snapshot).length).toBeGreaterThan(0);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses a terminal coordinator whose consumed participant journal is missing", async () => {
    const home = await newHome();
    await plantCoordinator(home, UNINSTALL);
    await plantFoundationJournal(home, markerParticipantId(UNINSTALL));

    const snapshot = await inspect(home);

    expect(reasons(snapshot).length).toBeGreaterThan(0);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses a coordinator whose future compensation participant published a final journal", async () => {
    const home = await uninstallAtArtifacts({ leasePathsRemoved: 4 });
    await plantFoundationJournal(
      home,
      compensationOf(UNINSTALL, markerParticipantId(UNINSTALL)),
      "planned",
    );

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_coordinator_participant_state");
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses a coordinator whose future forward participant published a non-terminal journal", async () => {
    const home = await uninstallAtArtifacts({
      leasePathsRemoved: 4,
      nextStep: artifactsStepIndex(UNINSTALL) - 1,
      artifactsJournal: false,
    });
    await plantFoundationJournal(home, artifactsParticipantId(UNINSTALL), "applied");

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_coordinator_participant_state");
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses an uninstall drain whose consumed artifacts participant journal is missing", async () => {
    const home = await uninstallAtArtifacts({
      leasePathsRemoved: 4,
      artifactsJournal: false,
      nextStep: artifactsStepIndex(UNINSTALL) + 1,
    });

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_coordinator_participant_state");
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses a coordinator whose future participant already published a final journal", async () => {
    const home = await uninstallAtArtifacts({
      leasePathsRemoved: 4,
      nextStep: artifactsStepIndex(UNINSTALL) - 1,
    });

    const snapshot = await inspect(home);

    expect(reasons(snapshot).length).toBeGreaterThan(0);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it.each([
    ["at the artifacts step", 0],
    ["one step past it", 1],
  ])("returns uninstall_draining %s once every lease path is gone", async (_label, offset) => {
    const home = await uninstallAtArtifacts({
      leasePathsRemoved: 4,
      nextStep: artifactsStepIndex(UNINSTALL) + offset,
    });

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({
      kind: "uninstall_draining",
      transactionId: UNINSTALL.id,
    });
  });

  it("never returns uninstall_draining before the artifacts step", async () => {
    const home = await uninstallAtArtifacts({
      leasePathsRemoved: 4,
      nextStep: artifactsStepIndex(UNINSTALL) - 1,
      artifactsJournal: false,
    });

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinators).toHaveLength(1);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses mixed retry_only and uninstall_draining candidates", async () => {
    const home = await uninstallAtArtifacts({ leasePathsRemoved: 4 });
    const cursor = PUSH.steps.findIndex((step) => step.kind === "network_push");
    await plantCoordinator(home, PUSH, journalFor(PUSH, { phase: "push_pending", nextStep: cursor }));

    const snapshot = await inspect(home);

    expect(snapshot.coordinators).toHaveLength(2);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses a compacting coordinator at every compactionNext", async () => {
    const entries = deriveTerminalCompaction(UNINSTALL.plan, "finalized").entries.length;
    const cursors = Array.from({ length: entries }, (_, index) => index);
    expect(cursors.length).toBeGreaterThan(0);

    for (const compactionNext of cursors) {
      const home = await newHome();
      await plantCoordinator(
        home,
        UNINSTALL,
        journalFor(UNINSTALL, {
          phase: "compacting",
          compactionNext,
          terminalOutcome: "finalized",
        }),
      );
      const snapshot = await inspect(home);
      expect(snapshot.coordinators[0]?.state).toBe("compacting");
      expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
    }
  });
});

/**
 * D45: with the step repeated, the cursor can rest on a later artifact step whose participant has
 * not started. §2.2's "at or beyond removal of all four runner-lease paths" still holds there,
 * because the leases lead the removal order and the first step removed them.
 */
describe("uninstall_draining across repeated artifact steps (D45)", () => {
  const CHUNKED = syntheticCoordinator("uninstall/present_manifest_without_launchd", 1n, 2);

  async function chunkedOnSecondArtifactStep(leasesPresent: number): Promise<HomeV1> {
    const home = await newHome();
    const first = artifactsStepIndex(CHUNKED);
    expect(CHUNKED.steps[first + 1]).toMatchObject({ kind: "foundation", slot: "uninstall_artifacts" });
    await plantCoordinator(
      home,
      CHUNKED,
      journalFor(CHUNKED, { phase: "participants_applying", nextStep: first + 1 }),
    );
    await plantFoundationJournal(home, markerParticipantId(CHUNKED));
    await plantFoundationJournal(home, artifactsParticipantId(CHUNKED));
    await write(home, "state/installation.json", MANIFEST_BYTES);
    await plantLeases(home, leasesPresent);
    return home;
  }

  it("returns uninstall_draining with the cursor on the second artifact step once the first removed every lease", async () => {
    const snapshot = await inspect(await chunkedOnSecondArtifactStep(0));

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "uninstall_draining", transactionId: CHUNKED.id });
  });

  it("never returns uninstall_draining on the second artifact step while a lease path survives", async () => {
    const snapshot = await inspect(await chunkedOnSecondArtifactStep(1));

    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });
});

describe("the coordinator envelope suffix", () => {
  it("admits a plan-plus-lock suffix with every earlier compaction entry absent", async () => {
    const home = await newHome();
    await plantCoordinator(home, UNINSTALL, null, { lock: true });

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinators[0]?.state).toBe("envelope_suffix_plan_and_lock");
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("admits a plan-only suffix with every earlier compaction entry absent", async () => {
    const home = await newHome();
    await plantCoordinator(home, UNINSTALL, null);

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinators[0]?.state).toBe("envelope_suffix_plan_only");
  });

  it("refuses a plan-only suffix while an earlier compaction entry survives", async () => {
    const home = await newHome();
    await plantCoordinator(home, UNINSTALL, null);
    await plantFoundationJournal(home, artifactsParticipantId(UNINSTALL));

    const snapshot = await inspect(home);

    expect(reasons(snapshot).length).toBeGreaterThan(0);
    expect(reasons(snapshot)).toContain("lifecycle_coordinator_suffix_state");
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses an absent coordinator or lifecycle-staging root", async () => {
    const home = await newHome({ omit: ["state/lifecycle-journals", "staging/lifecycle"] });

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual([
      "lifecycle_ledger_root_shape",
      "lifecycle_ledger_root_shape",
    ]);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses a lock-only coordinator envelope", async () => {
    const home = await newHome();
    await write(home, `state/lifecycle-journals/.${UNINSTALL.id}.lock`, new Uint8Array(0));

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_coordinator_lock_only"]);
    expect(snapshot.coordinators).toStrictEqual([]);
  });
});

describe("the uninstall control-file microstates", () => {
  async function compactingUninstall(options: {
    readonly nonce?: boolean;
    readonly allocator?: boolean;
  }): Promise<HomeV1> {
    const home = await newHome(options);
    const entries = deriveTerminalCompaction(UNINSTALL.plan, "finalized").entries.length - 1;
    await plantCoordinator(
      home,
      UNINSTALL,
      journalFor(UNINSTALL, { phase: "compacting", compactionNext: entries, terminalOutcome: "finalized" }),
      { lock: true },
    );
    return home;
  }

  it.each([
    ["both present", {}, false],
    ["allocator absent with nonce present", { allocator: false }, true],
    ["both absent", { nonce: false, allocator: false }, true],
  ] as const)("admits %s at the coordinator_envelope cursor", async (_label, options, allocatorNull) => {
    const home = await compactingUninstall(options);

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.allocator === null).toBe(allocatorNull);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses a nonce-absent, allocator-present home", async () => {
    const home = await compactingUninstall({ nonce: false });

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_install_nonce_shape");
    expect(snapshot.allocator).toBeNull();
  });

  it("refuses a missing allocator without the uninstall envelope cursor", async () => {
    const home = await newHome({ allocator: false });

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_id_allocator_shape");
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("reports the guarded-cleanable allocator temp without deleting it", async () => {
    const home = await newHome();
    const temp = await write(
      home,
      "state/.lifecycle-id-allocator.123e4567-e89b-42d3-a456-426614174000.json.tmp",
      encodeLifecycleIdAllocator({
        schemaVersion: 1,
        installNonce: NONCE,
        nextCounter: parseUInt64Decimal("200"),
      }),
    );

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_allocator_temp_present");
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
    expect(await home.fs.lstat(temp.path)).not.toBeNull();
  });
});

describe("the coordinator root grammar", () => {
  it("refuses a journal without its plan", async () => {
    const home = await newHome();
    await plantJournal(home, journalFor(UNINSTALL));

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_coordinator_plan_missing"]);
  });

  it("refuses a plan whose embedded ID does not match its filename", async () => {
    const home = await newHome();
    await write(
      home,
      `state/lifecycle-journals/${coordinatorId(9n)}.plan.json`,
      CODECS.executionPlan.encode(UNINSTALL.plan),
    );

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_coordinator_plan_identity");
  });

  it("refuses a journal whose embedded ID does not match its filename", async () => {
    const home = await newHome();
    await plantPlan(home, UNINSTALL);
    await write(
      home,
      `state/lifecycle-journals/${UNINSTALL.id}.json`,
      CODECS.coordinatorJournal.encode(journalFor(UNINSTALL, { id: coordinatorId(9n) })),
    );

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_coordinator_journal_identity");
  });

  it("refuses a journal whose planHash does not match its plan", async () => {
    const home = await newHome();
    await plantCoordinator(home, UNINSTALL, journalFor(UNINSTALL, { planHash: hash("d") }));

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_coordinator_plan_hash");
  });

  it("refuses a non-canonical plan", async () => {
    const home = await newHome();
    const canonical = CODECS.executionPlan.encode(UNINSTALL.plan);
    await write(home, `state/lifecycle-journals/${UNINSTALL.id}.plan.json`, ` ${canonical}`);
    await plantJournal(home, journalFor(UNINSTALL));

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_coordinator_plan_bytes");
  });

  it("refuses a plan over 16,777,216 bytes", async () => {
    const home = await newHome();
    await write(
      home,
      `state/lifecycle-journals/${UNINSTALL.id}.plan.json`,
      new Uint8Array(16_777_217),
    );

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_coordinator_plan_shape");
  });

  it("refuses a journal over its plan's maximumJournalBytes", async () => {
    const home = await newHome();
    await plantPlan(home, UNINSTALL);
    const journal = CODECS.coordinatorJournal.encode(journalFor(UNINSTALL));
    const padded = `${journal.slice(0, -1)}${" ".repeat(UNINSTALL.plan.maximumJournalBytes)}\n`;
    await write(home, `state/lifecycle-journals/${UNINSTALL.id}.json`, padded);

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_coordinator_journal_shape");
  });

  it("refuses an unknown coordinator leaf", async () => {
    const home = await newHome();
    await write(home, "state/lifecycle-journals/notes.txt", "x\n");

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_coordinator_journal_name"]);
  });

  it("returns lifecycle_recovery_required for malformed bytes with no readable participant envelope", async () => {
    const home = await newHome();
    await write(home, `state/lifecycle-journals/${UNINSTALL.id}.json`, new Uint8Array([0xff, 0xfe]));
    await write(home, `state/lifecycle-journals/${UNINSTALL.id}.plan.json`, new Uint8Array([0x00]));

    const snapshot = await inspect(home);

    expect(reasons(snapshot).length).toBeGreaterThan(0);
    expect(snapshot.coordinators).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });
});

describe("the coordinator temporary leaves", () => {
  const UUID = "123e4567-e89b-42d3-a456-426614174000";

  it.each([
    ["empty", ""],
    ["partial", '{"schemaVersion":1'],
    ["complete", null],
  ] as const)("admits an %s initial coordinator journal temp beside its plan", async (_label, bytes) => {
    const home = await newHome();
    await plantPlan(home, UNINSTALL);
    await write(
      home,
      `state/lifecycle-journals/.${UNINSTALL.id}.${UUID}.json.tmp`,
      bytes ?? CODECS.coordinatorJournal.encode(journalFor(UNINSTALL)),
    );

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinatorOrphans.length).toBeGreaterThan(0);
    expect(snapshot.coordinatorOrphans.map((orphan) => orphan.kind)).toContain("initial_journal_temp");
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it.each([
    ["empty", ""],
    ["partial", '{"schemaVersion":1'],
    ["complete", null],
  ] as const)("admits an %s plan-publication temp while the final plan is absent", async (_label, bytes) => {
    const home = await newHome();
    await write(
      home,
      `state/lifecycle-journals/.${UNINSTALL.id}.${UUID}.plan.json.tmp`,
      bytes ?? CODECS.executionPlan.encode(UNINSTALL.plan),
    );

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinatorOrphans.map((orphan) => orphan.kind)).toStrictEqual([
      "plan_publication_temp",
    ]);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses an initial journal temp after a participant journal exists", async () => {
    const home = await newHome();
    await plantPlan(home, UNINSTALL);
    await write(home, `state/lifecycle-journals/.${UNINSTALL.id}.${UUID}.json.tmp`, "");
    await plantFoundationJournal(home, artifactsParticipantId(UNINSTALL));

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_coordinator_temp_state");
  });

  it("reports a rewrite temp beside its final journal", async () => {
    const home = await newHome();
    await plantCoordinator(home, UNINSTALL);
    for (const id of UNINSTALL.forwardIds) await plantFoundationJournal(home, id);
    await write(
      home,
      `state/lifecycle-journals/.${UNINSTALL.id}.${UUID}.json.tmp`,
      CODECS.coordinatorJournal.encode(journalFor(UNINSTALL)),
    );

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinatorOrphans.map((orphan) => orphan.kind)).toStrictEqual(["rewrite_temp"]);
  });
});

describe("the lifecycle staging inventory", () => {
  it("reports a well-formed planless staging tree as a planless_staging orphan", async () => {
    const home = await newHome();
    const participant = transactionId(2n);
    await mkdir(home, `staging/lifecycle/${UNINSTALL.id}`);
    await mkdir(home, `staging/lifecycle/${UNINSTALL.id}/foundation`);
    await mkdir(home, `staging/lifecycle/${UNINSTALL.id}/foundation/${participant}`);
    await write(
      home,
      `staging/lifecycle/${UNINSTALL.id}/foundation/${participant}/journal.json`,
      encodeFoundationJournalJsonV1(foundationJournal(participant, "planned")),
    );

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.coordinatorOrphans.map((orphan) => orphan.kind)).toStrictEqual([
      "planless_staging",
    ]);
    expect(snapshot.counts.lifecycleStagingAggregate).toBe(4);
    expect(snapshot.counts.lifecycleStagingMaximumPerCoordinator).toBe(4);
  });

  it("never calls staging planless once a staged participant published its final journal", async () => {
    const home = await newHome();
    const participant = transactionId(2n);
    await mkdir(home, `staging/lifecycle/${UNINSTALL.id}`);
    await mkdir(home, `staging/lifecycle/${UNINSTALL.id}/foundation`);
    await mkdir(home, `staging/lifecycle/${UNINSTALL.id}/foundation/${participant}`);
    await write(
      home,
      `staging/lifecycle/${UNINSTALL.id}/foundation/${participant}/journal.json`,
      encodeFoundationJournalJsonV1(foundationJournal(participant, "planned")),
    );
    await plantFoundationJournal(home, participant);

    const snapshot = await inspect(home);

    expect(snapshot.coordinatorOrphans).toStrictEqual([]);
    expect(reasons(snapshot)).toContain("lifecycle_staging_participant_journal");
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses an unknown sibling beside a staged participant journal", async () => {
    const home = await newHome();
    const participant = transactionId(2n);
    await mkdir(home, `staging/lifecycle/${UNINSTALL.id}`);
    await mkdir(home, `staging/lifecycle/${UNINSTALL.id}/foundation`);
    await mkdir(home, `staging/lifecycle/${UNINSTALL.id}/foundation/${participant}`);
    await write(
      home,
      `staging/lifecycle/${UNINSTALL.id}/foundation/${participant}/journal.json`,
      encodeFoundationJournalJsonV1(foundationJournal(participant, "planned")),
    );
    await write(home, `staging/lifecycle/${UNINSTALL.id}/foundation/${participant}/notes.json`, "{}\n");

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toContain("lifecycle_staging_name");
  });

  it.each(["git", "launchd-process"] as const)(
    "refuses a %s staging child while plan 1a supplies no effect codec",
    async (child) => {
      const home = await newHome();
      await mkdir(home, `staging/lifecycle/${UNINSTALL.id}`);
      await mkdir(home, `staging/lifecycle/${UNINSTALL.id}/${child}`);

      const snapshot = await inspect(home);

      expect(reasons(snapshot)).toContain("lifecycle_staging_effect_unsupported");
      expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
    },
  );
});

describe("the effect journal roots", () => {
  const GIT = syntheticCoordinator("git_sync/new_network", 1n);
  const LAUNCHD = syntheticCoordinator("automation_reconcile/live_only", 6n);

  function effectCodec(): LifecycleEffectLedgerCodecV1 {
    return effectLedgerCodec();
  }

  async function plantGitEffect(home: HomeV1): Promise<void> {
    const ref = GIT.plan.participants.sourceGitEffect;
    if (ref === null) throw new Error("fixture lost its source Git effect");
    await write(
      home,
      `state/git-effect-journals/${ref.id}.plan.json`,
      encodeCanonicalJson({ marker: "source-git" }),
    );
  }

  async function plantLaunchdEffect(home: HomeV1): Promise<void> {
    const ref = LAUNCHD.plan.participants.launchdAfterFiles;
    if (ref === null) throw new Error("fixture lost its after-files effect");
    await write(
      home,
      `state/launchd-effect-journals/${ref.id}.plan.json`,
      encodeCanonicalJson({ marker: "after-files" }),
    );
  }

  it("refuses any Git-effect leaf while its codec is null", async () => {
    const home = await newHome();
    await plantGitEffect(home);

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_effect_root_unsupported"]);
    expect(snapshot.counts.gitEffectJournals).toBe(1);
  });

  it("refuses any launchd-effect leaf while its codec is null", async () => {
    const home = await newHome();
    await plantLaunchdEffect(home);

    const snapshot = await inspect(home);

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_effect_root_unsupported"]);
    expect(snapshot.counts.launchdEffectJournals).toBe(1);
  });

  it("validates the same leaves against their plans once effect codecs are supplied", async () => {
    const home = await newHome();
    const cursor = GIT.steps.findIndex((step) => step.kind === "source_git_effect");
    await plantCoordinator(
      home,
      GIT,
      journalFor(GIT, { phase: "external_applying", nextStep: cursor }),
    );
    await plantGitEffect(home);
    await plantCoordinator(
      home,
      LAUNCHD,
      journalFor(LAUNCHD, { phase: "external_applying", nextStep: 0 }),
    );
    await plantLaunchdEffect(home);

    const snapshot = await inspect(home, {
      gitEffectPlanCodec: effectCodec(),
      launchdEffectPlanCodec: effectCodec(),
    });

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.counts.gitEffectJournals).toBe(1);
    expect(snapshot.counts.launchdEffectJournals).toBe(1);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses an effect plan whose journal is absent behind the coordinator cursor", async () => {
    const home = await newHome();
    const cursor = GIT.steps.findIndex((step) => step.kind === "source_git_effect");
    await plantCoordinator(
      home,
      GIT,
      journalFor(GIT, { phase: "external_applying", nextStep: cursor + 1 }),
    );
    await plantGitEffect(home);

    const snapshot = await inspect(home, { gitEffectPlanCodec: effectCodec() });

    expect(reasons(snapshot)).toContain("lifecycle_effect_journal_missing");
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses an unreferenced effect journal once its codec is supplied", async () => {
    const ref = GIT.plan.participants.sourceGitEffect;
    if (ref === null) throw new Error("fixture lost its source Git effect");
    const home = await newHome();
    await write(home, `state/git-effect-journals/${ref.id}.json`, "{}\n");

    const snapshot = await inspect(home, { gitEffectPlanCodec: effectCodec() });

    expect(reasons(snapshot)).toStrictEqual(["lifecycle_effect_unreferenced"]);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses an unreferenced effect plan once its codec is supplied", async () => {
    const home = await newHome();
    await plantGitEffect(home);

    const snapshot = await inspect(home, { gitEffectPlanCodec: effectCodec() });

    expect(reasons(snapshot)).toContain("lifecycle_effect_unreferenced");
  });
});

describe("the standalone Foundation inventory", () => {
  it("collects a terminal standalone Foundation journal", async () => {
    const home = await newHome();
    const id = transactionId(2n);
    await plantFoundationJournal(home, id);

    const snapshot = await inspect(home);

    expect(snapshot.standaloneTerminalFoundation.length).toBeGreaterThan(0);
    expect(snapshot.standaloneTerminalFoundation).toStrictEqual([
      { transactionId: id, terminalPhase: "finalized", mutationCount: 1 },
    ]);
    expect(snapshot.closure).toStrictEqual({ kind: "clear" });
  });

  it("refuses a non-terminal standalone Foundation journal", async () => {
    const home = await newHome();
    const id = transactionId(2n);
    await plantFoundationJournal(home, id, "applied");

    const snapshot = await inspect(home);

    expect(snapshot.standaloneNonTerminalFoundation).toStrictEqual([{ id, phase: "applied" }]);
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("does not call a Foundation journal standalone while a non-terminal coordinator references it", async () => {
    const home = await uninstallAtArtifacts({ leasePathsRemoved: 4 });

    const snapshot = await inspect(home);

    expect(snapshot.standaloneTerminalFoundation).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "uninstall_draining", transactionId: UNINSTALL.id });
  });
});

/**
 * A8's injected enumerator: it streams synthetic names one entry at a time and
 * answers `lstat` from the name alone, so the production counting path reaches a
 * ceiling without a million real files.
 */
function syntheticCounter(
  target: "coordinator_root" | "staging_aggregate" | "staging_per_coordinator",
  leaves: number,
): { readonly fs: LifecycleGuardedFileSystemV1; readonly residue: LifecycleBookkeepingResidueV1 } {
  const retainedPaths = new Set<string>();
  const directory = (candidate: CanonicalAbsolutePathV1): LifecycleGuardedEntryV1 => ({
    path: candidate,
    kind: "directory",
    ownerUid: UID,
    mode: 0o700,
    nlink: 2,
    size: parseUInt64Decimal("0"),
    dev: parseUInt64Decimal("1"),
    ino: parseUInt64Decimal("2"),
  });
  const regular = (candidate: CanonicalAbsolutePathV1, size: number): LifecycleGuardedEntryV1 => ({
    path: candidate,
    kind: "regular_file",
    ownerUid: UID,
    mode: 0o600,
    nlink: 1,
    size: parseUInt64Decimal(size.toString(10)),
    dev: parseUInt64Decimal("1"),
    ino: parseUInt64Decimal("3"),
  });

  const nonceBytes = encoder.encode(`${NONCE}\n`);
  const allocatorBytes = encoder.encode(
    encodeLifecycleIdAllocator({
      schemaVersion: 1,
      installNonce: NONCE,
      nextCounter: parseUInt64Decimal("100"),
    }),
  );
  const noncePath = `${ROOTS.stateDirectory}/lifecycle-install-nonce`;
  const allocatorPath = `${ROOTS.stateDirectory}/lifecycle-id-allocator.json`;

  const tombstone = (ordinal: number): string =>
    `.developer-os-retained.bp_123e4567-e89b-42d3-a456-426614174000.${ordinal.toString(10)}.tombstone`;
  const stagingCoordinator = `${ROOTS.lifecycleStaging}/${coordinatorId(1n)}`;
  const stagingFoundation = `${stagingCoordinator}/foundation`;

  if (target === "coordinator_root") {
    for (let ordinal = 0; ordinal < leaves; ordinal += 1) {
      retainedPaths.add(`${ROOTS.coordinatorJournals}/${tombstone(ordinal)}`);
    }
  }

  const directories = new Set<string>([
    ROOTS.stateDirectory,
    ROOTS.foundationJournals,
    ROOTS.coordinatorJournals,
    ROOTS.gitEffectJournals,
    ROOTS.launchdEffectJournals,
    ROOTS.foundationStaging,
    ROOTS.foundationBackups,
    ROOTS.lifecycleStaging,
  ]);
  if (target === "staging_per_coordinator") {
    directories.add(stagingCoordinator);
    directories.add(stagingFoundation);
  }

  const refuse = (method: string): never => {
    throw new Error(`the ledger inventory is read-only: ${method}`);
  };

  async function* names(entry: LifecycleGuardedEntryV1): AsyncGenerator<string> {
    if (target === "coordinator_root" && entry.path === ROOTS.coordinatorJournals) {
      for (let ordinal = 0; ordinal < leaves; ordinal += 1) yield await Promise.resolve(tombstone(ordinal));
      return;
    }
    if (target === "staging_aggregate" && entry.path === ROOTS.lifecycleStaging) {
      for (let ordinal = 0; ordinal < leaves; ordinal += 1) {
        yield await Promise.resolve(formatAllocatedLifecycleId("lc", NONCE, BigInt(ordinal)));
      }
      return;
    }
    if (target === "staging_per_coordinator") {
      if (entry.path === ROOTS.lifecycleStaging) {
        yield await Promise.resolve(coordinatorId(1n));
        return;
      }
      if (entry.path === stagingCoordinator) {
        yield await Promise.resolve("foundation");
        return;
      }
      if (entry.path === stagingFoundation) {
        for (let ordinal = 0; ordinal < leaves - 2; ordinal += 1) {
          yield await Promise.resolve(formatAllocatedLifecycleId("tx", NONCE, BigInt(ordinal)));
        }
        return;
      }
    }
  }

  const fs: LifecycleGuardedFileSystemV1 = {
    lstat: (candidate) => {
      if (candidate === noncePath) return Promise.resolve(regular(candidate, nonceBytes.byteLength));
      if (candidate === allocatorPath) {
        return Promise.resolve(regular(candidate, allocatorBytes.byteLength));
      }
      if (directories.has(candidate)) return Promise.resolve(directory(candidate));
      if (retainedPaths.has(candidate)) return Promise.resolve(regular(candidate, 0));
      if (target === "staging_aggregate" && candidate.startsWith(`${ROOTS.lifecycleStaging}/`)) {
        return Promise.resolve(directory(candidate));
      }
      if (target === "staging_per_coordinator" && candidate.startsWith(`${stagingFoundation}/`)) {
        return Promise.resolve(directory(candidate));
      }
      return Promise.resolve(null);
    },
    readRegular: (entry) =>
      Promise.resolve(
        entry.path === noncePath ? nonceBytes : entry.path === allocatorPath ? allocatorBytes : new Uint8Array(0),
      ),
    hashRegular: () => Promise.resolve(hash("0")),
    names: (entry) => names(entry),
    writeExclusive: () => refuse("writeExclusive"),
    mkdirExclusive: () => refuse("mkdirExclusive"),
    renameOver: () => refuse("renameOver"),
    renameNoReplace: () => refuse("renameNoReplace"),
    unlinkExact: () => refuse("unlinkExact"),
    rmdirExactEmpty: () => refuse("rmdirExactEmpty"),
    syncDirectory: () => refuse("syncDirectory"),
  };
  return { fs, residue: { retainedPaths, bootstrapParticipantIds: new Set() } };
}

describe("the ledger bounds", () => {
  const home: HomeV1 = { fs: createInMemoryLifecycleGuardedFileSystem({ effectiveUid: UID, root: HOME }), roots: ROOTS };

  it.each([
    [10_000, false],
    [10_001, true],
  ])(
    "counts %i coordinator-root leaves through the production path (exceeded %s)",
    async (leaves, exceeded) => {
      const fixture = syntheticCounter("coordinator_root", leaves);

      const snapshot = await inspect(home, { fs: fixture.fs, residue: fixture.residue });

      expect(snapshot.counts.coordinatorJournals).toBe(exceeded ? leaves : 10_000);
      expect(reasons(snapshot).includes("ledger_capacity_exceeded")).toBe(exceeded);
    },
    120_000,
  );

  it.each([
    [1_000_000, false],
    [1_000_001, true],
  ])(
    "counts %i aggregate lifecycle-staging leaves through the production path (exceeded %s)",
    async (leaves, exceeded) => {
      const fixture = syntheticCounter("staging_aggregate", leaves);

      const snapshot = await inspect(home, { fs: fixture.fs, residue: fixture.residue });

      expect(reasons(snapshot).includes("ledger_capacity_exceeded")).toBe(exceeded);
      expect(snapshot.counts.lifecycleStagingAggregate).toBeGreaterThan(0);
    },
    600_000,
  );

  it.each([
    [1_000_000, false],
    [1_000_001, true],
  ])(
    "counts %i per-coordinator lifecycle-staging leaves through the production path (exceeded %s)",
    async (leaves, exceeded) => {
      const fixture = syntheticCounter("staging_per_coordinator", leaves);

      const snapshot = await inspect(home, { fs: fixture.fs, residue: fixture.residue });

      expect(reasons(snapshot).includes("ledger_capacity_exceeded")).toBe(exceeded);
      /** The aggregate ceiling always trips first, so the per-coordinator counter stops at it. */
      expect(snapshot.counts.lifecycleStagingMaximumPerCoordinator).toBe(1_000_000);
    },
    600_000,
  );
});

describe("the effect journal hookup", () => {
  const LOCAL = syntheticCoordinator("git_sync/new_local", 1n);
  const LIVE = syntheticCoordinator("automation_reconcile/live_only", 6n);
  const BOOTSTRAP_CHILDREN = ["tmp", "tmp/bootstrap-plist"] as const;

  type EffectKindV1 = "git" | "launchd";
  type EffectRefV1 = LifecycleEffectRefV1<GitEffectIdV1> | LifecycleEffectRefV1<LaunchdEffectIdV1>;

  function refOf<T>(ref: T | null, label: string): T {
    if (ref === null) throw new Error(`fixture lost its ${label}`);
    return ref;
  }

  const SOURCE = refOf(LOCAL.plan.participants.sourceGitEffect, "source Git effect");
  const DESTINATION = refOf(LOCAL.plan.participants.destinationGitEffect, "destination Git effect");
  const AFTER_FILES = refOf(LIVE.plan.participants.launchdAfterFiles, "after-files effect");
  const MARKERS = new Map<string, string>([
    [SOURCE.id, "source-git"],
    [DESTINATION.id, "destination-git"],
    [AFTER_FILES.id, "after-files"],
  ]);
  const OWNERS = new Map<string, LifecycleCoordinatorIdV1>([
    [SOURCE.id, LOCAL.id],
    [DESTINATION.id, LOCAL.id],
    [AFTER_FILES.id, LIVE.id],
  ]);

  function effectJournalText(
    ref: EffectRefV1,
    phase: string,
    overrides: {
      readonly id?: string;
      readonly coordinatorId?: string;
      readonly planHash?: string;
      readonly pad?: string;
    } = {},
  ): string {
    return encodeCanonicalJson({
      coordinatorId: overrides.coordinatorId ?? OWNERS.get(ref.id) ?? null,
      id: overrides.id ?? ref.id,
      phase,
      planHash: overrides.planHash ?? ref.planHash,
      ...(overrides.pad === undefined ? {} : { pad: overrides.pad }),
    });
  }

  async function plantEffect(
    home: HomeV1,
    kind: EffectKindV1,
    ref: EffectRefV1,
    journal: string | null,
  ): Promise<void> {
    const marker = MARKERS.get(ref.id);
    if (marker === undefined) throw new Error("fixture has no marker for that effect");
    await write(home, `state/${kind}-effect-journals/${ref.id}.plan.json`, encodeCanonicalJson({ marker }));
    if (journal !== null) await write(home, `state/${kind}-effect-journals/${ref.id}.json`, journal);
  }

  /** `git_sync/new_local` finalized: its one forward participant and both Git effects are terminal. */
  async function terminalLocalSync(
    phases: { readonly source?: string; readonly destination?: string } = {},
  ): Promise<HomeV1> {
    const home = await newHome();
    await plantCoordinator(home, LOCAL);
    expect(LOCAL.forwardIds.length).toBeGreaterThan(0);
    for (const id of LOCAL.forwardIds) await plantFoundationJournal(home, id);
    await plantEffect(home, "git", SOURCE, effectJournalText(SOURCE, phases.source ?? "finalized"));
    await plantEffect(home, "git", DESTINATION, effectJournalText(DESTINATION, phases.destination ?? "finalized"));
    return home;
  }

  /** `git_sync/new_local` with its cursor on `S`, the source effect plan published and no effect journal yet. */
  async function localSyncAtSource(): Promise<HomeV1> {
    const home = await newHome();
    const cursor = LOCAL.steps.findIndex((step) => step.kind === "source_git_effect");
    await plantCoordinator(home, LOCAL, journalFor(LOCAL, { phase: "external_applying", nextStep: cursor }));
    await plantEffect(home, "git", SOURCE, null);
    return home;
  }

  /** `automation_reconcile/live_only` with its cursor on `Q` and the after-files journal in `phase`. */
  async function liveOnlyAtAfterFiles(phase: string | null): Promise<HomeV1> {
    const home = await newHome();
    await plantCoordinator(home, LIVE, journalFor(LIVE, { phase: "external_applying", nextStep: 0 }));
    await plantEffect(home, "launchd", AFTER_FILES, phase === null ? null : effectJournalText(AFTER_FILES, phase));
    return home;
  }

  /** Creates every missing ancestor directory of `relative`, then `relative` itself as a directory or file. */
  async function plantStaging(home: HomeV1, relative: string, leaf: "directory" | "file" = "directory"): Promise<void> {
    const segments = relative.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      const ancestor = segments.slice(0, depth).join("/");
      if ((await home.fs.lstat(path(`${HOME}/${ancestor}`))) === null) await mkdir(home, ancestor);
    }
    if (leaf === "directory") await mkdir(home, relative);
    else await write(home, relative, "staged\n");
  }

  function withEntry(
    fs: LifecycleGuardedFileSystemV1,
    target: string,
    patch: Partial<LifecycleGuardedEntryV1>,
  ): LifecycleGuardedFileSystemV1 {
    return {
      ...fs,
      lstat: async (candidate) => {
        const entry = await fs.lstat(candidate);
        return entry !== null && candidate === target ? { ...entry, ...patch } : entry;
      },
    };
  }

  describe("terminal classification", () => {
    it.each(["finalized", "rolled_back"])("classifies a %s Git effect journal as terminal and the closure clear", async (phase) => {
      const home = await terminalLocalSync({ source: phase, destination: phase });

      const snapshot = await inspect(home, { gitEffectPlanCodec: effectLedgerCodec() });

      expect(snapshot.findings).toStrictEqual([]);
      expect(snapshot.counts.gitEffectJournals).toBe(4);
      expect(snapshot.closure).toStrictEqual({ kind: "clear" });
    });

    it.each(["planned", "applied", "verified", "compensating"])(
      "keeps closure non-clear while a terminal coordinator's effect journal is %s",
      async (phase) => {
        const home = await terminalLocalSync({ destination: phase });

        const snapshot = await inspect(home, { gitEffectPlanCodec: effectLedgerCodec() });

        expect(snapshot.findings).toStrictEqual([]);
        expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
      },
    );

    it("keeps a non-terminal launchd effect journal non-clear beside an active coordinator", async () => {
      const home = await liveOnlyAtAfterFiles("applied");

      const snapshot = await inspect(home, { launchdEffectPlanCodec: effectLedgerCodec() });

      expect(snapshot.findings).toStrictEqual([]);
      expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
    });

    it("keeps refusing effect roots when the codec is null (no widening before Task 14)", async () => {
      const home = await terminalLocalSync();

      const snapshot = await inspect(home, { gitEffectPlanCodec: null });

      expect(reasons(snapshot)).toContain("lifecycle_effect_root_unsupported");
      expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
    });

    it("refuses a journal whose embedded ID names the other effect", async () => {
      const home = await newHome();
      await plantCoordinator(home, LOCAL);
      for (const id of LOCAL.forwardIds) await plantFoundationJournal(home, id);
      await plantEffect(home, "git", SOURCE, effectJournalText(SOURCE, "finalized", { id: DESTINATION.id }));
      await plantEffect(home, "git", DESTINATION, effectJournalText(DESTINATION, "finalized"));

      const snapshot = await inspect(home, { gitEffectPlanCodec: effectLedgerCodec() });

      expect(reasons(snapshot)).toStrictEqual(["lifecycle_effect_journal_identity"]);
      expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
    });

    it("refuses a journal that names another coordinator", async () => {
      const home = await newHome();
      await plantCoordinator(home, LOCAL);
      for (const id of LOCAL.forwardIds) await plantFoundationJournal(home, id);
      await plantEffect(home, "git", SOURCE, effectJournalText(SOURCE, "finalized", { coordinatorId: LIVE.id }));
      await plantEffect(home, "git", DESTINATION, effectJournalText(DESTINATION, "finalized"));

      const snapshot = await inspect(home, { gitEffectPlanCodec: effectLedgerCodec() });

      expect(reasons(snapshot)).toStrictEqual(["lifecycle_effect_journal_identity"]);
      expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
    });

    it("refuses a journal bound to another plan hash", async () => {
      const home = await newHome();
      await plantCoordinator(home, LOCAL);
      for (const id of LOCAL.forwardIds) await plantFoundationJournal(home, id);
      await plantEffect(home, "git", SOURCE, effectJournalText(SOURCE, "finalized", { planHash: DESTINATION.planHash }));
      await plantEffect(home, "git", DESTINATION, effectJournalText(DESTINATION, "finalized"));

      const snapshot = await inspect(home, { gitEffectPlanCodec: effectLedgerCodec() });

      expect(reasons(snapshot)).toStrictEqual(["lifecycle_effect_plan_hash"]);
      expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
    });

    it.each([
      ["non-canonical", (text: string) => ` ${text}`],
      ["codec-rejected", () => encodeCanonicalJson({ id: SOURCE.id, planHash: SOURCE.planHash })],
      ["non-JSON", () => "journal\n"],
    ])("refuses a %s effect journal", async (_label, mutate) => {
      const home = await newHome();
      await plantCoordinator(home, LOCAL);
      for (const id of LOCAL.forwardIds) await plantFoundationJournal(home, id);
      await plantEffect(home, "git", SOURCE, mutate(effectJournalText(SOURCE, "finalized")));
      await plantEffect(home, "git", DESTINATION, effectJournalText(DESTINATION, "finalized"));

      const snapshot = await inspect(home, { gitEffectPlanCodec: effectLedgerCodec() });

      expect(reasons(snapshot)).toStrictEqual(["lifecycle_effect_journal_bytes"]);
      expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
    });
  });

  describe("journal size ceilings", () => {
    /** Pads a canonical journal to exactly `size` bytes; the pad is ASCII, one byte per character. */
    function journalOfSize(ref: EffectRefV1, size: number): string {
      const base = effectJournalText(ref, "finalized", { pad: "" }).length;
      return effectJournalText(ref, "finalized", { pad: "a".repeat(size - base) });
    }

    it.each([
      ["git", 16_777_216, false],
      ["git", 16_777_217, true],
      ["launchd", 1_048_576, false],
      ["launchd", 1_048_577, true],
    ] as const)("judges a %s effect journal of %i bytes (over the cap: %s)", async (kind, size, over) => {
      const home = await newHome();
      const codec = effectLedgerCodec();
      if (kind === "git") {
        await plantCoordinator(home, LOCAL);
        for (const id of LOCAL.forwardIds) await plantFoundationJournal(home, id);
        await plantEffect(home, "git", SOURCE, journalOfSize(SOURCE, size));
        await plantEffect(home, "git", DESTINATION, effectJournalText(DESTINATION, "finalized"));
      } else {
        await plantCoordinator(home, LIVE);
        await plantEffect(home, "launchd", AFTER_FILES, journalOfSize(AFTER_FILES, size));
      }

      const snapshot = await inspect(
        home,
        kind === "git" ? { gitEffectPlanCodec: codec } : { launchdEffectPlanCodec: codec },
      );

      expect(reasons(snapshot)).toStrictEqual(over ? ["lifecycle_effect_journal_shape"] : []);
      expect(snapshot.closure.kind).toBe(over ? "lifecycle_recovery_required" : "clear");
    }, 120_000);
  });

  describe("the Git staging grammar", () => {
    const CHILDREN = ["post", "post/0", "before"] as const;
    const SOURCE_STAGING = `staging/lifecycle/${LOCAL.id}/git/source/${SOURCE.id}`;

    it("admits exact git/<side>/<ge-id> directories and the children its effect plan owns", async () => {
      const home = await localSyncAtSource();
      await plantStaging(home, `${SOURCE_STAGING}/post`);
      await plantStaging(home, `${SOURCE_STAGING}/post/0`, "file");
      await plantStaging(home, `${SOURCE_STAGING}/before`);
      await plantStaging(home, `staging/lifecycle/${LOCAL.id}/git/destination/${DESTINATION.id}`);

      const snapshot = await inspect(home, { gitEffectPlanCodec: effectLedgerCodec(CHILDREN) });

      expect(snapshot.findings).toStrictEqual([]);
      /** The coordinator directory, `git`, both sides, both ID directories, `post`, `post/0` and `before`. */
      expect(snapshot.counts.lifecycleStagingMaximumPerCoordinator).toBe(9);
    });

    it.each([
      `${SOURCE_STAGING}/extra`,
      `${SOURCE_STAGING}/post/1`,
      `staging/lifecycle/${LOCAL.id}/git/sideways`,
      `staging/lifecycle/${LOCAL.id}/git/source/${DESTINATION.id}`,
      `staging/lifecycle/${LOCAL.id}/git/destination/${SOURCE.id}`,
      `staging/lifecycle/${LOCAL.id}/git/source/${formatAllocatedLifecycleId("ge", NONCE, 9n)}`,
      `staging/lifecycle/${LOCAL.id}/git/source/${formatAllocatedLifecycleId("le", NONCE, 3n)}`,
      `staging/lifecycle/${LOCAL.id}/launchd-process/home`,
      `staging/lifecycle/${LOCAL.id}/launchd-process/tmp`,
    ])("refuses staging entry %s outside the closed grammar", async (entry) => {
      const home = await localSyncAtSource();
      await plantStaging(home, entry);

      const snapshot = await inspect(home, {
        gitEffectPlanCodec: effectLedgerCodec(CHILDREN),
        launchdEffectPlanCodec: effectLedgerCodec(BOOTSTRAP_CHILDREN),
      });

      expect(snapshot.findings).toStrictEqual([
        { reason: "lifecycle_staging_name", path: path(`${HOME}/${entry}`) },
      ]);
      expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
    });

    it.each([
      ["a symlink", { kind: "symlink" }],
      ["a special file", { kind: "other" }],
      ["a foreign owner", { ownerUid: UID + 1 }],
    ] as const)("refuses an owned child that is %s", async (_label, patch) => {
      const home = await localSyncAtSource();
      await plantStaging(home, `${SOURCE_STAGING}/post`);
      const target = `${HOME}/${SOURCE_STAGING}/post`;

      const snapshot = await inspect(home, {
        fs: withEntry(home.fs, target, patch),
        gitEffectPlanCodec: effectLedgerCodec(CHILDREN),
      });

      expect(snapshot.findings).toStrictEqual([{ reason: "lifecycle_staging_shape", path: path(target) }]);
    });

    it("refuses an effect ID directory that is not a 0700 directory", async () => {
      const home = await localSyncAtSource();
      await plantStaging(home, SOURCE_STAGING);
      const target = `${HOME}/${SOURCE_STAGING}`;

      const snapshot = await inspect(home, {
        fs: withEntry(home.fs, target, { mode: 0o755 }),
        gitEffectPlanCodec: effectLedgerCodec(CHILDREN),
      });

      expect(snapshot.findings).toStrictEqual([{ reason: "lifecycle_staging_shape", path: path(target) }]);
    });

    it("refuses a malformed stagingChildren answer and admits nothing below the ID", async () => {
      const home = await localSyncAtSource();
      await plantStaging(home, `${SOURCE_STAGING}/post`);

      const snapshot = await inspect(home, { gitEffectPlanCodec: effectLedgerCodec(["post/0"]) });

      expect(reasons(snapshot)).toStrictEqual(["lifecycle_effect_staging_children", "lifecycle_staging_name"]);
    });

    it("keeps an empty planless git/<side>/<ge-id> tree a planless_staging orphan", async () => {
      const home = await newHome();
      await plantStaging(home, `staging/lifecycle/${LOCAL.id}/git/source/${SOURCE.id}`);

      const snapshot = await inspect(home, { gitEffectPlanCodec: effectLedgerCodec(CHILDREN) });

      expect(snapshot.findings).toStrictEqual([]);
      expect(snapshot.coordinatorOrphans.map((orphan) => orphan.kind)).toStrictEqual(["planless_staging"]);
    });

    it("refuses anything below a planless effect ID directory", async () => {
      const home = await newHome();
      const entry = `staging/lifecycle/${LOCAL.id}/git/source/${SOURCE.id}/post`;
      await plantStaging(home, entry);

      const snapshot = await inspect(home, { gitEffectPlanCodec: effectLedgerCodec(CHILDREN) });

      expect(snapshot.findings).toStrictEqual([{ reason: "lifecycle_staging_name", path: path(`${HOME}/${entry}`) }]);
    });
  });

  describe("the launchd-process staging grammar", () => {
    const PROCESS = `staging/lifecycle/${LIVE.id}/launchd-process`;
    const SNAPSHOT = `${PROCESS}/tmp/bootstrap-plist`;

    it.each([[["home", "tmp"]], [["tmp"]], [["home"]], [[]]] as const)(
      "admits exact empty 0700 children %j, the creation and child-first removal states",
      async (children) => {
        const home = await liveOnlyAtAfterFiles(null);
        await plantStaging(home, PROCESS);
        for (const child of children) await plantStaging(home, `${PROCESS}/${child}`);

        const snapshot = await inspect(home, { launchdEffectPlanCodec: effectLedgerCodec(BOOTSTRAP_CHILDREN) });

        expect(snapshot.findings).toStrictEqual([]);
        expect(snapshot.counts.lifecycleStagingMaximumPerCoordinator).toBe(2 + children.length);
      },
    );

    it.each([`${PROCESS}/home/child`, `${PROCESS}/other`, `${PROCESS}/tmp/bootstrap-plist.tmp`, `${PROCESS}/tmp/other`])(
      "refuses staging entry %s outside the closed grammar",
      async (entry) => {
        const home = await liveOnlyAtAfterFiles("applied");
        await plantStaging(home, entry);

        const snapshot = await inspect(home, { launchdEffectPlanCodec: effectLedgerCodec(BOOTSTRAP_CHILDREN) });

        expect(snapshot.findings).toStrictEqual([
          { reason: "lifecycle_staging_name", path: path(`${HOME}/${entry}`) },
        ]);
        expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
      },
    );

    it.each(["home", "tmp"])("refuses a %s child that is not a 0700 directory", async (child) => {
      const home = await liveOnlyAtAfterFiles(null);
      await plantStaging(home, `${PROCESS}/${child}`);
      const target = `${HOME}/${PROCESS}/${child}`;

      const snapshot = await inspect(home, {
        fs: withEntry(home.fs, target, { mode: 0o755 }),
        launchdEffectPlanCodec: effectLedgerCodec(BOOTSTRAP_CHILDREN),
      });

      expect(snapshot.findings).toStrictEqual([{ reason: "lifecycle_staging_shape", path: path(target) }]);
    });

    it("admits the one bootstrap snapshot prefix while its effect journal is at a non-terminal frontier", async () => {
      const home = await liveOnlyAtAfterFiles("applied");
      await plantStaging(home, `${PROCESS}/home`);
      await plantStaging(home, SNAPSHOT, "file");

      const snapshot = await inspect(home, { launchdEffectPlanCodec: effectLedgerCodec(BOOTSTRAP_CHILDREN) });

      expect(snapshot.findings).toStrictEqual([]);
    });

    it.each([
      ["no effect journal exists", null, BOOTSTRAP_CHILDREN],
      ["the effect journal is finalized", "finalized", BOOTSTRAP_CHILDREN],
      ["the effect journal is rolled back", "rolled_back", BOOTSTRAP_CHILDREN],
      ["the effect plan owns no snapshot", "applied", ["tmp"]],
    ] as const)("refuses the bootstrap snapshot when %s", async (_label, phase, children) => {
      const home = await liveOnlyAtAfterFiles(phase);
      await plantStaging(home, SNAPSHOT, "file");

      const snapshot = await inspect(home, { launchdEffectPlanCodec: effectLedgerCodec(children) });

      expect(snapshot.findings).toStrictEqual([
        { reason: "lifecycle_staging_name", path: path(`${HOME}/${SNAPSHOT}`) },
      ]);
    });

    it("refuses a bootstrap snapshot planted in home", async () => {
      const home = await liveOnlyAtAfterFiles("applied");
      const entry = `${PROCESS}/home/bootstrap-plist`;
      await plantStaging(home, entry, "file");

      const snapshot = await inspect(home, { launchdEffectPlanCodec: effectLedgerCodec(BOOTSTRAP_CHILDREN) });

      expect(snapshot.findings).toStrictEqual([{ reason: "lifecycle_staging_name", path: path(`${HOME}/${entry}`) }]);
    });

    it.each([
      ["over 1 MiB", { size: parseUInt64Decimal("1048577") }],
      ["not mode 0600", { mode: 0o644 }],
      ["hard-linked", { nlink: 2 }],
      ["a directory", { kind: "directory" }],
    ] as const)("refuses a bootstrap snapshot that is %s", async (_label, patch) => {
      const home = await liveOnlyAtAfterFiles("applied");
      await plantStaging(home, SNAPSHOT, "file");
      const target = `${HOME}/${SNAPSHOT}`;

      const snapshot = await inspect(home, {
        fs: withEntry(home.fs, target, patch),
        launchdEffectPlanCodec: effectLedgerCodec(BOOTSTRAP_CHILDREN),
      });

      expect(snapshot.findings).toStrictEqual([{ reason: "lifecycle_staging_shape", path: path(target) }]);
    });
  });
});

describe("the retained rollback payload ID", () => {
  const OTHER_NONCE = parseLowerHexSha256("4e".repeat(32));

  async function withRollbackRecord(payloadId: unknown): Promise<HomeV1> {
    const home = await newHome();
    await write(home, "state/update-rollback.json", encodeCanonicalJson({ schemaVersion: 1, payloadId } as CanonicalJsonValue));
    return home;
  }

  it("treats the empty §6.4 reservation as no record", async () => {
    const home = await newHome();
    await write(home, "state/update-rollback.json", "");

    const snapshot = await inspect(home);

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "clear" });
  });

  it("admits an rb ID the allocator counter already covers", async () => {
    const snapshot = await inspect(await withRollbackRecord(formatAllocatedLifecycleId("rb", NONCE, 99n)));

    expect(snapshot.findings).toStrictEqual([]);
    expect(snapshot.closure).toStrictEqual({ kind: "clear" });
  });

  it.each([100n, 101n])("refuses an allocator that could reissue the retained rb counter %s", async (counter) => {
    const snapshot = await inspect(await withRollbackRecord(formatAllocatedLifecycleId("rb", NONCE, counter)));

    expect(reasons(snapshot)).toContain("lifecycle_allocator_counter_rewind");
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses an rb ID from another installation nonce", async () => {
    const snapshot = await inspect(await withRollbackRecord(formatAllocatedLifecycleId("rb", OTHER_NONCE, 1n)));

    expect(reasons(snapshot)).toContain("lifecycle_allocated_id_nonce");
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it.each([
    ["another prefix", formatAllocatedLifecycleId("oe", NONCE, 1n)],
    ["a non-canonical counter", `rb_${NONCE}_01`],
    ["no payload ID", null],
  ])("refuses a record whose payload ID is %s", async (_label, payloadId) => {
    const snapshot = await inspect(await withRollbackRecord(payloadId));

    expect(reasons(snapshot)).toContain("lifecycle_rollback_record_bytes");
    expect(snapshot.closure).toStrictEqual({ kind: "lifecycle_recovery_required" });
  });

  it("refuses non-JSON record bytes", async () => {
    const home = await newHome();
    await write(home, "state/update-rollback.json", "{");

    expect(reasons(await inspect(home))).toContain("lifecycle_rollback_record_bytes");
  });
});
