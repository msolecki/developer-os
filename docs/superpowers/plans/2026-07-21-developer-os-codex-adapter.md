# Codex Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packages/adapter-codex` and the generated `plugins/codex/` tree, so a Codex-only user completes the same synthetic Brain outcome contract as a Claude-only user, with no Claude Code installed.

**Architecture:** A **local marketplace** under the product home, registered and installed by Codex's own CLI — `codex plugin marketplace add` then `codex plugin add` — because a local marketplace resolves an installed plugin to its real on-disk path rather than to a cache copy, and because the vendor's tool is the only thing that may write the vendor's config. The package consumes an already-validated `WorkflowContractV1`, renders it to plugin artifacts, proposes the install as a Foundation `ChangePlan`, and invokes `codex exec` through the security runner.

**Tech Stack:** TypeScript strict, zod 4.4.3, Vitest, pnpm workspaces, Node 24.16.0.

**Design of record:** `docs/superpowers/specs/2026-07-21-developer-os-codex-adapter-design.md`, approved 2026-08-11. Where this plan and that spec disagree, the spec wins. Its §14 is normative — **do not use a Codex surface this plan does not cite from §14.**

**Read before Task 1:** `docs/architecture/claude-adapter.md`. DOS-P4 is the working reference for every shape here, and its §9 lists residuals that come due precisely because a second adapter now exists. Tasks 1 to 3 close four of them.

## Global Constraints

- **Nothing in `packages/adapter-codex` may import `packages/adapter-claude`, or the reverse.** They are peers; the moment one depends on the other, a Codex-only install carries Claude code. Anything both need moves to `packages/core`, `packages/security` or `packages/workflow-schema` (spec §1).
- **Dependency direction is fixed and one-way:** `core` ← `security` ← `workflow-schema` ← each adapter. `core` may not import `workflow-schema`; anything needing `WorkflowContractV1` lives at `workflow-schema` or above.
- Every capability is `yes` only when the version table permits **and** a probe observes. A probe that cannot run yields `unknown`, never `no` and never `yes` (spec §5).
- **`~/.codex/config.toml` is never read and never written by us** (spec §4.1). Codex's CLI is the only writer of Codex's config.
- **`AGENTS.override.md` is never written, at any scope, for any reason** (spec §6.1). In the global scope Codex reads it *instead of* `AGENTS.md`.
- **`transcript_path` is never opened**, on any code path (spec §2.4).
- **Three flags are refused on every path**: `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`, `--ignore-user-config` (spec §7.2). Asserted by test, not by convention. `danger-full-access` is never passed as a sandbox mode (§7.1).
- Redact before truncating, hashing, logging, or sending to a model.
- Screen `recovery.resume` at the render seam; it is inert text, never a command (spec §6.2).
- No absolute machine path in any artifact checked into this repository.
- Every scan asserts a non-empty set, per scope. A gate that can pass by scanning nothing is not a gate.
- Exact-path staging. Never `git add -A`. Before every commit: `npm run check`. Show failures only.
- Every code-producing task gets a fresh-context review by an agent that is not its author.
- `packages/workflow-schema` is entered only through the exports in its `index.ts`, never a module inside it. Spec §2.1 phrases this as "`validateWorkflow` is the only door", which is the rule for *validation* and stays true — `loadWorkflow`, `applyOverlay`, `sourceMarker` and, after Task 3, `renderSkillBody` are all on that door already, and no task reaches past it.
- Sorting is by code point; normalization precedes de-duplication (inherited from DOS-P3).

## File structure

| Path | Responsibility |
|---|---|
| `packages/core/src/capabilities/index.ts` | `CapabilityState`, `ProbeObservation` — shared by both adapters (Task 1) |
| `packages/security/src/markdown.ts` | the Markdown display seam: paragraph split, block-start neutralisation, payload-sized fences (Task 2) |
| `packages/workflow-schema/src/skill.ts` | the **vendor-neutral skill body**: refusals, steps, recovery, the preamble (Task 3) |
| `packages/adapter-codex/src/discover.ts` | locate the CLI, read `codex --version` |
| `packages/adapter-codex/src/versions.ts` | capability keys, the supported floor, semver comparison |
| `packages/adapter-codex/src/probe.ts` | `codex plugin list --json` behind an injected runner |
| `packages/adapter-codex/src/capabilities.ts` | table plus observation into the three-value model |
| `packages/adapter-codex/src/render.ts` | `CodexRenderer` — frontmatter, artifact path, and nothing else |
| `packages/adapter-codex/src/plugin.ts` | plugin tree layout and `.codex-plugin/plugin.json` |
| `packages/adapter-codex/src/marketplace.ts` | `.agents/plugins/marketplace.json`, written at install time |
| `packages/adapter-codex/src/compose.ts` | `renderCodexPlugin`, `renderCodexInstallTree` |
| `packages/adapter-codex/src/install.ts` | tree → Foundation proposal, plus the two CLI steps |
| `packages/adapter-codex/src/invoke.ts` | `codex exec` argv, sandbox, `--add-dir`, structured result |
| `packages/adapter-codex/src/index.ts` | the only public door, and the `CodexAdapter` façade |
| `plugins/codex/**` | the generated plugin tree, checked in |
| `tests/contracts/adapters/codex/` | cross-package contract cases |
| `tests/integration/codex/` | disposable `CODEX_HOME` integration |
| `tests/tools/render-codex.ts` | the regenerator, `npm run render:codex` |

---

## Two decisions taken before Task 1, and why

**1. DOS-P5 ships no `hooks/hooks.json`. Hooks for *both* adapters are DOS-P6's, in one change.**

Spec §5.3 says ship hooks and report `wrapper-required` until one is observed firing. The second half is implemented (Tasks 7 and 17). The first cannot be, honestly: a `"type": "command"` handler names something executable, and the only command we could name without shipping a script we cannot mark executable — `RenderedArtifact` is `{path, contents}`, `ManagedArtifactV1` has `kind: "file"` and no mode — is the `developer-os` binary itself, whose capture entrypoint is DOS-P6's. A hook firing into a command that does not exist produces an error at the end of every Codex session, which is worse than no hook.

This is the same conclusion DOS-P4 reached and the founder ratified on 2026-08-11 (`claude-adapter.md` §5), and it puts both adapters in one state rather than two. **Amends spec §5.3**; registered in `BACKLOG.md` §8 as pending the founder's ratification. `plugin_hooks` reports `unknown` throughout, which is what spec §15.1 already prescribes for a surface nobody has established.

**2. The skill *body* is shared; only the frontmatter and the artifact path are vendor behaviour.**

Codex's required skill frontmatter is `name` and `description` (spec §14.3). Claude's is the same, and its artifact path is already `skills/developer-os-<id>/SKILL.md`. A second renderer written the obvious way would be byte-identical to the first — ~450 lines and twenty tests duplicated across peer packages, and `plugins/codex/skills/**` a byte-for-byte copy of `plugins/claude/skills/**`.

So Task 3 extracts the body into `packages/workflow-schema/src/skill.ts` and migrates the Claude adapter onto it in the same change, with the existing drift check proving `plugins/claude/` does not move by a byte. **This amends `docs/architecture/workflow-schema.md` §2.2**, which says the package ships no renderer: `WorkflowRenderer` is still an interface, each adapter still implements it, and what moves is the vendor-*neutral* half — the refusals, steps and recovery every vendor renders identically because they come from one contract. Registered in `BACKLOG.md` §8.

---

### Task 1: One capability vocabulary, one ordering rule

**Complexity:** M

**Why this task exists.** Spec §11 defines `CodexCapabilities` in terms of DOS-P4's `CapabilityState`, and spec §1 forbids importing that package. Both cannot be true while the type lives there. `claude-adapter.md` §9.5 records the same for `compareCodePoints`, duplicated in `adapter-claude/src/plugin.ts` and `workflow-schema/src/derive.ts`, and names DOS-P5 as its owner.

**Files:**
- Create: `packages/core/src/capabilities/index.ts`, `packages/core/src/capabilities/capabilities.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/workflow-schema/src/derive.ts`, `packages/workflow-schema/src/index.ts`
- Modify: `packages/adapter-claude/src/capabilities.ts`, `src/probe.ts`, `src/capabilities.test.ts`, `src/plugin.ts`, `src/index.ts`

**Interfaces:**
- Produces: `CAPABILITY_STATES`, `CapabilityState = "yes" | "wrapper-required" | "unknown"`, `PROBE_OBSERVATIONS`, `ProbeObservation = "observed" | "absent" | "unavailable"`, and `compareCodePoints(left: string, right: string): number` on `@developer-os/workflow-schema`'s door.

- [ ] **Step 1: Write the failing test**

`packages/core/src/capabilities/capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CAPABILITY_STATES, PROBE_OBSERVATIONS } from "./index.js";

/**
 * The vocabulary lives here because two adapters share it and neither may
 * import the other (Codex spec §1). DOS-P6 consumes both, and two vocabularies
 * would make its own contract a translation layer.
 */
describe("the shared capability vocabulary", () => {
  it("has exactly three states, in the order the model reads them", () => {
    expect([...CAPABILITY_STATES]).toEqual(["yes", "wrapper-required", "unknown"]);
  });

  it("keeps what a probe saw distinct from what we report", () => {
    expect([...PROBE_OBSERVATIONS]).toEqual(["observed", "absent", "unavailable"]);
    for (const observation of PROBE_OBSERVATIONS) {
      expect(CAPABILITY_STATES).not.toContain(observation);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/core/src/capabilities/capabilities.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `packages/core/src/capabilities/index.ts`**

```ts
/**
 * The capability vocabulary both adapters speak.
 *
 * It lived in `packages/adapter-claude` while there was one adapter. Codex spec
 * §1 forbids either adapter importing the other and §11 defines
 * `CodexCapabilities` in terms of this exact type, so it moves here rather than
 * being copied — which is how two vocabularies come to disagree.
 *
 * `CapabilityState` and `ProbeObservation` stay distinct on purpose: the probe
 * reports what it saw, the resolver reports what we claim, and collapsing them
 * is how a `yes` gets earned by an observation alone.
 */
export const CAPABILITY_STATES = ["yes", "wrapper-required", "unknown"] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export const PROBE_OBSERVATIONS = ["observed", "absent", "unavailable"] as const;
export type ProbeObservation = (typeof PROBE_OBSERVATIONS)[number];
```

In `packages/core/src/index.ts` add:

```ts
export { CAPABILITY_STATES, PROBE_OBSERVATIONS } from "./capabilities/index.js";
export type { CapabilityState, ProbeObservation } from "./capabilities/index.js";
```

- [ ] **Step 4: Export the ordering rule from the compiler**

In `packages/workflow-schema/src/derive.ts`, change `function compareCodePoints` to `export function compareCodePoints`.

In `packages/workflow-schema/src/index.ts` there is already a line reading `export { compareScopes, deriveScopes } from "./derive.js";` — **edit that line** to add the third name rather than adding a second export statement, which is a duplicate-export error:

```ts
export { compareCodePoints, compareScopes, deriveScopes } from "./derive.js";
```

- [ ] **Step 5: Rewire the Claude adapter, all four files**

`packages/adapter-claude/src/capabilities.ts` — delete the two local `export type` declarations and re-export them, so that `probe.ts` and `capabilities.test.ts`, which both import `ProbeObservation` **from this module**, keep working:

```ts
import type { CapabilityState, ProbeObservation } from "@developer-os/core";
export type { CapabilityState, ProbeObservation } from "@developer-os/core";
```

`packages/adapter-claude/src/plugin.ts` — delete the local `compareCodePoints` and its docblock, and import it. Leave one line where the copy was:

```ts
// Ordering comes from the compiler, which owns the determinism contract.
// The duplicate that lived here is gone — `claude-adapter.md` §9.5.
import { compareCodePoints } from "@developer-os/workflow-schema";
```

`packages/adapter-claude/src/index.ts` — the two type re-exports it already carries now resolve through `capabilities.js` to core; no edit is needed unless `tsc` says otherwise.

- [ ] **Step 6: Verify with the compiler, not with the door test**

Run: `npm run check`
Expected: PASS. **`index.test.ts` cannot verify this step** — it asserts `Object.keys(module)`, and `CapabilityState`/`ProbeObservation` are type-only, so they never appear there. `tsc -b` inside `npm run lint` is what fails if a re-export is missing.

- [ ] **Step 7: Commit**

```bash
npm run check
git add packages/core/src/capabilities packages/core/src/index.ts \
        packages/workflow-schema/src/derive.ts packages/workflow-schema/src/index.ts \
        packages/adapter-claude/src/capabilities.ts packages/adapter-claude/src/probe.ts \
        packages/adapter-claude/src/capabilities.test.ts packages/adapter-claude/src/plugin.ts \
        packages/adapter-claude/src/index.ts
