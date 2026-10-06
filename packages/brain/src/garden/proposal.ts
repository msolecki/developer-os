export type GardenProposalKindV1 = "hub" | "related";

export interface GardenProposalV1 {
  readonly kind: GardenProposalKindV1;
  /** Content-relative path. */
  readonly target: string;
  /** The full note text: frontmatter block, then body. */
  readonly note: string;
}

export const GARDEN_MAX_PROPOSALS = 8;
export const GARDEN_NOTE_MAX_BYTES = 65_536;

const KINDS: ReadonlySet<string> = new Set(["hub", "related"]);
const RESPONSE_KEYS = ["proposals"];
const PROPOSAL_KEYS = ["kind", "note", "target"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === keys.join("\0");
}

function isProposal(value: unknown): value is GardenProposalV1 {
  return (
    isPlainObject(value) &&
    hasExactly(value, PROPOSAL_KEYS) &&
    typeof value.kind === "string" &&
    KINDS.has(value.kind) &&
    typeof value.target === "string" &&
    typeof value.note === "string"
  );
}

/**
 * The response schema, hand-rolled rather than zod: `packages/brain` depends on
 * `core`, `security` and `yaml` only, and `ingest/proposal.ts` parses its model
 * output the same way. Exact key sets at both levels; anything else is `null`,
 * which the caller turns into `agent_output_invalid`.
 */
export function parseGardenResponse(value: unknown): { readonly proposals: readonly GardenProposalV1[] } | null {
  if (!isPlainObject(value) || !hasExactly(value, RESPONSE_KEYS)) return null;
  const { proposals } = value;
  if (!Array.isArray(proposals) || !proposals.every(isProposal)) return null;
  return { proposals: proposals.map(({ kind, target, note }) => ({ kind, target, note })) };
}
