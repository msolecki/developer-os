import { constants, type BigIntStats } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import {
  LAUNCHD_PROCESS_STAGING_CHILDREN,
  LifecycleRecoveryRequiredError,
  encodeCanonicalJson,
  hashBytes,
  parseCanonicalAbsolutePathText,
  parseUInt64Decimal,
  type CanonicalAbsolutePathV1,
  type CanonicalJsonValue,
  type EffectiveUidV1,
  type LifecycleCoordinatorIdV1,
  type LifecycleEffectAdapterV1,
  type LifecycleEffectRefV1,
  type LifecycleEffectStateV1,
  type LowerHexSha256,
  type UtcTimestampV1,
} from "@developer-os/core";
import type { SupervisedPhaseV1, SupervisedProcessRunner, SupervisedTerminationV1 } from "@developer-os/security";

import { LaunchdDistributionUnsupportedError, admitLaunchdHost, recheckLaunchdHost, type LaunchdHostObserverV1 } from "./distribution.js";
import {
  launchdEffectPlanHash,
  sameLaunchdLiveState,
  type LaunchdEffectJournalPortV1,
  type LaunchdEffectJournalV1,
  type LaunchdEffectPlanV1,
  type LaunchdEffectPositionV1,
  type LaunchdEffectTransitionV1,
} from "./effect-journal.js";
import type { LaunchdObservationJobV1, LaunchdObserver } from "./observe.js";
import { assertLaunchdPlan, launchdEffectPlan, parseCanonicalLaunchdPlist, type LaunchdPlanEntryV1, type LaunchdPlanV1 } from "./plan.js";
import {
  SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  expandLaunchdProcessTable,
  launchctlIdentityHash,
  launchdProcessTableHash,
  requireLaunchdMutationTable,
  type LaunchdProcessDirectoryIdentityV1,
  type SupportedLaunchdProcessTableTemplateV1,
  type SupportedLaunchdProcessTableV1,
} from "./process-table.js";
import { parseGeneratedLabel } from "./registry.js";
import {
  NODE_LAUNCHD_FILE_SYSTEM,
  readBoundedPlist,
  type LaunchdBootstrapPlistIdentityV1,
  type LaunchdBootstrapRequestV1,
  type LaunchdFileSystemV1,
  type LaunchdOpenedPlistIdentityV1,
  type LaunchdPathBootstrapper,
} from "./bootstrap.js";
import { LaunchdInputError, type LaunchdGeneratedServiceTargetV1, type LaunchdLiveStateV1, type LaunchdPlistDictionaryV1 } from "./types.js";

const MAX_PLIST_BYTES = 1_048_576;
const POLL_MS = 100;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const UNLOADED: LaunchdLiveStateV1 = Object.freeze({ state: "unloaded" });
const PRE_APPLY = new Set(["planned", "backed_up", "staged", "validated"]);

const NODE_FILE_SYSTEM = NODE_LAUNCHD_FILE_SYSTEM;

function recovery(reason: string, ...paths: readonly string[]): never {
  throw new LifecycleRecoveryRequiredError(reason, paths);
}

function refuse(message: string): never {
  throw new LaunchdInputError(message);
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return encodeCanonicalJson(left as CanonicalJsonValue) === encodeCanonicalJson(right as CanonicalJsonValue);
}

function sameIdentity(stats: BigIntStats, identity: { readonly dev: string; readonly ino: string }): boolean {
  return stats.dev.toString(10) === identity.dev && stats.ino.toString(10) === identity.ino;
}

/** Raw launchctl output is counted and discarded: no digest of it is kept (spec §5.3). */
export interface LaunchdBootoutEvidenceV1 {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly termination: SupervisedTerminationV1;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly groupReaped: true;
}

export interface LaunchdBootoutPortV1 {
  bootout(table: SupportedLaunchdProcessTableV1, target: LaunchdGeneratedServiceTargetV1, phase: SupervisedPhaseV1): Promise<LaunchdBootoutEvidenceV1>;
}

