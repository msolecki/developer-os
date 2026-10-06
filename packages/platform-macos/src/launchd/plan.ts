import {
  SCHEDULED_JOB_IDS,
  encodeCanonicalJson,
  hashBytes,
  hashCanonicalJson,
  parseCanonicalAbsolutePathText,
  parseFoundationTransactionId,
  parseLaunchdEffectId,
  parseLifecycleCoordinatorId,
  parseLowerHexSha256,
  parseUInt64Decimal,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonValue,
  type EffectiveUidV1,
  type FoundationTransactionIdV1,
  type LaunchdEffectIdV1,
  type LifecycleCoordinatorIdV1,
  type LifecycleCoordinatorPlanCoreV1,
  type LifecycleValueCodec,
  type LowerHexSha256,
  sortUtf8,
  type NormalizedScheduleV1,
} from "@developer-os/core";

import {
  launchdEffectPlanHash,
  maximumLaunchdEffectJournalBytes,
  parseLaunchdLiveState,
  type LaunchdEffectPlanV1,
  type LaunchdEffectPositionV1,
  type LaunchdEffectTransitionV1,
} from "./effect-journal.js";
import { LAUNCHD_GUI_DOMAIN_PATTERN } from "./fs-identity.js";
import { encodeLaunchdPlist, encodeRetainedLaunchdPlist, launchdPlistDictionary, launchdPriorStateFingerprint, MAX_LAUNCHD_PLIST_BYTES } from "./plist.js";
import {
  generatedLabel,
  launchdGeneration,
  launchdJob,
  launchdLogPath,
  launchdStatusPath,
  parseScheduledProductHome,
  scheduledBaseArgv,
} from "./registry.js";
import { assertNormalizedSchedule } from "./schedule.js";
import type { LaunchdBootstrapPlistIdentityV1 } from "./bootstrap.js";
import {
  LaunchdInputError,
  type LaunchdGuiDomainV1,
  type LaunchdPlanPreviewEntryV1,
  type LaunchdPlanPreviewV1,
  type LaunchdPlistDictionaryV1,
} from "./types.js";

export type LaunchdCoordinatorOperationV1 = "automation_enable" | "automation_reconcile" | "automation_disable" | "uninstall";

export type LaunchdPlanVariantV1 =
  | "automation_enable"
  | "automation_reconcile/files"
  | "automation_reconcile/live_only"
  | "automation_disable"
  | "uninstall/present_manifest";

/** Spec §5.3: a null participant is legal only for `automation_reconcile/live_only`. */
export type LifecycleFileBindingV1 = {
  readonly participantId: FoundationTransactionIdV1 | null;
  readonly targetPath: CanonicalAbsolutePathV1;
  readonly expectedBeforeHash: LowerHexSha256 | null;
  readonly afterHash: LowerHexSha256 | null;
};

export type LaunchdManifestFileStateV1 = { readonly state: "absent" } | { readonly state: "present"; readonly hash: LowerHexSha256 };

export type LaunchdManifestBindingV1 = {
  readonly path: CanonicalAbsolutePathV1;
  readonly statePlanHash: LowerHexSha256 | null;
  readonly before: LaunchdManifestFileStateV1;
  readonly after: LaunchdManifestFileStateV1;
};

export type LaunchdBootstrapPlistsV1 = {
  readonly before: LaunchdBootstrapPlistIdentityV1 | null;
  readonly after: LaunchdBootstrapPlistIdentityV1 | null;
};

export type LaunchdPlanEntryV1 = LaunchdPlanPreviewEntryV1 & { readonly bootstrapPlists: LaunchdBootstrapPlistsV1 };

export type LaunchdEffectBindingV1 = { readonly id: LaunchdEffectIdV1; readonly planHash: LowerHexSha256 };

export type LaunchdPlanV1 = {
  readonly schemaVersion: 1;
  readonly planHash: LowerHexSha256;
  readonly previewHash: LowerHexSha256 | null;
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly coordinatorOperation: LaunchdCoordinatorOperationV1;
  readonly processTableHash: LowerHexSha256;
  readonly config: LifecycleFileBindingV1;
  readonly activation: LifecycleFileBindingV1 | null;
  readonly plistFiles: readonly LifecycleFileBindingV1[];
  readonly manifest: LaunchdManifestBindingV1;
  readonly beforeFilesEffect: LaunchdEffectBindingV1 | null;
  readonly afterFilesEffect: LaunchdEffectBindingV1 | null;
  readonly entries: readonly LaunchdPlanEntryV1[];
};

/**
 * Everything `planLaunchdTransitions` binds. `bootstrapPlists` names, per job, the plist a
 * bootstrap may read: the postimage Foundation will publish (`after`) and the preimage its paired
 * inverse will restore (`before`), bound by content with no inode, or the retained inode for `keep`.
 */
