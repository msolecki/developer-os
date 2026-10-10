import { basename } from "node:path";

import { BrainService } from "@developer-os/brain";
import type { BrainSessionContextV1 } from "@developer-os/brain";

import { createBootstrapEvidenceInspectionRequest } from "../bootstrap/context.js";
import { assertOrdinaryCommandAdmitted } from "../bootstrap/report.js";
import { dependenciesFor } from "../commands/brain-dependencies.js";
import { readConfigFile } from "../config-file.js";
import { redactorWithoutCreatingKey, runtimePathsFor } from "../context.js";
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
  const context = await runtime.createContext({ ...runtime.io, stdout: () => undefined }, { localRelease: null, packageChannelInit: false });
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
  // NEW-159: the user's `[redaction] patterns`, as capture and ingest apply; read, never create, the key.
  const redactor = redactorWithoutCreatingKey(context, config.redaction?.patterns ?? []);
  const redact = (value: string): string => redactor(value).text;
  // AUD-028: redact before truncating, so a secret straddling the byte cap cannot survive as a prefix.
  const { vaultMap, projectNote } = await service.sessionContext(slugify(basename(root)));
  const text = composeInjection({
    vaultMap: vaultMap === null ? null : redact(vaultMap),
    projectNote: projectNote === null ? null : { title: redact(projectNote.title), text: redact(projectNote.text) },
  });
  if (text === null) return { kind: "allow", note: "brain status --inject: nothing to inject" };
  return { kind: "context", text, redact };
}

/** A session never fails to start because of injection: every failure is `allow` with one note. */
export const injectBrainContext: HookVerbHandler = async (_payload, runtime) => {
  try {
    return await inject(runtime);
  } catch {
    return { kind: "allow", note: "brain status --inject: context unavailable" };
  }
};
