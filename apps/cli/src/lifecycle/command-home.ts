/**
 * The admission every V2 lifecycle command (`config`, `git`, `automation`) runs before it acts:
 * the home must classify as an installed V2 home, and a manifest-absent home that still carries
 * the global lock is re-classified under that lock, because it may be a mutation in flight.
 * This lives beside `admission.ts` rather than in it because `mutation-gate.ts` imports
 * `admission.ts`, and `classifyMutationHome` is the gate's.
 */
import type { HeldLifecycleStableLockV1 } from "@developer-os/core";

import type { CliContext } from "../context.js";
import { V2HomeAdmissionError } from "./admission.js";
import type { CliLifecycleContext } from "./context.js";
import { classifyMutationHome, globalLockPath } from "./mutation-gate.js";

/**
 * The lock is taken with `acquireExisting` and never created: a command on a home with no
 * installation must not leave one behind.
 */
async function reclassifyUnderGlobalLock(context: CliContext, lifecycle: CliLifecycleContext | undefined): Promise<boolean> {
  if (lifecycle === undefined) return false;
  const held = await lifecycle.locks.acquireExisting(globalLockPath(context.paths));
  try {
    return (await classifyMutationHome(context, lifecycle)).kind === "v2";
  } finally {
    await held.release();
  }
}

export async function admitV2Home(context: CliContext): Promise<CliLifecycleContext> {
  const lifecycle = context.lifecycle;
  const home = await classifyMutationHome(context, lifecycle);
  if (home.kind === "v1") throw new V2HomeAdmissionError("manifest_v1_not_migratable", [context.paths.manifestFile]);
  if (home.kind === "manifest_absent") throw new V2HomeAdmissionError("manifest_absent", [context.paths.manifestFile]);
  if (home.kind === "manifest_absent_with_global_lock" && !(await reclassifyUnderGlobalLock(context, lifecycle))) {
    throw new V2HomeAdmissionError("manifest_absent", [context.paths.manifestFile, globalLockPath(context.paths)]);
  }
  if (lifecycle === undefined) throw new Error("an admitted V2 home has no lifecycle context");
  return lifecycle;
}

export async function withGlobalLock<T>(
  context: CliContext,
  lifecycle: CliLifecycleContext,
  work: (global: HeldLifecycleStableLockV1) => Promise<T>,
): Promise<T> {
  const held = await lifecycle.locks.acquireExisting(globalLockPath(context.paths));
  try {
    return await work(held);
  } finally {
    await held.release();
  }
}
