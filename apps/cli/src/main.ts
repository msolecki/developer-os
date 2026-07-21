import {
  EXIT_CODES,
  failure,
  formatJsonResult,
  success,
  type ExitCode,
} from "@developer-os/core";

import type { CliIo } from "./io.js";

export type { CliIo } from "./io.js";

const usage = "Usage: developer-os --version [--json]";

export function run(argv: readonly string[], io: CliIo): Promise<ExitCode> {
  const json = argv.includes("--json");
  const commandArguments = argv.filter((argument) => argument !== "--json");

  if (commandArguments.length === 1 && commandArguments[0] === "--version") {
    if (json) {
      io.stdout(formatJsonResult(success({ version: "0.0.0" })));
    } else {
      io.stdout("developer-os 0.0.0");
    }

    return Promise.resolve(EXIT_CODES.success);
  }

  if (json) {
    io.stdout(
      formatJsonResult(
        failure(EXIT_CODES.invalidInput, {
          kind: "invalid_input",
          message: usage,
          paths: [],
        }),
      ),
    );
  } else {
    io.stderr(usage);
  }

  return Promise.resolve(EXIT_CODES.invalidInput);
}
