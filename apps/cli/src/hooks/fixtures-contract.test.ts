import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CliIo } from "../io.js";
import type { HookVendor, HookVerb } from "./argv.js";
import { runHookMode } from "./entry.js";
import type { HookEnvironment } from "./entry.js";
import { HOOK_EVENT_OF } from "./firing-records.js";
import { decodeHookPayload } from "./payload.js";
import type { HookContextFactory } from "./registry.js";

/** Recorded vendor payloads, scrubbed (A13 Task 1); `docs/architecture/hooks.md` §1. */
const FIXTURES = fileURLToPath(new URL("../../../../tests/fixtures/hooks/", import.meta.url));
const SYNTHETIC_CWD = "/Users/synthetic/work";
const TRANSCRIPT_FIELD = ["transcript", "path"].join("_");
const VENDORS: readonly HookVendor[] = ["claude", "codex"];

/** Only `inject` builds a context; with none available it allows with this one line (fail open). */
const INJECT_NOTE = "developer-os: brain status --inject: context unavailable";

let home: string;
let project: string;

beforeAll(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "developer-os-hook-fixtures-")));
  project = join(home, "work");
  await mkdir(join(project, ".git"), { recursive: true });
  await writeFile(join(project, "note.txt"), "synthetic2\n");
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

interface Fixture {
  readonly name: string;
  readonly text: string;
  readonly event: string;
}

async function fixtures(vendor: HookVendor): Promise<readonly Fixture[]> {
  const directory = join(FIXTURES, vendor);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(
    names.map(async (name) => {
      const text = await readFile(join(directory, name), "utf8");
      const event = (JSON.parse(text) as { hook_event_name: string }).hook_event_name;
      return { name, text, event };
    }),
  );
}

function verbsFor(vendor: HookVendor, event: string): readonly HookVerb[] {
  const events = HOOK_EVENT_OF[vendor];
  return (Object.keys(events) as HookVerb[]).filter((verb) => events[verb] === event);
}

function argvFor(verb: HookVerb, vendor: HookVendor): readonly string[] {
  return verb === "inject" ? ["brain", "status", "--inject", "--vendor", vendor] : ["guard", verb, "--vendor", vendor];
}

function memoryIo(bytes: Uint8Array): CliIo & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line) => void out.push(line),
    stderr: (line) => void err.push(line),
    confirm: () => Promise.resolve(false),
    readStdin: () => Promise.resolve(null),
    readStdinBytes: () => Promise.resolve(bytes),
  };
}

const noContext: HookContextFactory = () => {
  throw new Error("no context in the fixture contract");
};

describe.each(VENDORS)("recorded %s hook payloads", (vendor) => {
  it("has fixtures, and every fixture's event maps to at least one verb", async () => {
    const all = await fixtures(vendor);
    expect(all.length).toBeGreaterThan(0);
    for (const fixture of all) expect(verbsFor(vendor, fixture.event).length, fixture.name).toBeGreaterThan(0);
  });

  it("runs every verb of each fixture's event to its exact expected outcome", async () => {
    const environment: HookEnvironment = {
      env: {},
      userHome: home,
      processCwd: () => project,
      nodeExecutable: process.execPath,
      recordFiring: () => Promise.resolve(),
    };
    const all = await fixtures(vendor);
    expect(all.length).toBeGreaterThan(0);
    for (const fixture of all) {
      const bytes = new TextEncoder().encode(fixture.text.split(SYNTHETIC_CWD).join(project));
      for (const verb of verbsFor(vendor, fixture.event)) {
        const io = memoryIo(bytes);
        const label = `${fixture.name} ${verb}`;
        expect(await runHookMode(argvFor(verb, vendor), io, noContext, environment), label).toBe(0);
        expect(io.out, label).toStrictEqual([]);
        expect(io.err, label).toStrictEqual(verb === "inject" ? [INJECT_NOTE] : []);
      }
    }
  });

  it("decodes each fixture identically with the transcript key added back", async () => {
    const all = await fixtures(vendor);
    expect(all.length).toBeGreaterThan(0);
    for (const fixture of all) {
      const patched = { ...(JSON.parse(fixture.text) as Record<string, unknown>), [TRANSCRIPT_FIELD]: "/Users/synthetic/t" };
      const encoded = new TextEncoder().encode(JSON.stringify(patched));
      for (const verb of verbsFor(vendor, fixture.event)) {
        const plain = decodeHookPayload(new TextEncoder().encode(fixture.text), vendor, verb);
        expect(plain.ok, `${fixture.name} ${verb}`).toBe(true);
        expect(decodeHookPayload(encoded, vendor, verb), `${fixture.name} ${verb}`).toStrictEqual(plain);
      }
    }
  });
});
