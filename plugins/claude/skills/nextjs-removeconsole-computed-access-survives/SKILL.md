---
name: nextjs-removeconsole-computed-access-survives
description: 'Explains why some console output survives Next.js production builds despite

  `compiler.removeConsole: true`. Use when: (1) auditing whether a logging wrapper''s

  output is stripped in production, (2) a claim that "removeConsole deletes our logs"

  needs verifying, (3) deciding if middleware/security logs (e.g. role-mismatch or

  auth-denial events) reach the hosting platform''s function logs in prod, (4) designing a

  console-only log helper you WANT to survive (or be sure is removed). Key fact: SWC''s

  remove_console strips only STATIC `console.warn(...)` calls, NOT computed `console[method](...)`.

  '
---

# Next.js removeConsole only strips STATIC console calls, not computed access

## Problem

`next.config` `compiler.removeConsole: true` (or `process.env.NODE_ENV === "production"`)
is widely assumed to delete ALL `console.*` output from production bundles. It does not.
The SWC `remove_console` transform removes only **statically identifiable**
`console.<identifier>(...)` calls. A **computed** member expression `console[method](...)`
— where `method` is a runtime variable — is left intact and reaches production logs
(serverless function and edge logs included).

This flips audit conclusions in both directions:
- A logging helper that emits via `console[method](...)` (a common wrapper pattern)
  **survives** production stripping — its output DOES reach platform logs.
- Code relying on `removeConsole` to guarantee no secrets leak via `console[secretKey]`
  would still leak.

## Context / Trigger Conditions

- A `@yourorg/logger`-style wrapper does `const consoleLog = (m, ...a) => console[m](...a)`.
- Someone claims "`logWarning`/`console.warn` is stripped in prod, so those events are logged nowhere."
- `compiler.removeConsole` is set to plain `true` (no `{ exclude: [...] }`).
- Packages consumed as raw TS source via workspace symlink (no `transpilePackages` needed —
  the app's SWC loader still processes them, because the symlink resolves to a real path
  inside the monorepo, not under `node_modules`).
- Auditing where middleware role-mismatch / auth-denial / security events actually land in prod.

## Solution

1. **Do not reason about it — reproduce it.** Run the real Next SWC binding against the
   exact source pattern (see Verification). Plain `true` strips `console.warn/error/log`
   (static) to empty statements `;`; `console[method](...)` is emitted unchanged.
2. **Trace the actual emission site**, not the call site. If `logWarning("x")` delegates to
   `consoleLog("warn", ...)` which does `console[method](...)`, the emission is computed →
   survives. If it called `console.warn(...)` directly → stripped.
3. **To force removal** of a computed call, `removeConsole` is not enough; strip it another way.
   **To force survival** of an important log under `removeConsole: true`, route it through a
   computed access OR use `removeConsole: { exclude: ["warn", "error"] }`.
4. Note: `console.error`/`console.warn` are ALSO stripped by plain `true` (no implicit
   exclusion of `error`). Wrappers usually survive stripping only because they ALSO have a
   non-console transport (an error-tracking service) — the console echo is what gets removed there.

## Verification

Reproduce with the app's own Next SWC binding (authoritative — not a blog):

```js
// node repro.mjs  (run from the repository root so `next` resolves)
import * as swc from 'next/dist/build/swc/index.js'
const src = `
const consoleLog = (m, p, msg) => { console[m](p, msg) }        // computed
export const logWarning = (msg) => consoleLog("warn", "[WARN]", msg)
function direct(m){ console.warn("[DIRECT]", m); console.error("[E]", m) } // static
`
if (swc.loadBindings) await swc.loadBindings()
const out = await swc.transform(src, { jsc:{parser:{syntax:'ecmascript'},target:'es2020'}, removeConsole: true })
console.log(out.code)
// EXPECT: console[m](...) present; console.warn/error(...) replaced with `;`; [WARN] literal survives
```

If the bare `next/...` specifier does not resolve, import the same file by its absolute path
inside the app's `node_modules`. If `bindings not loaded yet` throws, call
`await swc.loadBindings()` first (as above).

## Example

An audit claimed a console-only middleware logger was stripped in production. The premises
held, but the logger emitted through `console[method](...)`, so its output survived; an SWC
repro disproved the claim.

## Notes

- Applies to the webpack (`next build --webpack`) SWC path. Turbopack has a separate
  transform; verify separately if the app uses it.
- Minification runs AFTER remove_console on un-inlined source; the minifier does not drop
  console, so the computed call reaches the final bundle in both node and edge/middleware chunks.
- The ported transform derives from `babel-plugin-transform-remove-console`, which likewise
  only matches static member access — so this is a shared limitation, not a Next-only quirk.
- Lesson beyond the fact: when verifying a "code X is stripped/removed" claim, confirm the
  actual EMISSION construct, not just the premises. Confirming all premises ≠ confirming the
  causal step.

## References

- Next.js Compiler documentation, `removeConsole` (nextjs.org/docs/architecture/nextjs-compiler)
- Next.js pull request 31449 — port babel-plugin-transform-remove-console to SWC
- Next.js discussion 34810 — removeConsole in production only
- Empirical verification via `next/dist/build/swc` `transform({ removeConsole: true })` (authoritative;
  the computed-vs-static distinction was undocumented as of Next 16).