export type LaunchdTransitionRequestV1 = {
  readonly coordinatorId: LifecycleCoordinatorIdV1;
  readonly coordinatorOperation: LaunchdCoordinatorOperationV1;
  readonly previewHash: LowerHexSha256 | null;
  readonly processTableHash: LowerHexSha256;
  readonly preview: LaunchdPlanPreviewV1;
  readonly config: LifecycleFileBindingV1;
  readonly activation: LifecycleFileBindingV1 | null;
  readonly plistFiles: readonly LifecycleFileBindingV1[];
  readonly manifest: LaunchdManifestBindingV1;
  readonly beforeFilesEffectId: LaunchdEffectIdV1 | null;
  readonly afterFilesEffectId: LaunchdEffectIdV1 | null;
  readonly bootstrapPlists: Readonly<Partial<Record<LaunchdPlanPreviewEntryV1["job"], LaunchdBootstrapPlistsV1>>>;
};

/** One entry's row of the exhaustive §5.3 file/live table: its `P` unload and its `Q` load. */
export type LaunchdEntryTransitionsV1 = {
  readonly unload: LaunchdEffectTransitionV1 | null;
  readonly load: LaunchdEffectTransitionV1 | null;
};

const PLAN_DOMAIN = "developer-os:launchd-plan:v1";
const UNLOADED = Object.freeze({ state: "unloaded" as const });
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Which position-tagged effects the §2.4 step grammar puts in each variant. */
const EFFECT_ARMS: Readonly<Record<LaunchdPlanVariantV1, { readonly before: boolean; readonly after: boolean }>> = {
  automation_enable: { before: false, after: true },
  "automation_reconcile/files": { before: true, after: true },
  "automation_reconcile/live_only": { before: false, after: true },
  automation_disable: { before: true, after: false },
  "uninstall/present_manifest": { before: true, after: false },
};

const ENTRY_KEYS = [
  "operation",
  "job",
  "baseLabel",
  "domain",
  "productHome",
  "schedule",
  "plistPath",
  "plistBytes",
  "executablePath",
  "baseArgv",
  "logPath",
  "statusPath",
  "generationProjection",
  "generation",
  "generatedLabel",
  "beforeFileHash",
  "beforeLiveState",
  "priorStateFingerprint",
  "bootstrapPlists",
] as const;

function refuse(message: string): never {
  throw new LaunchdInputError(message);
}

function canonical(value: unknown): CanonicalJsonValue {
  return value as CanonicalJsonValue;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return encodeCanonicalJson(canonical(left)) === encodeCanonicalJson(canonical(right));
}

function exactKeys(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) refuse(`${label}: not an object`);
  const present = Object.keys(value);
  if (present.length !== keys.length || !keys.every((key) => present.includes(key))) refuse(`${label}: keys`);
  return value as Record<string, unknown>;
}

function nullableHash(value: unknown): LowerHexSha256 | null {
  return value === null ? null : parseLowerHexSha256(value);
}

export function launchdPlistBytesHash(bytes: string): LowerHexSha256 {
  return parseLowerHexSha256(hashBytes(encoder.encode(bytes)));
}

function domainUid(domain: LaunchdGuiDomainV1): number {
  const match = LAUNCHD_GUI_DOMAIN_PATTERN.exec(domain);
  if (match === null) refuse("LaunchdGuiDomainV1");
  return Number(match[1]);
}

function unloadOf(entry: LaunchdPlanPreviewEntryV1): LaunchdEffectTransitionV1 | null {
  const live = entry.beforeLiveState;
  if (live.state === "unloaded") return null;
  if (entry.beforeFileHash === null) refuse(`${entry.job}: loaded without a retained plist`);
  return Object.freeze({
    job: entry.job,
    label: live.label,
    generation: live.generation,
    domain: entry.domain,
    plistPath: entry.plistPath,
    plistHash: entry.beforeFileHash,
    before: live,
    after: UNLOADED,
  });
}

function loadOf(entry: LaunchdPlanPreviewEntryV1): LaunchdEffectTransitionV1 {
  if (entry.plistBytes === null || entry.generation === null || entry.generatedLabel === null) refuse(`${entry.job}: no postimage`);
  return Object.freeze({
    job: entry.job,
    label: entry.generatedLabel,
    generation: entry.generation,
    domain: entry.domain,
    plistPath: entry.plistPath,
    plistHash: launchdPlistBytesHash(entry.plistBytes),
    before: UNLOADED,
    after: Object.freeze({ state: "loaded" as const, label: entry.generatedLabel, generation: entry.generation }),
  });
}

/**
 * Spec §5.3's exhaustive file/live table. Replace and remove unload only a loaded old generation;
 * install, replace and an unloaded keep load the new one; a keep already loaded at its postimage
 * needs nothing. Every other combination (a keep loaded at another generation, a loaded install)
 * is outside the row selected before intent and refuses.
 */
