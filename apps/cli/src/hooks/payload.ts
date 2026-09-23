import type { HookVendor, HookVerb } from "./argv.js";
import { applyPatchPaths } from "./patch.js";

export const MAX_HOOK_PAYLOAD_BYTES = 1_048_576;

export interface HookPayloadV1 {
  readonly cwd: string | null;
  readonly toolName: string | null;
  readonly command: string | null;
  readonly filePath: string | null;
  readonly prompt: string | null;
  readonly stopHookActive: boolean | null;
}

export type DecodedHookPayload =
  | { readonly ok: true; readonly payload: HookPayloadV1 }
  | {
      readonly ok: false;
      readonly reason:
        | "absent"
        | "too_large"
        | "not_utf8"
        | "nul"
        | "not_json"
        | "not_object"
        | "field_type";
    };

type FieldPath = readonly string[];
/** `null`: the vendor never sends the field. */
type FieldMap = Readonly<Record<keyof HookPayloadV1, FieldPath | null>>;

/** Codex spellings: `docs/architecture/hooks.md` §1 question 5 (0.155.1). */
const FIELD_MAPS: Readonly<Record<HookVendor, FieldMap>> = {
  claude: {
    cwd: ["cwd"],
    toolName: ["tool_name"],
    command: ["tool_input", "command"],
    filePath: ["tool_input", "file_path"],
    prompt: ["prompt"],
    stopHookActive: ["stop_hook_active"],
  },
  codex: {
    cwd: ["cwd"],
    toolName: ["tool_name"],
    command: ["tool_input", "command"],
    filePath: null,
    prompt: ["prompt"],
    stopHookActive: ["stop_hook_active"],
  },
};

/** Codex's shell arrives as `Bash` and a file edit as `apply_patch` (hooks.md §1 question 4). */
export const HOOK_TOOL_MATCHERS: Readonly<
  Record<HookVendor, Readonly<Record<"shell" | "file", readonly string[]>>>
> = {
  claude: { shell: ["Bash"], file: ["Edit", "Write", "MultiEdit"] },
  codex: { shell: ["Bash"], file: ["apply_patch"] },
};

/**
 * The paths a file tool call edits: Claude's `tool_input.file_path`, or the headers of Codex's
 * `apply_patch` body, which arrives in `tool_input.command`. `null` when absent or outside the
 * patch grammar.
 */
export function editedPaths(payload: HookPayloadV1, vendor: HookVendor): readonly string[] | null {
  if (vendor === "codex") return payload.command === null ? null : applyPatchPaths(payload.command);
  return payload.filePath === null ? null : [payload.filePath];
}

const REQUIRED: Readonly<Record<HookVerb, readonly (keyof HookPayloadV1)[]>> = {
  command: ["toolName"],
  commit: ["toolName"],
  path: ["toolName"],
  format: ["toolName"],
  edit: ["toolName"],
  prompt: ["prompt"],
  stop: ["stopHookActive"],
  inject: [],
};

function at(root: unknown, path: FieldPath | null): unknown {
  if (path === null) return undefined;
  let node: unknown = root;
  for (const key of path) {
    if (typeof node !== "object" || node === null || Array.isArray(node) || !Object.hasOwn(node, key)) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

export function decodeHookPayload(
  bytes: Uint8Array | null,
  vendor: HookVendor,
  verb: HookVerb,
): DecodedHookPayload {
  if (bytes === null) return { ok: false, reason: "absent" };
  if (bytes.byteLength > MAX_HOOK_PAYLOAD_BYTES) return { ok: false, reason: "too_large" };
  const map = FIELD_MAPS[vendor];
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "not_utf8" };
  }
  if (text.includes("\0")) return { ok: false, reason: "nul" };
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    return { ok: false, reason: "not_object" };
  }
  let wrongType = false;
  const str = (path: FieldPath | null): string | null => {
    const value = at(root, path);
    if (value === undefined) return null;
    if (typeof value === "string") return value;
    wrongType = true;
    return null;
  };
  const flag = at(root, map.stopHookActive);
  if (flag !== undefined && typeof flag !== "boolean") wrongType = true;
  const payload: HookPayloadV1 = {
    cwd: str(map.cwd),
    toolName: str(map.toolName),
    command: str(map.command),
    filePath: str(map.filePath),
    prompt: str(map.prompt),
    stopHookActive: typeof flag === "boolean" ? flag : null,
  };
  if (wrongType || REQUIRED[verb].some((field) => payload[field] === null)) {
    return { ok: false, reason: "field_type" };
  }
  return { ok: true, payload };
}
