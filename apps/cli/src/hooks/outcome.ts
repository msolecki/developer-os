import { screenAndCap } from "@developer-os/security";

import type { CliIo } from "../io.js";
import type { HookVendor } from "./argv.js";

export type HookOutcome =
  | { readonly kind: "allow"; readonly note?: string }
  | { readonly kind: "context"; readonly text: string; readonly redact?: (text: string) => string }
  | { readonly kind: "block"; readonly ruleId: string; readonly detail: string }
  | { readonly kind: "advise"; readonly ruleId: string; readonly detail: string };

export const MAX_HOOK_REASON_BYTES = 2048;
export const MAX_MATCHED_EXCERPT_BYTES = 200;
const MAX_CONTEXT_BYTES = 16_384;

export function capUtf8Bytes(text: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength <= maxBytes) return text;
  return new TextDecoder("utf-8", { fatal: false }).decode(encoded.subarray(0, maxBytes)).replace(/�$/u, "");
}

export function excerpt(input: string): string {
  return capUtf8Bytes(input, MAX_MATCHED_EXCERPT_BYTES);
}

interface OutcomeMap {
  readonly block: number;
  readonly advise: number;
}

const OUTCOME_MAPS: Readonly<Record<HookVendor, OutcomeMap | null>> = {
  claude: { block: 2, advise: 2 },
  codex: null,
};

// screenAndCap counts graphemes, not bytes, so the byte bound is applied after it.
function line(text: string, redact: (text: string) => string, maxBytes: number): string {
  return capUtf8Bytes(screenAndCap(redact(text), maxBytes), maxBytes);
}

// screenControlCharacters collapses every whitespace run, LF included, so multi-line context is
// screened line by line and rejoined; otherwise the injected vault map would arrive as one line.
function block(text: string, redact: (text: string) => string, maxBytes: number): string {
  const screened = redact(text)
    .split("\n")
    .map((part) => screenAndCap(part, maxBytes))
    .join("\n");
  return capUtf8Bytes(screened, maxBytes);
}

export function writeHookOutcome(
  outcome: HookOutcome,
  vendor: HookVendor,
  io: Pick<CliIo, "stdout" | "stderr">,
  redact: (text: string) => string,
): number {
  const map = OUTCOME_MAPS[vendor];
  if (map === null) {
    io.stderr(`developer-os: ${vendor} hook outcome map is unobserved; allowing`);
    return 0;
  }
  switch (outcome.kind) {
    case "allow":
      if (outcome.note !== undefined) io.stderr(line(`developer-os: ${outcome.note}`, redact, MAX_HOOK_REASON_BYTES));
      return 0;
    case "context":
      io.stdout(block(outcome.text, outcome.redact ?? redact, MAX_CONTEXT_BYTES));
      return 0;
    case "block":
    case "advise":
      io.stderr(line(`developer-os ${outcome.ruleId}: ${outcome.detail}`, redact, MAX_HOOK_REASON_BYTES));
      return map[outcome.kind];
  }
}
