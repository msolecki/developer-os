#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createInterface } from "node:readline/promises";

import { MAX_CAPTURE_INPUT_BYTES } from "./commands/capture.js";
import { createProductionContext } from "./context.js";
import type { CliIo } from "./io.js";
import { run } from "./main.js";

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
   * **Reading stops one byte past the bound rather than continuing.** The
   * command owns the refusal — `MAX_CAPTURE_INPUT_BYTES` is its constant — but
   * the channel owns the memory, and `cat huge.log | developer-os capture`
   * must not be buffered whole to be told it is too large. One byte past is
   * exactly enough for the command to tell "at the bound" from "over it", and
   * nothing over the bound is ever written: it is refused, never shortened.
   */
  readStdin: async (): Promise<string | null> => {
    if (process.stdin.isTTY) return null;

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = chunk as Buffer;
      chunks.push(bytes);
      size += bytes.byteLength;
      if (size > MAX_CAPTURE_INPUT_BYTES) break;
    }
    return Buffer.concat(chunks).toString("utf8");
  },
};

const home = process.env.HOME;

if (home === undefined || home.length === 0) {
  process.stderr.write("HOME is not set; Developer OS cannot resolve paths\n");
  process.exitCode = 2;
} else {
  try {
    process.exitCode = await run(process.argv.slice(2), io, (commandIo) =>
      createProductionContext({
        io: commandIo,
        env: process.env,
        userHome: home,
      }),
    );
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
    process.exitCode = 1;
  }
}