/** What one bootstrap read admitted: the parsed bytes and the inode they were read through. */
export interface LaunchdAdmittedPlistV1 {
  readonly plist: LaunchdPlistDictionaryV1;
  readonly source: LaunchdOpenedPlistIdentityV1;
}

/**
 * Plan-bound plist checks: a bootout needs the current bytes; a bootstrap needs the plan-bound
 * bytes and metadata through one no-follow descriptor, plus the bound inode for a `keep` arm.
 * `read` returns the inode it opened, which every later step compares against.
 */
export interface LaunchdPlistPortV1 {
  read(identity: LaunchdBootstrapPlistIdentityV1): Promise<LaunchdAdmittedPlistV1>;
  verifyHash(path: CanonicalAbsolutePathV1, hash: LowerHexSha256): Promise<void>;
}

/** Every read is `O_NOFOLLOW`, bounded to 1 MiB, and judged by its bytes' SHA-256. */
export class NodeLaunchdPlistReader implements LaunchdPlistPortV1 {
  readonly #fs: LaunchdFileSystemV1;

  constructor(fs: LaunchdFileSystemV1 = NODE_FILE_SYSTEM) {
    this.#fs = fs;
  }

  /**
   * Opens the plist no-follow, admits the descriptor's own `fstat` (owner, 0600, one link, the
   * bound size, and the bound inode when the arm binds one), and hashes the bytes read through that
   * same descriptor. The returned identity carries the inode actually opened (NEW-138).
   */
  async read(identity: LaunchdBootstrapPlistIdentityV1): Promise<LaunchdAdmittedPlistV1> {
    const { bytes, stats } = await this.#bytes(identity.path, (opened) =>
      opened.isFile() &&
      opened.uid === BigInt(identity.ownerUid) &&
      (opened.mode & 0o7777n) === BigInt(PRIVATE_FILE_MODE) &&
      opened.nlink === 1n &&
      opened.size === BigInt(identity.size) &&
      (identity.dev === null || identity.ino === null ? identity.dev === identity.ino : sameIdentity(opened, { dev: identity.dev, ino: identity.ino })),
    );
    if (hashBytes(bytes) !== identity.hash) recovery("launchd_bootstrap_plist_changed", identity.path);
    const source: LaunchdOpenedPlistIdentityV1 = Object.freeze({
      ...identity,
      dev: parseUInt64Decimal(stats.dev.toString(10)),
      ino: parseUInt64Decimal(stats.ino.toString(10)),
    });
    return Object.freeze({ plist: parseCanonicalLaunchdPlist(bytes), source });
  }

  async verifyHash(path: CanonicalAbsolutePathV1, hash: LowerHexSha256): Promise<void> {
    const { bytes } = await this.#bytes(path, (stats) => stats.isFile() && stats.size <= BigInt(MAX_PLIST_BYTES));
    if (hashBytes(bytes) !== hash) recovery("launchd_plist_changed", path);
  }

  async #bytes(path: CanonicalAbsolutePathV1, admit: (stats: BigIntStats) => boolean): Promise<{ readonly bytes: Uint8Array; readonly stats: BigIntStats }> {
    let handle: Awaited<ReturnType<LaunchdFileSystemV1["open"]>>;
    try {
      handle = await this.#fs.open(path, READ_FLAGS);
    } catch {
      return recovery("launchd_plist_changed", path);
    }
    try {
      const stats = await handle.stat({ bigint: true });
      if (!admit(stats)) recovery("launchd_plist_changed", path);
      const bytes = await readBoundedPlist(handle, MAX_PLIST_BYTES);
      if (bytes.byteLength > MAX_PLIST_BYTES) recovery("launchd_plist_changed", path);
      return { bytes, stats };
    } finally {
      await handle.close();
    }
  }
}

