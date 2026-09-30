import { describe, expect, it } from "vitest";

import type { LintFinding } from "../lint/index.js";
import { DEFAULT_BRAIN_CONFIG } from "../schema/config.js";
import type { GardenTargetsV1 } from "./select.js";
import { note } from "./testing.js";
import { validateGardenResponse } from "./validate.js";
import type { GardenValidationV1 } from "./validate.js";

interface Fields {
  readonly title: string;
  readonly type?: string;
  readonly updated?: string | null;
  readonly author?: string;
  readonly summary?: string;
  readonly sources?: readonly string[];
}

/**
 * A valid knowledge-note header. `updated: null` is omitted rather than
 * rendered, because `parseNote` rejects a present `updated` that is not a date.
 */
function frontmatter(fields: Fields): string {
  const lines = [
    "---",
    "schemaVersion: 1",
    `title: ${JSON.stringify(fields.title)}`,
    `type: ${fields.type ?? "knowledge-note"}`,
    'created: "2026-01-01"',
    ...(fields.updated == null ? [] : [`updated: ${JSON.stringify(fields.updated)}`]),
    'tags: ["testing"]',
    `summary: ${JSON.stringify(fields.summary ?? `About ${fields.title}.`)}`,
    "stage: emerging",
    `author: ${fields.author ?? "agent"}`,
    "reviewed: null",
    ...(fields.sources === undefined ? [] : [`sources: ${JSON.stringify(fields.sources)}`]),
    "---",
    "",
  ];
  return lines.join("\n");
}

const TITLES: Readonly<Record<string, string>> = {
  "DEV/alpha.md": "Alpha",
  "DEV/beta.md": "Beta",
  "DEV/gamma.md": "Gamma",
  "DEV/delta.md": "Delta",
};

const TEXTS = new Map(
  Object.entries(TITLES).map(([path, title]) => [path, frontmatter({ title }) + `# ${title}\n\nBody.\n`]),
);

function text(path: string): string {
  const value = TEXTS.get(path);
  if (value === undefined) throw new Error(`no fixture for ${path}`);
  return value;
}

const NOTES = Object.entries(TITLES).map(([path, title]) =>
  note(`content/${path}`, { title, tags: path === "DEV/alpha.md" ? [] : ["testing"] }),
);

const TARGETS: GardenTargetsV1 = {
  gaps: [{ tag: "testing", notePaths: ["DEV/beta.md", "DEV/gamma.md", "DEV/delta.md"] }],
  isolated: ["DEV/alpha.md", "DEV/delta.md"],
};

const SUMMARY_FINDING: LintFinding = {
  class: "frontmatter",
  severity: "warn",
  path: "content/DEV/gamma.md",
  key: "summary",
  message: "summary is too vague",
  line: null,
};

function validate(
  response: unknown,
  overrides: { pendingNotePaths?: ReadonlySet<string>; onDisk?: ReadonlyMap<string, string> } = {},
): GardenValidationV1 {
  const result = validateGardenResponse({
    response,
    targets: TARGETS,
    notes: NOTES,
    config: DEFAULT_BRAIN_CONFIG,
    readNote: (path) => TEXTS.get(path) ?? overrides.onDisk?.get(path) ?? null,
    pendingNotePaths: overrides.pendingNotePaths ?? new Set(),
    findings: [SUMMARY_FINDING],
    redactionFindings: (value) => (value.includes("AKIA") ? 1 : 0),
  });
  if ("invalid" in result) throw new Error("unexpected agent_output_invalid");
  return result;
}

function goodFor(path: string): string {
  return (
    text(path).replace('created: "2026-01-01"\n', 'created: "2026-01-01"\nupdated: "2026-10-04"\n') +
    "\n## Related\n\n- [[Beta]]\n- [[Gamma]]\n"
  );
}

function hubNote({ links, sources = [] }: { links: readonly string[]; sources?: readonly string[] }): string {
  return (
    frontmatter({ title: "Testing hub", type: "compiled-note", sources }) +
    "# Testing hub\n\n" +
    links.map((link) => `- [[${link}]]\n`).join("")
  );
}

const HUB = hubNote({ links: ["Beta", "Gamma", "Delta"], sources: ["content/DEV/beta.md"] });

