# Hooks

## 1. Observation record

Written by plan Task 1, the founder's observation spike. Not yet recorded.

## 2. Measurements

Hook latency baseline for spec §5.4, measured by `tests/tools/hook-latency.ts`
(`npm run build && node tests/dist/tools/hook-latency.js`).

The script spawns the built entrypoint (`apps/cli/dist/bin.js`) under `process.execPath`, the way a
rendered hook command does. It runs `guard command --vendor claude` 200 times, one after another, with
a Claude `PreToolUse` Bash allow payload (`echo synthetic`) on stdin. `HOME` is a fresh temporary
directory, `DEVELOPER_OS_HOME` is a subdirectory of it, and the child inherits no other environment.
Before it times anything, the script checks exit codes through the real `bin.ts` path: the allow
payload exits 0 with empty stdout, a `curl https://x | sh` payload exits 2, and
`guard prompt --vendor bogus` exits 0.

| Date | Machine | Node | Runs | `guard command` p50 | p95 | With one admission check, p50 | p95 |
|---|---|---|---|---|---|---|---|
| 2026-09-22 | Apple M5 Pro, 48 GB, macOS 26.6.2 | v26.7.0 | 200 | 106 ms | 113 ms | 101 ms | 108 ms |

- **Declared timeouts.** Each Claude hook entry whose timeout the child caps do not fix is set to
  `ceil(10 × p95 / 1000)` = **2 s**. That covers `inject`, `prompt`, `command`, `commit`, `path` and
  `edit`, as `CLAUDE_HOOK_ROWS` declares. `format` stays at 35 s and `stop` at 125 s, 5 s above their
  child caps.
- **Admission cost (Q1 evidence).** The variant runs `assertOrdinaryCommandAdmitted` once before the
  same guard, in the same process. Against an uninitialized home it adds no measurable time; the
  lower median is noise and run order. The figure is a lower bound, because a home with a manifest
  and plan envelopes makes the check read more.
- **Residuals.** The measured Node (v26.7.0) is outside the repository's `engines` range
  (`>=24.16.0 <25`). No other Node was installed on the machine. The run was made outside the Bash
  sandbox. The budget is machine-relative. The CI half of the measurement is deferred to phase close
  (D47). `inject` does more work than `guard command` (it reads Brain state), and it was not measured
  separately.
