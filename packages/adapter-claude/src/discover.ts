import { discoverCli } from "@developer-os/security";
import type { CliInstallation } from "@developer-os/security";

/**
 * `discoverCli`, `screenValueArgument` and `parseStructuredPayload` moved to
 * `packages/security/src/cli.ts` (Task 3.5): the vendor-CLI boundary is the
 * same shape for every adapter, and this file is now only the
 * Claude-specific binding onto it.
 */

export type ClaudeInstallation = CliInstallation;

export const discoverClaude = discoverCli;
