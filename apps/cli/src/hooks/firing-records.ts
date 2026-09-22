import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  decodeHookFiringRecord,
  encodeHookFiringRecord,
  hookFiringRecordName,
  MAX_HOOK_FIRING_RECORD_BYTES,
  MAX_HOOK_FIRING_RECORD_CHILDREN,
} from "@developer-os/core";
import type { HookFiringRecordV1 } from "@developer-os/core";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { assertOrdinaryCommandAdmitted } from "../bootstrap/report.js";
import type { HookVendor, HookVerb } from "./argv.js";

export const HOOK_EVENT_OF: Readonly<Record<HookVendor, Readonly<Record<HookVerb, string>> | null>> = Object.freeze({
  claude: Object.freeze({
    inject: "SessionStart",
    command: "PreToolUse",
    commit: "PreToolUse",
    path: "PreToolUse",
    format: "PostToolUse",
    edit: "PostToolUse",
    stop: "Stop",
    prompt: "UserPromptSubmit",
  }),
  codex: null,
});

export const FIRING_RECORD_REFRESH_MS = 86_400_000;

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

/** Spec §7.3: best effort after the outcome is written; never creates a directory, never throws. */
export async function recordHookFiring(request: HookFiringRequest): Promise<void> {
  try {
    const event = HOOK_EVENT_OF[request.vendor]?.[request.verb];
    if (event === undefined) return;
    const directory = join(request.stateDirectory, "hooks");
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.uid !== request.effectiveUid || (stats.mode & 0o777) !== 0o700) return;

    const name = hookFiringRecordName(request.vendor, event);
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

export async function readHookFiringObservations(stateDirectory: string, vendor: HookVendor): Promise<{
  readonly observations: ReadonlyMap<FiringKey, "observed">;
  readonly records: readonly HookFiringRecordV1[];
}> {
  const records: HookFiringRecordV1[] = [];
  try {
    const directory = join(stateDirectory, "hooks");
    if (!(await lstat(directory)).isDirectory()) return { observations: new Map(), records: [] };
    const names = (await readdir(directory))
      .filter((name) => name.startsWith(`${vendor}.`) && name.endsWith(".json"))
      .sort()
      .slice(0, MAX_HOOK_FIRING_RECORD_CHILDREN);
    for (const name of names) {
      const record = await readRecord(join(directory, name));
      if (record !== null && record.vendor === vendor && hookFiringRecordName(vendor, record.event) === name) {
        records.push(record);
      }
    }
  } catch {
    return { observations: new Map(), records: [] };
  }
  const observations = new Map<FiringKey, "observed">();
  if (records.length > 0) observations.set("plugin_hooks", "observed");
  const sessionStart = HOOK_EVENT_OF[vendor]?.inject;
  if (sessionStart !== undefined && records.some((record) => record.event === sessionStart)) {
    observations.set("session_start_injection", "observed");
  }
  return { observations, records };
}
