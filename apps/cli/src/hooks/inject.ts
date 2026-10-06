import { randomBytes } from "node:crypto";
import { basename } from "node:path";

import { BrainService } from "@developer-os/brain";
import type { BrainSessionContextV1 } from "@developer-os/brain";
import { createRedactor } from "@developer-os/security";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { assertOrdinaryCommandAdmitted } from "../bootstrap/report.js";
import { dependenciesFor } from "../commands/brain-dependencies.js";
import { readConfigFile } from "../config-file.js";
import { readRedactionKey, REDACTION_KEY_BYTES, runtimePathsFor } from "../context.js";
import { slugify } from "../project-slug.js";
import { capUtf8Bytes } from "./outcome.js";
import type { HookOutcome } from "./outcome.js";
import { resolveProjectRoot } from "./project-root.js";
import type { HookRuntime, HookVerbHandler } from "./registry.js";

export const MAX_INJECTED_CONTEXT_BYTES = 16_384;
export const VAULT_MAP_TRUNCATED_MARKER = "[developer-os: vault map truncated]";

const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength;

/** The vault map is truncated first, at a line boundary, so the project note survives whole (`hooks.md` §3.4.1). */
export function composeInjection(context: BrainSessionContextV1): string | null {
  const note = context.projectNote === null ? "" : `# ${context.projectNote.title}\n\n${context.projectNote.text}`;
  if (context.vaultMap === null) return note === "" ? null : capUtf8Bytes(note, MAX_INJECTED_CONTEXT_BYTES);
  const separator = note === "" ? "" : "\n\n";
  const budget = MAX_INJECTED_CONTEXT_BYTES - byteLength(note) - byteLength(separator);
  let map = context.vaultMap;
  if (byteLength(map) > budget) {
    const cut = capUtf8Bytes(map, Math.max(0, budget - byteLength(`\n${VAULT_MAP_TRUNCATED_MARKER}`)));
    map = `${cut.slice(0, Math.max(0, cut.lastIndexOf("\n")))}\n${VAULT_MAP_TRUNCATED_MARKER}`;
  }
  return capUtf8Bytes(`${map}${separator}${note}`, MAX_INJECTED_CONTEXT_BYTES);
}

async function inject(runtime: HookRuntime): Promise<HookOutcome> {
  const context = await runtime.createContext({ ...runtime.io, stdout: () => undefined }, { localRelease: null });
  await assertOrdinaryCommandAdmitted(
    createBootstrapEvidenceInspectionRequest({
      productHome: context.paths.home,
      stateDirectory: context.paths.stateDir,
      initialRoots: [context.paths.home, context.paths.stateDir, context.userHome],
    }),
  );
  const config = await readConfigFile(context, context.paths.configFile);
  if (config === null) return { kind: "allow", note: "brain status --inject: no configuration" };
  const service = new BrainService(dependenciesFor(context, runtimePathsFor(context, config).brain, config));
  const root = await resolveProjectRoot(runtime.cwd);
  const text = composeInjection(await service.sessionContext(slugify(basename(root))));
  if (text === null) return { kind: "allow", note: "brain status --inject: nothing to inject" };
  // NEW-159: the user's `[redaction] patterns`, as capture and ingest apply; read, never create, the key.
  const redact = createRedactor(readRedactionKey(context.paths.stateDir) ?? randomBytes(REDACTION_KEY_BYTES), {
    userPatterns: config.redaction?.patterns ?? [],
  });
  return { kind: "context", text, redact: (value) => redact(value).text };
}

/** A session never fails to start because of injection: every failure is `allow` with one note. */
export const injectBrainContext: HookVerbHandler = async (_payload, runtime) => {
  try {
    return await inject(runtime);
  } catch {
    return { kind: "allow", note: "brain status --inject: context unavailable" };
  }
};
