#!/usr/bin/env node
/**
 * The stable launcher's composition root. It resolves platform identity and
 * the product home, admits a launcher candidate, constructs the shell-free
 * process request `selection.ts` produces, writes the FD 3 offline-trust
 * handoff when one is configured, and execs it.
 *
 * `ponytail:` the bootstrap-closure reader is not wired for real here — a
 * real reader (walking the plan/journal/retention envelope) is Task 9's
 * territory, reused rather than reimplemented once its read-only reader is
 * exposed to this package. Until then this always reports `handoff_complete`,
 * which is safe (it only ever *widens* which candidate can route to normal
 * active/fallback selection, never past `LauncherBundleAdmission`'s guarded
 * checks) but not yet the full §6 recovery routing.
 */
import { arch, platform as nodePlatform } from "node:os";

import { admitLauncherPlatformIdentity } from "@developer-os/platform-macos";
import { resolveRuntimePaths } from "@developer-os/core";
import type {
  CanonicalAbsolutePathV1,
  OfflineReleaseTrustV1,
  OfflineRootKeyV1,
} from "@developer-os/core";

import { buildLauncherEnvironment } from "./environment.js";
import {
  compileLauncherOfflineReleaseTrust,
  createLauncherRetainedDocumentVerifier,
  execAdmittedRelease,
} from "./handoff.js";
import { createNodeLauncherReader } from "./reader.js";
import { buildLauncherProcessRequest, selectLauncherCandidate } from "./selection.js";

/**
 * ponytail: the founder has not yet decided the production offline root key
 * or its permitted metadata-redirect origins (that decision, and wiring
 * real compiled constants here, is Task 11b's territory) — both empty
 * rather than guessed or hardcoded in the meantime. Empty roots alone
 * already makes `compileLauncherOfflineReleaseTrust` return `null`: no FD 3
 * pipe is opened and `verifyRetainedDocument` refuses every retained
 * document it is asked to check, which only ever routes a present active
 * release into recovery (never past `LauncherBundleAdmission`'s guarded
 * checks) — the same safe-widening invariant the bootstrap-closure stub
 * above documents.
 */
const LAUNCHER_OFFLINE_RELEASE_ROOTS: readonly OfflineRootKeyV1[] = [];
const LAUNCHER_METADATA_REDIRECT_ORIGINS: OfflineReleaseTrustV1["metadataRedirectOrigins"] = [];

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

  // ponytail: the package-manager-owned fallback location is Homebrew formula
  // work (Spec 2 §2, A16) and not yet wired; resolved relative to this
  // launcher's own install directory as a placeholder.
  const launcherRoot = new URL("../fallback", import.meta.url).pathname as CanonicalAbsolutePathV1;

  const selection = await selectLauncherCandidate({
    productHome,
    platform,
    effectiveUid,
    fs,
    packagedFallback: {
      bundleRoot: `${launcherRoot}/bundle` as CanonicalAbsolutePathV1,
      manifestPath: `${launcherRoot}/bundle-manifest.json` as CanonicalAbsolutePathV1,
    },
    // ponytail: always reports the terminal state until Task 9's read-only
    // bootstrap-closure reader is exposed to this package; see the module
    // docblock above.
    bootstrapClosure: { kind: "handoff_complete" },
    verifyRetainedDocument: createLauncherRetainedDocumentVerifier(LAUNCHER_OFFLINE_RELEASE_ROOTS),
  });

  const trust = compileLauncherOfflineReleaseTrust({
    acceptedRoots: LAUNCHER_OFFLINE_RELEASE_ROOTS,
    metadataRedirectOrigins: LAUNCHER_METADATA_REDIRECT_ORIGINS,
  });
  const request = buildLauncherProcessRequest(selection, env, process.argv.slice(2), trust !== null);

  const outcome = await execAdmittedRelease(request, trust);
  process.exitCode = outcome.code ?? (outcome.signal === null ? 1 : 128);
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
