import { normalizeShellCommand } from "@developer-os/security";

import { excerpt } from "../outcome.js";
import { HOOK_TOOL_MATCHERS } from "../payload.js";
import type { HookVerbHandler } from "../registry.js";

export interface ShellRule<Id extends string> {
  readonly id: Id;
  readonly matches: (normalized: string) => boolean;
}

/**
 * Splits a normalized command at `;`, `&`, `|` (and `&&`, `||`) into tokenized segments,
 * honoring quotes: single quotes are literal, double quotes take backslash escapes, and a
 * backslash outside quotes makes the next character literal. Returns null for an unterminated
 * quote so the guards can fail closed.
 */
export function shellSegments(normalized: string): readonly (readonly string[])[] | null {
  const segments: string[][] = [];
  let tokens: string[] = [];
  let token = "";
  let started = false;
  let quote: "'" | '"' | null = null;
  const endToken = (): void => {
    if (started) tokens.push(token);
    token = "";
    started = false;
  };
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized.charAt(i);
    if (quote === "'") {
      if (char === "'") quote = null;
      else token += char;
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "\\" && i + 1 < normalized.length && '"\\$`'.includes(normalized.charAt(i + 1))) token += normalized.charAt(++i);
      else token += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === "\\") {
      token += normalized.charAt(++i);
      started = true;
    } else if (/\s/u.test(char)) {
      endToken();
    } else if (char === ";" || char === "&" || char === "|") {
      endToken();
      if (tokens.length > 0) segments.push(tokens);
      tokens = [];
      if (normalized.charAt(i + 1) === char && char !== ";") i += 1;
    } else {
      token += char;
      started = true;
    }
  }
  if (quote !== null) return null;
  endToken();
  if (tokens.length > 0) segments.push(tokens);
  return segments;
}

export function shellRuleGuard(rules: readonly ShellRule<string>[]): HookVerbHandler {
  return (payload, runtime) => {
    const shell = HOOK_TOOL_MATCHERS[runtime.vendor].shell;
    if (payload.toolName === null || !shell.includes(payload.toolName)) return Promise.resolve({ kind: "allow" });
    if (payload.command === null) {
      return Promise.resolve({ kind: "block", ruleId: "payload-malformed", detail: "shell command field absent" });
    }
    const normalized = normalizeShellCommand(payload.command);
    if (!normalized.ok) {
      return Promise.resolve({ kind: "block", ruleId: "nul-byte", detail: "command contains a NUL byte" });
    }
    if (shellSegments(normalized.text) === null) {
      return Promise.resolve({ kind: "block", ruleId: "unterminated-quote", detail: excerpt(normalized.text) });
    }
    const rule = rules.find((candidate) => candidate.matches(normalized.text));
    return Promise.resolve(
      rule === undefined ? { kind: "allow" } : { kind: "block", ruleId: rule.id, detail: excerpt(normalized.text) },
    );
  };
}