export function launchdEntryTransitions(entry: LaunchdPlanPreviewEntryV1): LaunchdEntryTransitionsV1 {
  const live = entry.beforeLiveState;
  switch (entry.operation) {
    case "install":
      if (entry.beforeFileHash !== null || live.state !== "unloaded") refuse(`${entry.job}: install over a retained or loaded job`);
      return { unload: null, load: loadOf(entry) };
    case "replace":
      if (entry.beforeFileHash === null) refuse(`${entry.job}: replace without a retained plist`);
      if (live.state === "loaded" && live.label === entry.generatedLabel) refuse(`${entry.job}: replace already loaded at its postimage`);
      return { unload: unloadOf(entry), load: loadOf(entry) };
    case "keep":
      if (entry.plistBytes === null || entry.beforeFileHash !== launchdPlistBytesHash(entry.plistBytes)) refuse(`${entry.job}: keep drifted`);
      if (live.state === "loaded") {
        if (live.label !== entry.generatedLabel) refuse(`${entry.job}: keep loaded at another generation`);
        return { unload: null, load: null };
      }
      return { unload: null, load: loadOf(entry) };
    case "remove":
      if (entry.beforeFileHash === null) refuse(`${entry.job}: remove without a retained plist`);
      return { unload: unloadOf(entry), load: null };
    default: {
      const unknown: never = entry.operation;
      return refuse(`unknown launchd operation ${String(unknown)}`);
    }
  }
}

function positionTransitions(entries: readonly LaunchdPlanPreviewEntryV1[], position: LaunchdEffectPositionV1): readonly LaunchdEffectTransitionV1[] {
  return entries.flatMap((entry) => {
    const { unload, load } = launchdEntryTransitions(entry);
    const transition = position === "before_files" ? unload : load;
    return transition === null ? [] : [transition];
  });
}

function buildEffectPlan(
  coordinatorId: LifecycleCoordinatorIdV1,
  id: LaunchdEffectIdV1,
  position: LaunchdEffectPositionV1,
  processTableHash: LowerHexSha256,
  transitions: readonly LaunchdEffectTransitionV1[],
): LaunchdEffectPlanV1 {
  const draft = { schemaVersion: 1 as const, id, coordinatorId, position, processTableHash, maximumJournalBytes: 0, transitions };
  return Object.freeze({ ...draft, maximumJournalBytes: maximumLaunchdEffectJournalBytes(draft) });
}

/** The immutable effect plan a position-tagged participant publishes, derived only from `plan`. */
export function launchdEffectPlan(plan: LaunchdPlanV1, position: LaunchdEffectPositionV1): LaunchdEffectPlanV1 | null {
  const binding = position === "before_files" ? plan.beforeFilesEffect : plan.afterFilesEffect;
  if (binding === null) return null;
  return buildEffectPlan(plan.coordinatorId, binding.id, position, plan.processTableHash, positionTransitions(plan.entries, position));
}

export function launchdPlanVariant(plan: Pick<LaunchdPlanV1, "coordinatorOperation" | "config">): LaunchdPlanVariantV1 {
  switch (plan.coordinatorOperation) {
    case "automation_reconcile":
      return plan.config.participantId === null ? "automation_reconcile/live_only" : "automation_reconcile/files";
    case "uninstall":
      return "uninstall/present_manifest";
    default:
      return plan.coordinatorOperation;
  }
}

/** SHA-256 over `developer-os:launchd-plan:v1\0` plus canonical JSON of every field except `planHash`. */
export function launchdPlanHash(plan: Omit<LaunchdPlanV1, "planHash">): LowerHexSha256 {
  const rest: Record<string, unknown> = { ...plan };
  delete rest.planHash;
  return hashCanonicalJson(PLAN_DOMAIN, canonical(rest));
}

function assertEntryOperations(variant: LaunchdPlanVariantV1, entries: readonly LaunchdPlanEntryV1[]): void {
  const allowed: Readonly<Record<LaunchdPlanVariantV1, readonly LaunchdPlanEntryV1["operation"][]>> = {
    automation_enable: ["install"],
    "automation_reconcile/files": ["install", "replace", "keep", "remove"],
    "automation_reconcile/live_only": ["keep"],
    automation_disable: ["remove"],
    "uninstall/present_manifest": ["remove"],
  };
  for (const entry of entries) {
    if (!allowed[variant].includes(entry.operation)) refuse(`${variant}: ${entry.job} may not ${entry.operation}`);
  }
  if (variant === "automation_reconcile/files" && entries.every((entry) => entry.operation === "keep")) {
    refuse("automation_reconcile/files requires a plist mutation");
  }
}

