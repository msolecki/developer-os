import { HOOK_GUARD_KINDS, HOOK_VENDORS } from "@developer-os/core";
import type { HookGuardKind, HookVendor, HookVerb } from "@developer-os/core";

export { HOOK_GUARD_KINDS };
export type { HookGuardKind, HookVendor, HookVerb };

const VENDORS: readonly string[] = HOOK_VENDORS;
const SECURITY: readonly string[] = ["command", "path", "commit"];

export const HOOK_FAIL_MODE: Readonly<Record<HookVerb, "closed" | "open">> = Object.freeze({
  command: "closed",
  path: "closed",
  commit: "closed",
  stop: "open",
  format: "open",
  prompt: "open",
  edit: "open",
  inject: "open",
});

export type HookArgv =
  | { readonly ok: true; readonly verb: HookVerb; readonly vendor: HookVendor }
  | { readonly ok: false; readonly failMode: "closed" | "open"; readonly vendor: HookVendor };

export function isHookInvocation(argv: readonly string[]): boolean {
  return argv[0] === "guard" || argv.includes("--inject");
}

function vendorOf(value: string | undefined): HookVendor | null {
  return value !== undefined && VENDORS.includes(value) ? (value as HookVendor) : null;
}

/**
 * Accepts exactly the rendered command's token sequence. `main.ts`'s `parse`
 * keeps refusing `guard` and `--inject`, because `run` never reaches it with them.
 */
export function parseHookArgv(argv: readonly string[]): HookArgv {
  const refusal = (): HookArgv => ({
    ok: false,
    failMode: argv[0] === "guard" && SECURITY.includes(argv[1] ?? "") ? "closed" : "open",
    vendor: "claude",
  });
  if (argv[0] === "guard" && argv.length === 4 && argv[2] === "--vendor") {
    const kind = argv[1] ?? "";
    const vendor = vendorOf(argv[3]);
    if (vendor === null || !(HOOK_GUARD_KINDS as readonly string[]).includes(kind)) return refusal();
    return { ok: true, verb: kind as HookGuardKind, vendor };
  }
  if (
    argv.length === 5 &&
    argv[0] === "brain" &&
    argv[1] === "status" &&
    argv[2] === "--inject" &&
    argv[3] === "--vendor"
  ) {
    const vendor = vendorOf(argv[4]);
    return vendor === null ? refusal() : { ok: true, verb: "inject", vendor };
  }
  return refusal();
}

/** The exit a hook-mode process must use when nothing else could decide one. */
export function hookLastResortExit(argv: readonly string[]): 0 | 2 {
  const parsed = parseHookArgv(argv);
  const mode = parsed.ok ? HOOK_FAIL_MODE[parsed.verb] : parsed.failMode;
  return mode === "closed" ? 2 : 0;
}