async function directoryIdentity(fs: LaunchdFileSystemV1, path: string): Promise<LaunchdProcessDirectoryIdentityV1> {
  let stats: BigIntStats;
  try {
    stats = await fs.lstat(path, { bigint: true });
  } catch {
    return recovery("launchd_process_staging_changed", path);
  }
  if (!stats.isDirectory() || (stats.mode & 0o7777n) !== BigInt(PRIVATE_DIRECTORY_MODE)) recovery("launchd_process_staging_changed", path);
  return {
    path: parseCanonicalAbsolutePathText(path),
    ownerUid: Number(stats.uid) as EffectiveUidV1,
    mode: 448,
    dev: parseUInt64Decimal(stats.dev.toString(10)),
    ino: parseUInt64Decimal(stats.ino.toString(10)),
  };
}

/**
 * Re-derives the allocated mutation table from the three guarded staging directories of one
 * coordinator and a fresh host admission; the effect plan's `processTableHash` then decides
 * whether it is the bound table, so a launchctl or macOS change since planning never matches.
 */
export async function loadLaunchdProcessTable(
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: LifecycleCoordinatorIdV1,
  options: {
    readonly fs?: LaunchdFileSystemV1;
    readonly template?: SupportedLaunchdProcessTableTemplateV1;
    readonly host: LaunchdHostObserverV1;
  },
): Promise<SupportedLaunchdProcessTableV1> {
  const fs = options.fs ?? NODE_FILE_SYSTEM;
  const root = `${productHome}/staging/lifecycle/${coordinatorId}/launchd-process`;
  const launchctl = await admitLaunchdHost(options.host);
  return expandLaunchdProcessTable(
    {
      root: await directoryIdentity(fs, root),
      home: await directoryIdentity(fs, `${root}/home`),
      tmp: await directoryIdentity(fs, `${root}/tmp`),
    },
    launchctl,
    options.template ?? SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE,
  );
}

/** Before and after every process: the exact two-child root and both children entry-empty. */
async function admitProcessStaging(fs: LaunchdFileSystemV1, table: SupportedLaunchdProcessTableV1): Promise<void> {
  const { root, home, tmp } = table.staging;
  for (const identity of [root, home, tmp]) {
    const stats = await fs.lstat(identity.path, { bigint: true });
    if (
      !stats.isDirectory() ||
      stats.uid !== BigInt(identity.ownerUid) ||
      (stats.mode & 0o7777n) !== BigInt(PRIVATE_DIRECTORY_MODE) ||
      !sameIdentity(stats, identity)
    ) {
      recovery("launchd_process_staging_changed", identity.path);
    }
  }
  const children = [...(await fs.readdir(root.path))].sort();
  if (!sameCanonical(children, [...LAUNCHD_PROCESS_STAGING_CHILDREN])) recovery("launchd_process_staging_changed", root.path);
  for (const identity of [home, tmp]) {
    if ((await fs.readdir(identity.path)).length !== 0) recovery("launchd_process_staging_not_empty", identity.path);
  }
}

export interface LaunchdBootoutDependenciesV1 {
  readonly runner: Pick<SupervisedProcessRunner, "run">;
  readonly fs?: LaunchdFileSystemV1;
  readonly template?: SupportedLaunchdProcessTableTemplateV1;
  effectiveUid(): number;
  readonly host: LaunchdHostObserverV1;
}

/**
 * The literal `launchctl bootout gui/<uid>/<generated-label>` of the mutation table, with the
 * table's bound launchctl identity rechecked and the private `HOME`/`TMPDIR` staging re-verified
 * around it.
 */
export class LaunchdBootoutRunner implements LaunchdBootoutPortV1 {
  readonly #dependencies: LaunchdBootoutDependenciesV1;
  readonly #fs: LaunchdFileSystemV1;

  constructor(dependencies: LaunchdBootoutDependenciesV1) {
    this.#dependencies = dependencies;
    this.#fs = dependencies.fs ?? NODE_FILE_SYSTEM;
  }