function expectedPlistBinding(entry: LaunchdPlanEntryV1): Omit<LifecycleFileBindingV1, "participantId"> | null {
  if (entry.operation === "keep") return null;
  return {
    targetPath: entry.plistPath,
    expectedBeforeHash: entry.beforeFileHash,
    afterHash: entry.plistBytes === null ? null : launchdPlistBytesHash(entry.plistBytes),
  };
}

function assertPlistFiles(plan: LaunchdPlanV1, liveOnly: boolean): void {
  const expected = plan.entries.flatMap((entry) => {
    const binding = expectedPlistBinding(entry);
    return binding === null ? [] : [binding];
  });
  if (plan.plistFiles.length !== expected.length) refuse("plistFiles: not one binding per mutated plist");
  const sorted = sortUtf8(plan.plistFiles, (file) => file.targetPath);
  plan.plistFiles.forEach((binding, index) => {
    if (binding !== sorted[index]) refuse("plistFiles: not sorted by target path");
    const match = expected.find((candidate) => candidate.targetPath === binding.targetPath);
    if (match === undefined || match.expectedBeforeHash !== binding.expectedBeforeHash || match.afterHash !== binding.afterHash) {
      refuse(`plistFiles: ${binding.targetPath} is not its entry's mutation`);
    }
    if ((binding.participantId === null) !== liveOnly) refuse("plistFiles: participant");
  });
}

function assertPreservedBinding(binding: LifecycleFileBindingV1 | null, label: string): void {
  if (binding === null || binding.participantId !== null) refuse(`live_only: ${label} must be preserved`);
  if (binding.expectedBeforeHash === null || binding.expectedBeforeHash !== binding.afterHash) refuse(`live_only: ${label} changes`);
}

function assertFileBindings(plan: LaunchdPlanV1, variant: LaunchdPlanVariantV1): void {
  const liveOnly = variant === "automation_reconcile/live_only";
  assertPlistFiles(plan, liveOnly);
  const { manifest } = plan;
  if (liveOnly) {
    assertPreservedBinding(plan.config, "config");
    assertPreservedBinding(plan.activation, "activation");
    if (manifest.statePlanHash !== null || manifest.before.state !== "present" || !sameCanonical(manifest.before, manifest.after)) {
      refuse("live_only: manifest must be preserved");
    }
    return;
  }
  if (plan.config.participantId === null) refuse("config: participant");
  if (plan.activation === null ? variant !== "uninstall/present_manifest" : plan.activation.participantId === null) refuse("activation: participant");
  if (manifest.statePlanHash === null) refuse("manifest: state plan hash");
}

/**
 * `before` is non-null exactly when compensation may reload the preimage (a loaded replace or
 * remove) and `after` exactly when forward execution may load the postimage; `keep` binds its one
 * retained identity in both arms (spec §5.3). Only `keep` binds an inode: every other arm is a
 * file Foundation writes or restores through a fresh inode, so its `dev`/`ino` are null and the
 * reader binds the inode it opens (NEW-138).
 */
function assertBootstrapPlists(entry: LaunchdPlanEntryV1): void {
  const { before, after } = entry.bootstrapPlists;
  const loaded = entry.beforeLiveState.state === "loaded";
  const needsBefore = entry.operation === "keep" || ((entry.operation === "replace" || entry.operation === "remove") && loaded);
  const needsAfter = entry.operation !== "remove";
  if ((before !== null) !== needsBefore || (after !== null) !== needsAfter) refuse(`${entry.job}: bootstrap plist arms`);
  const uid = domainUid(entry.domain);
  for (const identity of [before, after]) {
    if (identity === null) continue;
    if (identity.path !== entry.plistPath || identity.ownerUid !== uid) refuse(`${entry.job}: bootstrap plist path or owner`);
    const inodeBound = entry.operation === "keep";
    if ((identity.dev !== null) !== inodeBound || (identity.ino !== null) !== inodeBound) refuse(`${entry.job}: bootstrap plist inode binding`);
  }
  if (before !== null && before.hash !== entry.beforeFileHash) refuse(`${entry.job}: bootstrap preimage hash`);
  if (after !== null) {
    if (entry.plistBytes === null) refuse(`${entry.job}: bootstrap postimage bytes`);
    if (after.hash !== launchdPlistBytesHash(entry.plistBytes) || after.size !== encoder.encode(entry.plistBytes).byteLength) {
      refuse(`${entry.job}: bootstrap postimage identity`);
    }
  }
  if (entry.operation === "keep" && !sameCanonical(before, after)) refuse(`${entry.job}: keep binds two identities`);
}

