import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  decodeHookFiringRecord,
  encodeHookFiringRecord,
  hookFiringRecordName,
  MAX_HOOK_FIRING_RECORD_BYTES,
} from "@developer-os/core";
import type { HookFiringRecordV1 } from "@developer-os/core";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { assertOrdinaryCommandAdmitted } from "../bootstrap/report.js";
import { HOOK_GUARD_KINDS } from "./argv.js";
import type { HookVendor, HookVerb } from "./argv.js";

const PASCAL_CASE_EVENTS: Readonly<Record<HookVerb, string>> = Object.freeze({
  inject: "SessionStart",
  command: "PreToolUse",
  commit: "PreToolUse",
  path: "PreToolUse",
  format: "PostToolUse",
  edit: "PostToolUse",
  stop: "Stop",
  prompt: "UserPromptSubmit",
});

/** Codex keys its hooks document with the same PascalCase names (hooks.md §1 question 4). */
export const HOOK_EVENT_OF: Readonly<Record<HookVendor, Readonly<Record<HookVerb, string>>>> = Object.freeze({
  claude: PASCAL_CASE_EVENTS,
  codex: PASCAL_CASE_EVENTS,
});

export const FIRING_RECORD_REFRESH_MS = 86_400_000;

const HOOK_VERBS: readonly HookVerb[] = ["inject", ...HOOK_GUARD_KINDS];

type FiringKey = "plugin_hooks" | "session_start_injection";

export interface HookFiringRequest {
  readonly productHome: string;
  readonly stateDirectory: string;
  readonly userHome: string;
  readonly vendor: HookVendor;
  readonly verb: HookVerb;
  readonly now: Date;
  readonly productVersion: string;
  readonly effectiveUid: number;
  /** Test seam; defaults to the ordinary-command gate every command passes. */
  readonly admit?: () => Promise<void>;
}

async function readRecord(path: string): Promise<HookFiringRecordV1 | null> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await handle.stat()).isFile()) return null;
      const buffer = Buffer.alloc(MAX_HOOK_FIRING_RECORD_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
      if (bytesRead > MAX_HOOK_FIRING_RECORD_BYTES) return null;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
      return decodeHookFiringRecord(text);
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * Spec §7.3: best effort after the outcome is written; never creates a directory, never throws. One
 * record per verb, named `<vendor>.<verb>.json`, carrying the verb's event: `command`, `commit` and
 * `path` share `PreToolUse`, and a per-event record would hide an untrusted `path` behind a firing
 * `command` (hooks.md §3.7).
 */
export async function recordHookFiring(request: HookFiringRequest): Promise<void> {
  try {
    const event = HOOK_EVENT_OF[request.vendor][request.verb];
    const directory = join(request.stateDirectory, "hooks");
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.uid !== request.effectiveUid || (stats.mode & 0o777) !== 0o700) return;

    const name = hookFiringRecordName(request.vendor, request.verb);
    const target = join(directory, name);
    const existing = await readRecord(target);
    const valid = existing !== null && existing.vendor === request.vendor && existing.event === event;
    if (valid && request.now.getTime() - Date.parse(existing.lastSeen) < FIRING_RECORD_REFRESH_MS) return;

    await (request.admit ?? (() =>
      assertOrdinaryCommandAdmitted(createBootstrapEvidenceInspectionRequest({
        productHome: request.productHome,
        stateDirectory: request.stateDirectory,
        initialRoots: [request.productHome, request.stateDirectory, request.userHome],
      }))))();

    const now = request.now.toISOString();
    const text = encodeHookFiringRecord({
      schemaVersion: 1,
      vendor: request.vendor,
      event,
      productVersion: request.productVersion,
      firstSeen: valid ? existing.firstSeen : now,
      lastSeen: now,
    });
    const temp = `${target}.tmp-${randomBytes(8).toString("hex")}`;
    try {
      const handle = await open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(text, "utf8");
      } finally {
        await handle.close();
      }
      await rename(temp, target);
    } catch {
      await unlink(temp).catch(() => undefined);
    }
  } catch {
    // A firing record is an observation, never a reason to change the hook's outcome.
  }
}

export interface HookFiringObservation {
  readonly verb: HookVerb;
  readonly record: HookFiringRecordV1;
}

/** Reads the vendor's per-verb records only; a record whose event is not its verb's is ignored. */
export async function readHookFiringObservations(stateDirectory: string, vendor: HookVendor): Promise<{
  readonly observations: ReadonlyMap<FiringKey, "observed">;
  readonly records: readonly HookFiringObservation[];
}> {
  const records: HookFiringObservation[] = [];
  try {
    const directory = join(stateDirectory, "hooks");
    if (!(await lstat(directory)).isDirectory()) return { observations: new Map(), records: [] };
    for (const verb of HOOK_VERBS) {
      const record = await readRecord(join(directory, hookFiringRecordName(vendor, verb)));
      if (record !== null && record.vendor === vendor && record.event === HOOK_EVENT_OF[vendor][verb]) {
        records.push({ verb, record });
      }
    }
  } catch {
    return { observations: new Map(), records: [] };
  }
  const observations = new Map<FiringKey, "observed">();
  if (records.length > 0) observations.set("plugin_hooks", "observed");
  if (records.some((record) => record.verb === "inject")) {
    observations.set("session_start_injection", "observed");
  }
  return { observations, records };
}
