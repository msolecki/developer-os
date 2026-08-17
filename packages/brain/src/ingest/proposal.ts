/**
 * One note the model proposes writing. Nothing else: no operation, no mode, no
 * target other than a path — the proposal describes *what a note would say*,
 * and Developer OS decides what happens to it.
 */
export interface ProposedNote {
  /**
   * **Relative to the content root**, not to the vault — `DEV/a.md` under a
   * default configuration resolves to `<vault>/content/DEV/a.md`. The prompt
   * and the JSON Schema both say so to the model in those words, and whoever
   * turns this field into a real filesystem path joins it to
   * `BrainConfigV1.contentRoot`; joining it to the vault root instead writes
   * every proposed note one directory too high, outside the only subtree
   * `ingest` is allowed to touch.
   *
   * POSIX-separated, ending in `.md`, and carried through **byte for byte**.
   * Paths are byte-exact everywhere in this package
   * (`docs/architecture/brain.md` §5): a path is an identifier a user has to
   * be able to act on, and a normalizing parser would hand the transaction a
   * different filename than the one the model named.
   */
  readonly path: string;
  /** The whole note: frontmatter block, then body. */
  readonly contents: string;
  /** The `captureId` this note was derived from. */
  readonly sourceCaptureId: string;
}

export interface IngestProposal {
  readonly schemaVersion: 1;
  readonly notes: readonly ProposedNote[];
}

/**
 * One word per refusal a caller can act on, and no message. The payload is
 * model output, so echoing any part of it back into a diagnostic would put
 * attacker-influenced text into a log — the same rule
 * `parseAgentPromptArgs` follows for a `with` block.
 */
export type IngestProposalRefusal =
  | "unparseable"
  | "unknown-key"
  | "reserved-key"
  | "schema-version"
  | "oversized"
  | "unsafe-path"
  | "missing-provenance"
  | "duplicate-path";

export type IngestProposalOutcome =
  | { readonly ok: true; readonly proposal: IngestProposal }
  | { readonly ok: false; readonly reason: IngestProposalRefusal };

/**
 * Bounds on model output, not policy about what a good note looks like — the
 * nine validators of spec §6.3 own that. These are the point past which a
 * proposal stops being a proposal and becomes a way to make Developer OS write
 * for as long as the model keeps talking, and an unbounded parser is how that
 * becomes the transaction's problem instead of this function's.
 *
 * The character bound is the same order as `MAX_FRONTMATTER_CHARS`, which
 * bounds the quadratic YAML parse a note's frontmatter would otherwise reach;
 * counting UTF-16 code units for the same reason it does.
 */
export const MAX_PROPOSED_NOTES = 32;
export const MAX_PROPOSED_NOTE_CHARS = 64 * 1024;
export const MAX_PROPOSED_PATH_CHARS = 512;

const NOTE_EXTENSION = ".md";
const PROPOSAL_KEYS = new Set(["schemaVersion", "notes"]);
const NOTE_KEYS = new Set(["path", "contents", "sourceCaptureId"]);

/**
 * `\p{Cc}` and `\p{Cf}`, refused rather than screened. Every other surface in
 * this product *rewrites* a control character to a space, because it is
 * displaying prose; a path is not prose. A NUL truncates the name a syscall
 * actually opens, and U+202E reorders the printed line a user is asked to
 * approve — neither is something to silently repair on the model's behalf,
 * and repairing it would produce a filename nobody proposed.
 */
const PATH_CONTROL = /[\p{Cc}\p{Cf}]/u;

function refuse(reason: IngestProposalRefusal): IngestProposalOutcome {
  return { ok: false, reason };
}

/**
 * The two forms of `__proto__`, because only one of them arrives over the wire
 * and a screen checking one passes the other.
 *
 * `JSON.parse` creates an **own** property and leaves the prototype alone;
 * an object literal writing `__proto__:` **sets the prototype** and creates no
 * own property. `packages/core`'s `parseAgentPromptArgs` and
 * `workflow-schema`'s `validateWorkflow` both screen the own-property form
 * only, which is right for them — both parse text and never see a literal.
 * This parser is reached from both directions: `JSON.parse` in production, a
 * literal in every test that describes what production must refuse.
 *
 * Screening at all is the correction those two files record: `zod@4.4.3`
 * strips `__proto__` *before* its own strictness check, so a hostile object
 * carrying one passes `.strict()` and the key silently disappears rather than
 * being refused. Never remove this on the grounds that a schema covers it.
 */
function carriesReservedKey(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return true;
  return Object.prototype.hasOwnProperty.call(value, "__proto__");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKey(value: object, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).some((key) => !allowed.has(key));
}

