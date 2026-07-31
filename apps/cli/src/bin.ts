#!/usr/bin/env node

import { createInterface } from "node:readline/promises";

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