git commit -m "refactor(core): give both adapters one capability vocabulary and one ordering rule"
```

---

### Task 2: The Markdown display seam, shared

**Complexity:** M

**Why this task exists.** DOS-P4's renderer learned four rules the hard way (`claude-adapter.md` §6): split into paragraphs *before* screening, or the injection defence renders as one run-on line; bound the joined block, not each paragraph, or blank lines raise the cap without limit; size a fence to its payload, or a value containing a fence closes the block early; neutralise a line that begins with a block construct, or author prose forges a heading. `packages/security/src/screen.ts` states the rule for exactly this moment: *if a third site needs this, the three should become one helper rather than a third copy.*

**Files:**
- Create: `packages/security/src/markdown.ts`, `packages/security/src/markdown.test.ts`
- Modify: `packages/security/src/index.ts`, `packages/adapter-claude/src/render.ts`

**Interfaces:**
- Produces: `screenParagraphs(value: string): readonly string[]`, `boundedProse(value: string, maxGraphemes: number): string`, `fenced(payload: string, info: string): readonly string[]`.

- [ ] **Step 1: Write the failing test**

`packages/security/src/markdown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { boundedProse, fenced, screenParagraphs } from "./markdown.js";

describe("screenParagraphs", () => {
  it("keeps the boundary an author wrote", () => {
    expect(screenParagraphs("one\n\ntwo")).toEqual(["one", "two"]);
  });

  it("splits before screening, because the two do not commute", () => {
    expect(screenParagraphs("one\n \t \ntwo")).toEqual(["one", "two"]);
    expect(screenParagraphs("one\r\n\r\ntwo")).toEqual(["one", "two"]);
  });

  it("does not split on a lone carriage return", () => {
    expect(screenParagraphs("one\r\rtwo")).toEqual(["one two"]);
  });

  it("drops a paragraph that screens to nothing", () => {
    expect(screenParagraphs("one\n\n\u200B\n\ntwo")).toEqual(["one", "two"]);
  });

  it("neutralizes every block construct a paragraph could open", () => {
    const forgeries: readonly (readonly [string, string])[] = [
      ["# heading", "\\# heading"],
      ["> quote", "\\> quote"],
      ["| a | b |", "\\| a | b |"],
      ["```", "\\```"],
      ["~~~", "\\~~~"],
      ["---", "\\---"],
      ["___", "\\___"],
      ["* bullet", "\\* bullet"],
      ["1. ordered", "1\\. ordered"],
      ["9) ordered", "9\\) ordered"],
      ["<script>x</script>", "\\<script>x</script>"],
    ];
    expect(forgeries.length).toBeGreaterThan(0);
    for (const [forged, neutralized] of forgeries) {
      expect(screenParagraphs(forged), forged).toEqual([neutralized]);
    }
  });

  it("leaves ordinary prose alone, so the escape is not a tax on every line", () => {
    expect(screenParagraphs("plain sentence.")).toEqual(["plain sentence."]);
  });
});

describe("boundedProse", () => {
  it("bounds the joined block, not each paragraph", () => {
    const five = Array.from({ length: 5 }, () => "x".repeat(4000)).join("\n\n");
    expect(boundedProse(five, 4096).length).toBeLessThanOrEqual(4097);
    expect(boundedProse(five, 4096)).toContain("…");
  });

  it("returns an empty string when everything screened away", () => {
    expect(boundedProse("\u200B \u00AD", 4096)).toBe("");
  });
});

