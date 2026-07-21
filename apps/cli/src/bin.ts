#!/usr/bin/env node

import { run } from "./main.js";

const code = await run(process.argv.slice(2), {
  stdout: (line: string) => {
    process.stdout.write(`${line}\n`);
  },
  stderr: (line: string) => {
    process.stderr.write(`${line}\n`);
  },
  confirm: () => Promise.resolve(false),
});

process.exitCode = code;
