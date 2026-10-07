import { readlink, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  admitBootstrapEvidencePlan,
  BOOTSTRAP_MAX_JOURNAL_BYTES,
  BOOTSTRAP_MAX_PLAN_BYTES,
  decodeCanonicalJson,
  deriveBootstrapEnvelopePaths,
  PACKAGE_CHANNEL_LAYOUT,
  parseCanonicalAbsolutePathText,
  parseStableSemver,
  selectBootstrapEvidenceJournal,
  updateCoordinatorEnvelopePaths,
} from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  FreshV2InitIdV1,
  LifecycleCoordinatorIdV1,
  LifecycleGuardedEntryV1,
  PACKAGE_CHANNEL_SOURCE_TABLE,
} from "@developer-os/core";
import type { LauncherGuardedReaderV1 } from "@developer-os/platform-macos";

import { createCanonicalPathEvidence } from "./selection.js";
import type { LauncherBootstrapClosureV1, LauncherPackagedFallbackV1, LauncherUpdateEnvelopeV1 } from "./selection.js";

/**
 * The launcher's two NEW-111 readers. Each only classifies what is on disk for routing; the CLI
 * stays the authority that resumes, recovers or refuses the envelope it finds.
 */

const FRESH_PLAN = /^fresh-v2-init\.(fi_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.plan\.json$/u;
/** A bootstrap whose journal reached one of these phases no longer owns launcher routing (Spec 2 §3.1). */
const TERMINAL_PHASES: ReadonlySet<string> = new Set(["finalized", "rolled_back", "retaining", "retained"]);

function ownedStateFile(entry: LifecycleGuardedEntryV1 | null, effectiveUid: number): entry is LifecycleGuardedEntryV1 {
  return entry !== null && entry.kind === "regular_file" && entry.ownerUid === effectiveUid && entry.mode === 0o600 && entry.nlink === 1;
}

/** `present` when both files of the coordinator's envelope are owned `0600` regular files, `absent` when neither exists. */
export async function readUpdateEnvelope(
  fs: LauncherGuardedReaderV1,
  productHome: CanonicalAbsolutePathV1,
  coordinatorId: LifecycleCoordinatorIdV1,
  effectiveUid: number,
): Promise<LauncherUpdateEnvelopeV1> {
  const paths = updateCoordinatorEnvelopePaths(productHome, coordinatorId);
  const [plan, journal] = await Promise.all([fs.lstat(paths.plan), fs.lstat(paths.journal)]);
  if (plan === null && journal === null) return { kind: "absent" };
  return ownedStateFile(plan, effectiveUid) && ownedStateFile(journal, effectiveUid)
    ? { kind: "present", coordinatorId }
    : { kind: "malformed" };
}

/** The bytes of an owned `0600` state file, or `null` when it is anything else. */
async function readStateFile(
  fs: LauncherGuardedReaderV1,
  path: CanonicalAbsolutePathV1,
  effectiveUid: number,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  const entry = await fs.lstat(path);
  if (!ownedStateFile(entry, effectiveUid) || BigInt(entry.size) > BigInt(maximumBytes)) return null;
  return fs.readRegular(entry, maximumBytes);
}

/**
 * One envelope's status, as the CLI's evidence report classes it (`apps/cli/src/bootstrap/report.ts`):
 * `terminal` when its admitted journal reached a terminal phase; `incomplete` when its admitted
 * journal has not, or when both slots are still empty and the bootstrap leaf its plan persisted is
 * the live one (NEW-83); `unverified` for anything that does not admit.
 */
type EnvelopeStatusV1 = "terminal" | "incomplete" | "unverified";

/** `report.ts`'s `identityMatches`: owner, mode, link count, device and inode. */
function sameIdentity(
  entry: LifecycleGuardedEntryV1,
  expected: { readonly ownerUid: number; readonly mode: number; readonly nlink: number; readonly dev: string; readonly ino: string },
): boolean {
  return entry.ownerUid === expected.ownerUid && entry.mode === expected.mode && entry.nlink === expected.nlink &&
    entry.dev === expected.dev && entry.ino === expected.ino;
}

async function classifyEnvelope(
  fs: LauncherGuardedReaderV1,
  productHome: CanonicalAbsolutePathV1,
  stateDirectory: CanonicalAbsolutePathV1,
  id: FreshV2InitIdV1,
  effectiveUid: number,
): Promise<EnvelopeStatusV1> {
  try {
    const envelope = deriveBootstrapEnvelopePaths(productHome, id);
    const planBytes = await readStateFile(fs, envelope.plan, effectiveUid, BOOTSTRAP_MAX_PLAN_BYTES);
    if (planBytes === null) return "unverified";
    const plan = admitBootstrapEvidencePlan(
      decodeCanonicalJson(planBytes, BOOTSTRAP_MAX_PLAN_BYTES),
      { productHome, stateDirectory, expectedId: id },
      createCanonicalPathEvidence(),
    );
    // `report.ts`'s `slots_unbound`: each slot must be the regular file, with the identity, its plan bound.
    const entries: LifecycleGuardedEntryV1[] = [];
    for (const bound of plan.journalSlots) {
      const entry = await fs.lstat(bound.path);
      if (entry === null || entry.kind !== "regular_file" || !sameIdentity(entry, bound)) return "unverified";
      entries.push(entry);
    }
    // A slot torn by a death mid-write is no authority; it never fails the whole envelope (report.ts).
    const slots: unknown[] = [];
    for (const entry of entries) {
      if (entry.size === "0") {
        slots.push(null);
        continue;
      }
      const bytes = await fs.readRegular(entry, BOOTSTRAP_MAX_JOURNAL_BYTES);
      try {
        slots.push(decodeCanonicalJson(bytes, BOOTSTRAP_MAX_JOURNAL_BYTES));
      } catch {
        slots.push(null);
      }
    }
    const selection = selectBootstrapEvidenceJournal(plan, [slots[0], slots[1]]);
    if (selection !== null) return TERMINAL_PHASES.has(selection.current.phase) ? "terminal" : "incomplete";
    // No slot is authority: resumable only as `initialSlotWriteAdmissible` reads it (slot 1 still
    // 0 bytes, neither slot decodes) and with the live leaf its plan persisted (NEW-83).
    const leaf = await fs.lstat(plan.bootstrapIdentity.path);
    return entries[1]?.size === "0" && slots[0] === null && slots[1] === null &&
      leaf !== null && leaf.kind === "regular_file" && leaf.size === "0" && sameIdentity(leaf, plan.bootstrapIdentity)
      ? "incomplete"
      : "unverified";
  } catch {
    return "unverified";
  }
}

/**
 * Spec 2 §6's bootstrap-closure verdict from `state/fresh-v2-init.<id>.*`, as the CLI reads it:
 * terminal, unverified and altered envelopes are inert (Spec 2 §3.1, §6.4; NEW-123 decision B lets
 * a new `init` start beside an unverified one, with or without an active record). Exactly one
 * incomplete envelope is `non_terminal`, so recovery runs `init`; two or more are `malformed`.
 */
export async function readBootstrapClosure(
  fs: LauncherGuardedReaderV1,
  productHome: CanonicalAbsolutePathV1,
  effectiveUid: number,
): Promise<LauncherBootstrapClosureV1> {
  const stateDirectory = parseCanonicalAbsolutePathText(`${productHome}/state`);
  const directory = await fs.lstat(stateDirectory);
  if (directory === null) return { kind: "handoff_complete" };
  if (directory.kind !== "directory" || directory.ownerUid !== effectiveUid) return { kind: "malformed" };
  const ids: FreshV2InitIdV1[] = [];
  for await (const name of fs.names(directory)) {
    const match = FRESH_PLAN.exec(name);
    if (match !== null) ids.push(match[1] as FreshV2InitIdV1);
  }
  const statuses: EnvelopeStatusV1[] = [];
  for (const id of ids) statuses.push(await classifyEnvelope(fs, productHome, stateDirectory, id, effectiveUid));
  const incomplete = statuses.filter((status) => status === "incomplete").length;
  return incomplete === 0 ? { kind: "handoff_complete" } : incomplete === 1 ? { kind: "non_terminal" } : { kind: "malformed" };
}

/**
 * The packaged fallback in the keg the fixed table names (D84 K2/K3): the `opt` link is read once
 * and must resolve to exactly `<prefix>/Cellar/developer-os/<stable semver>`; never `PATH`, never
 * `brew`. Null when the link is absent or resolves anywhere else, so only the fallback route refuses
 * and an active release still launches without the keg (Review Focus 2).
 */
export async function resolvePackagedFallback(
  entry: (typeof PACKAGE_CHANNEL_SOURCE_TABLE)["arm64"],
): Promise<LauncherPackagedFallbackV1 | null> {
  try {
    const keg = resolve(dirname(entry.opt), await readlink(entry.opt));
    const cellar = `${entry.prefix}/Cellar/developer-os/`;
    if (!keg.startsWith(cellar) || (await realpath(entry.opt)) !== keg) return null;
    parseStableSemver(keg.slice(cellar.length));
    const fallback = `${keg}/${entry.fallback}`;
    return {
      prefix: entry.prefix,
      bundleRoot: parseCanonicalAbsolutePathText(`${fallback}/${PACKAGE_CHANNEL_LAYOUT.bundleRoot}`),
      manifestPath: parseCanonicalAbsolutePathText(`${fallback}/${PACKAGE_CHANNEL_LAYOUT.bundleManifest}`),
    };
  } catch {
    return null;
  }
}