function assertEffects(plan: LaunchdPlanV1, variant: LaunchdPlanVariantV1): void {
  const arms = EFFECT_ARMS[variant];
  for (const position of ["before_files", "after_files"] as const) {
    const binding = position === "before_files" ? plan.beforeFilesEffect : plan.afterFilesEffect;
    const required = position === "before_files" ? arms.before : arms.after;
    if ((binding !== null) !== required) refuse(`${variant}: ${position} effect arm`);
    const transitions = positionTransitions(plan.entries, position);
    if (binding === null) {
      if (transitions.length !== 0) refuse(`${variant}: ${position} transitions without an effect`);
      continue;
    }
    const effect = launchdEffectPlan(plan, position);
    if (effect === null || launchdEffectPlanHash(effect) !== binding.planHash) refuse(`${position}: effect plan hash`);
  }
}

/**
 * Every rule a persisted `LaunchdPlanV1` must satisfy on its own: registry order, one domain and
 * product home, the table row of each entry, the variant's operations and effect arms, the file
 * bindings, the bootstrap identities, and the plan hash.
 */
export function assertLaunchdPlan(plan: LaunchdPlanV1): LaunchdPlanVariantV1 {
  const variant = launchdPlanVariant(plan);
  if ((plan.previewHash === null) !== (plan.coordinatorOperation === "uninstall")) refuse("previewHash");
  let order = -1;
  for (const entry of plan.entries) {
    const index = SCHEDULED_JOB_IDS.indexOf(entry.job);
    if (index <= order) refuse("entries are not unique in registry order");
    order = index;
    const first = plan.entries[0];
    if (first !== undefined && (entry.domain !== first.domain || entry.productHome !== first.productHome || entry.executablePath !== first.executablePath)) {
      refuse("entries disagree on domain, product home or executable");
    }
    launchdEntryTransitions(entry);
    assertBootstrapPlists(entry);
  }
  assertEntryOperations(variant, plan.entries);
  assertFileBindings(plan, variant);
  assertEffects(plan, variant);
  if (launchdPlanHash(plan) !== plan.planHash) refuse("planHash");
  return variant;
}

/**
 * Builds the allocated execution plan from a revalidated preview: nothing is recalculated
 * differently later, because apply and recovery re-derive every effect plan from this one value.
 */
export function planLaunchdTransitions(request: LaunchdTransitionRequestV1): LaunchdPlanV1 {
  const entries = request.preview.entries.map((entry) => {
    const bootstrapPlists = request.bootstrapPlists[entry.job] ?? refuse(`${entry.job}: no bootstrap plist binding`);
    return Object.freeze({ ...entry, bootstrapPlists });
  });
  const binding = (id: LaunchdEffectIdV1 | null, position: LaunchdEffectPositionV1): LaunchdEffectBindingV1 | null => {
    if (id === null) return null;
    const effect = buildEffectPlan(request.coordinatorId, parseLaunchdEffectId(id), position, request.processTableHash, positionTransitions(entries, position));
    return Object.freeze({ id: effect.id, planHash: launchdEffectPlanHash(effect) });
  };
  const draft: Omit<LaunchdPlanV1, "planHash"> = {
    schemaVersion: 1,
    previewHash: request.previewHash,
    coordinatorId: request.coordinatorId,
    coordinatorOperation: request.coordinatorOperation,
    processTableHash: parseLowerHexSha256(request.processTableHash),
    config: request.config,
    activation: request.activation,
    plistFiles: [...request.plistFiles],
    manifest: request.manifest,
    beforeFilesEffect: binding(request.beforeFilesEffectId, "before_files"),
    afterFilesEffect: binding(request.afterFilesEffectId, "after_files"),
    entries,
  };
  const plan: LaunchdPlanV1 = Object.freeze({ ...draft, planHash: launchdPlanHash(draft) });
  assertLaunchdPlan(plan);
  return plan;
}

function parseFileBinding(value: unknown, label: string): LifecycleFileBindingV1 {
  const raw = exactKeys(value, ["participantId", "targetPath", "expectedBeforeHash", "afterHash"], label);
  return Object.freeze({
    participantId: raw.participantId === null ? null : parseFoundationTransactionId(raw.participantId, null),
    targetPath: parseCanonicalAbsolutePathText(raw.targetPath),
    expectedBeforeHash: nullableHash(raw.expectedBeforeHash),
    afterHash: nullableHash(raw.afterHash),
  });
}

function parseManifestState(value: unknown, label: string): LaunchdManifestFileStateV1 {
  if ((value as { readonly state?: unknown } | null)?.state === "absent") {
    exactKeys(value, ["state"], label);
    return Object.freeze({ state: "absent" });
  }
  const raw = exactKeys(value, ["state", "hash"], label);
  if (raw.state !== "present") refuse(`${label}: state`);
  return Object.freeze({ state: "present", hash: parseLowerHexSha256(raw.hash) });
}

function parseEffectBinding(value: unknown, label: string): LaunchdEffectBindingV1 | null {
  if (value === null) return null;
  const raw = exactKeys(value, ["id", "planHash"], label);
  return Object.freeze({ id: parseLaunchdEffectId(raw.id), planHash: parseLowerHexSha256(raw.planHash) });
}

