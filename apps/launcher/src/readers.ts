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

async function classifyPlan(
  fs: LauncherGuardedReaderV1,
  productHome: CanonicalAbsolutePathV1,
  stateDirectory: CanonicalAbsolutePathV1,
  id: FreshV2InitIdV1,
  effectiveUid: number,
): Promise<LauncherBootstrapClosureV1> {
  const envelope = deriveBootstrapEnvelopePaths(productHome, id);
  const planBytes = await readStateFile(fs, envelope.plan, effectiveUid, BOOTSTRAP_MAX_PLAN_BYTES);
  if (planBytes === null) return { kind: "malformed" };
  const plan = admitBootstrapEvidencePlan(
    decodeCanonicalJson(planBytes, BOOTSTRAP_MAX_PLAN_BYTES),
    { productHome, stateDirectory, expectedId: id },
    createCanonicalPathEvidence(),
  );
  const slots: (unknown)[] = [];
  for (const path of envelope.journalSlots) {
    const bytes = await readStateFile(fs, path, effectiveUid, BOOTSTRAP_MAX_JOURNAL_BYTES);
    if (bytes === null) return { kind: "malformed" };
    slots.push(bytes.byteLength === 0 ? null : decodeCanonicalJson(bytes, BOOTSTRAP_MAX_JOURNAL_BYTES));
  }
  // A published plan whose slots are both still empty reservations: `init` resumes it (NEW-83).
  if (slots[0] === null && slots[1] === null) return { kind: "non_terminal" };
  const selection = selectBootstrapEvidenceJournal(plan, [slots[0], slots[1]]);
  if (selection === null) return { kind: "malformed" };
  return TERMINAL_PHASES.has(selection.current.phase) ? { kind: "handoff_complete" } : { kind: "non_terminal" };
}

/**
 * Spec 2 §6's bootstrap-closure verdict from `state/fresh-v2-init.<id>.*`: no plan is
 * `handoff_complete`; one plan is classified by its admitted journal's phase; more than one plan,
 * or anything that does not admit, is `malformed`.
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
  if (ids.length === 0) return { kind: "handoff_complete" };
  if (ids.length > 1) return { kind: "malformed" };
  try {
    return await classifyPlan(fs, productHome, stateDirectory, ids[0] as FreshV2InitIdV1, effectiveUid);
  } catch {
    return { kind: "malformed" };
  }
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
      bundleRoot: parseCanonicalAbsolutePathText(`${fallback}/${PACKAGE_CHANNEL_LAYOUT.bundleRoot}`),
      manifestPath: parseCanonicalAbsolutePathText(`${fallback}/${PACKAGE_CHANNEL_LAYOUT.bundleManifest}`),
    };
  } catch {
    return null;
  }
}
