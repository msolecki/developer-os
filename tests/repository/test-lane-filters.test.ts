import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * **A `-t` lane filter must still match a case in the file it names** (TEST-1). The bootstrap
 * isolation, the fine-grained shard and the update-recovery lanes select cases by title regex.
 * Vitest exits 0 when a filter selects nothing, so a renamed title silently empties a shard or moves
 * the isolated case back into the shared process. This reads the lanes from `package.json` and
 * requires every literal fragment of every filter to occur in its test file.
 */
export interface LaneFilter {
  readonly script: string;
  readonly file: string;
  readonly filter: string;
}

export function laneFilters(scripts: Readonly<Record<string, string>>): readonly LaneFilter[] {
  return Object.entries(scripts).flatMap(([script, command]) =>
    command.split("&&").flatMap((part) => {
      const match = /vitest run (\S+\.test\.ts) -t '([^']*)'/u.exec(part);
      return match === null ? [] : [{ script, file: match[1] ?? "", filter: match[2] ?? "" }];
    }),
  );
}

/** The literal words of a filter: regex punctuation stripped, alternatives split. */
export function filterFragments(filter: string): readonly string[] {
  return filter
    .replaceAll("(?!", "(")
    .replaceAll(".*", "|")
    .split(/[()|^$]/u)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0);
}

export function missingFragments(filter: string, source: string): readonly string[] {
  return filterFragments(filter).filter((fragment) => !source.includes(fragment));
}

describe("every -t lane filter in package.json still matches its test file", () => {
  it("finds a case title for every fragment of every filter", async () => {
    const manifest = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const lanes = laneFilters(manifest.scripts);
    expect(lanes.length, "no -t lane found in package.json").toBeGreaterThan(5);
    const problems: string[] = [];
    for (const lane of lanes) {
      const source = await readFile(join(ROOT, lane.file), "utf8");
      for (const fragment of missingFragments(lane.filter, source)) {
        problems.push(`${lane.script}: "${fragment}" does not occur in ${lane.file}`);
      }
    }
    expect(problems).toStrictEqual([]);
  });

  it("reports a renamed case, which vitest itself would run as zero tests", () => {
    const filter = "^(?!.*(at every death point|died anywhere)).*(death|died).*$";
    expect(filterFragments(filter)).toStrictEqual([
      "at every death point",
      "died anywhere",
      "death",
      "died",
    ]);
    expect(missingFragments(filter, 'it("at every death point", () => {}); // died')).toStrictEqual(["died anywhere"]);
    expect(missingFragments("fine-grained death", 'it("fine grained death")')).toStrictEqual(["fine-grained death"]);
  });
});
