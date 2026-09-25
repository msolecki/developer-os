#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { userInfo } from "node:os";
import { createInterface } from "node:readline/promises";

import { parseScheduledInvocation } from "./commands/automation/index.js";
import { MAX_CAPTURE_INPUT_BYTES } from "./commands/capture.js";
import { createProductionContext, PRODUCT_VERSION } from "./context.js";
import { hookLastResortExit, isHookInvocation } from "./hooks/argv.js";
import type { HookEnvironment } from "./hooks/entry.js";
import type { CliIo } from "./io.js";
import { run } from "./main.js";
import { LAUNCHER_TRUST_ARGUMENT } from "./update/context.js";
import { admitUnsignedLocalPackagedRelease } from "./update/packaged-release.js";

/**
 * One stdin chunk as bytes, whatever shape the stream handed over. A stream
 * with no encoding set yields `Buffer`; one with an encoding yields `string`;
 * neither is guaranteed by the types, which say `any`. Anything else is a
 * `TypeError` rather than a silently wrong byte count.
 */
function asBytes(chunk: unknown): Buffer {
  if (typeof chunk === "string") return Buffer.from(chunk, "utf8");
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  throw new TypeError("stdin yielded a chunk that is neither text nor bytes");
}

const io: CliIo = {
  stdout: (line: string) => {
    process.stdout.write(`${line}\n`);
  },
  stderr: (line: string) => {
    process.stderr.write(`${line}\n`);
  },
  /**
   * Prompts on stderr so `--json` output on stdout stays one parseable line, and
   * declines without asking when there is no terminal: an unattended run must
   * never be answered by whatever happens to be on stdin.
   */
  confirm: async (question: string): Promise<boolean> => {
    if (!process.stdin.isTTY) return false;

    const prompt = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      const answer = await prompt.question(`${question} [y/N] `);
      return answer.trim().toLowerCase() === "y";
    } finally {
      prompt.close();
    }
  },
  /**
   * `null` on a terminal, for the reason the docblock above gives: an
   * interactive `developer-os capture` with no `--text` must refuse rather
   * than hang on a terminal that will never send EOF.
   *
   * **`null` also when the stream ends without ever yielding a chunk.** `null`
   * is the contract's word for *nothing was piped*, and `developer-os capture
   * < /dev/null` piped nothing; returning `""` there made the command answer
   * "the observation supplied was empty", which describes an observation
   * nobody supplied.
   *
   * **Reading stops within one chunk of the bound.** The command owns the
   * refusal — `MAX_CAPTURE_INPUT_BYTES` is its constant — but the channel owns
   * the memory, and `cat huge.log | developer-os capture` must not be buffered
   * whole to be told it is too large. The loop tests the bound after each
   * chunk, so it holds at most one chunk more than the bound; that is enough
   * for the command to see a length over it, and nothing over the bound is
   * ever written — it is refused, never shortened.
   *
   * Leaving the loop early destroys the stream, so a writer still sending will
   * see `EPIPE`: `cat huge.log | developer-os capture` reports a broken pipe
   * from `cat` beside this command's refusal. That is the correct outcome —
   * the reader has refused the input and has no reason to keep draining it —
   * and it is recorded here because the second error surprises people.
   */
  readStdin: async (): Promise<string | null> => {
    if (process.stdin.isTTY) return null;

    const chunks: Buffer[] = [];
    let size = 0;
    /**
     * `unknown`, then narrowed. `@types/node` types a stream chunk as `any`,
     * and asserting `Buffer` was a trapdoor rather than a shortcut: anything
     * that set an encoding on `process.stdin` would yield strings, whose
     * `byteLength` is `undefined`, so `size` became `NaN`, the bound never
     * tripped, and `Buffer.concat` threw on the way out. Both shapes are now
     * handled and anything else fails loudly.
     */
    for await (const chunk of process.stdin as AsyncIterable<unknown>) {
      const bytes = asBytes(chunk);
      chunks.push(bytes);
      size += bytes.byteLength;
      if (size > MAX_CAPTURE_INPUT_BYTES) break;
    }
    return chunks.length === 0 ? null : Buffer.concat(chunks).toString("utf8");
  },
  readStdinBytes: async (limit: number): Promise<Uint8Array | null> => {
    if (process.stdin.isTTY) return null;

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin as AsyncIterable<unknown>) {
      const bytes = asBytes(chunk);
      chunks.push(bytes);
      size += bytes.byteLength;
      if (size > limit) break;
    }
    return chunks.length === 0 ? null : Buffer.concat(chunks).subarray(0, limit + 1);
  },
};

const home = process.env.HOME;
const launchedArgv = process.argv.slice(2);
// `update` reads FD 3 itself; the marker is not a public option, so no parser ever sees it.
const argv = launchedArgv[0] === LAUNCHER_TRUST_ARGUMENT ? launchedArgv.slice(1) : launchedArgv;
const hookMode = isHookInvocation(argv);
const scheduledMode = parseScheduledInvocation(argv) !== null;
const hookEnvironment = (userHome: string | null): HookEnvironment => ({
  env: process.env,
  userHome,
  processCwd: () => process.cwd(),
  nodeExecutable: process.execPath,
});

if ((home === undefined || home.length === 0) && !scheduledMode) {
  if (hookMode) {
    try {
      process.exitCode = await run(argv, io, () => {
        throw new Error("HOME is not set");
      }, hookEnvironment(null));
    } catch (error) {
      io.stderr(error instanceof Error ? `developer-os failed: ${error.name}` : "developer-os failed unexpectedly");
      process.exitCode = hookLastResortExit(argv);
    }
  } else {
    process.stderr.write("HOME is not set; Developer OS cannot resolve paths\n");
    process.exitCode = 2;
  }
} else {
  try {
    process.exitCode = await run(argv, io, async (commandIo, request) => {
      // §5.3: a scheduled run's user home is the account record, never the ambient `HOME`.
      if (request.scheduledProductHome !== undefined) {
        return createProductionContext({
          io: commandIo,
          env: { DEVELOPER_OS_HOME: request.scheduledProductHome },
          userHome: userInfo().homedir,
          localRelease: null,
        });
      }
      if (home === undefined) throw new Error("HOME is not set");
      return createProductionContext({
        io: commandIo,
        env: process.env,
        userHome: home,
        localRelease: request.localRelease === null
          ? null
          : await admitUnsignedLocalPackagedRelease(request.localRelease, PRODUCT_VERSION),
      });
    },
    hookMode && home !== undefined ? hookEnvironment(home) : undefined);
  } catch (error) {
    /**
     * Last resort. An escaping rejection here would otherwise surface as an
     * unhandled top-level rejection: a stack trace carrying absolute paths, no
     * result line, and an exit status nobody chose.
     */
    io.stderr(
      error instanceof Error
        ? `developer-os failed: ${error.name}`
        : "developer-os failed unexpectedly",
    );
    process.exitCode = hookMode ? hookLastResortExit(argv) : 1;
  }
}
