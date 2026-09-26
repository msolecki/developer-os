import { basename } from "node:path";

import type { HookVerbHandler } from "../registry.js";
import { commandWords, shellPipeline, shellRuleGuard } from "./shell-segments.js";
import type { ShellRule } from "./shell-segments.js";

const ROOT_OPERANDS = new Set(["/", "~", "$HOME", "${HOME}", "/*", "~/*", "$HOME/*", "${HOME}/*"]);
const recursiveFlag = (token: string): boolean => token === "--recursive" || /^-[A-Za-z]*[rR][A-Za-z]*$/u.test(token);
const rootOperand = (token: string): boolean =>
  !token.startsWith("-") && ROOT_OPERANDS.has(token.length > 1 ? token.replace(/\/+$/u, "") || "/" : token);

const DOWNLOADERS = new Set(["curl", "wget"]);
const SHELLS = new Set(["sh", "bash", "zsh", "ksh"]);
const INTERPRETER = /^(?:python[\d.]*|node|perl|ruby)$/u;
const SQL_CLIENTS = new Set(["psql", "mysql", "sqlite3"]);
const SQL_DESTRUCTIVE = /\b(?:drop\s+(?:table|database)|truncate)\b/iu;

const program = (words: readonly string[]): string => basename(words[0] ?? "");

const commands = (n: string): readonly (readonly string[])[] =>
  (shellPipeline(n) ?? []).map((segment) => commandWords(segment.tokens));

/** A `curl` or `wget` segment piped straight into a segment `target` accepts. */
function downloadPipedTo(n: string, target: (words: readonly string[]) => boolean): boolean {
  const segments = shellPipeline(n) ?? [];
  return segments.some(
    (segment, at) =>
      segment.pipesToNext &&
      DOWNLOADERS.has(program(commandWords(segment.tokens))) &&
      target(commandWords(segments[at + 1]?.tokens ?? [])),
  );
}

export const COMMAND_RULES: readonly ShellRule<
  "pipe-to-shell" | "pipe-to-interpreter" | "download-process-substitution" | "recursive-delete-root" | "sql-destructive"
>[] = [
  {
    id: "pipe-to-shell",
    matches: (n) =>
      /\b(?:curl|wget)\b[^|]*\|\s*(?:\S*\/)?(?:ba|z)?sh(?:\s|$)/iu.test(n) ||
      downloadPipedTo(n, (words) => SHELLS.has(program(words))),
  },
  {
    id: "pipe-to-interpreter",
    matches: (n) =>
      downloadPipedTo(
        n,
        (words) => INTERPRETER.test(program(words)) && (words.length === 1 || (words.length === 2 && words[1] === "-")),
      ),
  },
  {
    id: "download-process-substitution",
    matches: (n) =>
      (shellPipeline(n) ?? []).some(({ tokens }) =>
        tokens.some(
          (token, at) => token.startsWith("<(") && DOWNLOADERS.has(basename(token.slice(2) || (tokens[at + 1] ?? ""))),
        ),
      ),
  },
  {
    id: "recursive-delete-root",
    matches: (n) =>
      commands(n).some(
        (words) => program(words) === "rm" && words.slice(1).some(recursiveFlag) && words.slice(1).some(rootOperand),
      ),
  },
  {
    id: "sql-destructive",
    matches: (n) =>
      commands(n).some((words) => SQL_CLIENTS.has(program(words)) && SQL_DESTRUCTIVE.test(words.slice(1).join(" "))),
  },
];

export const guardCommand: HookVerbHandler = shellRuleGuard(COMMAND_RULES);
