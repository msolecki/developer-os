import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { cwd as processCwd } from "node:process";

import {
  EXIT_CODES,
  containsPath,
  failure,
  hashBytes,
  success,
  validateChangePlan,
} from "@developer-os/core";
import type { CliResult, ExitCode } from "@developer-os/core";
import { createRedactor } from "@developer-os/security";
import type { RedactionScope, Redactor } from "@developer-os/security";

import {
  REDACTION_KEY_BYTES,
  failureFrom,
  readRedactionKey,
  renderPath,
  runtimePathsFor,
} from "../context.js";
import type { CliContext, CliGuards } from "../context.js";
import { readAdmittedManifest, readConfigFile } from "./doctor.js";
import {
  PROJECT_TEMPLATE,
  PROJECT_TEMPLATE_MAX_BYTES,
} from "./project-template.js";
import type { ProjectTemplateFile } from "./project-template.js";
import { EMPTY_MANIFEST } from "./quarantine.js";
import { UntrustedFileRefusal, readUntrustedText } from "./untrusted-file.js";

export interface ProjectInitResultV1 {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly created: readonly string[];
  readonly overridden: readonly string[];
  readonly transactionId: string | null;
}

export interface ProjectInitOptions {
  readonly dir: string | null;
  readonly dryRun: boolean;
}

export interface ProjectInitDependencies {
  readonly cwd: () => string;
  readonly templates: readonly ProjectTemplateFile[];
}

const DEFAULT_DEPENDENCIES: ProjectInitDependencies = {
  cwd: () => processCwd(),
  templates: PROJECT_TEMPLATE,
};

type FailureExitCode = Exclude<ExitCode, typeof EXIT_CODES.success>;

/** `failureFrom` derives `kind` from the class name; these refusals need the spec's named kinds. */
class ProjectInitRefusal extends Error {
  readonly code: FailureExitCode;
  readonly kind: string;
  readonly paths: readonly string[];
  readonly recovery: string | undefined;

  constructor(
    code: FailureExitCode,
    kind: string,
    message: string,
    paths: readonly string[] = [],
    recovery?: string,
  ) {
    super(message);
    this.name = "ProjectInitRefusal";
    this.code = code;
    this.kind = kind;
    this.paths = paths;
    this.recovery = recovery;
  }
}

function isMissingEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

async function lstatOrNull(context: CliContext, path: string) {
  try {
    return await context.fs.lstat(path, { bigint: true });
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }
}

function guardsWith(guards: CliGuards, redact: Redactor): CliGuards {
  return {
    ...guards,
    redactDiagnostic: (text: string, scope?: RedactionScope): string =>
      redact(text, scope).text,
  };
}

interface ResolvedTemplates {
  readonly files: readonly ProjectTemplateFile[];
  readonly overridden: readonly string[];
  readonly warnings: readonly string[];
}

async function resolveOverrides(
  context: CliContext,
  home: string,
  templates: readonly ProjectTemplateFile[],
  redact: Redactor,
): Promise<ResolvedTemplates> {
  const directory = join(home, "templates", "project");
  const stats = await lstatOrNull(context, directory);
  if (stats === null || !stats.isDirectory()) {
    return { files: templates, overridden: [], warnings: [] };
  }

  const names = new Set(templates.map((file) => file.name));
  const entries = [...(await context.fs.readdir(directory))].sort();
  const warnings = entries
    .filter((entry) => !names.has(entry))
    .map((entry) => `ignored the override ${entry}: it is not a project template name`);

  const replaced = new Map<string, string>();
  for (const entry of entries.filter((name) => names.has(name))) {
    const path = join(directory, entry);
    let content: string;
    try {
      content = await readUntrustedText(context, path, PROJECT_TEMPLATE_MAX_BYTES);
    } catch (error) {
      if (error instanceof UntrustedFileRefusal) {
        throw new ProjectInitRefusal(error.code, "project_template_unreadable", error.message, [path]);
      }
      throw error;
    }
    if (redact(content).findings.length > 0) {
      throw new ProjectInitRefusal(
        EXIT_CODES.securityRefusal,
        "project_template_secret",
        "the override holds a value the redactor flags; project files may be pushed, so nothing was written",
        [path],
        "remove the secret from the override, or delete the override to use the default",
      );
    }
    replaced.set(entry, content);
  }

  return {
    files: templates.map((file) => ({
      name: file.name,
      content: replaced.get(file.name) ?? file.content,
    })),
    overridden: templates.map((file) => file.name).filter((name) => replaced.has(name)),
    warnings,
  };
}

