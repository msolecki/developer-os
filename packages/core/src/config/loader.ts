import { isAbsolute } from "node:path";

import { parse, stringify } from "smol-toml";
import { z } from "zod";

import type { DeveloperOsConfigV1 } from "./types.js";

const absolutePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\0"), {
    message: "Path must not contain NUL bytes",
  })
  .refine(isAbsolute, {
    message: "Path must be absolute",
  });

const configSchema = z
  .object({
    schemaVersion: z.literal(1),
    brainPath: absolutePathSchema,
    adapters: z
      .object({
        claude: z.boolean(),
        codex: z.boolean(),
      })
      .strict(),
    git: z
      .object({
        enabled: z.boolean(),
      })
      .strict(),
    automation: z
      .object({
        enabled: z.boolean(),
      })
      .strict(),
    telemetry: z.literal(false),
  })
  .strict();

export function loadConfig(source: string): DeveloperOsConfigV1 {
  return configSchema.parse(parse(source));
}

export function serializeConfig(config: DeveloperOsConfigV1): string {
  const validated = configSchema.parse(config);

  return stringify({
    schemaVersion: validated.schemaVersion,
    brainPath: validated.brainPath,
    adapters: {
      claude: validated.adapters.claude,
      codex: validated.adapters.codex,
    },
    git: {
      enabled: validated.git.enabled,
    },
    automation: {
      enabled: validated.automation.enabled,
    },
    telemetry: validated.telemetry,
  });
}