function parseBootstrapIdentity(value: unknown, label: string): LaunchdBootstrapPlistIdentityV1 | null {
  if (value === null) return null;
  const raw = exactKeys(value, ["path", "ownerUid", "mode", "nlink", "size", "hash", "dev", "ino"], label);
  if (typeof raw.ownerUid !== "number" || !Number.isSafeInteger(raw.ownerUid) || raw.ownerUid < 0) refuse(`${label}: ownerUid`);
  if (raw.mode !== 384 || raw.nlink !== 1) refuse(`${label}: mode or link count`);
  if (typeof raw.size !== "number" || !Number.isSafeInteger(raw.size) || raw.size < 1 || raw.size > MAX_LAUNCHD_PLIST_BYTES) refuse(`${label}: size`);
  return Object.freeze({
    path: parseCanonicalAbsolutePathText(raw.path),
    ownerUid: raw.ownerUid as EffectiveUidV1,
    mode: 384,
    nlink: 1,
    size: raw.size,
    hash: parseLowerHexSha256(raw.hash),
    dev: raw.dev === null ? null : parseUInt64Decimal(raw.dev),
    ino: raw.ino === null ? null : parseUInt64Decimal(raw.ino),
  });
}

/**
 * Rebuilds an entry from its primitive fields through the registry, schedule and plist
 * functions, then requires the stored value to be byte-identical to that reconstruction: a
 * persisted generation, argv, path or plist byte cannot differ from what they derive.
 */
function parseEntry(value: unknown, index: number): LaunchdPlanEntryV1 {
  const label = `LaunchdPlanEntryV1[${String(index)}]`;
  const raw = exactKeys(value, ENTRY_KEYS, label);
  const definition = launchdJob(raw.job);
  const job = definition.id;
  const productHome = parseScheduledProductHome(raw.productHome);
  const domain = raw.domain as LaunchdGuiDomainV1;
  domainUid(domain);
  const plistPath = parseCanonicalAbsolutePathText(raw.plistPath);
  if (!plistPath.endsWith(`/Library/LaunchAgents/${definition.plistFileName}`)) refuse(`${label}: plist path`);
  const executablePath = parseCanonicalAbsolutePathText(raw.executablePath);
  const beforeFileHash = nullableHash(raw.beforeFileHash);
  const beforeLiveState = parseLaunchdLiveState(raw.beforeLiveState, job, `${label}.beforeLiveState`);
  const operation = raw.operation as LaunchdPlanEntryV1["operation"];
  if (!["install", "replace", "keep", "remove"].includes(operation)) refuse(`${label}: operation`);
  const common = {
    operation,
    job,
    baseLabel: definition.baseLabel,
    domain,
    productHome,
    plistPath,
    executablePath,
    // NEW-144: the Node is argv[0]; the canonical reconstruction below still binds it.
    baseArgv: scheduledBaseArgv(job, productHome, executablePath, (Array.isArray(raw.baseArgv) ? raw.baseArgv[0] : undefined) as CanonicalAbsolutePathV1),
    logPath: launchdLogPath(productHome, job),
    statusPath: launchdStatusPath(productHome, job),
    beforeFileHash,
    beforeLiveState,
    priorStateFingerprint: launchdPriorStateFingerprint({ job, domain, plistPath, beforeFileHash, beforeLiveState }),
  };
  const bootstrap = exactKeys(raw.bootstrapPlists, ["before", "after"], `${label}.bootstrapPlists`);
  const bootstrapPlists = Object.freeze({
    before: parseBootstrapIdentity(bootstrap.before, `${label}.bootstrapPlists.before`),
    after: parseBootstrapIdentity(bootstrap.after, `${label}.bootstrapPlists.after`),
  });
  let entry: LaunchdPlanEntryV1;
  if (operation === "remove") {
    entry = { ...common, schedule: null, plistBytes: null, generationProjection: null, generation: null, generatedLabel: null, bootstrapPlists };
  } else {
    const schedule = assertNormalizedSchedule(raw.schedule as NormalizedScheduleV1);
    const generationProjection = {
      job,
      baseLabel: common.baseLabel,
      domain,
      schedule,
      productHome,
      plistPath,
      executablePath,
      baseArgv: common.baseArgv,
      logPath: common.logPath,
      statusPath: common.statusPath,
    };
    const generation = launchdGeneration(generationProjection);
    const plistBytes = encodeLaunchdPlist(launchdPlistDictionary(generationProjection, generation));
    entry = { ...common, schedule, plistBytes, generationProjection, generation, generatedLabel: generatedLabel(job, generation), bootstrapPlists };
  }
  if (!sameCanonical(entry, value)) refuse(`${label}: not its canonical reconstruction`);
  return Object.freeze(entry);
}