/** Spec §6. Every refusal below happens before any write. */
export async function runProjectInit(
  context: CliContext,
  options: ProjectInitOptions,
  dependencies: ProjectInitDependencies = DEFAULT_DEPENDENCIES,
): Promise<CliResult<ProjectInitResultV1>> {
  let guards = context.guards;
  try {
    const { templates } = dependencies;
    if (templates.length === 0) {
      throw new ProjectInitRefusal(
        EXIT_CODES.capabilityUnavailable,
        "project_templates_unavailable",
        "this build ships no project templates, so there is nothing to write",
      );
    }

    const config = await readConfigFile(context, context.paths.configFile);
    if (config === null) {
      throw new ProjectInitRefusal(
        EXIT_CODES.operationalFailure,
        "project_not_initialized",
        "Developer OS is not initialized, so there is no product home to journal into",
        [context.paths.configFile],
        "developer-os init",
      );
    }
    const paths = runtimePathsFor(context, config);
    // Never creates a key (plan Global Constraints): redaction here only decides whether a finding exists.
    const redact = createRedactor(
      readRedactionKey(paths.stateDir) ?? randomBytes(REDACTION_KEY_BYTES),
      { userPatterns: config.redaction?.patterns ?? [] },
    );
    guards = guardsWith(context.guards, redact);

    const target = resolve(dependencies.cwd(), options.dir ?? ".");
    const root = await context.guards.canonicalize(target);
    const rootStats = await lstatOrNull(context, root);
    if (rootStats === null || !rootStats.isDirectory()) {
      throw new ProjectInitRefusal(
        EXIT_CODES.invalidInput,
        "project_root_not_directory",
        "the project root is not an existing directory",
        [target],
      );
    }

    for (const product of [paths.home, paths.brain]) {
      const canonical = await context.guards.canonicalize(product);
      if (containsPath(root, canonical) || containsPath(canonical, root)) {
        throw new ProjectInitRefusal(
          EXIT_CODES.securityRefusal,
          "project_root_overlaps_product",
          "the project root overlaps the product home or the Brain",
          [target, product],
        );
      }
    }

    const resolved = await resolveOverrides(context, paths.home, templates, redact);

    const existing: string[] = [];
    for (const file of resolved.files) {
      const path = join(root, file.name);
      if ((await lstatOrNull(context, path)) !== null) existing.push(path);
    }
    if (existing.length > 0) {
      throw new ProjectInitRefusal(
        EXIT_CODES.decisionRequired,
        "project_file_exists",
        "project init is create-only, and these files already exist; nothing was written",
        existing,
        "move or delete the listed files, then run project init again",
      );
    }

    const created = resolved.files.map((file) => file.name);
    const result = (transactionId: string | null): CliResult<ProjectInitResultV1> =>
      success(
        { schemaVersion: 1, root, created, overridden: resolved.overridden, transactionId },
        resolved.warnings,
      );
    if (options.dryRun) return result(null);

    const contents = resolved.files.map((file) => new TextEncoder().encode(file.content));
    const validated = await validateChangePlan(
      {
        schemaVersion: 1,
        productVersion: context.productVersion,
        operations: resolved.files.map((file, index) => ({
          targetPath: join(root, file.name),
          operation: "create" as const,
          owner: "core" as const,
          kind: "file" as const,
          expectedBeforeHash: null,
          source: "project-init",
          mergeStrategy: "dedicated" as const,
          proposedHash: hashBytes(contents[index] ?? new Uint8Array()),
        })),
      },
      {
        manifest: (await readAdmittedManifest(context, paths)) ?? EMPTY_MANIFEST,
        ownedRoots: [root],
        excludedRoots: [paths.home, paths.brain],
        canonicalize: context.guards.canonicalize,
      },
    );

    const journal = await context.executor.execute({
      kind: "project-init",
      mutations: validated.operations.map((operation, index) => ({
        targetPath: operation.canonicalTargetPath,
        operation: "create" as const,
        content: contents[index] ?? new Uint8Array(),
      })),
    });
    return result(journal.id);
  } catch (error) {
    if (error instanceof ProjectInitRefusal) {
      return failure(error.code, {
        kind: error.kind,
        message: guards.redactDiagnostic(error.message),
        paths: error.paths,
        ...(error.recovery === undefined
          ? {}
          : { recovery: guards.redactDiagnostic(error.recovery) }),
      });
    }
    return failureFrom({ guards }, error);
  }
}

export function renderProjectInit(result: ProjectInitResultV1): readonly string[] {
  return [
    result.transactionId === null
      ? "Developer OS would create:"
      : "Developer OS created:",
    ...result.created.map((path) => `  ${renderPath(path)}`),
  ];
}
