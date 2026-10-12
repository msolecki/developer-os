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
import { guardPrompt } from "./guards/prompt.js";

/** Structurally `main.ts`'s `CliContextFactory`; importing it would pull the whole command graph in. */
export type HookContextFactory = (
  io: CliIo,
  request: { readonly localRelease: string | null; readonly packageChannelInit: boolean },
) => CliContext | Promise<CliContext>;

export interface HookRuntime {
  readonly vendor: HookVendor;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly userHome: string | null;
  readonly cwd: string;
  readonly runner: ProcessRunner;
  readonly nodeExecutable: string;
  /** Applied before a guard truncates any input it echoes: a cut secret no longer matches the redactor. */
  readonly redact: (text: string) => string;
  readonly io: CliIo;
  readonly createContext: HookContextFactory;
}

export type HookVerbHandler = (payload: HookPayloadV1, runtime: HookRuntime) => Promise<HookOutcome>;

/**
 * D102 (AUD-006, NEW-251): `stop` and `format` run no project tool, because a cloned repository's
 * `node_modules` is untrusted code. They stay installed and registered as no-ops, so a `hooks.json`
 * written by an earlier build keeps exiting cleanly.
 */
const runsNoProjectTool: HookVerbHandler = () => Promise.resolve({ kind: "allow" });

export const HOOK_HANDLERS: Partial<Record<HookVerb, HookVerbHandler>> = {
  command: guardCommand,
  commit: guardCommit,
  path: guardPath,
  stop: runsNoProjectTool,
  format: runsNoProjectTool,
  prompt: guardPrompt,
  edit: guardEdit,
  inject: injectBrainContext,
};
