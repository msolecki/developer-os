import { EXIT_CODES } from "../result.js";
import { hasExactKeys, isRecord } from "../shape.js";
import { assertNotWorkflowId, parseInstructionId } from "./bounds.js";
import type { InstructionCategoryV1, InstructionIdV1 } from "./bounds.js";

export interface InstructionCatalogRowV1 {
  readonly category: Exclude<InstructionCategoryV1, "command" | "vendor-file">;
  readonly id: InstructionIdV1;
  readonly legacyName: string;
  readonly vendors: readonly ("claude" | "codex")[];
  readonly thinCommand: boolean;
}

export interface InstructionCatalogV1 {
  readonly schemaVersion: 1;
  readonly artifacts: readonly InstructionCatalogRowV1[];
}

export class InstructionCatalogInvalidError extends Error {
  readonly code = EXIT_CODES.invalidInput;
  readonly reason = "instruction_catalog_invalid" as const;

  constructor() {
    super("instruction_catalog_invalid: the release's instructions/catalog.json is invalid");
    this.name = "InstructionCatalogInvalidError";
  }
}

const CATEGORIES: ReadonlySet<string> = new Set(["rule", "scoped-rule", "output-style", "agent", "skill"]);
const ROW_KEYS = ["category", "id", "legacyName", "thinCommand", "vendors"];
const encoder = new TextEncoder();

function invalid(): never {
  throw new InstructionCatalogInvalidError();
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, keys);
}

function row(value: unknown, workflowIds: ReadonlySet<string>): InstructionCatalogRowV1 {
  if (!isExactRecord(value, ROW_KEYS)) invalid();
  const { category, id, legacyName, thinCommand, vendors } = value;
  if (typeof category !== "string" || !CATEGORIES.has(category)) invalid();
  if (typeof id !== "string") invalid();
  let parsed: InstructionIdV1;
  try {
    parsed = parseInstructionId(id);
    assertNotWorkflowId(parsed, workflowIds);
  } catch {
    invalid();
  }
  if (typeof legacyName !== "string" || legacyName.length === 0 || encoder.encode(legacyName).byteLength > 256) invalid();
  if (typeof thinCommand !== "boolean" || (thinCommand && category !== "skill")) invalid();
  if (
    !Array.isArray(vendors) ||
    !(
      (vendors.length === 1 && (vendors[0] === "claude" || vendors[0] === "codex")) ||
      (vendors.length === 2 && vendors[0] === "claude" && vendors[1] === "codex")
    )
  ) {
    invalid();
  }
  return {
    category: category as InstructionCatalogRowV1["category"],
    id: parsed,
    legacyName,
    vendors: [...(vendors as ("claude" | "codex")[])],
    thinCommand,
  };
}

/** Strict keys; rows strictly ascending by `(category, id)`, so sorted and unique. */
export function validateInstructionCatalog(value: unknown, workflowIds: ReadonlySet<string>): InstructionCatalogV1 {
  if (!isExactRecord(value, ["artifacts", "schemaVersion"]) || value.schemaVersion !== 1 || !Array.isArray(value.artifacts)) {
    invalid();
  }
  const artifacts = value.artifacts.map((item) => row(item, workflowIds));
  for (let index = 1; index < artifacts.length; index += 1) {
    const previous = artifacts[index - 1];
    const current = artifacts[index];
    if (previous === undefined || current === undefined) invalid();
    const order =
      previous.category === current.category
        ? previous.id < current.id
        : previous.category < current.category;
    if (!order) invalid();
  }
  return { schemaVersion: 1, artifacts };
}