export function validateLaunchdPlan(value: unknown): LaunchdPlanV1 {
  const raw = exactKeys(
    value,
    [
      "schemaVersion",
      "planHash",
      "previewHash",
      "coordinatorId",
      "coordinatorOperation",
      "processTableHash",
      "config",
      "activation",
      "plistFiles",
      "manifest",
      "beforeFilesEffect",
      "afterFilesEffect",
      "entries",
    ],
    "LaunchdPlanV1",
  );
  if (raw.schemaVersion !== 1) refuse("LaunchdPlanV1: schemaVersion");
  const operations: readonly unknown[] = ["automation_enable", "automation_reconcile", "automation_disable", "uninstall"];
  if (!operations.includes(raw.coordinatorOperation)) refuse("LaunchdPlanV1: coordinatorOperation");
  if (!Array.isArray(raw.plistFiles) || raw.plistFiles.length > SCHEDULED_JOB_IDS.length) refuse("LaunchdPlanV1: plistFiles");
  if (!Array.isArray(raw.entries) || raw.entries.length > SCHEDULED_JOB_IDS.length) refuse("LaunchdPlanV1: entries");
  const manifest = exactKeys(raw.manifest, ["path", "statePlanHash", "before", "after"], "LaunchdPlanV1.manifest");
  const plan: LaunchdPlanV1 = Object.freeze({
    schemaVersion: 1,
    planHash: parseLowerHexSha256(raw.planHash),
    previewHash: nullableHash(raw.previewHash),
    coordinatorId: parseLifecycleCoordinatorId(raw.coordinatorId, null),
    coordinatorOperation: raw.coordinatorOperation as LaunchdCoordinatorOperationV1,
    processTableHash: parseLowerHexSha256(raw.processTableHash),
    config: parseFileBinding(raw.config, "LaunchdPlanV1.config"),
    activation: raw.activation === null ? null : parseFileBinding(raw.activation, "LaunchdPlanV1.activation"),
    plistFiles: Object.freeze((raw.plistFiles as readonly unknown[]).map((binding, index) => parseFileBinding(binding, `LaunchdPlanV1.plistFiles[${String(index)}]`))),
    manifest: Object.freeze({
      path: parseCanonicalAbsolutePathText(manifest.path),
      statePlanHash: nullableHash(manifest.statePlanHash),
      before: parseManifestState(manifest.before, "LaunchdPlanV1.manifest.before"),
      after: parseManifestState(manifest.after, "LaunchdPlanV1.manifest.after"),
    }),
    beforeFilesEffect: parseEffectBinding(raw.beforeFilesEffect, "LaunchdPlanV1.beforeFilesEffect"),
    afterFilesEffect: parseEffectBinding(raw.afterFilesEffect, "LaunchdPlanV1.afterFilesEffect"),
    entries: Object.freeze((raw.entries as readonly unknown[]).map(parseEntry)),
  });
  assertLaunchdPlan(plan);
  return plan;
}

/**
 * A preview entry is a plan entry before any bootstrap inode exists, so it is admitted by the same
 * canonical reconstruction with no bootstrap identity, and must not carry one of its own.
 */
export function validateLaunchdPlanPreview(value: unknown): LaunchdPlanPreviewV1 {
  const raw = exactKeys(
    value,
    ["schemaVersion", "observationProcessTableHash", "mutationProcessTableTemplateHash", "entries"],
    "LaunchdPlanPreviewV1",
  );
  if (raw.schemaVersion !== 1) refuse("LaunchdPlanPreviewV1: schemaVersion");
  if (!Array.isArray(raw.entries) || raw.entries.length > SCHEDULED_JOB_IDS.length) refuse("LaunchdPlanPreviewV1: entries");
  let order = -1;
  const entries = (raw.entries as readonly unknown[]).map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) || Object.hasOwn(entry, "bootstrapPlists")) {
      refuse(`LaunchdPlanPreviewV1.entries[${String(index)}]`);
    }
    const planned = parseEntry({ ...entry, bootstrapPlists: { before: null, after: null } }, index);
    const parsed = Object.fromEntries(
      Object.entries(planned).filter(([key]) => key !== "bootstrapPlists"),
    ) as unknown as LaunchdPlanPreviewEntryV1;
    const position = SCHEDULED_JOB_IDS.indexOf(parsed.job);
    if (position <= order) refuse("LaunchdPlanPreviewV1: entries are not unique in registry order");
    order = position;
    return Object.freeze(parsed);
  });
  return Object.freeze({
    schemaVersion: 1,
    observationProcessTableHash: parseLowerHexSha256(raw.observationProcessTableHash),
    mutationProcessTableTemplateHash: parseLowerHexSha256(raw.mutationProcessTableTemplateHash),
    entries: Object.freeze(entries),
  });
}

