#!/usr/bin/env node
/**
 * The stable launcher's composition root. It resolves platform identity and
 * the product home, reads the bootstrap closure, resolves the keg's packaged
 * fallback from the fixed table, admits a launcher candidate, and execs the
 * shell-free process request `selection.ts` produces with stdio only.
 */
import { arch, platform as nodePlatform } from "node:os";

import { admitLauncherPlatformIdentity } from "@developer-os/platform-macos";
import { PACKAGE_CHANNEL_SOURCE_TABLE, resolveRuntimePaths } from "@developer-os/core";
import type { CanonicalAbsolutePathV1 } from "@developer-os/core";

import { buildLauncherEnvironment } from "./environment.js";
import { execAdmittedRelease } from "./handoff.js";
import { createNodeLauncherReader } from "./reader.js";
import { readBootstrapClosure, readUpdateEnvelope, resolvePackagedFallback } from "./readers.js";
import { buildLauncherProcessRequest, selectLauncherCandidate } from "./selection.js";

async function main(): Promise<void> {
  const platform = admitLauncherPlatformIdentity({ platform: nodePlatform(), architecture: arch() });

  const home = process.env.HOME;
  if (home === undefined || home.length === 0) {
    process.stderr.write("developer-os-launcher: HOME is not set\n");
    process.exitCode = 2;
    return;
  }
  // Spec 2 §3.1: "resolves the product home from the same guarded
  // default/DEVELOPER_OS_HOME grammar as the CLI, without resolving a
  // Brain" — `.brain` is discarded on purpose.
  const productHome = resolveRuntimePaths({
    HOME: home,
    ...(process.env.DEVELOPER_OS_HOME === undefined ? {} : { DEVELOPER_OS_HOME: process.env.DEVELOPER_OS_HOME }),
  }).home as CanonicalAbsolutePathV1;

  const env = buildLauncherEnvironment({
    home,
    productHome,
    brainOverride: process.env.DEVELOPER_OS_BRAIN ?? null,
  });

  const effectiveUid = process.getuid?.() ?? -1;
  const fs = createNodeLauncherReader(effectiveUid);

  const selection = await selectLauncherCandidate({
    productHome,
    platform,
    effectiveUid,
    fs,
    packagedFallback: await resolvePackagedFallback(PACKAGE_CHANNEL_SOURCE_TABLE[platform.architecture]),
    bootstrapClosure: (handoff) => readBootstrapClosure(fs, productHome, effectiveUid, handoff),
    readUpdateEnvelope: (coordinatorId) => readUpdateEnvelope(fs, productHome, coordinatorId, effectiveUid),
  });

  process.exitCode = await execAdmittedRelease(buildLauncherProcessRequest(selection, env, process.argv.slice(2)));
}

function exitCodeOf(error: unknown): number {
  if (typeof error !== "object" || error === null || !("code" in error)) return 1;
  const code = (error as { readonly code: unknown }).code;
  return typeof code === "number" ? code : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`developer-os-launcher: ${error instanceof Error ? error.message : "failed"}\n`);
  process.exitCode = exitCodeOf(error);
});
