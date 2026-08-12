import { discoverCli } from "@developer-os/security";
import type { CliInstallation } from "@developer-os/security";

/**
 * The vendor-CLI boundary — discover a version without ever throwing — is
 * the same shape for every adapter and lives in `packages/security/src/cli.ts`
 * (Task 3.5), alongside the identical binding on the Claude adapter's side
 * (its own `discover.ts`). This file is only the Codex binding onto it.
 */

export type CodexInstallation = CliInstallation;

export const discoverCodex = discoverCli;
