import { normalizeShellCommand } from "@developer-os/security";

import { excerpt } from "../outcome.js";
import { HOOK_TOOL_MATCHERS } from "../payload.js";
import type { HookVerbHandler } from "../registry.js";

export interface ShellRule<Id extends string> {
  readonly id: Id;
  readonly matches: (normalized: string) => boolean;
}

/**
 * Splits a normalized command at `;`, `&`, `|` (and `&&`, `||`) and an unquoted LF into tokenized
 * segments, honoring quotes: single quotes are literal, double quotes take backslash escapes, and a
 * backslash outside quotes makes the next character literal. A `#` that starts a word comments out
 * the rest of its line, and a heredoc body is skipped, so neither opens a quote or arms a heredoc.
 * Returns null for an unterminated quote so the guards can fail closed.
 */
export function shellSegments(normalized: string): readonly (readonly string[])[] | null {
  const segments: string[][] = [];
  let tokens: string[] = [];
  let token = "";
  let started = false;
  let quote: "'" | '"' | null = null;
  // A `<<` arms a heredoc; the delimiter is the rest of that token, or the next token.
  let armed: { readonly stripTabs: boolean; readonly from: number } | null = null;
  const heredocs: { readonly delimiter: string; readonly stripTabs: boolean }[] = [];
  const endToken = (): void => {
    if (armed !== null && started && token.length > armed.from) {
      const delimiter = token.slice(armed.from);
      // `1 << 3` and `$((1<<2))` shift; a delimiter starting with a digit or `)` arms nothing (fail closed).
      if (!/^[\d)]/u.test(delimiter)) heredocs.push({ delimiter, stripTabs: armed.stripTabs });
      armed = null;
    } else if (armed !== null && armed.from > 0) {
      armed = { ...armed, from: 0 };
    }
    if (started) tokens.push(token);
    token = "";
    started = false;
  };
  const endSegment = (): void => {
    endToken();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
  };
  // Returns the index just past the last pending heredoc's delimiter line, or -1 when a delimiter
  // line never comes (`$((1<<2))` is no heredoc), so every later LF still splits (fail closed).
  const heredocBodyEnd = (from: number): number => {
    let at = from;
    for (const { delimiter, stripTabs } of heredocs) {
      for (;;) {
        if (at > normalized.length) return -1;
        const lineEnd = normalized.indexOf("\n", at);
        const end = lineEnd === -1 ? normalized.length : lineEnd;
        const line = normalized.slice(at, end);
        at = end + 1;
        if ((stripTabs ? line.replace(/^\t+/u, "") : line) === delimiter) break;
      }
    }
    return at - 1;
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
    } else if (char === "\n") {
      endToken();
      const bodyEnd = heredocs.length > 0 ? heredocBodyEnd(i + 1) : -1;
      heredocs.length = 0;
      // A heredoc body is data, not shell text: skip it to the LF that ends its delimiter line.
      if (bodyEnd > i) i = bodyEnd - 1;
      else endSegment();
    } else if (char === "#" && !started) {
      // A comment runs to the next LF, which still ends the segment.
      const lineEnd = normalized.indexOf("\n", i);
      i = (lineEnd === -1 ? normalized.length : lineEnd) - 1;
    } else if (/\s/u.test(char)) {
      endToken();
    } else if (char === ";" || char === "&" || char === "|") {
      endSegment();
      if (normalized.charAt(i + 1) === char && char !== ";") i += 1;
    } else if (normalized.startsWith("<<<", i)) {
      // A here-string is a plain word; consumed whole so its tail `<<` arms no heredoc.
      token += "<<<";
      i += 2;
      started = true;
    } else if (normalized.startsWith("<<", i)) {
      const stripTabs = normalized.charAt(i + 2) === "-";
      token += stripTabs ? "<<-" : "<<";
      i += stripTabs ? 2 : 1;
      started = true;
      armed = { stripTabs, from: token.length };
    } else {
      token += char;
      started = true;
    }
  }
  if (quote !== null) return null;
  endSegment();
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
      return Promise.resolve({ kind: "block", ruleId: "unterminated-quote", detail: excerpt(runtime.redact(normalized.text)) });
    }
    // D63: each physical line, trimmed, is also a candidate, so a line that blocks on its own blocks
    // whatever the segment analysis made of quotes, comments, heredocs or `$'…'` around it.
    const candidates = [normalized.text, ...payload.command.split(/\r\n|\r|\n/u).map((line) => line.trim())];
    const rule = rules.find((candidate) => candidates.some((text) => candidate.matches(text)));
    return Promise.resolve(
      rule === undefined ? { kind: "allow" } : { kind: "block", ruleId: rule.id, detail: excerpt(runtime.redact(normalized.text)) },
    );
  };
}