  async bootout(table: SupportedLaunchdProcessTableV1, target: LaunchdGeneratedServiceTargetV1, phase: SupervisedPhaseV1): Promise<LaunchdBootoutEvidenceV1> {
    requireLaunchdMutationTable(table, this.#dependencies.template ?? SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE);
    const prefix = `gui/${String(this.#dependencies.effectiveUid())}/`;
    if (!target.startsWith(prefix)) refuse("launchd bootout target is not the effective user's gui domain");
    parseGeneratedLabel(target.slice(prefix.length));
    await recheckLaunchdHost(this.#dependencies.host, table.launchctlIdentity);
    await admitProcessStaging(this.#fs, table);
    const [mutationProfile] = table.profiles;
    const evidence = await this.#dependencies.runner.run({
      executable: table.executable.path,
      argv: ["bootout", target],
      env: { ...table.environment },
      cwd: table.staging.home.path,
      stdin: "ignore",
      inheritedFds: [],
      stdoutCap: mutationProfile.stdoutMaxBytes,
      stderrCap: mutationProfile.stderrMaxBytes,
      idleMs: mutationProfile.idleDeadlineMs,
      wallMs: mutationProfile.wallDeadlineMs,
      terminationGraceMs: table.terminationGraceMs,
      phase,
    });
    await admitProcessStaging(this.#fs, table);
    return Object.freeze({
      exitCode: evidence.exitCode,
      signal: evidence.signal,
      termination: evidence.termination,
      stdoutBytes: evidence.stdoutBytes,
      stderrBytes: evidence.stderrBytes,
      groupReaped: evidence.groupReaped,
    });
  }
}

export interface LaunchdEffectDependenciesV1 {
  /** The coordinator-embedded plan; every effect plan is re-derived from it, never trusted alone. */
  readonly plan: LaunchdPlanV1;
  readonly journals: LaunchdEffectJournalPortV1;
  readonly observer: Pick<LaunchdObserver, "observe">;
  readonly bootstrapper: Pick<LaunchdPathBootstrapper, "bootstrap" | "verifyLoaded">;
  readonly launchctl: LaunchdBootoutPortV1;
  readonly plists: LaunchdPlistPortV1;
  /** Usually `loadLaunchdProcessTable(productHome, plan.coordinatorId)`. */
  processTable(): Promise<SupportedLaunchdProcessTableV1>;
  readonly template?: SupportedLaunchdProcessTableTemplateV1;
  /** One absolute 30,000-ms budget per forward or reverse transition, shared by its command and probes. */
  beginTransition(): SupervisedPhaseV1;
  clock(): UtcTimestampV1;
  pause?(milliseconds: number): Promise<void>;
}

type Direction = "forward" | "reverse";
type JournalPatch = Partial<Pick<LaunchdEffectJournalV1, "phase" | "nextTransition" | "compensationNext" | "observations">>;

function effectState(journal: LaunchdEffectJournalV1 | null): LifecycleEffectStateV1 {
  if (journal === null) return "future";
  if (PRE_APPLY.has(journal.phase)) return "planned";
  return journal.phase as LifecycleEffectStateV1;
}

function commandSucceeded(evidence: { readonly termination: SupervisedTerminationV1; readonly exitCode: number | null; readonly signal: string | null }): boolean {
  return evidence.termination === "exited" && evidence.exitCode === 0 && evidence.signal === null;
}

/**
 * Spec §2.4/§5.3's position-tagged launchd participant. A `before_files` plan only unloads and an
 * `after_files` plan only loads; the durable journal cursor is the directional intent persisted
 * before every `bootout` or bootstrap, and the exact candidate probes run after every command
 * before the cursor advances. A probe may find only the recorded preimage (run the one bound
 * command) or postimage (record it without repeating); every other state is preserved as
 * `lifecycle_recovery_required`.
 */
export class LaunchdEffectExecutor implements LifecycleEffectAdapterV1 {
  readonly #dependencies: LaunchdEffectDependenciesV1;
  readonly #template: SupportedLaunchdProcessTableTemplateV1;

  constructor(dependencies: LaunchdEffectDependenciesV1) {
    assertLaunchdPlan(dependencies.plan);
    this.#dependencies = dependencies;
    this.#template = dependencies.template ?? SUPPORTED_LAUNCHD_PROCESS_TABLE_TEMPLATE;
  }

  async observe(ref: LifecycleEffectRefV1<string>): Promise<LifecycleEffectStateV1> {
    const effect = await this.#effect(ref);
    return effectState(await this.#dependencies.journals.readJournal(effect));
  }

  async apply(ref: LifecycleEffectRefV1<string>): Promise<void> {
    const effect = await this.#effect(ref);
    await this.#locked(effect, () => this.#apply(effect));
  }

  async finalize(ref: LifecycleEffectRefV1<string>): Promise<void> {
    const effect = await this.#effect(ref);
    await this.#locked(effect, async () => {
      const journal = await this.#dependencies.journals.readJournal(effect);
      if (journal?.phase === "finalized") return;
      if (journal?.phase !== "verified") recovery("launchd_effect_not_verified", effect.id);
      await this.#write(effect, journal, { phase: "finalized" });
    });
  }

  async compensate(ref: LifecycleEffectRefV1<string>): Promise<void> {
    const effect = await this.#effect(ref);
    await this.#locked(effect, () => this.#compensate(effect));
  }

  async compact(ref: LifecycleEffectRefV1<string>, outcome: "finalized" | "rolled_back"): Promise<void> {
    const effect = await this.#effect(ref);
    const journal = await this.#dependencies.journals.readJournal(effect);
    if (journal !== null && journal.phase !== outcome) recovery("launchd_effect_not_terminal", effect.id);
    await this.#dependencies.journals.compact(effect);
  }

  /** The ref must be one of this plan's two bound effects, and the published plan its exact derivation. */
  async #effect(ref: LifecycleEffectRefV1<string>): Promise<LaunchdEffectPlanV1> {
    const { plan } = this.#dependencies;
    const position: LaunchdEffectPositionV1 | null =
      plan.beforeFilesEffect?.id === ref.id ? "before_files" : plan.afterFilesEffect?.id === ref.id ? "after_files" : null;
    if (position === null) recovery("launchd_effect_unbound", ref.id);
    const binding = position === "before_files" ? plan.beforeFilesEffect : plan.afterFilesEffect;
    const derived = launchdEffectPlan(plan, position);
    if (derived === null || binding === null || binding.planHash !== ref.planHash || launchdEffectPlanHash(derived) !== ref.planHash) {
      recovery("lifecycle_effect_plan_hash", ref.id);
    }
    const published = await this.#dependencies.journals.readPlan(ref);
    if (!sameCanonical(published, derived)) recovery("lifecycle_effect_plan_hash", ref.id);
    return derived;
  }

