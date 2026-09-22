import { isAbsolute, join, resolve } from "node:path";

import type { CanonicalAbsolutePathV1 } from "@developer-os/core";

/** Spec §2.2: `H`, `P` and `C`, resolved once per command. */
export interface VendorHomesV1 {
  readonly userHome: CanonicalAbsolutePathV1;
  readonly productHome: CanonicalAbsolutePathV1;
  readonly codexHome: CanonicalAbsolutePathV1;
}

/** `C` is `CODEX_HOME` when absolute, else `H/.codex`. `CLAUDE_CONFIG_DIR` is never followed. */
export function resolveVendorHomes(
  env: Readonly<Record<string, string | undefined>>,
  userHome: string,
  productHome: string,
): VendorHomesV1 {
  const home = resolve(userHome);
  const codexHome = env.CODEX_HOME;
  return {
    userHome: home as CanonicalAbsolutePathV1,
    productHome: resolve(productHome) as CanonicalAbsolutePathV1,
    codexHome: (codexHome !== undefined && isAbsolute(codexHome) ? resolve(codexHome) : join(home, ".codex")) as CanonicalAbsolutePathV1,
  };
}

export const claudeInstructionPaths = (homes: VendorHomesV1) => {
  const claude = join(homes.userHome, ".claude");
  return {
    pluginRoot: join(claude, "skills", "developer-os"),
    rulesDir: join(claude, "rules"),
    outputStylesDir: join(claude, "output-styles"),
    instructionFile: join(claude, "CLAUDE.md"),
    importDir: join(homes.productHome, "claude", "instructions"),
  } as const;
};

export const codexInstructionPaths = (homes: VendorHomesV1) =>
  ({
    agentsDir: join(homes.codexHome, "agents"),
    instructionFile: join(homes.codexHome, "AGENTS.md"),
    pluginRoot: join(homes.productHome, "codex", "plugins", "developer-os"),
    registrationFile: join(homes.productHome, "codex", "registration.json"),
  }) as const;