describe("validateGardenResponse", () => {
  it("accepts a valid hub, related and fix proposal together", () => {
    const fix = text("DEV/gamma.md").replace("About Gamma.", "Gamma: how the gamma step works.");
    const result = validate({
      proposals: [
        { kind: "hub", target: "DEV/testing-hub.md", note: HUB },
        { kind: "related", target: "DEV/alpha.md", note: goodFor("DEV/alpha.md") },
        { kind: "fix", target: "DEV/gamma.md", note: fix },
      ],
    });
    expect(result.rejected).toEqual([]);
    expect(result.accepted.map((p) => p.target)).toEqual(["DEV/testing-hub.md", "DEV/alpha.md", "DEV/gamma.md"]);
  });

  it("rejects a related proposal that also rewrites the body, and still accepts the other proposals", () => {
    const current = frontmatter({ title: "Alpha", updated: null }) + "# Alpha\n\nBody.\n";
    const edited = current.replace("Body.", "Body changed.") + "\n## Related\n\n- [[Beta]]\n- [[Gamma]]\n";
    const good = current.replace("updated: null", 'updated: "2026-10-04"') + "\n## Related\n\n- [[Beta]]\n- [[Gamma]]\n";
    const result = validate({ proposals: [
      { kind: "related", target: "DEV/alpha.md", note: edited },
      { kind: "related", target: "DEV/delta.md", note: goodFor("DEV/delta.md") },
    ] });
    expect(result).toMatchObject({ rejected: [{ index: 0, code: "related_changes_body" }] });
    expect(result.accepted.map((p) => p.target)).toEqual(["DEV/delta.md"]);
    // `good` is the same note with only a Related section added: accepted.
    expect(validate({ proposals: [{ kind: "related", target: "DEV/alpha.md", note: good }] }).rejected).toEqual([]);
  });

  it("rejects a hub whose sources name a note outside the bundle", () => {
    const hub = hubNote({ links: ["Beta", "Gamma", "Delta"], sources: ["content/DEV/beta.md", "content/DEV/not-in-bundle.md"] });
    expect(validate({ proposals: [{ kind: "hub", target: "DEV/testing-hub.md", note: hub }] }))
      .toMatchObject({ accepted: [], rejected: [{ index: 0, code: "sources_outside_bundle" }] });
  });

  it("rejects a link into quarantine as unresolved", () => {
    const hub = HUB + "- [[_raw/quarantine/x]]\n";
    expect(validate({ proposals: [{ kind: "hub", target: "DEV/testing-hub.md", note: hub }] }))
      .toMatchObject({ accepted: [], rejected: [{ index: 0, code: "link_unresolved" }] });
  });

  it("resolves a link to a hub accepted in the same run, but not to a rejected or private one", () => {
    const linking = goodFor("DEV/alpha.md").replace("- [[Gamma]]", "- [[Testing hub]]");
    expect(validate({ proposals: [
      { kind: "related", target: "DEV/alpha.md", note: linking },
      { kind: "hub", target: "DEV/testing-hub.md", note: HUB },
    ] }).rejected).toEqual([]);

    // The hub is rejected later in the order (redaction), so the link it would have satisfied fails.
    expect(validate({ proposals: [
      { kind: "related", target: "DEV/alpha.md", note: linking },
      { kind: "hub", target: "DEV/testing-hub.md", note: HUB + "AKIAABCDEFGHIJKLMNOP\n" },
    ] }).rejected).toEqual([
      { index: 0, target: "DEV/alpha.md", code: "link_unresolved" },
      { index: 1, target: "DEV/testing-hub.md", code: "redaction_would_alter" },
    ]);

    // A hub proposed into a private folder never becomes a link target.
    const privateLink = goodFor("DEV/alpha.md").replace("- [[Gamma]]", "- [[_raw/x]]");
    expect(validate({ proposals: [
      { kind: "hub", target: "_raw/x.md", note: HUB },
      { kind: "related", target: "DEV/alpha.md", note: privateLink },
    ] }).rejected).toEqual([
      { index: 0, target: "_raw/x.md", code: "target_outside_topics" },
      { index: 1, target: "DEV/alpha.md", code: "link_unresolved" },
    ]);
  });

  it("rejects a proposal the redactor would alter", () => {
    const hub = HUB + "\nKey: AKIAABCDEFGHIJKLMNOP\n";
    expect(validate({ proposals: [{ kind: "hub", target: "DEV/testing-hub.md", note: hub }] }))
      .toMatchObject({ accepted: [], rejected: [{ index: 0, code: "redaction_would_alter" }] });
  });

  it("rejects proposals past the eighth as over_limit", () => {
    const proposals = Array.from({ length: 9 }, (_, i) => ({
      kind: "hub",
      target: `DEV/hub-${String(i)}.md`,
      note: HUB,
    }));
    const result = validate({ proposals });
    expect(result.accepted).toHaveLength(8);
    expect(result.rejected).toEqual([{ index: 8, target: "DEV/hub-8.md", code: "over_limit" }]);
  });

  it("rejects a second proposal for one target as duplicate_target", () => {
    const result = validate({ proposals: [
      { kind: "related", target: "DEV/alpha.md", note: goodFor("DEV/alpha.md") },
      { kind: "related", target: "DEV/alpha.md", note: goodFor("DEV/alpha.md") },
    ] });
    expect(result.accepted.map((p) => p.target)).toEqual(["DEV/alpha.md"]);
    expect(result.rejected).toEqual([{ index: 1, target: "DEV/alpha.md", code: "duplicate_target" }]);
  });

  it("rejects a hub at a path a note, a pending capture or an unindexed file occupies", () => {
    for (const [target, overrides] of [
      ["DEV/beta.md", {}],
      ["DEV/Beta.md", {}],
      ["DEV/pending.md", { pendingNotePaths: new Set(["DEV/pending.md"]) }],
      ["DEV/broken.md", { onDisk: new Map([["DEV/broken.md", "not a note"]]) }],
    ] as const) {
      expect(validate({ proposals: [{ kind: "hub", target, note: HUB }] }, overrides))
        .toMatchObject({ accepted: [], rejected: [{ index: 0, code: "target_occupied" }] });
    }
  });

  it("rejects a hub outside a topic folder", () => {
    for (const target of ["_outputs/hub.md", "DEV/_raw/hub.md", "DEV/.hidden/hub.md", "NOPE/hub.md", "DEV/../hub.md", "DEV/hub.txt"]) {
      expect(validate({ proposals: [{ kind: "hub", target, note: HUB }] }))
        .toMatchObject({ accepted: [], rejected: [{ index: 0, code: "target_outside_topics" }] });
    }
  });

  it("rejects a hub with fewer than three links to bundle notes", () => {
    const hub = hubNote({ links: ["Beta", "Gamma", "Alpha"] });
    expect(validate({ proposals: [{ kind: "hub", target: "DEV/testing-hub.md", note: hub }] }))
      .toMatchObject({ accepted: [], rejected: [{ index: 0, code: "hub_too_thin" }] });
  });

  it("rejects a related proposal for a note that was not selected", () => {
    expect(validate({ proposals: [{ kind: "related", target: "DEV/beta.md", note: goodFor("DEV/beta.md") }] }))
      .toMatchObject({ accepted: [], rejected: [{ index: 0, code: "target_not_selected" }] });
  });

  it("rejects a related section with fewer than two or more than five links", () => {
    const one = goodFor("DEV/alpha.md").replace("- [[Gamma]]\n", "");
    const six = goodFor("DEV/alpha.md") + "- [[Delta]]\n- [[Beta]]\n- [[Gamma]]\n- [[Delta]]\n";
    for (const body of [one, six]) {
      expect(validate({ proposals: [{ kind: "related", target: "DEV/alpha.md", note: body }] }))
        .toMatchObject({ accepted: [], rejected: [{ index: 0, code: "related_changes_body" }] });
    }
  });

  it("rejects a fix that changes a key its finding does not name, or the body", () => {
    const title = text("DEV/gamma.md").replace('title: "Gamma"', 'title: "Gamma step"');
    const body = text("DEV/gamma.md").replace("About Gamma.", "Better.").replace("Body.", "Other.");
    const unflagged = text("DEV/beta.md").replace("About Beta.", "Better.");
    for (const [target, fix] of [["DEV/gamma.md", title], ["DEV/gamma.md", body], ["DEV/beta.md", unflagged]] as const) {
      expect(validate({ proposals: [{ kind: "fix", target, note: fix }] }))
        .toMatchObject({ accepted: [], rejected: [{ index: 0, code: "fix_out_of_scope" }] });
    }
  });

  it("rejects a note over 64 KiB as too_large", () => {
    const hub = HUB + "x".repeat(70_000);
    expect(validate({ proposals: [{ kind: "hub", target: "DEV/testing-hub.md", note: hub }] }))
      .toMatchObject({ accepted: [], rejected: [{ index: 0, code: "too_large" }] });
  });

  it("rejects a note whose frontmatter is not an unreviewed emerging agent note", () => {
    for (const hub of [
      HUB.replace("author: agent", "author: human"),
      HUB.replace("stage: emerging", "stage: established"),
      HUB.replace("reviewed: null", 'reviewed: "2026-09-01"'),
      HUB.replace("stage: emerging", "stage: emerging\nextra: 1"),
      HUB.replace("type: compiled-note", "type: knowledge-note"),
      "no frontmatter",
    ]) {
      expect(validate({ proposals: [{ kind: "hub", target: "DEV/testing-hub.md", note: hub }] }))
        .toMatchObject({ accepted: [], rejected: [{ index: 0, code: "frontmatter_invalid" }] });
    }
  });

  it("rejects the whole response when it does not match the schema", () => {
    const base = {
      targets: TARGETS,
      notes: NOTES,
      config: DEFAULT_BRAIN_CONFIG,
      readNote: () => null,
      pendingNotePaths: new Set<string>(),
      findings: [],
      redactionFindings: () => 0,
    };
    for (const response of [
      { proposals: "x" },
      42,
      null,
      [],
      {},
      { proposals: [], extra: 1 },
      { proposals: [{ kind: "delete", target: "DEV/a.md", note: "" }] },
      { proposals: [{ kind: "hub", target: "DEV/a.md", note: 1 }] },
      { proposals: [{ kind: "hub", target: "DEV/a.md", note: "", extra: 1 }] },
    ]) {
      expect(validateGardenResponse({ ...base, response })).toEqual({ invalid: "agent_output_invalid" });
    }
  });
});