  async #locked(effect: LaunchdEffectPlanV1, body: () => Promise<void>): Promise<void> {
    const held = await this.#dependencies.journals.lock(effect);
    try {
      await body();
    } finally {
      await held.release();
    }
  }

  async #write(effect: LaunchdEffectPlanV1, current: LaunchdEffectJournalV1, patch: JournalPatch): Promise<LaunchdEffectJournalV1> {
    const next: LaunchdEffectJournalV1 = { ...current, ...patch, updatedAt: this.#dependencies.clock() };
    await this.#dependencies.journals.writeJournal(effect, current, next);
    return next;
  }

  /**
   * Hash-bound to the effect plan and de-slotted to the compiled template before any query or
   * mutation. A launchctl other than the one the journal was opened with is a host change, not a
   * damaged table: it refuses before the hash comparison that it would otherwise fail.
   */
  async #table(effect: LaunchdEffectPlanV1, journal: LaunchdEffectJournalV1 | null): Promise<SupportedLaunchdProcessTableV1> {
    const table = await this.#dependencies.processTable();
    if (journal !== null && journal.launchctlIdentityHash !== launchctlIdentityHash(table.launchctlIdentity)) {
      throw new LaunchdDistributionUnsupportedError("launchctl changed since this launchd effect journal was opened");
    }
    if (launchdProcessTableHash(table) !== effect.processTableHash) recovery("launchd_process_table_changed", table.staging.root.path);
    requireLaunchdMutationTable(table, this.#template);
    return table;
  }

  async #apply(effect: LaunchdEffectPlanV1): Promise<void> {
    const n = effect.transitions.length;
    let journal = await this.#dependencies.journals.readJournal(effect);
    const table = n === 0 ? null : await this.#table(effect, journal);
    if (journal === null) {
      const createdAt = this.#dependencies.clock();
      journal = {
        schemaVersion: 1,
        id: effect.id,
        coordinatorId: effect.coordinatorId,
        phase: "planned",
        planHash: launchdEffectPlanHash(effect),
        launchctlIdentityHash: table === null ? null : launchctlIdentityHash(table.launchctlIdentity),
        nextTransition: 0,
        compensationNext: null,
        observations: [],
        createdAt,
        updatedAt: createdAt,
      };
      await this.#dependencies.journals.writeJournal(effect, null, journal);
    }
    if (journal.phase === "verified" || journal.phase === "finalized") return;
    if (journal.phase === "compensating" || journal.phase === "rolled_back") recovery("launchd_effect_compensating", effect.id);
    if (journal.phase === "planned") {
      await this.#requirePreimages(effect);
      journal = await this.#write(effect, journal, { phase: "backed_up" });
    }
    if (journal.phase === "backed_up") journal = await this.#write(effect, journal, { phase: "staged" });
    if (journal.phase === "staged") {
      assertLaunchdPlan(this.#dependencies.plan);
      await this.#requirePreimages(effect);
      journal = await this.#write(effect, journal, { phase: "validated" });
    }
    if (journal.phase === "validated") journal = await this.#write(effect, journal, { phase: n === 0 ? "verified" : "applied" });
    while (journal.phase === "applied" && table !== null) {
      const index = journal.nextTransition;
      const transition = effect.transitions[index] ?? recovery("lifecycle_effect_journal_state", effect.id);
      await this.#forward(effect, index, transition, table);
      journal = await this.#write(effect, journal, {
        nextTransition: index + 1,
        observations: [...journal.observations, { transitionIndex: index, observedAfter: transition.after }],
        phase: index + 1 === n ? "verified" : "applied",
      });
    }
  }

  async #compensate(effect: LaunchdEffectPlanV1): Promise<void> {
    const { journals } = this.#dependencies;
    let journal = await journals.readJournal(effect);
    if (journal === null || journal.phase === "rolled_back") return;
    if (journal.phase === "finalized") recovery("launchd_effect_finalized", effect.id);
    if (PRE_APPLY.has(journal.phase)) {
      await this.#write(effect, journal, { phase: "rolled_back", compensationNext: -1 });
      return;
    }
    const table = effect.transitions.length === 0 ? null : await this.#table(effect, journal);
    if (journal.phase === "applied") {
      const index = journal.nextTransition;
      const transition = effect.transitions[index] ?? recovery("lifecycle_effect_journal_state", effect.id);
      const [live] = await this.#observe(effect, [transition], this.#dependencies.beginTransition());
      const published = live !== undefined && sameLaunchdLiveState(live, transition.after);
      if (!published && (live === undefined || !sameLaunchdLiveState(live, transition.before))) recovery("launchd_live_state_third_state", transition.plistPath);
      const reached = published ? index + 1 : index;
      journal = await this.#write(effect, journal, {
        phase: "compensating",
        nextTransition: reached,
        observations: published ? [...journal.observations, { transitionIndex: index, observedAfter: transition.after }] : journal.observations,
        compensationNext: reached - 1,
      });
    } else if (journal.phase === "verified") {
      journal = await this.#write(effect, journal, { phase: "compensating", compensationNext: journal.nextTransition - 1 });
    }
    for (let index = journal.compensationNext ?? -1; index >= 0; index -= 1) {
      const transition = effect.transitions[index] ?? recovery("lifecycle_effect_journal_state", effect.id);
      await this.#reverse(effect, index, transition, table ?? recovery("lifecycle_effect_journal_state", effect.id));
      journal = await this.#write(effect, journal, { compensationNext: index - 1 });
    }
    await this.#write(effect, journal, { phase: "rolled_back", compensationNext: -1 });
  }

  async #requirePreimages(effect: LaunchdEffectPlanV1): Promise<void> {
    if (effect.transitions.length === 0) return;
    const observed = await this.#observe(effect, effect.transitions, this.#dependencies.beginTransition());
    effect.transitions.forEach((transition, index) => {
      const live = observed[index];
      if (live === undefined || !sameLaunchdLiveState(live, transition.before)) recovery("launchd_live_state_drift", transition.plistPath);
    });
  }

  async #forward(effect: LaunchdEffectPlanV1, index: number, transition: LaunchdEffectTransitionV1, table: SupportedLaunchdProcessTableV1): Promise<void> {
    await this.#transition(effect, "forward", index, transition, transition.before, transition.after, table);
  }

  /** The exact inverse: postimage runs it, preimage means it already took effect. */
  async #reverse(effect: LaunchdEffectPlanV1, index: number, transition: LaunchdEffectTransitionV1, table: SupportedLaunchdProcessTableV1): Promise<void> {
    await this.#transition(effect, "reverse", index, transition, transition.after, transition.before, table);
  }

  async #transition(
    effect: LaunchdEffectPlanV1,
    direction: Direction,
    index: number,
    transition: LaunchdEffectTransitionV1,
    from: LaunchdLiveStateV1,
    to: LaunchdLiveStateV1,
    table: SupportedLaunchdProcessTableV1,
  ): Promise<void> {
    const phase = this.#dependencies.beginTransition();
    const [live] = await this.#observe(effect, [transition], phase);
    if (live !== undefined && sameLaunchdLiveState(live, to)) return;
    if (live === undefined || !sameLaunchdLiveState(live, from)) recovery("launchd_live_state_third_state", transition.plistPath);
    const bootstrap = await this.#command(effect, direction, index, transition, to, table, phase);
    try {
      await this.#awaitState(effect, transition, from, to, phase);
    } catch (error) {
      // Spec §5.3 rule 5 (D71): a forward bootstrap that does not produce the planned label is
      // the runtime proof failing; the coordinator compensates.
      if (!bootstrap || direction !== "forward" || !(error instanceof LifecycleRecoveryRequiredError)) throw error;
      throw new LaunchdDistributionUnsupportedError("bootstrap post-observation is not the planned generated label", { cause: error });
    }
  }

  /**
   * Unloading is always the transition's own generated label; its plist must still hold the bound
   * bytes, because every unload precedes its plist mutation and every compensating unload precedes
   * the plist inverse. Loading (D82) admits the plan-bound plist through the reader, bootstraps it
   * by its path, and immediately verifies the inode, bytes and the loaded job's program; a mismatch
   * boots the label out and refuses `launchd_bootstrap_plist_changed`. Returns whether it bootstrapped.
   */
  async #command(
    effect: LaunchdEffectPlanV1,
    direction: Direction,
    index: number,
    transition: LaunchdEffectTransitionV1,
    to: LaunchdLiveStateV1,
    table: SupportedLaunchdProcessTableV1,
    phase: SupervisedPhaseV1,
  ): Promise<boolean> {
    if (to.state === "unloaded") {
      await this.#dependencies.plists.verifyHash(transition.plistPath, transition.plistHash);
      const evidence = await this.#dependencies.launchctl.bootout(table, `${transition.domain}/${transition.label}`, phase);
      if (!commandSucceeded(evidence)) recovery("launchd_command_failed", transition.plistPath);
      return false;
    }
    const role = direction === "forward" ? "after" : "before";
    const bound = this.#entry(transition).bootstrapPlists[role] ?? recovery("launchd_bootstrap_plist_unbound", transition.plistPath);
    const { plist, source } = await this.#dependencies.plists.read(bound);
    const request: LaunchdBootstrapRequestV1 = {
      table,
      domain: transition.domain,
      effectId: effect.id,
      planHash: launchdEffectPlanHash(effect),
      direction,
      transitionIndex: index,
      role,
      source,
      plist,
      phase,
    };
    const { bootstrapper, launchctl } = this.#dependencies;
    const evidence = await bootstrapper.bootstrap(request);
    if (!commandSucceeded(evidence.process)) recovery("launchd_command_failed", transition.plistPath);
    if (!(await bootstrapper.verifyLoaded(request))) {
      // D82: bound the life of a job loaded from swapped bytes to this post-check window.
      await launchctl.bootout(table, `${transition.domain}/${plist.Label}`, phase);
      recovery("launchd_bootstrap_plist_changed", transition.plistPath);
    }
    return true;
  }

  async #awaitState(
    effect: LaunchdEffectPlanV1,
    transition: LaunchdEffectTransitionV1,
    from: LaunchdLiveStateV1,
    to: LaunchdLiveStateV1,
    phase: SupervisedPhaseV1,
  ): Promise<void> {
    for (;;) {
      const [live] = await this.#observe(effect, [transition], phase);
      if (live !== undefined && sameLaunchdLiveState(live, to)) return;
      if (live === undefined || !sameLaunchdLiveState(live, from)) recovery("launchd_live_state_third_state", transition.plistPath);
      await (this.#dependencies.pause ?? ((milliseconds: number) => delay(milliseconds)))(POLL_MS);
    }
  }

  #entry(transition: LaunchdEffectTransitionV1): LaunchdPlanEntryV1 {
    return this.#dependencies.plan.entries.find((entry) => entry.job === transition.job) ?? recovery("launchd_effect_unbound", transition.plistPath);
  }

  /**
   * The closed candidate set per job: the transition's own journaled label in the observer's
   * retained (an unload's old generation) or planned (a load's new generation) field, and the
   * entry's other generation opposite it, so a dual or foreign generation is a third state.
   */
  #candidate(effect: LaunchdEffectPlanV1, transition: LaunchdEffectTransitionV1): LaunchdObservationJobV1 {
    const entry = this.#entry(transition);
    if (effect.position === "before_files") {
      const planned = entry.generatedLabel !== null && entry.generatedLabel !== transition.label ? entry.generatedLabel : null;
      return { job: transition.job, retained: transition.label, planned };
    }
    const live = entry.beforeLiveState;
    const retained = live.state === "loaded" && live.label !== transition.label ? live.label : null;
    return { job: transition.job, retained, planned: transition.label };
  }

  async #observe(effect: LaunchdEffectPlanV1, transitions: readonly LaunchdEffectTransitionV1[], phase: SupervisedPhaseV1): Promise<readonly LaunchdLiveStateV1[]> {
    if (phase.remainingMilliseconds() <= 0) recovery("launchd_transition_deadline", effect.id);
    const [first] = transitions;
    if (first === undefined) return [];
    const observation = await this.#dependencies.observer.observe({
      domain: first.domain,
      jobs: transitions.map((transition) => this.#candidate(effect, transition)),
    });
    if (observation.kind === "unobservable") recovery("launchd_unobservable", effect.id);
    if (phase.remainingMilliseconds() <= 0) recovery("launchd_transition_deadline", effect.id);
    return transitions.map((transition, index) => {
      const observed = observation.jobs[index];
      if (observed?.job !== transition.job) return recovery("launchd_unobservable", effect.id);
      const { state } = observed;
      switch (state.kind) {
        case "unloaded":
          return UNLOADED;
        case "exact_old":
        case "exact_new":
          return { state: "loaded", label: state.label, generation: state.generation };
        default:
          return recovery("launchd_live_state_third_state", transition.plistPath);
      }
    });
  }
}