export const LAUNCHD_PLAN_PREVIEW_CODEC: LifecycleValueCodec<LaunchdPlanPreviewV1> = Object.freeze({
  validate: validateLaunchdPlanPreview,
  encode: (preview: LaunchdPlanPreviewV1) => encodeCanonicalJson(canonical(preview)),
});

/** The coordinator plan's `participants.launchd` leaf codec. */
export const LAUNCHD_PLAN_CODEC: LifecycleValueCodec<LaunchdPlanV1> = Object.freeze({
  validate: validateLaunchdPlan,
  encode: (plan: LaunchdPlanV1) => encodeCanonicalJson(canonical(plan)),
});

type LaunchdCoordinatorPlanV1 = LifecycleCoordinatorPlanCoreV1<unknown, LaunchdPlanV1, unknown, unknown>;

function assertForwardMutation(coordinator: LaunchdCoordinatorPlanV1, binding: LifecycleFileBindingV1, label: string): void {
  if (binding.participantId === null) return;
  const ref = coordinator.participants.foundation.find((candidate) => candidate.id === binding.participantId);
  if (ref === undefined || ref.role.kind !== "forward") refuse(`${label}: participant is not a forward Foundation ref`);
  const match = ref.mutations.some(
    (mutation) =>
      mutation.targetPath === binding.targetPath &&
      mutation.expectedBeforeHash === binding.expectedBeforeHash &&
      mutation.contentHash === binding.afterHash,
  );
  if (!match) refuse(`${label}: no matching Foundation mutation`);
}

/**
 * Spec §5.3's cross-bindings, recomputed before any Foundation or launchd participant starts:
 * coordinator identity and operation, preview hash, position-tagged effect refs, authority plist
 * paths, and every non-null file binding against its named forward Foundation mutation.
 */
export function assertLaunchdPlanBindings(plan: LaunchdPlanV1, coordinator: LaunchdCoordinatorPlanV1): void {
  assertLaunchdPlan(plan);
  if (!sameCanonical(coordinator.participants.launchd, plan)) refuse("coordinator does not embed this launchd plan");
  if (coordinator.id !== plan.coordinatorId || coordinator.operation !== plan.coordinatorOperation) refuse("coordinator identity");
  if (coordinator.previewHash !== plan.previewHash) refuse("coordinator preview hash");
  if (!sameCanonical(coordinator.participants.launchdBeforeFiles, plan.beforeFilesEffect)) refuse("before_files effect ref");
  if (!sameCanonical(coordinator.participants.launchdAfterFiles, plan.afterFilesEffect)) refuse("after_files effect ref");
  if (!sameCanonical(coordinator.authority.plistPaths, plan.plistFiles.map((binding) => binding.targetPath))) refuse("authority plist paths");
  if (coordinator.authority.configPath !== plan.config.targetPath) refuse("config path");
  if (plan.activation !== null && coordinator.authority.activationPath !== plan.activation.targetPath) refuse("activation path");
  if (coordinator.authority.manifestPath !== plan.manifest.path) refuse("manifest path");
  assertForwardMutation(coordinator, plan.config, "config");
  if (plan.activation !== null) assertForwardMutation(coordinator, plan.activation, "activation");
  plan.plistFiles.forEach((binding, index) => {
    assertForwardMutation(coordinator, binding, `plistFiles[${String(index)}]`);
  });
}

function unescapeText(value: string): string {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/**
 * Reads retained plist bytes back into `LaunchdPlistDictionaryV1` and accepts them only when
 * re-rendering is byte-identical; no DTD or entity is ever resolved (spec §5.3).
 */
export function parseCanonicalLaunchdPlist(bytes: Uint8Array): LaunchdPlistDictionaryV1 {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return refuse("retained plist is not UTF-8");
  }
  const strings = (indent: number): string[] =>
    [...text.matchAll(new RegExp(`^ {${String(indent)}}<string>(.*)</string>$`, "gmu"))].map((match) => unescapeText(match[1] ?? ""));
  const top = strings(4);
  const calendar: Record<string, number> = {};
  for (const match of text.matchAll(/^ {6}<key>(Weekday|Hour|Minute)<\/key>\n {6}<integer>(0|[1-9][0-9]?)<\/integer>$/gmu)) {
    calendar[match[1] ?? ""] = Number(match[2]);
  }
  if (top.length !== 3) refuse("retained plist: string count");
  const dictionary: unknown = {
    Label: top[0],
    ProgramArguments: strings(6),
    StartCalendarInterval: calendar,
    StandardOutPath: top[1],
    StandardErrorPath: top[2],
  };
  const parsed = dictionary as LaunchdPlistDictionaryV1;
  if (encodeRetainedLaunchdPlist(parsed) !== text) refuse("retained plist is not canonical");
  return parsed;
}
