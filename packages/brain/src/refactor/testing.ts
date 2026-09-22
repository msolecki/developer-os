import type { DirectoryEntry } from "../discovery/index.js";
import { DEFAULT_BRAIN_CONFIG } from "../schema/config.js";
import type { RefactorInputV1 } from "./plan.js";

/**
 * A `RefactorInputV1` over an in-memory vault, keyed by content-root-relative
 * path — the same shape `validate.ts`'s `projectionOf` overlays.
 */
export function memoryInput(
  notes: Record<string, string>,
  options: { readonly reversed?: boolean; readonly today?: string } = {},
): RefactorInputV1 {
  const files = new Map(
    Object.entries(notes).map(([path, text]) => [`/vault/content/${path}`, text]),
  );
  const tree = new Map<string, DirectoryEntry[]>();
  for (const absolute of files.keys()) {
    const segments = absolute.slice("/vault/".length).split("/");
    for (let i = 0; i < segments.length; i += 1) {
      const parent = ["/vault", ...segments.slice(0, i)].join("/");
      const name = segments[i] as string;
      const isFile = i === segments.length - 1;
      const siblings = tree.get(parent) ?? [];
      if (!siblings.some((entry) => entry.name === name)) {
        siblings.push({ name, isDirectory: !isFile, isFile, isSymbolicLink: false });
      }
      tree.set(parent, siblings);
    }
  }
  return {
    build: {
      vaultRoot: "/vault",
      config: DEFAULT_BRAIN_CONFIG,
      reader: {
        readDir: (path: string) => {
          const entries = tree.get(path) ?? [];
          return Promise.resolve(options.reversed === true ? [...entries].reverse() : entries);
        },
      },
      readFile: (path: string) => {
        const text = files.get(path);
        return text === undefined
          ? Promise.reject(Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }))
          : Promise.resolve(text);
      },
      assertReadable: () => Promise.resolve(),
      canonicalize: (path: string) => Promise.resolve(path),
      now: () => "2026-09-22T00:00:00.000Z",
    },
    today: options.today ?? "2026-09-22",
  };
}

export function noteText(fields: {
  readonly title: string;
  readonly body?: string;
  readonly sources?: readonly string[];
  readonly tags?: readonly string[];
  readonly type?: string;
}): string {
  const lines = [
    "schemaVersion: 1",
    `title: ${fields.title}`,
    `type: ${fields.type ?? "knowledge-note"}`,
    "created: 2026-01-01",
    `tags: [${(fields.tags ?? ["dev"]).join(", ")}]`,
    `summary: About ${fields.title}.`,
    "stage: established",
    "author: human",
    "reviewed: 2026-09-01",
    ...(fields.sources === undefined ? [] : [`sources: [${fields.sources.join(", ")}]`]),
  ];
  return `---\n${lines.join("\n")}\n---\n\n${fields.body ?? "Body."}\n`;
}
