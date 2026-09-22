import type { ProcessRunner } from "@developer-os/security";

import type { CliContext } from "../context.js";
import type { CliIo } from "../io.js";
import type { HookVendor, HookVerb } from "./argv.js";
import { guardCommand } from "./guards/command.js";
import { guardCommit } from "./guards/commit.js";
import { guardPath } from "./guards/path.js";
import { injectBrainContext } from "./inject.js";
import type { HookOutcome } from "./outcome.js";
import type { HookPayloadV1 } from "./payload.js";
import { guardEdit } from "./guards/edit.js";
import { guardFormat } from "./guards/format.js";
import { guardPrompt } from "./guards/prompt.js";
import { guardStop } from "./guards/stop.js";

/** Structurally `main.ts`'s `CliContextFactory`; importing it would pull the whole command graph in. */
export type HookContextFactory = (
  io: CliIo,
  request: { readonly localRelease: string | null },
) => CliContext | Promise<CliContext>;

export interface HookRuntime {
  readonly vendor: HookVendor;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly userHome: string | null;
  readonly cwd: string;
  readonly runner: ProcessRunner;
  readonly nodeExecutable: string;
  readonly now: () => Date;
  readonly io: CliIo;
  readonly createContext: HookContextFactory;
}

export type HookVerbHandler = (payload: HookPayloadV1, runtime: HookRuntime) => Promise<HookOutcome>;

export const HOOK_HANDLERS: Partial<Record<HookVerb, HookVerbHandler>> = {
  command: guardCommand,
  commit: guardCommit,
  path: guardPath,
  stop: guardStop,
  format: guardFormat,
  prompt: guardPrompt,
  edit: guardEdit,
  inject: injectBrainContext,
};
