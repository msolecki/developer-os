/**
 * Spec 1 §2.4's effect-journal hookup: the one seam through which the ledger
 * reads a Git or launchd effect plan and journal it cannot parse itself. Plan
 * 1b's executors (Git in core, launchd in platform-macos) each supply one codec;
 * a `null` codec keeps plan 1a's refusal of the whole root and its staging.
 */
import type { LifecycleValueCodec } from "./codecs.js";

export type LifecycleEffectTerminalV1 = "finalized" | "rolled_back" | null;

export interface LifecycleEffectLedgerCodecV1 {
  readonly plan: LifecycleValueCodec<unknown>;
  readonly journal: LifecycleValueCodec<unknown>;
  /** Terminal outcome of a validated journal, or null while non-terminal. */
  terminal(journal: unknown): LifecycleEffectTerminalV1;
  /** Exact staging children a validated plan owns under its side/process directory. */
  stagingChildren(plan: unknown): readonly string[];
}

export const MAX_GIT_EFFECT_JOURNAL_BYTES = 16_777_216;
export const MAX_LAUNCHD_EFFECT_JOURNAL_BYTES = 1_048_576;

export const GIT_EFFECT_STAGING_SIDES = ["destination", "source"] as const;
export type GitEffectStagingSideV1 = (typeof GIT_EFFECT_STAGING_SIDES)[number];

export const LAUNCHD_PROCESS_STAGING_CHILDREN = ["home", "tmp"] as const;

/**
 * The sole linked leaf `launchd-process` may hold, and only while its owning
 * effect's journal sits at the current bootstrap frontier (spec §2.4, §5.3).
 * Retained only to recognise residue from builds before D82; nothing creates it now.
 */
export const LAUNCHD_BOOTSTRAP_SNAPSHOT_CHILD = "tmp/bootstrap-plist";
export const MAX_LAUNCHD_BOOTSTRAP_SNAPSHOT_BYTES = 1_048_576;

const SEGMENT = /^[^/\0]+$/u;

/**
 * Validates a codec's `stagingChildren` answer: relative, `/`-separated, no
 * empty, `.` or `..` segment, no duplicate, and every proper parent listed, so
 * the ledger's one walker can admit each entry it meets by exact lookup.
 */
export function parseEffectStagingChildren(children: readonly string[]): ReadonlySet<string> {
  const admitted = new Set<string>();
  for (const child of children) {
    const segments = child.split("/");
    if (segments.some((segment) => segment === "." || segment === ".." || !SEGMENT.test(segment))) {
      throw new Error(`invalid effect staging child ${JSON.stringify(child)}`);
    }
    if (admitted.has(child)) throw new Error(`duplicate effect staging child ${JSON.stringify(child)}`);
    admitted.add(child);
  }
  for (const child of admitted) {
    const boundary = child.lastIndexOf("/");
    if (boundary >= 0 && !admitted.has(child.slice(0, boundary))) {
      throw new Error(`effect staging child ${JSON.stringify(child)} has no listed parent`);
    }
  }
  return admitted;
}

export interface LifecycleEffectJournalBindingV1 {
  readonly id: string;
  readonly coordinatorId: string;
  readonly planHash: string;
}

/**
 * Spec §2.4 `EffectJournalV1`: every effect journal names its own ID, its
 * coordinator and the hash of its immutable plan. The ledger binds all three
 * to the filename, the referencing coordinator and the plan it already hashed,
 * so a journal copied under another name is refused whatever the codec accepts.
 */
export function effectJournalBinding(journal: unknown): LifecycleEffectJournalBindingV1 | null {
  if (typeof journal !== "object" || journal === null) return null;
  const { id, coordinatorId, planHash } = journal as {
    readonly id?: unknown;
    readonly coordinatorId?: unknown;
    readonly planHash?: unknown;
  };
  return typeof id === "string" && typeof coordinatorId === "string" && typeof planHash === "string"
    ? { id, coordinatorId, planHash }
    : null;
}
