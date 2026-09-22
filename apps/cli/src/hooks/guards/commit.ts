import { basename } from "node:path";

import type { HookVerbHandler } from "../registry.js";
import { shellRuleGuard, shellSegments } from "./shell-segments.js";
import type { ShellRule } from "./shell-segments.js";

const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]);

function gitSubcommand(tokens: readonly string[]): { readonly name: string; readonly rest: readonly string[] } | null {
  if (basename(tokens[0] ?? "") !== "git") return null;
  let i = 1;
  while (i < tokens.length && (tokens[i] ?? "").startsWith("-")) i += GIT_VALUE_OPTIONS.has(tokens[i] ?? "") ? 2 : 1;
  const name = tokens[i];
  return name === undefined ? null : { name, rest: tokens.slice(i + 1) };
}

function options(
  rest: readonly string[],
  valueShort: string,
  valueLong: ReadonlySet<string>,
  attachedOnly = "",
): readonly string[] {
  const found: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (token === "--") break;
    if (token.startsWith("--")) {
      found.push(token);
      if (valueLong.has(token)) i += 1;
    } else if (/^-[A-Za-z]+$/u.test(token)) {
      for (let at = 1; at < token.length; at += 1) {
        const letter = token.charAt(at);
        found.push(`-${letter}`);
        if (valueShort.includes(letter)) {
          if (at === token.length - 1) i += 1;
          break;
        }
        // git commit's -S and -u take their optional value attached (-Skey, -uno), never as the next token.
        if (attachedOnly.includes(letter)) break;
      }
    }
  }
  return found;
}

const COMMIT_VALUE_LONG = new Set(["--message", "--file", "--author", "--date", "--template", "--reuse-message", "--reedit-message", "--fixup", "--squash", "--cleanup"]);
const PUSH_VALUE_LONG = new Set(["--repo", "--push-option", "--receive-pack", "--exec"]);

function gitCalls(normalized: string): readonly { readonly name: string; readonly rest: readonly string[] }[] {
  return (shellSegments(normalized) ?? []).flatMap((tokens) => gitSubcommand(tokens) ?? []);
}

export const COMMIT_RULES: readonly ShellRule<"hook-bypass" | "force-push">[] = [
  {
    id: "hook-bypass",
    matches: (n) =>
      gitCalls(n).some(({ name, rest }) =>
        name === "commit"
          ? options(rest, "mFCct", COMMIT_VALUE_LONG, "Su").some((o) => o === "--no-verify" || o === "-n")
          : name === "push" && options(rest, "o", PUSH_VALUE_LONG).includes("--no-verify"),
      ),
  },
  {
    id: "force-push",
    matches: (n) =>
      gitCalls(n).some(
        ({ name, rest }) =>
          name === "push" &&
          (options(rest, "o", PUSH_VALUE_LONG).some((o) => o === "--force" || o === "-f") ||
            rest.some((token) => token.startsWith("+"))),
      ),
  },
];

export const guardCommit: HookVerbHandler = shellRuleGuard(COMMIT_RULES);