/**
 * The path rules that are properties of the *string*, and only those.
 *
 * Refusing an absolute path, a traversal, a separator that is not `/` and a
 * control character are all answerable without touching a filesystem, which is
 * what makes them this parser's. **They are not the write-scope enforcement of
 * spec §6.4**, which canonicalizes every path through Foundation, resolves
 * symlinks, and checks the destination against `PRIVATE_FOLDERS`, the
 * configured indexes directory and the workflow's declared write scopes. That
 * check needs a real vault and belongs to the validators; nothing here may be
 * read as having discharged it.
 */
function pathViolation(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PROPOSED_PATH_CHARS) return true;
  if (!path.endsWith(NOTE_EXTENSION) || path === NOTE_EXTENSION) return true;
  if (path.includes("\\") || PATH_CONTROL.test(path)) return true;
  return path
    .split("/")
    .some((segment) => segment === "" || segment === "." || segment === "..");
}

function parseNote(value: unknown): ProposedNote | IngestProposalRefusal {
  if (!isPlainObject(value)) return "unparseable";
  if (carriesReservedKey(value)) return "reserved-key";
  if (unknownKey(value, NOTE_KEYS)) return "unknown-key";

  const { path, contents, sourceCaptureId } = value;
  if (
    typeof path !== "string" ||
    typeof contents !== "string" ||
    typeof sourceCaptureId !== "string"
  ) {
    /**
     * A `sourceCaptureId` that is absent or of the wrong type is the
     * provenance refusal rather than a shape one: "a proposed note does not
     * name the capture it came from" is a sentence the caller can act on,
     * and it is the first of the nine validators this parser can answer
     * without a vault.
     */
    return typeof sourceCaptureId !== "string" ? "missing-provenance" : "unparseable";
  }

  if (sourceCaptureId.length === 0) return "missing-provenance";
  if (pathViolation(path)) return "unsafe-path";
  if (contents.length === 0 || contents.length > MAX_PROPOSED_NOTE_CHARS) {
    return "oversized";
  }

  /**
   * Rebuilt field by field rather than handed back, so nothing the payload
   * carried rides along into the validators, and a getter cannot return one
   * value to this function and another to whoever reads the note next.
   *
   * **The identity of `sourceCaptureId` is deliberately not checked here.**
   * Spec §6.3's source-and-provenance validator compares it against the
   * capture actually being ingested, which is a stronger check than any
   * format rule and needs a context this package does not have. A regex here
   * would be a third copy of the capture-id format — `capture/build.ts`
   * writes it and `capture/parse.ts` checks it — and a rule that exists three
   * times is a rule that will be corrected twice.
   */
  return Object.freeze({ path, contents, sourceCaptureId });
}

/**
 * The parser for what an ingest agent returns, and the one place in this
 * product where hostile input is the **expected** case rather than the edge
 * one: this payload comes from a model that has just read captured material
 * an attacker may have written.
 *
 * Total over any `unknown`, which the signature promises. A throwing getter, a
 * hostile `Proxy` and a revoked `Proxy` all escaped the first version of the
 * two functions this one is modelled on; a validator that aborts on one
 * hostile input cannot report on the rest.
 *
 * What it does **not** do is the nine validators of spec §6.3. It answers only
 * what is answerable from the payload itself — shape, reserved keys, bounds,
 * path form and provenance presence. Frontmatter, links, duplicates against
 * the existing vault, the secret scan and write-scope enforcement all need a
 * real vault and are the validators' own.
 */
export function parseIngestProposal(payload: unknown): IngestProposalOutcome {
  try {
    return parse(payload);
  } catch {
    return refuse("unparseable");
  }
}

function parse(payload: unknown): IngestProposalOutcome {
  if (!isPlainObject(payload)) return refuse("unparseable");
  if (carriesReservedKey(payload)) return refuse("reserved-key");
  if (unknownKey(payload, PROPOSAL_KEYS)) return refuse("unknown-key");
  if (payload["schemaVersion"] !== 1) return refuse("schema-version");

  const raw = payload["notes"];
  if (!Array.isArray(raw)) return refuse("unparseable");
  if (raw.length > MAX_PROPOSED_NOTES) return refuse("oversized");

  const notes: ProposedNote[] = [];
  /**
   * Normalization precedes de-duplication. Two paths differing only in
   * normalization form are one file on a normalizing volume, so comparing raw
   * bytes would let a proposal claim to write two notes and in fact write one
   * over the other — a silent loss where a refusal belongs. The *stored* path
   * stays raw; NFC is used to answer "are these the same file" and for nothing
   * else.
   */
  const seen = new Set<string>();
  for (const entry of raw) {
    const note = parseNote(entry);
    if (typeof note === "string") return refuse(note);
    const key = note.path.normalize("NFC");
    if (seen.has(key)) return refuse("duplicate-path");
    seen.add(key);
    notes.push(note);
  }

  return {
    ok: true,
    proposal: Object.freeze({ schemaVersion: 1, notes: Object.freeze(notes) }),
  };
}
