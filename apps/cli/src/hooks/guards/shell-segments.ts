import { normalizeShellCommand } from "@developer-os/security";

import { excerpt } from "../outcome.js";
import { HOOK_TOOL_MATCHERS } from "../payload.js";
import type { HookVerbHandler } from "../registry.js";

export interface ShellRule<Id extends string> {
  readonly id: Id;
  readonly matches: (normalized: string) => boolean;
}

export function shellSegments(normalized: string): readonly (readonly string[])[] {
  return normalized
    .split(/\|\||&&|[;|&]/u)
    .map((segment) =>
      segment
        .trim()
        .split(/\s+/u)
        .filter((token) => token.length > 0)
        .map((token) => token.replace(/^(['"])(.*)\1$/u, "$2")),
    )
    .filter((tokens) => tokens.length > 0);
}

export function shellRuleGuard(rules: readonly ShellRule<string>[]): HookVerbHandler {
  return (payload, runtime) => {
    const shell = HOOK_TOOL_MATCHERS[runtime.vendor]?.shell ?? [];
    if (payload.toolName === null || !shell.includes(payload.toolName)) return Promise.resolve({ kind: "allow" });
    if (payload.command === null) {
      return Promise.resolve({ kind: "block", ruleId: "payload-malformed", detail: "shell command field absent" });
    }
    const normalized = normalizeShellCommand(payload.command);
    if (!normalized.ok) {
      return Promise.resolve({ kind: "block", ruleId: "nul-byte", detail: "command contains a NUL byte" });
    }
    const rule = rules.find((candidate) => candidate.matches(normalized.text));
    return Promise.resolve(
      rule === undefined ? { kind: "allow" } : { kind: "block", ruleId: rule.id, detail: excerpt(normalized.text) },
    );
  };
}
