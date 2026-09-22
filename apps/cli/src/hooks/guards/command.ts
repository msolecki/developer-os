import { basename } from "node:path";

import type { HookVerbHandler } from "../registry.js";
import { shellRuleGuard, shellSegments } from "./shell-segments.js";
import type { ShellRule } from "./shell-segments.js";

const ROOT_OPERANDS = new Set(["/", "~", "$HOME", "${HOME}"]);
const recursiveFlag = (token: string): boolean => token === "--recursive" || /^-[A-Za-z]*[rR][A-Za-z]*$/u.test(token);
const rootOperand = (token: string): boolean =>
  !token.startsWith("-") && ROOT_OPERANDS.has(token.length > 1 ? token.replace(/\/+$/u, "") || "/" : token);

export const COMMAND_RULES: readonly ShellRule<"pipe-to-shell" | "recursive-delete-root">[] = [
  { id: "pipe-to-shell", matches: (n) => /\b(?:curl|wget)\b[^|]*\|\s*(?:\S*\/)?(?:ba|z)?sh(?:\s|$)/iu.test(n) },
  {
    id: "recursive-delete-root",
    matches: (n) =>
      shellSegments(n).some(
        (tokens) =>
          basename(tokens[0] ?? "") === "rm" && tokens.slice(1).some(recursiveFlag) && tokens.slice(1).some(rootOperand),
      ),
  },
];

export const guardCommand: HookVerbHandler = shellRuleGuard(COMMAND_RULES);
