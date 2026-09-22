import type { HookVendor, HookVerb } from "./argv.js";

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
        | "field_type"
        | "vendor_unobserved";
    };

type FieldPath = readonly string[];
type FieldMap = Readonly<Record<keyof HookPayloadV1, FieldPath>>;

const FIELD_MAPS: Readonly<Record<HookVendor, FieldMap | null>> = {
  claude: {
    cwd: ["cwd"],
    toolName: ["tool_name"],
    command: ["tool_input", "command"],
    filePath: ["tool_input", "file_path"],
    prompt: ["prompt"],
    stopHookActive: ["stop_hook_active"],
  },
  codex: null,
};

export const HOOK_TOOL_MATCHERS: Readonly<
  Record<HookVendor, Readonly<Record<"shell" | "file", readonly string[]>> | null>
> = {
  claude: { shell: ["Bash"], file: ["Edit", "Write", "MultiEdit"] },
  codex: null,
};

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

function at(root: unknown, path: FieldPath): unknown {
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
  if (map === null) return { ok: false, reason: "vendor_unobserved" };
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
  const str = (path: FieldPath): string | null => {
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