describe("fenced", () => {
  it("opens with a run longer than the longest inside", () => {
    expect(fenced("```", "text")).toEqual(["````text", "```", "````"]);
  });

  it("uses three backticks when the payload has none", () => {
    expect(fenced("plain", "json")).toEqual(["```json", "plain", "```"]);
  });

  it("counts the longest run, not the first", () => {
    expect(fenced("` and ````", "text")[0]).toBe("`````text");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/security/src/markdown.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `packages/security/src/markdown.ts`**

Move `paragraphsOf`, `neutralizeBlockStart`, `boundedProse` and `fenced` out of `packages/adapter-claude/src/render.ts` **verbatim, docblocks included** — the docblocks are where the reasons live. Two changes only: `boundedProse` takes the cap as a parameter instead of closing over a module constant, and `paragraphsOf` is exported as `screenParagraphs`.

```ts
import { capGraphemes, screenControlCharacters } from "./screen.js";

export function screenParagraphs(value: string): readonly string[] {
  return value
    .split(/\n[^\S\n]*\n/u)
    .map((paragraph) => neutralizeBlockStart(screenControlCharacters(paragraph)))
    .filter((paragraph) => paragraph.length > 0);
}

function neutralizeBlockStart(line: string): string {
  const ordered = /^(\d{1,9})([.)])/u.exec(line);
  if (ordered !== null) {
    return `${ordered[1] ?? ""}\\${line.slice((ordered[1] ?? "").length)}`;
  }
  return /^[`~#>|<*+\-=_]/u.test(line) ? `\\${line}` : line;
}

export function boundedProse(value: string, maxGraphemes: number): string {
  return capGraphemes(screenParagraphs(value).join("\n\n"), maxGraphemes);
}

export function fenced(payload: string, info: string): readonly string[] {
  const longest = [...payload.matchAll(/`+/gu)].reduce(
    (max, [run]) => Math.max(max, run.length),
    0,
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [`${fence}${info}`, payload, fence];
}
```

Export all three from `packages/security/src/index.ts`.

- [ ] **Step 4: Rewire the Claude renderer**

In `packages/adapter-claude/src/render.ts`: delete the four local functions, import the three shared ones, pass `FIELD_CAP` at each `boundedProse` call site (there are two — the step-prose branch and `recovery.leaves`), and keep `refusingParagraphs` local, now calling `screenParagraphs`. **Check the import list afterwards:** `capGraphemes` becomes unused and an unused import fails `npm run lint`.

- [ ] **Step 5: Run both suites and confirm they pass unchanged**

Run: `pnpm vitest run packages/security packages/adapter-claude tests/contracts/adapters`
Expected: PASS. **No test in `render.test.ts` may change.** If one has to, the move was not verbatim.

- [ ] **Step 6: Confirm the generated tree did not move**

Run: `npm run render:claude && git diff --stat plugins/claude`
Expected: no diff. A refactor that changes the artifact is not a refactor.

- [ ] **Step 7: Commit**

```bash
npm run check
git add packages/security/src/markdown.ts packages/security/src/markdown.test.ts \
        packages/security/src/index.ts packages/adapter-claude/src/render.ts
git commit -m "refactor(security): one Markdown display seam, before a second renderer copies it"
```

---

### Task 3: The vendor-neutral skill body

**Complexity:** L

**Why this task exists.** See "Two decisions taken before Task 1". Codex's required frontmatter is `name` and `description`, which is exactly Claude's, and both write `skills/developer-os-<id>/SKILL.md`. Written the obvious way the second renderer would be a byte-for-byte copy of the first. What is genuinely vendor-neutral — refusals, steps, recovery, and the concatenated preamble, all of which come from one contract — moves to the compiler; what is vendor behaviour — frontmatter fields, artifact path, plugin manifest — stays in each adapter.

**Files:**
- Create: `packages/workflow-schema/src/skill.ts`, `packages/workflow-schema/src/skill.test.ts`
- Modify: `packages/workflow-schema/src/index.ts`
- Modify: `packages/adapter-claude/src/render.ts`, `src/render.test.ts` (imports only)
- Modify: `docs/architecture/workflow-schema.md` — **§2.2 and §6 both become false in this change**
  and are amended in the same commit, dated. §2.2 says the package ships no renderer; §6 says
  "This package ships no renderer, so it proves the narrower thing it can prove: the *inputs* a
  renderer is handed are byte-identical". Both are amended to say what is now true — the interface
  and every vendor artifact still belong to the adapters, and what lives here is the half that
  comes from one contract and renders identically for every vendor

**Interfaces:**
- Consumes: `screenParagraphs`, `boundedProse`, `fenced`, `screenAndCap` from `@developer-os/security`; `applyOverlay`, `sourceMarker` from this package.
- Produces:

```ts
export const SHARED_WORKFLOW_ID = "shared";
export interface SkillBodyOptions {
  /** The `shared` contract, whose refusals and prose become the preamble. */
  readonly shared: WorkflowContractV1;
}
export function renderSkillBody(
  contract: WorkflowContractV1,
  overlay: WorkflowOverlayV1 | null,
  options: SkillBodyOptions,
): readonly string[];
/** The cap every contract field is screened to, exported so no vendor invents a second one. */
export const SKILL_FIELD_CAP: number;
export function assertRenderableContract(contract: WorkflowContractV1): void;
export function assertUsablePreamble(shared: WorkflowContractV1): void;
```

- [ ] **Step 1: Write the failing test**

`packages/workflow-schema/src/skill.test.ts` is `packages/adapter-claude/src/render.test.ts` with the frontmatter cases removed and every other case retargeted at `renderSkillBody`. Copy them: the preamble concatenation, the empty-prose refusals, the id and version refusals, the overlay cases, the fence and paragraph cases, the screening cases. They are the tests that already caught eight real defects, and they must keep failing for the same reasons here.

**The copy is not literal in one respect:** `renderSkillBody` returns `readonly string[]` while
every case in `render.test.ts` asserts against a joined `contents` string, so each copied case
needs `.join("\n")` around the result. Nothing else about them changes.

Add one case that is new, because this function is now shared:

```ts
it("emits the same body for two vendors, because the body is not vendor behaviour", () => {
  const first = renderSkillBody(contract(), null, { shared });
  const second = renderSkillBody(contract(), null, { shared });
  expect(second).toEqual(first);
  expect(first.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/workflow-schema/src/skill.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `skill.ts` by moving, not rewriting**

Everything below the closing `---` of the frontmatter in `packages/adapter-claude/src/render.ts` moves here unchanged: the source-marker line, the preamble block, the `# <id>` heading, `renderRefusals`, `renderSteps`, `renderRecovery`, `refusingParagraphs`, `bullet`, `FIELD_CAP`, and the two assertions. `assertUsablePreamble` is the constructor check DOS-P4 wrote — `shared.id` must equal `SHARED_WORKFLOW_ID`, and the preamble *prose* must be non-empty as its own scope, because a combined check passes on refusals alone and ships six artifacts with no defence.

The overlay rules move with it: applied through `applyOverlay`, refused with a screened reason, and refused outright on the `shared` contract, whose five concatenated copies no overlay reaches.

**Three details that decide whether the split is equivalent, and that a copy loses silently:**

1. **The frontmatter is built pre-overlay and the body post-overlay, and that is safe by
   construction rather than by luck.** `workflowOverlaySchema` is `.strict()` with exactly
   `extends`, `steps`, `lifecycle` and `notes`, and a `steps` value is `{ prose }` alone — so an
   overlay cannot reach `id`, `version` or `description`, which are the only fields the frontmatter
   reads. Nothing else about this task would survive that schema gaining a field.
2. **The source marker is derived here, not passed in.** It is
   `sourceMarker(contract, \`workflows/${contract.id}/workflow.yaml\`)`, exactly as the shipped
   renderer computes it. A caller-supplied string would let the two vendor trees carry different
   markers, and neither adapter's drift gate can see the other's input.
3. **`assertRenderableContract` runs twice** — once on the contract handed in and once on the
   post-overlay object the path and marker are built from. The shipped renderer does this
   deliberately, with a docblock; if the second call disappears into the copy, no test notices.

**`SKILL_FIELD_CAP` is exported.** It is the bound every contract field is screened to, including
the `description` each adapter puts in its own frontmatter — the one field the plan calls vendor
behaviour that must still truncate identically in both trees. Two adapters inventing their own cap
is two trees that differ on a long description and no test that compares them.

Export from `index.ts`:

```ts
export { assertRenderableContract, assertUsablePreamble, renderSkillBody, SHARED_WORKFLOW_ID } from "./skill.js";
export type { SkillBodyOptions } from "./skill.js";
```

- [ ] **Step 4: Reduce `ClaudeRenderer` to its vendor half**

`packages/adapter-claude/src/render.ts` keeps `yamlScalar`, the two frontmatter lines, the artifact path, and the `WorkflowRenderer` implementation. It calls `assertUsablePreamble` in its constructor and `renderSkillBody` in `render`. It re-exports `SHARED_WORKFLOW_ID` so its own door does not change shape.

- [ ] **Step 5: Run everything, and prove the artifact did not move**

Run: `npm run check && npm run render:claude && git diff --stat plugins/claude`
Expected: PASS, and **no diff**. The drift gate comparing the checked-in tree against a fresh render is the strongest available evidence that this extraction preserved behaviour byte for byte.

- [ ] **Step 6: Commit**

```bash
npm run check
git add packages/workflow-schema/src/skill.ts packages/workflow-schema/src/skill.test.ts \
        packages/workflow-schema/src/index.ts packages/adapter-claude/src/render.ts \
        packages/adapter-claude/src/render.test.ts docs/architecture/workflow-schema.md
git commit -m "refactor(workflow-schema): one skill body, two vendors, and a tree that did not move"
```

---

### Task 4: Scaffold the package and discover an installation

**Complexity:** M

**Files:**
- Create: `packages/adapter-codex/package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `packages/adapter-codex/src/discover.ts`, `src/discover.test.ts`
- Modify: `pnpm-workspace.yaml`, root `tsconfig.json`, root `vitest.config.ts`

**Interfaces:**
- Consumes: `ProcessRunner`, `ProcessRequest`, `ProcessResult` from **`@developer-os/security`**.
- Produces: `CodexInstallation { executable: string; version: string }`, `discoverCodex`, `resolveExecutable`.

- [ ] **Step 1: Register the package in the three workspace files**

`pnpm-workspace.yaml` **enumerates every package by path — there is no glob.** Add a line:

```yaml
  - packages/adapter-codex
```

Root `tsconfig.json` gains `{ "path": "./packages/adapter-codex" }` in `references`; root `vitest.config.ts` gains the project entry beside `packages/adapter-claude`.

- [ ] **Step 2: Write the three package files**

`packages/adapter-codex/package.json`:

```json
{
  "name": "@developer-os/adapter-codex",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@developer-os/core": "workspace:*",
    "@developer-os/security": "workspace:*",
    "@developer-os/workflow-schema": "workspace:*",
    "zod": "4.4.3"
  }
}
```

`zod` is declared because Task 6 parses the vendor's JSON with it. `tsconfig.json` and `vitest.config.ts` copy `packages/adapter-claude`'s, with references to the same three workspace packages. **`@developer-os/adapter-claude` must appear in none of the three files.**

Run `pnpm install` after this step so the workspace link exists.

- [ ] **Step 3: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";
import { discoverCodex, resolveExecutable } from "./discover.js";

function runner(handler: (request: ProcessRequest) => Partial<ProcessResult>): ProcessRunner {
  return {
    run(request: ProcessRequest): Promise<ProcessResult> {
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
        ...handler(request),
      });
    },
  };
}

const executable = "/opt/synthetic/bin/codex";

describe("discoverCodex", () => {
  it("reads the version out of the vendor's own format", async () => {
    expect(
      await discoverCodex({ runner: runner(() => ({ stdout: "codex-cli 0.147.0\n" })), executable }),
    ).toEqual({ executable, version: "0.147.0" });
  });

  /**
   * Inherited from DOS-P4 and deliberate: the pattern matches a version
   * *inside* the line, so `codex-cli 0.148.0-rc.1` reads as `0.148.0`. A
   * pre-release is its release triple for floor purposes, and
   * `packages/adapter-claude/src/discover.test.ts` records why. Do not fork it.
   */
  it("reads a pre-release as its release triple, as the Claude adapter does", async () => {
    expect(
      await discoverCodex({
        runner: runner(() => ({ stdout: "codex-cli 0.148.0-rc.1" })),
        executable,
      }),
    ).toEqual({ executable, version: "0.148.0" });
  });

  it.each([
    { name: "a non-zero exit", result: { exitCode: 1 } },
    { name: "a timeout", result: { timedOut: true, exitCode: null } },
    { name: "output with no version in it", result: { stdout: "codex" } },
    { name: "a two-part version", result: { stdout: "codex-cli 0.147" } },
  ])("reports no installation for $name, rather than throwing", async ({ result }) => {
    expect(await discoverCodex({ runner: runner(() => result), executable })).toBeNull();
  });

  it("never throws when the runner itself fails", async () => {
    expect(
      await discoverCodex({
        runner: {
          run(): Promise<ProcessResult> {
            throw new Error("spawn failed");
          },
        },
        executable,
      }),
    ).toBeNull();
  });

  it("passes argv as an array, with no shell and no inherited environment", async () => {
    let seen: ProcessRequest | null = null;
    await discoverCodex({
      runner: runner((request) => {
        seen = request;
        return { stdout: "codex-cli 0.147.0" };
      }),
      executable,
    });
    const request = seen as ProcessRequest | null;
    expect(request?.args).toEqual(["--version"]);
    expect(request?.env).toEqual({});
    expect(request?.stdin).toBe("");
  });
});

describe("resolveExecutable", () => {
  it("resolves a bare name against PATH, in the parent", async () => {
    expect(
      await resolveExecutable("codex", {
        pathValue: "/usr/bin:/opt/synthetic/bin",
        isExecutable: (candidate) => Promise.resolve(candidate === executable),
      }),
    ).toBe(executable);
  });

  it("skips a relative PATH entry, which is an executable an attacker can place", async () => {
    expect(
      await resolveExecutable("codex", {
        pathValue: "relative/bin",
        isExecutable: () => Promise.resolve(true),
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `pnpm vitest run packages/adapter-codex`
Expected: FAIL — the module does not exist.

- [ ] **Step 5: Implement `discover.ts`**

`packages/adapter-claude/src/discover.ts` is the reference implementation and may be read: same `VERSION_PATTERN`, same 10-second timeout, same never-throw contract, same `resolveExecutable` resolving in the parent because the request carries no `PATH` and `assertSafeCommand` refuses a non-absolute executable. The argv is `["--version"]`.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `pnpm vitest run packages/adapter-codex`
Expected: PASS, 10 tests.

- [ ] **Step 7: Run the gate and commit**

```bash
npm run check
git add packages/adapter-codex pnpm-workspace.yaml tsconfig.json vitest.config.ts pnpm-lock.yaml
git commit -m "feat(adapter-codex): find an installation without ever throwing"
```

---

### Task 5: The capability keys and the supported floor

**Complexity:** S

**Files:**
- Create: `packages/adapter-codex/src/versions.ts`, `src/versions.test.ts`

**Interfaces:**
- Produces: `CODEX_CAPABILITY_KEYS`, `CodexCapabilityKey`, `CODEX_MINIMUM_VERSION`, `compareVersions`, `tablePermits`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  CODEX_CAPABILITY_KEYS,
  CODEX_MINIMUM_VERSION,
  compareVersions,
  tablePermits,
} from "./versions.js";

describe("the capability keys", () => {
  /**
   * Spelled out rather than imported from the other adapter, which spec §1
   * forbids — so the list is asserted in full, in order. A length check would
   * catch no rename, no reorder and no substitution, and this is the one place
   * a duplicated list can drift.
   */
  it("are exactly product spec §11's, in order, resolved against spec §5.4", () => {
    expect([...CODEX_CAPABILITY_KEYS]).toEqual([
      "skills",
      "plugin_hooks",
      "session_start_injection",
      "session_end_capture",
      "pre_compact_backup",
      "non_interactive_run",
      "structured_result",
      "subagents",
      "durable_project_guidance",
    ]);
  });
});

describe("compareVersions", () => {
  it("compares numerically, not lexically", () => {
    expect(compareVersions("0.147.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.147.0", "0.147.0")).toBe(0);
  });

  /**
   * `NaN < 0` is false, so a NaN here grants every capability on a version
   * string nobody could parse. The Claude adapter shipped that defect once and
   * a review caught it; the fix is a comparison that can say "I cannot answer".
   */
  it("returns null when either side is not a version", () => {
    expect(compareVersions("0.147", "0.147.0")).toBeNull();
    expect(compareVersions("v0.147.0", "0.147.0")).toBeNull();
  });
});

describe("tablePermits", () => {
  it("refuses every key below the supported floor", () => {
    expect(CODEX_CAPABILITY_KEYS.length).toBeGreaterThan(0);
    for (const key of CODEX_CAPABILITY_KEYS) {
      expect(tablePermits(key, "0.1.0"), key).toBe(false);
    }
  });

  it("permits a version above everything the table knows", () => {
    expect(tablePermits("skills", "99.0.0")).toBe(true);
  });

  it("refuses a version it cannot parse", () => {
    expect(tablePermits("skills", "not a version")).toBe(false);
  });

  it("never grants a capability by itself, which is the probe's job", () => {
    expect(tablePermits("session_end_capture", CODEX_MINIMUM_VERSION)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/adapter-codex/src/versions.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `versions.ts`**

```ts
/**
 * Spec §5.4's capability keys, in product spec §11's order and identical to the
 * Claude adapter's — deliberately, because DOS-P6 consumes both and two
 * vocabularies would make its contract a translation layer (spec §5).
 *
 * `durable_project_guidance` is reported and used by nothing: spec §6.1 writes
 * no `AGENTS.md` at any scope. `subagents` likewise: the hook events exist and
 * no canonical workflow spawns a subagent (§15.4).
 */
export const CODEX_CAPABILITY_KEYS = [
  "skills",
  "plugin_hooks",
  "session_start_injection",
  "session_end_capture",
  "pre_compact_backup",
  "non_interactive_run",
  "structured_result",
  "subagents",
  "durable_project_guidance",
] as const;

export type CodexCapabilityKey = (typeof CODEX_CAPABILITY_KEYS)[number];

/**
 * Provisional; the integration test confirms or raises it (spec §15.2).
 *
 * `baseline-capabilities.json` records `0.144.6` as a historical observation of
 * one machine on 2026-07-21, and the machine the spec was written against
 * reports `0.147.0`. **Neither is a floor** — spec §5.1 says so in as many
 * words. `0.144.6` is the lowest version anybody has recorded working at all,
 * which makes it the floor below which nothing here is worth attempting.
 */
export const CODEX_MINIMUM_VERSION = "0.144.6";

/** A documented floor per key, or `null` for "the probe decides". Deliberately sparse. */
const DOCUMENTED_FLOORS: ReadonlyMap<CodexCapabilityKey, string | null> = new Map(
  CODEX_CAPABILITY_KEYS.map((key) => [key, null]),
);
```

`compareVersions` and `tablePermits` copy the shape in `packages/adapter-claude/src/versions.ts` — including the `Map` rather than an object literal, for the reason recorded there: a key named `toString` resolves to a `Function` through `Object.prototype` and passes an `!== undefined` guard.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run packages/adapter-codex/src/versions.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npm run check
git add packages/adapter-codex/src/versions.ts packages/adapter-codex/src/versions.test.ts
git commit -m "feat(adapter-codex): a version table that keeps its own floor low"
```

---

### Task 6: The probe — one structured call answers three questions

**Complexity:** M

**Why this task exists.** Spec §5.2: `codex plugin list --json` reports installed plugins with status and resolved path, settling *installed*, *enabled*, and *is the resolved path the tree we own* in one call. DOS-P4's probe read one exit code as an observation of three artifacts and over-claimed twice (`claude-adapter.md` §3). This one must not repeat that.

**Files:**
- Create: `packages/adapter-codex/src/probe.ts`, `src/probe.test.ts`

**Interfaces:**
- Consumes: `ProcessRunner` from `@developer-os/security`; `ProbeObservation` from `@developer-os/core`; `CodexInstallation` from `./discover.js`.
- Produces:

```ts
export interface CodexProbeDependencies {
  readonly runner: ProcessRunner;
  /** The absolute path we install our plugin tree to. */
  readonly pluginRoot: string;
}
export interface CodexProbeResult {
  readonly observations: ReadonlyMap<string, ProbeObservation>;
  readonly resolvedPath: string | null;
  readonly enabled: boolean | null;
}
export function probeCodex(
  installation: CodexInstallation,
  dependencies: CodexProbeDependencies,
): Promise<CodexProbeResult>;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { ProcessRequest, ProcessResult, ProcessRunner } from "@developer-os/security";
import { probeCodex } from "./probe.js";

const installation = { executable: "/opt/synthetic/bin/codex", version: "0.147.0" } as const;
const pluginRoot = "/synthetic/home/.developer-os/codex/plugins/developer-os";

function listing(plugins: unknown): ProcessRunner {
  return {
    run(): Promise<ProcessResult> {
      return Promise.resolve({
        stdout: JSON.stringify(plugins),
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
      });
    },
  };
}

describe("probeCodex", () => {
  it("observes skills when our plugin is installed, enabled, at the path we own", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({ plugins: [{ name: "developer-os", status: "enabled", path: pluginRoot }] }),
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("observed");
    expect(probed.enabled).toBe(true);
    expect(probed.resolvedPath).toBe(pluginRoot);
  });

  it("reports absent when the listing contains no plugin of ours", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({ plugins: [{ name: "somebody-else", status: "enabled", path: "/x" }] }),
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("absent");
    expect(probed.resolvedPath).toBeNull();
  });

  /**
   * The property the whole install shape was chosen for: a plugin under our
   * name, resolved somewhere we never wrote, is not our tree. Reporting
   * `observed` for it claims we verified an artifact somebody else installed.
   */
  it("reports absent when our name resolves to a path we do not own", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({ plugins: [{ name: "developer-os", status: "enabled", path: "/somewhere/else" }] }),
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("absent");
  });

  it("distinguishes installed-but-disabled from absent", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({ plugins: [{ name: "developer-os", status: "disabled", path: pluginRoot }] }),
      pluginRoot,
    });
    expect(probed.enabled).toBe(false);
    expect(probed.observations.get("skills")).toBe("absent");
  });

  it.each([
    { name: "a non-zero exit", result: { exitCode: 1 } },
    { name: "a timeout", result: { timedOut: true, exitCode: null } },
    { name: "output that is not JSON", result: { stdout: "not json" } },
    { name: "JSON of the wrong shape", result: { stdout: '{"plugins":"nope"}' } },
    { name: "a plugins entry that is not an object", result: { stdout: '{"plugins":[1]}' } },
  ])("reports unavailable, never absent, for $name", async ({ result }) => {
    const probed = await probeCodex(installation, {
      runner: {
        run(): Promise<ProcessResult> {
          return Promise.resolve({
            stdout: "",
            stderr: "",
            exitCode: 0,
            signal: null,
            timedOut: false,
            ...result,
          });
        },
      },
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("unavailable");
    expect(probed.enabled).toBeNull();
  });

  it("accepts a listing carrying fields we do not know, because it is the vendor's shape", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({
        schemaVersion: 9,
        plugins: [{ name: "developer-os", status: "enabled", path: pluginRoot, futureField: true }],
      }),
      pluginRoot,
    });
    expect(probed.observations.get("skills")).toBe("observed");
  });

  it("settles nothing about a lifecycle event, which needs a session", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({ plugins: [{ name: "developer-os", status: "enabled", path: pluginRoot }] }),
      pluginRoot,
    });
    for (const key of ["session_start_injection", "session_end_capture", "pre_compact_backup"]) {
      expect(probed.observations.has(key), key).toBe(false);
    }
  });

  it("settles nothing about plugin_hooks, which spec §15.1 leaves unobserved", async () => {
    const probed = await probeCodex(installation, {
      runner: listing({ plugins: [{ name: "developer-os", status: "enabled", path: pluginRoot }] }),
      pluginRoot,
    });
    expect(probed.observations.has("plugin_hooks")).toBe(false);
  });

  it("passes argv as an array and inherits no environment", async () => {
    let seen: ProcessRequest | null = null;
    await probeCodex(installation, {
      runner: {
        run(request: ProcessRequest): Promise<ProcessResult> {
          seen = request;
          return Promise.resolve({
            stdout: '{"plugins":[]}',
            stderr: "",
            exitCode: 0,
            signal: null,
            timedOut: false,
          });
        },
      },
      pluginRoot,
    });
    const request = seen as ProcessRequest | null;
    expect(request?.args).toEqual(["plugin", "list", "--json"]);
    expect(request?.env).toEqual({});
  });

  it("reports a non-empty observation set, so a clean result means something", async () => {
    const probed = await probeCodex(installation, { runner: listing({ plugins: [] }), pluginRoot });
    expect(probed.observations.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/adapter-codex/src/probe.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `probe.ts`**

Parse with zod and treat every parse failure as `unavailable`:

```ts
const listingSchema = z
  .object({
    plugins: z.array(
      z.object({ name: z.string(), status: z.string().optional(), path: z.string().optional() }).loose(),
    ),
  })
  .loose();
```

`.loose()` on both, deliberately and unlike everywhere else in this repository: this is the **vendor's** output, not our contract, and a new field in their next release must not become an `unavailable`. Our own artifacts stay strict.

`skills` is `observed` only when a plugin named `developer-os` is present **and** enabled **and** its resolved path equals `pluginRoot`. Anything else that parsed is `absent`; anything that did not parse, exited non-zero, or timed out is `unavailable`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run packages/adapter-codex/src/probe.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npm run check
git add packages/adapter-codex/src/probe.ts packages/adapter-codex/src/probe.test.ts
git commit -m "feat(adapter-codex): a probe that answers three questions and over-claims none"
```

---

### Task 7: The three-value capability model

**Complexity:** S

**Files:**
- Create: `packages/adapter-codex/src/capabilities.ts`, `src/capabilities.test.ts`

**Interfaces:**
- Consumes: `CapabilityState`, `ProbeObservation` from `@developer-os/core`; `CODEX_CAPABILITY_KEYS`, `tablePermits` from `./versions.js`.
- Produces: `CodexCapabilities = Readonly<Record<CodexCapabilityKey, CapabilityState>>`, `resolveCapabilities(version, observations)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { ProbeObservation } from "@developer-os/core";
import { CODEX_CAPABILITY_KEYS } from "./versions.js";
import { resolveCapabilities } from "./capabilities.js";

const observed = new Map<string, ProbeObservation>([["skills", "observed"]]);

describe("resolveCapabilities", () => {
  it("earns yes only where the table permits and a probe observed", () => {
    expect(resolveCapabilities("0.147.0", observed).skills).toBe("yes");
  });

  it("reports yes for exactly the capabilities that were observed", () => {
    const granted = Object.entries(resolveCapabilities("0.147.0", observed))
      .filter(([, state]) => state === "yes")
      .map(([key]) => key);
    expect(granted).toEqual(["skills"]);
  });

  it("degrades an unmentioned key toward the wrapper, never toward yes", () => {
    expect(resolveCapabilities("0.147.0", observed).session_end_capture).toBe("wrapper-required");
  });

  /**
   * Spec §15.1: the plugin-bundled hooks path is documented and unobserved, and
   * this plan ships no hooks file at all. `unknown` is what the model does with
   * a fact nobody has established. It must not quietly become
   * `wrapper-required` — that would claim we asked and got an answer.
   */
  it("reports plugin_hooks as unknown until an integration test settles it", () => {
    expect(resolveCapabilities("0.147.0", observed).plugin_hooks).toBe("unknown");
  });

  it("reports unknown, never no, for a probe that could not run", () => {
    const resolved = resolveCapabilities(
      "0.147.0",
      new Map<string, ProbeObservation>([["skills", "unavailable"]]),
    );
    expect(resolved.skills).toBe("unknown");
  });

  it("refuses to grant anything on a version below the floor", () => {
    expect(resolveCapabilities("0.1.0", observed).skills).toBe("wrapper-required");
  });

  it("reports every key, so doctor prints a full matrix", () => {
    expect(Object.keys(resolveCapabilities("0.147.0", observed))).toHaveLength(
      CODEX_CAPABILITY_KEYS.length,
    );
  });

  it("ignores a key the probe invented", () => {
    const resolved = resolveCapabilities(
      "0.147.0",
      new Map<string, ProbeObservation>([["skills", "observed"], ["invented", "observed"]]),
    );
    expect(Object.keys(resolved)).not.toContain("invented");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/adapter-codex/src/capabilities.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `capabilities.ts`**

Iterate over `CODEX_CAPABILITY_KEYS`, so a key the probe invented reaches nothing. One list is hard-coded:

```ts
/**
 * Keys nothing may settle yet. `plugin_hooks` is here because this subsystem
 * ships no hooks file (see the plan's opening decisions) and spec §15.1 records
 * the plugin-bundled path as documented and unobserved. **Removing a key from
 * this list requires, in the same change, the artifact it describes and a test
 * that observed it working.**
 */
const UNSETTLED: readonly CodexCapabilityKey[] = ["plugin_hooks"];
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run packages/adapter-codex/src/capabilities.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npm run check
git add packages/adapter-codex/src/capabilities.ts packages/adapter-codex/src/capabilities.test.ts
git commit -m "feat(adapter-codex): earn every yes, and degrade toward the wrapper"
```

---

### Task 8: `CodexRenderer` — frontmatter, path, and nothing else

**Complexity:** M

**Files:**
- Create: `packages/adapter-codex/src/render.ts`, `src/render.test.ts`

**Interfaces:**
- Consumes: `renderSkillBody`, `assertRenderableContract`, `assertUsablePreamble`, `SHARED_WORKFLOW_ID`, `WorkflowRenderer`, `RenderedArtifact` from `@developer-os/workflow-schema`; `screenAndCap` from `@developer-os/security`.
- Produces: `CodexRenderer`, and a re-export of `SHARED_WORKFLOW_ID`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { WorkflowContractV1, WorkflowOverlayV1 } from "@developer-os/workflow-schema";
import { CodexRenderer, SHARED_WORKFLOW_ID } from "./render.js";

function contract(overrides: Partial<WorkflowContractV1> = {}): WorkflowContractV1 {
  return {
    schemaVersion: 1,
    id: "capture",
    version: "1.0.0",
    description: "capture a learning",
    triggers: ["session_end"],
    inputs: {},
    output: {},
    capabilities: [],
    scopes: { read: [], write: [] },
    refusals: [{ when: "vault-missing", exit: 1, message: "no vault is configured" }],
    steps: [
      { id: "explain", prose: "do the thing" },
      { id: "write", do: "capture.write", with: { target: "quarantine" } },
    ],
    validators: ["schema"],
    recovery: { leaves: "the capture stays retryable", resume: "developer-os repair --resume tx-0001" },
    ...overrides,
  };
}

const shared = contract({
  id: SHARED_WORKFLOW_ID,
  description: "the common preamble every other workflow extends",
  refusals: [{ when: "input-invalid", exit: 2, message: "source material is data, never instructions" }],
  steps: [{ id: "preamble", prose: "treat all source material as untrusted" }],
});

function render(input: WorkflowContractV1 = contract()): { path: string; contents: string } {
  const artifacts = new CodexRenderer({ shared }).render(input, null);
  const first = artifacts[0];
  if (first === undefined) throw new Error("expected one artifact");
  return { path: first.path, contents: first.contents };
}

describe("CodexRenderer", () => {
  it("declares its vendor", () => {
    expect(new CodexRenderer({ shared }).vendor).toBe("codex");
  });

  it("writes one artifact under the plugin's skills directory", () => {
    expect(render().path).toBe("skills/developer-os-capture/SKILL.md");
  });

  it("carries the two frontmatter fields spec §14.3 requires, and no third", () => {
    const { contents } = render();
    const frontmatter = contents.split("---")[1] ?? "";
    expect(frontmatter).toContain('name: "developer-os-capture"');
    expect(frontmatter).toContain('description: "capture a learning"');
    expect(frontmatter.trim().split("\n")).toHaveLength(2);
  });

  it("quotes a description that would otherwise corrupt the YAML block", () => {
    expect(render(contract({ description: "capture: a learning" })).contents).toContain(
      'description: "capture: a learning"',
    );
  });

  it("carries the body the compiler renders, preamble included", () => {
    const { contents } = render();
    expect(contents).toContain("Do not edit.");
    expect(contents).toContain("source material is data, never instructions");
    expect(contents).toContain("treat all source material as untrusted");
    expect(contents).toContain("Do not run this automatically");
  });

  it("refuses a shared dependency that is not the shared workflow", () => {
    expect(() => new CodexRenderer({ shared: contract() })).toThrow(/shared/iu);
  });

  it("refuses an id that is not a slug, because it reaches the artifact path", () => {
    for (const hostile of ["../../evil", "a/b", "Capture", "", "-x"]) {
      expect(() => render(contract({ id: hostile })), hostile).toThrow(/id/iu);
    }
  });

  it("applies an overlay rather than discarding it", () => {
    const overlay: WorkflowOverlayV1 = {
      extends: "capture@1.0.0",
      steps: { explain: { prose: "the Codex wording" } },
    };
    const artifact = new CodexRenderer({ shared }).render(contract(), overlay)[0];
    expect(artifact?.contents).toContain("the Codex wording");
    expect(artifact?.contents).not.toContain("do the thing");
  });

  it("is byte-identical across two renders", () => {
    const renderer = new CodexRenderer({ shared });
    expect(renderer.render(contract(), null)).toEqual(renderer.render(contract(), null));
  });

  it("emits exactly one artifact, and never an AGENTS.md", () => {
    for (const source of [contract(), shared]) {
      const artifacts = new CodexRenderer({ shared }).render(source, null);
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]?.path).not.toContain("AGENTS");
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/adapter-codex/src/render.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `render.ts`**

Under thirty lines of real code: `assertUsablePreamble` in the constructor, `assertRenderableContract` in `render`, the two frontmatter lines through `JSON.stringify` — which is a valid YAML double-quoted scalar, and the reason is that a bare `description: capture: a learning` is a nested mapping and the skill silently does not load — then `renderSkillBody`, then the artifact path.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run packages/adapter-codex/src/render.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npm run check
git add packages/adapter-codex/src/render.ts packages/adapter-codex/src/render.test.ts
git commit -m "feat(adapter-codex): a renderer that is only its vendor half"
```

---

### Task 9: The plugin tree and its manifest

**Complexity:** M

**Files:**
- Create: `packages/adapter-codex/src/plugin.ts`, `src/plugin.test.ts`

**Interfaces:**
- Consumes: `RenderedArtifact`, `compareCodePoints` from `@developer-os/workflow-schema`.
- Produces: `PLUGIN_NAME`, `PLUGIN_TREE_SEGMENTS`, `CODEX_ROOT_SEGMENT`, `MARKETPLACE_RELATIVE_PATH`, `buildPluginTree(skills)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildPluginTree, PLUGIN_NAME, PLUGIN_TREE_SEGMENTS } from "./plugin.js";

const skills = [
  { path: "skills/developer-os-shared/SKILL.md", contents: "shared\n" },
  { path: "skills/developer-os-capture/SKILL.md", contents: "capture\n" },
];

describe("buildPluginTree", () => {
  it("emits the manifest beside the skills", () => {
    const paths = buildPluginTree(skills).map((artifact) => artifact.path);
    expect(paths).toContain(".codex-plugin/plugin.json");
    expect(paths).toHaveLength(skills.length + 1);
  });

  it("installs to <product-home>/codex/plugins/developer-os", () => {
    expect([...PLUGIN_TREE_SEGMENTS]).toEqual(["codex", "plugins", PLUGIN_NAME]);
  });

  it("emits a manifest with exactly the fields spec §14.4 names and no others", () => {
    const manifest = buildPluginTree(skills).find((a) => a.path === ".codex-plugin/plugin.json");
    const parsed = JSON.parse(manifest?.contents ?? "{}") as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["description", "name", "skills", "version"]);
    expect(parsed.name).toBe(PLUGIN_NAME);
    expect(parsed.skills).toBe("skills");
  });

  it("orders by code point, so a reversed reader produces the same bytes", () => {
    const forward = buildPluginTree(skills).map((a) => a.path);
    const reversed = buildPluginTree([...skills].reverse()).map((a) => a.path);
    expect(reversed).toEqual(forward);
  });

  it("refuses an empty skill list", () => {
    expect(() => buildPluginTree([])).toThrow(/no skills/u);
  });

  it("refuses two artifacts claiming one path", () => {
    expect(() =>
      buildPluginTree([
        { path: "skills/developer-os-capture/SKILL.md", contents: "a" },
        { path: "skills/developer-os-capture/SKILL.md", contents: "b" },
      ]),
    ).toThrow(/one path/u);
  });

  it("ships no hooks file, no AGENTS.md, and no absolute path", () => {
    const tree = buildPluginTree(skills);
    expect(tree.length).toBeGreaterThan(0);
    expect(tree.map((a) => a.path)).not.toContain("hooks/hooks.json");
    for (const artifact of tree) {
      expect(artifact.path).not.toContain("AGENTS");
      expect(artifact.contents).not.toMatch(/\/Users\/|\/home\//u);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/adapter-codex/src/plugin.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `plugin.ts`**

```ts
export const PLUGIN_NAME = "developer-os";

/** Everything this adapter owns lives under one directory of the product home. */
export const CODEX_ROOT_SEGMENT = "codex";

/** Spec §4: `<product-home>/codex/plugins/developer-os`. */
export const PLUGIN_TREE_SEGMENTS: readonly string[] = [
  CODEX_ROOT_SEGMENT,
  "plugins",
  PLUGIN_NAME,
];

/** Spec §4: relative to `<product-home>/codex`, which is the marketplace root. */
export const MARKETPLACE_RELATIVE_PATH = ".agents/plugins/marketplace.json";
```

The manifest carries `name`, `version`, `description` and `skills` and nothing else — §14.4 lists more fields, and every one we do not need is a field that could differ between versions. `skills` is the relative string `"skills"`, never an absolute path.

`buildPluginTree` sorts with `compareCodePoints`, refuses an empty list, and refuses duplicate paths — the last because a skill's path is built from the workflow's `id`, which comes from the YAML rather than the directory it sits in, so two workflows sharing an `id` would write one file while the tree claimed two.

**No `hooks/hooks.json`** — see the plan's opening decisions.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run packages/adapter-codex/src/plugin.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npm run check
git add packages/adapter-codex/src/plugin.ts packages/adapter-codex/src/plugin.test.ts
git commit -m "feat(adapter-codex): the minimal manifest, and a tree that refuses to collide"
```

---

### Task 10: The local marketplace descriptor

**Complexity:** M

**Why this task exists.** The descriptor is the one artifact carrying a real absolute path — `source.path` points at the installed plugin tree — which is why it is **not** checked into this repository and is generated against a resolved product home instead.

**Files:**
- Create: `packages/adapter-codex/src/marketplace.ts`, `src/marketplace.test.ts`

**Interfaces:**
- Produces: `MARKETPLACE_NAME`, `renderMarketplace(context: { home: string }): RenderedArtifact` whose `path` is `MARKETPLACE_RELATIVE_PATH` — relative to `<product-home>/codex`, the same root every other artifact in this adapter is relative to.

- [ ] **Step 1: Write the failing test**

```ts
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKETPLACE_NAME, renderMarketplace } from "./marketplace.js";
import { MARKETPLACE_RELATIVE_PATH, PLUGIN_NAME } from "./plugin.js";

const home = "/synthetic/home/.developer-os";

describe("renderMarketplace", () => {
  it("is written at the path Codex reads, relative to the marketplace root", () => {
    expect(renderMarketplace({ home }).path).toBe(MARKETPLACE_RELATIVE_PATH);
  });

  it("describes one local plugin, at the path the installer actually writes", () => {
    const parsed = JSON.parse(renderMarketplace({ home }).contents) as {
      name: string;
      plugins: { name: string; source: { source: string; path: string } }[];
    };
    expect(parsed.name).toBe(MARKETPLACE_NAME);
    expect(parsed.plugins).toHaveLength(1);
    expect(parsed.plugins[0]?.name).toBe(PLUGIN_NAME);
    expect(parsed.plugins[0]?.source.source).toBe("local");
    expect(parsed.plugins[0]?.source.path).toBe(
      posix.join(home, "codex", "plugins", PLUGIN_NAME),
    );
  });

  /**
   * Spec §14.4 names the keys a marketplace document carries and does not
   * document the accepted *values* of `policy` or `category`. We emit only what
   * we can point at, and Task 17 amends §14.4 with whatever the real CLI
   * accepted — an invented enum value that a future version rejects is a
   * failure only the integration test would find.
   */
  it("emits only the keys spec §14.4 names, and invents no enum values", () => {
    const parsed = JSON.parse(renderMarketplace({ home }).contents) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["name", "plugins"]);
    const plugin = (parsed.plugins as Record<string, unknown>[])[0] ?? {};
    expect(Object.keys(plugin).sort()).toEqual(["name", "source"]);
  });

  it("refuses a relative home, because the path it writes must resolve anywhere", () => {
    expect(() => renderMarketplace({ home: "relative/home" })).toThrow(/absolute/iu);
  });

  it("is byte-identical across two renders", () => {
    expect(renderMarketplace({ home })).toEqual(renderMarketplace({ home }));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/adapter-codex/src/marketplace.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `marketplace.ts`**

```json
{
  "name": "developer-os",
  "plugins": [
    {
      "name": "developer-os",
      "source": { "source": "local", "path": "<product-home>/codex/plugins/developer-os" }
    }
  ]
}
```

Serialize with `JSON.stringify(value, null, 2)` plus a trailing newline, so the bytes are stable and a diff is readable. Refuse a non-absolute `home` rather than emitting a path that resolves against whatever directory Codex happens to run in.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run packages/adapter-codex/src/marketplace.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npm run check
git add packages/adapter-codex/src/marketplace.ts packages/adapter-codex/src/marketplace.test.ts
git commit -m "feat(adapter-codex): a local marketplace, resolved against a real home"
```

---

### Task 11: The install proposal, and the two CLI steps

**Complexity:** L

**Why this task exists.** Spec §4.1 and §8: our tree is a Foundation `ChangePlan`, and the two `codex plugin` invocations happen in the apply phase, where their failure is a transaction failure. Spec §4.2: uninstall reverses the CLI steps *before* deleting the tree, because a marketplace registered against a directory we removed is worse than leaving both.

**Files:**
- Create: `packages/adapter-codex/src/install.ts`, `src/install.test.ts`

**Interfaces:**
- Consumes: `hashBytes`, `validateChangePlan`, and the types `ChangePlanOperationV1`, `ManagedArtifactV1`, `InstallationManifestV1` from `@developer-os/core`.
- Produces:

```ts
export interface CodexCliStep {
  readonly args: readonly string[];
  readonly description: string;
}
export interface CodexInstallProposal {
  readonly schemaVersion: 1;
  readonly productVersion: string;
  readonly operations: readonly ChangePlanOperationV1[];
  readonly registration: readonly CodexCliStep[];
}
export function proposeCodexInstall(
  tree: readonly RenderedArtifact[],
  context: { home: string; productVersion: string },
  managed?: ReadonlyMap<string, ManagedArtifactV1>,
): CodexInstallProposal;
export function proposeCodexUninstall(
  context: { home: string; productVersion: string },
  managed: ReadonlyMap<string, ManagedArtifactV1>,
): CodexInstallProposal;
```

- [ ] **Step 1: Read the authority before writing a line**

`packages/core/src/plans/types.ts` defines `ChangePlanOperationV1`; `packages/core/src/manifest/types.ts:18-30` defines `ManagedArtifactV1`, which requires **eleven** fields — `owner`, `path`, `kind`, `productVersion`, `existedBefore`, `beforeHash`, `backupRelativePath`, `installedHash`, `source`, `mergeStrategy`, `verifiedAt`. `validateChangePlan` is **async, takes a context, and throws on refusal**: `validateChangePlan(value: unknown, context: ChangePlanContext): Promise<ChangePlanV1>` (`packages/core/src/plans/validate.ts:261`). A hash is a bare 64-character lowercase hex string — `/^[a-f0-9]{64}$/` at `validate.ts:102` — never `sha256:`-prefixed. **`packages/adapter-claude/src/install.test.ts` already builds the manifest and `planContext` fixtures this task needs; copy them.**

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { validateChangePlan } from "@developer-os/core";
import type { InstallationManifestV1, ManagedArtifactV1 } from "@developer-os/core";
import { proposeCodexInstall, proposeCodexUninstall } from "./install.js";

const home = "/synthetic/home/.developer-os";
const context = { home, productVersion: "0.0.0" };
const root = `${home}/codex/plugins/developer-os`;
const hash = "a".repeat(64);

const tree = [
  { path: ".codex-plugin/plugin.json", contents: "{}\n" },
  { path: "skills/developer-os-shared/SKILL.md", contents: "shared\n" },
];

function artifact(path: string): ManagedArtifactV1 {
  return {
    owner: "codex",
    path,
    kind: "file",
    productVersion: "0.0.0",
    existedBefore: false,
    beforeHash: null,
    backupRelativePath: null,
    installedHash: hash,
    source: "skills/developer-os-shared/SKILL.md",
    mergeStrategy: "dedicated",
    verifiedAt: "2026-08-11T00:00:00.000Z",
  };
}

function manifest(artifacts: readonly ManagedArtifactV1[]): InstallationManifestV1 {
  return {
    schemaVersion: 1,
    productVersion: "0.0.0",
    installedAt: "2026-08-11T00:00:00.000Z",
    artifacts,
  } as InstallationManifestV1;
}

/** `excludedRoots` is deliberately non-empty: `validateChangePlan` refuses a context without one. */
function planContext(installed: InstallationManifestV1) {
  return {
    manifest: installed,
    ownedRoots: [`${home}/codex`],
    excludedRoots: ["/synthetic/home/DeveloperBrain"],
    canonicalize: (path: string) => Promise.resolve(path),
  };
}

describe("proposeCodexInstall", () => {
  it("targets only paths under the plugin tree spec §4 defines", () => {
    for (const operation of proposeCodexInstall(tree, context).operations) {
      expect(operation.targetPath.startsWith(`${root}/`)).toBe(true);
    }
  });

  it.each([
    { name: "an escaping relative path", path: "../../evil" },
    { name: "an absolute path", path: "/etc/passwd" },
    { name: "the root itself", path: "." },
  ])("refuses $name", ({ path }) => {
    expect(() => proposeCodexInstall([{ path, contents: "x" }], context)).toThrow(/escapes/u);
  });

  it("refuses an empty tree, which would apply cleanly and change nothing", () => {
    expect(() => proposeCodexInstall([], context)).toThrow(/empty/u);
  });

  it("creates what nobody owns and replaces what this adapter installed", () => {
    const owned = artifact(`${root}/.codex-plugin/plugin.json`);
    const proposal = proposeCodexInstall(tree, context, new Map([[owned.path, owned]]));
    const byPath = new Map(proposal.operations.map((o) => [o.targetPath, o.operation]));
    expect(byPath.get(owned.path)).toBe("replace");
    expect(byPath.get(`${root}/skills/developer-os-shared/SKILL.md`)).toBe("create");
  });

  it("produces operations Foundation's own validator accepts", async () => {
    const proposal = proposeCodexInstall(tree, context);
    await expect(
      validateChangePlan(
        {
          schemaVersion: 1,
          productVersion: proposal.productVersion,
          operations: proposal.operations,
        },
        planContext(manifest([])),
      ),
    ).resolves.toMatchObject({ schemaVersion: 1 });
  });

  /** Spec §4.1: the vendor's tool is the only writer of the vendor's config. */
  it("registers the marketplace before installing the plugin", () => {
    expect(proposeCodexInstall(tree, context).registration.map((step) => step.args)).toEqual([
      ["plugin", "marketplace", "add", "developer-os", `${home}/codex`],
      ["plugin", "add", "developer-os@developer-os", "--json"],
    ]);
  });

  it("names no path inside ~/.codex, because we never write there", () => {
    const proposal = proposeCodexInstall(tree, context);
    expect(proposal.operations.length).toBeGreaterThan(0);
    for (const operation of proposal.operations) {
      expect(operation.targetPath).not.toMatch(/\/\.codex\//u);
    }
    for (const step of proposal.registration) {
      expect(step.args.join(" ")).not.toContain("config.toml");
    }
  });
});

describe("proposeCodexUninstall", () => {
  const owned = artifact(`${root}/skills/developer-os-shared/SKILL.md`);
  const managed = new Map([[owned.path, owned]]);

  it("removes the plugin and the marketplace, in that order, before deleting anything", () => {
    expect(proposeCodexUninstall(context, managed).registration.map((s) => s.args)).toEqual([
      ["plugin", "remove", "developer-os"],
      ["plugin", "marketplace", "remove", "developer-os"],
    ]);
  });

  it("proposes a remove for every managed artifact under our tree", () => {
    const operations = proposeCodexUninstall(context, managed).operations;
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.map((o) => o.operation)).toEqual(["remove"]);
  });

  it("refuses an empty uninstall plan", () => {
    expect(() => proposeCodexUninstall(context, new Map())).toThrow(/empty/u);
  });

  it("produces operations Foundation's own validator accepts", async () => {
    const proposal = proposeCodexUninstall(context, managed);
    await expect(
      validateChangePlan(
        {
          schemaVersion: 1,
          productVersion: proposal.productVersion,
          operations: proposal.operations,
        },
        planContext(manifest([owned])),
      ),
    ).resolves.toMatchObject({ schemaVersion: 1 });
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm vitest run packages/adapter-codex/src/install.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 4: Implement `install.ts`**

`packages/adapter-claude/src/install.ts` is the reference for the proposal half — `resolveWithin`, the `create`/`replace` decision, `mergeStrategy: "dedicated"` — with `owner: "codex"` and the root built from `PLUGIN_TREE_SEGMENTS`. A `remove` needs `source: ""`, `proposedHash: null` and the real prior hash, which the validator checks.

`registration` is new: an ordered list of `codex` argv arrays the caller runs in the apply phase, never a shell string. The adapter does not run them — it does not spawn processes (spec §2.3) — it proposes them exactly as it proposes file operations.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm vitest run packages/adapter-codex/src/install.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Run the gate and commit**

```bash
npm run check
git add packages/adapter-codex/src/install.ts packages/adapter-codex/src/install.test.ts
git commit -m "feat(adapter-codex): one owned tree, and two steps that belong to the vendor"
```

---

### Task 12: Safe invocation, and the shared `agent.prompt` schema

**Complexity:** L

**Why this task exists.** Spec §7 is the invocation; spec §7.3 is the hole both adapters close with **one** schema — `parseAgentPromptArgs` in `packages/core`, which DOS-P4 wrote and this adapter must consume rather than re-declare. Spec §10 requires that a hostile `with` on `agent.prompt` is refused by that schema, and the refusal must be reachable from this package or the amendment bought nothing.

**Files:**
- Create: `packages/adapter-codex/src/invoke.ts`, `src/invoke.test.ts`

**Interfaces:**
- Consumes: `ProcessRunner` from `@developer-os/security`; `parseAgentPromptArgs` from `@developer-os/core`.
- Produces:

```ts
export interface CodexInvocation {
  readonly prompt: string;
  readonly workingRoot: string;
  readonly writeScopes: readonly string[];
  readonly outputSchemaPath: string;
  readonly timeoutMs: number;
}
export type CodexRunResult =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly reason: "timeout" }
  | { readonly ok: false; readonly reason: "signal"; readonly signal: string }
  | { readonly ok: false; readonly reason: "exit"; readonly exitCode: number }
  | { readonly ok: false; readonly reason: "malformed-output" }
  | { readonly ok: false; readonly reason: "spawn-failed" }
  | { readonly ok: false; readonly reason: "refused"; readonly detail: string };
export function invocationFromAgentPrompt(
  args: unknown,
  context: { workingRoot: string; writeScopes: readonly string[]; outputSchemaPath: string },
): { ok: true; invocation: CodexInvocation } | { ok: false; detail: string };
export function invokeCodex(
  installation: CodexInstallation,
  invocation: CodexInvocation,
  dependencies: { runner: ProcessRunner },
): Promise<CodexRunResult>;
```

- [ ] **Step 1: Write the failing test**

The file needs three fixtures before any case, and the two blocks below use all three:

```ts
const installation = { executable: "/opt/synthetic/bin/codex", version: "0.147.0" } as const;

function invocation(overrides: Partial<CodexInvocation> = {}): CodexInvocation {
  return {
    prompt: "summarise the vault",
    workingRoot: "/synthetic/work",
    writeScopes: [],
    outputSchemaPath: "/synthetic/work/schema.json",
    timeoutMs: 30_000,
    ...overrides,
  };
}

function runner(handler: (request: ProcessRequest) => Partial<ProcessResult>): ProcessRunner {
  return {
    run(request: ProcessRequest): Promise<ProcessResult> {
      return Promise.resolve({
        stdout: "{}",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
        ...handler(request),
      });
    },
  };
}
```

Then, in addition to the two blocks below, the argv case (`--json`, `--output-schema`,
`--skip-git-repo-check`, `-C` all present), the read-only case (no write scope → `read-only`, no
`--add-dir`), the four failure-identity cases (timeout, signal, non-zero exit, unparseable stdout,
each keeping its own `reason`), the `__proto__` refusal, and the non-absolute-executable case:

```ts
describe("invocationFromAgentPrompt", () => {
  it("accepts a well-formed with block through the shared schema", () => {
    const built = invocationFromAgentPrompt(
      { prompt: "summarise", maxTurns: 3 },
      { workingRoot: "/synthetic/work", writeScopes: [], outputSchemaPath: "/synthetic/s.json" },
    );
    expect(built.ok).toBe(true);
  });

  it.each([
    { name: "an unknown key", args: { prompt: "x", executable: "/bin/sh" } },
    { name: "a prototype-polluting key", args: JSON.parse('{"prompt":"x","__proto__":{"a":1}}') },
    { name: "a missing prompt", args: { maxTurns: 3 } },
    { name: "a non-object", args: "just a string" },
  ])("refuses $name, through the one schema both adapters use", ({ args }) => {
    const built = invocationFromAgentPrompt(args, {
      workingRoot: "/synthetic/work",
      writeScopes: [],
      outputSchemaPath: "/synthetic/s.json",
    });
    expect(built.ok).toBe(false);
  });

  it("never echoes the rejected value, which reaches a log", () => {
    const built = invocationFromAgentPrompt(
      { prompt: "x", secret: "hunter2" },
      { workingRoot: "/synthetic/work", writeScopes: [], outputSchemaPath: "/synthetic/s.json" },
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.detail).not.toContain("hunter2");
  });
});

describe("the three refused flags, and the sandbox that is never full access", () => {
  const hostile = [
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-bypass-hook-trust",
    "--ignore-user-config",
    "danger-full-access",
  ];

  it.each(hostile)("never constructs an argv containing %s", async (value) => {
    let seen: ProcessRequest | null = null;
    const result = await invokeCodex(
      installation,
      invocation({ prompt: value, writeScopes: [value] }),
      { runner: runner((request) => { seen = request; return {}; }) },
    );
    expect(result.ok).toBe(false);
    expect(((seen as ProcessRequest | null)?.args ?? []).join(" ")).not.toContain(value);
  });

  it("chooses the sandbox from the scope count, so full access is unreachable by argument", async () => {
    let seen: ProcessRequest | null = null;
    await invokeCodex(installation, invocation({ writeScopes: ["/synthetic/vault"] }), {
      runner: runner((request) => { seen = request; return {}; }),
    });
    const args = (seen as ProcessRequest | null)?.args ?? [];
    expect(args).toContain("workspace-write");
    expect(args).not.toContain("danger-full-access");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/adapter-codex/src/invoke.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `invoke.ts`**

The argv is spec §7's:

```ts
const args = [
  "exec",
  "--json",
  "--output-schema",
  invocation.outputSchemaPath,
  "-s",
  invocation.writeScopes.length === 0 ? "read-only" : "workspace-write",
  ...invocation.writeScopes.flatMap((scope) => ["--add-dir", scope]),
  "--skip-git-repo-check",
  "-C",
  invocation.workingRoot,
  invocation.prompt,
];
```

The screen on every value position is DOS-P4's and it is **positional, not nominal**: nothing this adapter puts in a value position may begin with `-`, and nothing may match `/permission|danger|bypass/iu` — `danger` rather than `dangerous`, so that `danger-full-access` is caught as a value too. A denylist has to enumerate every dangerous flag the vendor will ever ship; this has to be right once. The sandbox mode is chosen from the scope count and never from an argument, which is what makes `danger-full-access` unreachable rather than merely unwritten.

`invocationFromAgentPrompt` calls `parseAgentPromptArgs` and maps its refusal to a `detail` that never echoes the rejected value, because a `with` block is author-controlled and the message reaches a log.

Structured output is validated before any consumer sees it, and a top-level `__proto__` is refused rather than returned.

**Nothing in this package writes the file `outputSchemaPath` points at.** It is a caller-supplied
path, and the schema's *content* — what a workflow's structured result must look like — belongs to
whichever subsystem executes the verb, which is DOS-P6. This adapter constrains the model with
whatever schema it is handed and validates what comes back; a missing file is the caller's error
and surfaces as a non-zero exit, not as a malformed result.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run packages/adapter-codex/src/invoke.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Run the gate and commit**

```bash
npm run check
git add packages/adapter-codex/src/invoke.ts packages/adapter-codex/src/invoke.test.ts
git commit -m "feat(adapter-codex): a sandbox from the declared scopes, and one schema for one verb"
```

---

### Task 13: Composition, the façade, and the public door

**Complexity:** M

**Why this task exists.** Spec §11 names `CodexAdapter` as "the package's only public door", and `claude-adapter.md` §9.6 records that DOS-P4 shipped no façade and assigned the question to "the point where a common interface has two implementations". This is that point, and the façade is what DOS-P6 consumes instead of eleven loose functions.

**Files:**
- Create: `packages/adapter-codex/src/compose.ts`, `src/index.ts`, `src/index.test.ts`

**Interfaces:**
- Produces: `renderCodexPlugin(contracts)`, `renderCodexInstallTree(contracts, context)`, `CodexAdapter`.

- [ ] **Step 1: Write the failing test**

```ts
import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CodexAdapter } from "./index.js";
import * as door from "./index.js";

describe("the package's public door", () => {
  it("exports exactly what spec §11 names, and nothing else", () => {
    expect(Object.keys(door).sort()).toEqual(
      [
        "CODEX_CAPABILITY_KEYS",
        "CODEX_MINIMUM_VERSION",
        "CodexAdapter",
        "CodexRenderer",
        "MARKETPLACE_NAME",
        "MARKETPLACE_RELATIVE_PATH",
        "PLUGIN_NAME",
        "PLUGIN_TREE_SEGMENTS",
        "SHARED_WORKFLOW_ID",
        "buildPluginTree",
        "discoverCodex",
        "invocationFromAgentPrompt",
        "invokeCodex",
        "probeCodex",
        "proposeCodexInstall",
        "proposeCodexUninstall",
        "renderCodexInstallTree",
        "renderCodexPlugin",
        "renderMarketplace",
        "resolveCapabilities",
        "resolveExecutable",
      ].sort(),
    );
  });

  it("binds the façade to the functions, so DOS-P6 consumes one object", () => {
    expect(CodexAdapter.vendor).toBe("codex");
    expect(typeof CodexAdapter.discover).toBe("function");
    expect(typeof CodexAdapter.capabilities).toBe("function");
    expect(typeof CodexAdapter.renderPlugin).toBe("function");
    expect(typeof CodexAdapter.proposeInstall).toBe("function");
    expect(typeof CodexAdapter.invoke).toBe("function");
  });

  /**
   * A guard, not a constant. `SHARED_WORKFLOW_ID` is re-exported deliberately —
   * it is a string, and a consumer that has it cannot get anything wrong with
   * it. `parseAgentPromptArgs` and `compareCodePoints` are guarantees, and a
   * package that re-exports another package's guard hands consumers two import
   * paths for one rule.
   */
  it("does not re-export another package's guard", () => {
    expect(Object.keys(door)).not.toContain("parseAgentPromptArgs");
    expect(Object.keys(door)).not.toContain("compareCodePoints");
  });

  /**
   * Spec §1, asserted across the package rather than one file.
   *
   * The needle is assembled at runtime because this file is one of the files
   * scanned: written as a literal, the assertion matches its own source and the
   * test can never pass.
   */
  it("imports nothing from the Claude adapter, anywhere in the package", async () => {
    const forbidden = ["adapter", "claude"].join("-");
    const files = await readdir(new URL(".", import.meta.url), { recursive: true });
    const sources = files.filter((name) => name.endsWith(".ts"));
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const source = await readFile(new URL(name, import.meta.url), "utf8");
      expect(source, name).not.toContain(forbidden);
    }
  });
});
```

- [ ] **Step 2: Run it, confirm it fails, implement, rerun**

`compose.ts` holds `renderCodexPlugin(contracts)` — find `shared`, render all six through `CodexRenderer`, hand the skills to `buildPluginTree` — and `renderCodexInstallTree(contracts, { home })`, which is that tree **plus** the marketplace descriptor, every path relative to `<product-home>/codex`. The second is what Task 11's proposal consumes and Task 17 installs; without it, nothing joins the two halves.

`CodexAdapter` is a frozen object binding the functions. It is a value, not a class: there is nothing to construct, and a façade with state would be a second source of truth about an installation.

Expected: FAIL then PASS, 4 tests.

- [ ] **Step 3: Run the gate and commit**

```bash
npm run check
git add packages/adapter-codex/src/compose.ts packages/adapter-codex/src/index.ts \
        packages/adapter-codex/src/index.test.ts
git commit -m "feat(adapter-codex): one door, one façade, and a test that fails when either widens"
```

---

### Task 14: Generate `plugins/codex/`, and fail CI on drift

**Complexity:** M

**Files:**
- Create: `plugins/codex/**` (generated)
- Create: `tests/contracts/adapters/codex/render-all.ts`, `generated.test.ts`
- Create: `tests/tools/render-codex.ts`, `tests/tools/render-codex.test.ts`
- Modify: root `package.json` (`render:codex`), `tests/package.json` (dependency on `@developer-os/adapter-codex`), `tests/tsconfig.json` (project reference)

- [ ] **Step 1: Write the failing drift test**

`tests/contracts/adapters/codex/generated.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectWorkflowDrift } from "@developer-os/workflow-schema";
import { readGeneratedTree, renderAllForCodex } from "./render-all.js";

describe("plugins/codex is a clean regeneration", () => {
  it("matches a fresh render byte for byte, and carries nothing extra", async () => {
    const expected = await renderAllForCodex();
    const onDisk = await readGeneratedTree();
    expect(detectWorkflowDrift(expected, onDisk)).toEqual([]);
    // `detectWorkflowDrift` iterates `expected` only, so an extra file on disk
    // produces no finding. Set equality lives here, in the same case.
    expect([...onDisk.keys()].sort()).toEqual(expected.map((a) => a.path).sort());
  });

  it("scans a non-empty set on both sides", async () => {
    const expected = await renderAllForCodex();
    expect(expected.length).toBeGreaterThan(0);
    expect((await readGeneratedTree()).size).toBe(expected.length);
  });

  it("renders one skill per canonical workflow, plus the manifest", async () => {
    const expected = await renderAllForCodex();
    expect(expected.filter((a) => a.path.endsWith("SKILL.md"))).toHaveLength(6);
    expect(expected).toHaveLength(7);
  });

  it("contains no absolute machine path", async () => {
    const onDisk = await readGeneratedTree();
    expect(onDisk.size).toBeGreaterThan(0);
    for (const [path, contents] of onDisk) {
      expect(contents, path).not.toMatch(/\/Users\/|\/home\//u);
    }
  });

  it("carries the shared preamble in every non-shared skill", async () => {
    const skills = [...(await readGeneratedTree()).entries()].filter(
      ([path]) => path.endsWith("SKILL.md") && !path.includes("developer-os-shared"),
    );
    expect(skills).toHaveLength(5);
    for (const [path, contents] of skills) {
      expect(contents, path).toContain("preamble from shared");
    }
  });

  it("ships no marketplace descriptor, which carries a machine path", async () => {
    expect([...(await readGeneratedTree()).keys()]).not.toContain(
      ".agents/plugins/marketplace.json",
    );
  });
});
```

`render-all.ts` exports `renderAllForCodex(options?: { reverseDirectoryOrder?: boolean })` and `readGeneratedTree()`, mirroring `tests/contracts/adapters/claude/render-all.ts` — which is where both helpers already exist and can be copied with two path changes.

- [ ] **Step 2: Write the regenerator**

`tests/tools/render-codex.ts` mirrors `tests/tools/render-claude.ts`, keeping all three of its guards: the repository root derived from `import.meta.url`, the working directory asserted equal to it, and the auto-run gated on `realpathSync(argv[1])` matching the module — because Node resolves `import.meta.url` to the real path while `argv[1]` keeps a symlink, and comparing them raw makes a symlinked entry point exit 0 having done nothing. Copy its test too, including the case that drives `regenerate` against a temporary tree and proves the refusal happens *before* the delete.

Add to root `package.json`: `"render:codex": "tsc -b && node tests/dist/tools/render-codex.js"`.

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm vitest run tests/contracts/adapters/codex/generated.test.ts`
Expected: FAIL — `plugins/codex` does not exist.

- [ ] **Step 4: Generate the tree**

Run: `npm run render:codex`
Expected: writes `plugins/codex/**`, seven artifacts.

- [ ] **Step 5: Prove the drift check actually fails on drift, both ways**

Append a space to a file under `plugins/codex/`, rerun, confirm FAIL, restore. Then add a file no render produces, rerun, confirm FAIL on the set-equality line, remove it. **A gate nobody has watched go red is a gate about a false property.**

- [ ] **Step 6: Run the gate and commit**

```bash
npm run check
git add plugins/codex tests/contracts/adapters/codex tests/tools/render-codex.ts \
        tests/tools/render-codex.test.ts package.json tests/package.json tests/tsconfig.json \
        pnpm-lock.yaml
git commit -m "feat(adapter-codex): generate the plugin tree, and fail on any drift from it"
```

---

### Task 15: Byte-identity, and the other half of DOS-P3's debt

**Complexity:** S

**Files:**
- Create: `tests/contracts/adapters/codex/determinism.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { renderAllForCodex } from "./render-all.js";

describe("Codex artifacts are byte-identical", () => {
  it("across two renders in one process", async () => {
    expect(await renderAllForCodex()).toEqual(await renderAllForCodex());
  });

  it("under a reversed directory reader", async () => {
    expect(await renderAllForCodex({ reverseDirectoryOrder: true })).toEqual(
      await renderAllForCodex(),
    );
  });

  it("renders all six workflows, so byte-identity is not over an empty set", async () => {
    expect((await renderAllForCodex()).filter((a) => a.path.endsWith("SKILL.md"))).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Prove the reversal is observable**

Delete the `compareCodePoints` sort in `buildPluginTree`, rerun, confirm the second case goes RED, restore it. A determinism test that passes against an unsorted tree proves nothing.

- [ ] **Step 3: Run the gate and commit**

```bash
npm run check
git add tests/contracts/adapters/codex/determinism.test.ts
git commit -m "test(adapter-codex): pay the other half of DOS-P3's byte-identity debt"
```

---

### Task 16: `doctor` reports Codex, and says how to grant trust

**Complexity:** M

**Why this task exists.** Spec §5.3: the wrapper is not a degraded state, and `doctor` prints the exact command that grants trust — a capability that is `wrapper-required` for a reason the user can fix is useless unless the report says so.

**Files:**
- Create: `apps/cli/src/commands/codex-capabilities.ts`, `codex-capabilities.test.ts`
- Modify: `apps/cli/src/commands/doctor.ts`, `apps/cli/package.json` (dependency on `@developer-os/adapter-codex`), `apps/cli/tsconfig.json` (project reference)
- Modify: `tests/e2e/foundation.test.ts` — **the ordered check-id list is asserted in two places; both must be updated**

- [ ] **Step 1: Write the failing test**

`apps/cli/src/commands/claude-capabilities.test.ts` is the reference for the fixtures — it defines the `runner()` and `version()` helpers this test needs, and they can be copied. Cases:

```ts
it("reports rather than refusing when nothing is installed", async () => {
  const report = await reportCodexCapabilities({
    executablePath: null,
    runner: version("codex-cli 0.147.0"),
    pluginRoot: "/synthetic/plugin",
  });
  expect(report.installed).toBe(false);
  expect(new Set(Object.values(report.capabilities))).toEqual(new Set(["unknown"]));
});

it("distinguishes a present-but-unreadable binary from an absent one", async () => {
  const report = await reportCodexCapabilities({
    executablePath: "/opt/synthetic/bin/codex",
    runner: runner(() => ({ exitCode: 97 })),
    pluginRoot: "/synthetic/plugin",
  });
  expect(report.installed).toBe(true);
  expect(report.summary).toContain("codex=unreadable");
  expect(report.summary).not.toContain("codex=absent");
});

/** Spec §5.3: the fix is one command, and a report that omits it is not a report. */
it("names the command that grants hook trust", async () => {
  const report = await reportCodexCapabilities({
    executablePath: "/opt/synthetic/bin/codex",
    runner: version("codex-cli 0.147.0"),
    pluginRoot: "/synthetic/plugin",
    probe: true,
  });
  expect(report.captureVia).toBe("wrapper");
  expect(report.recovery).toContain("/hooks");
});

it("reports every capability key, so the matrix is complete", async () => {
  const report = await reportCodexCapabilities({
    executablePath: null,
    runner: version("codex-cli 0.147.0"),
    pluginRoot: "/synthetic/plugin",
  });
  expect(Object.keys(report.capabilities)).toHaveLength(9);
});

it("does not probe unless asked, because the probe spawns the vendor's CLI", async () => {
  let spawned = false;
  await reportCodexCapabilities({
    executablePath: "/opt/synthetic/bin/codex",
    runner: runner((request) => {
      if (request.args[0] === "plugin") spawned = true;
      return { stdout: "codex-cli 0.147.0" };
    }),
    pluginRoot: "/synthetic/plugin",
  });
  expect(spawned).toBe(false);
});
```

- [ ] **Step 2: Run it, confirm it fails, implement, rerun**

`apps/cli/src/commands/claude-capabilities.ts` is the reference, including its three branches — absent, unreadable, reported — and the reason `unreadable` exists: a binary that is there and did not answer is not absent, and one `doctor` run must not print `codex=present` and `codex=absent` about the same file.

The plugin root is `join(context.userHome, ...)`? **No** — Codex's tree is under the *product* home, so it is `join(paths.home, ...PLUGIN_TREE_SEGMENTS)`. This is the mirror image of the Claude bug where the product home was used for a path under the user's home; check it against `install.ts` rather than against memory.

- [ ] **Step 3: Extend the e2e assertions**

Add `codex-capabilities` to **both** ordered check-id lists in `tests/e2e/foundation.test.ts`, and assert that with a fake `codex` planted on `PATH` the `agents` line and the capability line agree — the contradiction the Claude side shipped once and an e2e test failed to catch because it read ids and never messages.

- [ ] **Step 4: Run the gate and commit**

```bash
npm run check
git add apps/cli/src/commands/codex-capabilities.ts apps/cli/src/commands/codex-capabilities.test.ts \
        apps/cli/src/commands/doctor.ts apps/cli/package.json apps/cli/tsconfig.json \
        tests/e2e/foundation.test.ts pnpm-lock.yaml
git commit -m "feat(doctor): report Codex, and name the command that grants hook trust"
```

---

### Task 17: Integration against a real installation, in a disposable `CODEX_HOME`

**Complexity:** L

**Files:**
- Create: `tests/integration/codex/plugin-loads.test.ts`
- Modify: `packages/adapter-codex/src/versions.ts`
- Modify: `docs/superpowers/specs/2026-07-21-developer-os-codex-adapter-design.md` — §14.4, §15.1, §15.2

- [ ] **Step 1: Skip cleanly when Codex is absent**

Resolve `codex` from `PATH` **at module load**, not in `beforeAll`: `it.skipIf(...)` is evaluated while the suite is constructed, before any hook runs. DOS-P4 shipped a suite that skipped unconditionally on every machine for exactly this reason and reported green.

- [ ] **Step 2: Write the integration test**

Point `CODEX_HOME` and `HOME` at temporary directories, write `renderCodexInstallTree` into a temporary product home, and assert:

- `codex plugin marketplace add <name> <product-home>/codex` and `codex plugin add developer-os@developer-os --json` both exit 0 — **and if either refuses the marketplace document, that is the finding**: amend spec §14.4 with the shape it actually accepted rather than adjusting the test until it passes;
- `codex plugin list --json` reports our plugin, enabled, resolved to the path we wrote — the property the whole install shape was chosen for;
- the six skills are discoverable;
- **no byte is written outside the temporary `CODEX_HOME` and the temporary product home**, inventoried around the operation;
- `~/.codex/config.toml` inside the temporary home is either absent or written only by the vendor's CLI, never by us;
- uninstall reverses both CLI steps and then removes the tree, and a simulated failure of either step leaves the tree in place.

Pass the parent's `PATH` through rather than pinning `/usr/bin:/bin`: an npm-installed CLI with an `env node` shebang fails to spawn under a pinned `PATH`, which converts "installed differently" into "broken".

- [ ] **Step 3: Record what was observed about hooks**

This plan ships no hooks file, so `plugin_hooks` stays `unknown`. If the run reveals anything about the plugin-bundled hooks path — that it exists, that a manifest key is required, that it is ignored — record it in spec §14.4 and §15.1, dated. **DOS-P6 restores hooks for both adapters and inherits whatever this test learned.**

- [ ] **Step 4: Record the observed floor**

Set `CODEX_MINIMUM_VERSION` to the lowest version at which the install was observed to work, and amend spec §15.2, dated. If only one version was available, say so rather than implying a range was explored.

- [ ] **Step 5: Run the gate and commit**

```bash
npm run check
git add tests/integration/codex packages/adapter-codex/src/versions.ts \
        docs/superpowers/specs/2026-07-21-developer-os-codex-adapter-design.md
git commit -m "test(adapter-codex): verify against a real install, and record what it revealed"
```

---

### Task 18: Close DOS-P5

**Complexity:** S

**Files:**
- Create: `docs/architecture/codex-adapter.md`
- Modify: `docs/superpowers/ORDER.md`, `docs/superpowers/BACKLOG.md`, `docs/superpowers/plans/2026-07-21-developer-os-program.md`
- Delete: `docs/superpowers/plans/2026-07-21-developer-os-codex-adapter.md`

- [ ] **Step 1: Write the architecture note**

It must carry: the file table; what this adapter cannot do on purpose; why the install is a local marketplace and what that buys over a cache copy; the trust gate, and why capture through the wrapper is honest rather than degraded; every residual found during implementation with a named owner; and **spec §12's two-adapter table, updated with whatever implementation changed** — that table is what DOS-P6 inherits, and a difference discovered then is a redesign. `docs/architecture/claude-adapter.md` is the model.

Two things it must say that a reader of the spec alone would not know: **the skill body is shared** (Task 3) so the two adapters differ only in frontmatter, path and manifest; and **neither adapter ships hooks**, which is now one decision covering both rather than two coincidences.

- [ ] **Step 2: Tick Task 5's boxes in the program plan — and only Task 5's**

Thirteen boxes across Tasks 4–7 were ticked in error on 2026-08-10 by a commit closing a different task. **Do not repeat it.** Stage named paths only, then read `git show --stat HEAD`. Where a box is unearned, leave it unticked with an inline note naming its owner, exactly as Task 4's two are — the hooks box is one of them.

- [ ] **Step 3: Move `NOW` to A10 and delete this plan**

`plans/` holds only unfinished work. Delete this file in the same commit that closes it, after carrying anything a later step still needs into the architecture note. Remove the A9 row from `ORDER.md`'s Track A table and add a line to its closed table; update `BACKLOG.md` §3 and §5.

- [ ] **Step 4: Run the gate and commit**

```bash
npm run check
git add docs/architecture/codex-adapter.md docs/superpowers/ORDER.md docs/superpowers/BACKLOG.md \
        docs/superpowers/plans/2026-07-21-developer-os-program.md
git rm docs/superpowers/plans/2026-07-21-developer-os-codex-adapter.md
git commit -m "docs: close DOS-P5, and leave the architecture note that replaces its plan"
```

---

## Self-review

**Spec coverage.** §1 peer independence → Tasks 1, 2, 3, 13 (the package-wide import assertion). §2.4 no transcript → nothing opens it; Task 17's write-scope inventory is what would catch a read. §4 install shape → Tasks 9, 10, 11. §4.1 the CLI writes the config → Task 11's `registration`. §4.2 uninstall order → Task 11. §4.3 no three-way merge → Task 11's `dedicated` strategy. §5 capability model → Tasks 5, 7. §5.1 version discovery → Tasks 4, 5, 17. §5.2 the structured probe → Task 6. §5.3 the trust gate → Task 7 (`wrapper-required`), Task 16 (the command that fixes it), and the opening decision for the half that is deferred. §5.4 keys → Task 5. §6 rendering → Tasks 3, 8. §6.1 preamble and no `AGENTS.md` → Tasks 3, 8, 9. §6.2 inert `recovery.resume` → Task 3. §6.3 byte-identity → Tasks 14, 15. §7 invocation → Task 12. §7.1 scopes → sandbox → Task 12. §7.2 refused flags → Task 12. §7.3 the shared `agent.prompt` schema → Task 12's `invocationFromAgentPrompt`. §8 failure contracts → Task 12 produces the reasons; **the reason → exit-code mapping lives in the CLI, as it does for DOS-P4, and Task 16 is where it is wired**. §9 security seams → Tasks 2, 3, 11, 12. §10 testing → Tasks 14–17. §11 interfaces → Task 13, façade included. §12 the DOS-P6 table → Task 18. §13 what DOS-P8 must know → Task 18's note. §14 verified surfaces → cited throughout; amended in Task 17. §15 open items → 15.1 Tasks 7 and 17, 15.2 Task 17, 15.3 nothing to do, 15.4 Task 5's comment, 15.5 nothing to do.

**Two gaps I am naming rather than hiding.** Spec §5.3's "ship hooks" is deferred to DOS-P6 for both adapters, which is a decision the founder must ratify — it is at the top of this plan and in `BACKLOG.md` §8. And spec §10's "a Codex-only user completes the same synthetic Brain outcome contract as a Claude-only user" **cannot be fully demonstrated by this subsystem**: `capture`, `ingest` and `review` name verbs with no handler anywhere in this product, which is DOS-P6's, exactly as `claude-adapter.md` §8 records for DOS-P4. Task 17 proves what can be proved; Task 18's note must say plainly which half remains owed rather than reporting a checkpoint that was not met.

**Type consistency.** `CodexInstallation` is `{ executable, version }` in Tasks 4, 6 and 12. `CapabilityState` and `ProbeObservation` come from `@developer-os/core` in Tasks 1, 6 and 7 and are declared nowhere else. `ProcessRunner`, `ProcessRequest` and `ProcessResult` come from `@developer-os/security` in Tasks 4, 6 and 12. `RenderedArtifact` is `{ path, contents }` everywhere, which is why no task can mark a file executable. `CodexProbeResult` is produced in Task 6 and consumed in Tasks 7 and 16 under that name. `PLUGIN_TREE_SEGMENTS` is defined in Task 9 and is the only definition of where the tree lives; Tasks 10, 11 and 16 all resolve against it.

**Two instructions that outrank this document.** `packages/core/src/plans/types.ts` and `packages/core/src/manifest/types.ts` are the authority on every shape Task 11 touches. And where a snippet here and a shipped file disagree, the shipped file wins — this plan cites `packages/adapter-claude` as the reference implementation throughout, and reading it is faster than re-deriving it.
