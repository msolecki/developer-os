---
name: url-construction-silent-footguns
description: 'Three silent-failure bugs when building URLs / query strings / redirect URLs by string

  concatenation in JS/TS (Next.js especially). Use when: (1) a rendered link or email href

  shows "[object Object]/..." , (2) a query param reads as undefined/wrong even though it

  appears in the URL, (3) a URL has two "?" (e.g. "/success?trial=1?session_id=..."),

  (4) building return_url / callbackUrl / redirect targets, (5) UI shows a price / discount /

  trial / eligibility that the server does not honor (client query-param vs server truth

  divergence), (6) auditing a codebase for these variants. Fixes: interpolate the string field

  not the object, use URLSearchParams instead of string concat, derive trust-sensitive flags

  server-side. All three were observed as real production bugs.

  '
---

# Silent URL / query-string construction footguns

## Problem

URLs and query strings built with template-literal concatenation fail **silently** — no
exception, no TypeScript error, no failing test. The bug only surfaces as a broken link, a
param that reads back `undefined`, or a UI that disagrees with the server. All three variants
below were found in real production code in a single audit.

## Context / Trigger Conditions

Reach for this when you see ANY of:

- A link / email `href` renders literally as `[object Object]/rest/of/path`.
- A query parameter is `undefined` (or has a garbage value) on the receiving page/handler even
  though you can see it in the URL string.
- A URL contains two `?` — e.g. `/success?trial=1?session_id=cs_123`.
- You are constructing a `return_url`, `callbackUrl`, `redirect`, unsubscribe link, or any URL
  that carries state, by string concatenation across more than one place.
- The UI advertises a price / free trial / discount / access level that the server then does
  NOT apply (user charged despite "free", etc.).
- You are auditing/grepping a codebase for these classes of bug (variant analysis).

## Solution

### Footgun 1 — interpolating a config OBJECT instead of its string field

Config barrels often mix string exports and object exports. Interpolating the object gives
`[object Object]`.

```ts
// src/config/domain.ts
export const DOMAIN = { base: 'example.com', email: {...}, url: process.env.SITE_URL } as const;

// BUG: DOMAIN is an object → "[object Object]/api/unsubscribe?token=..."
const url = `${DOMAIN}/api/unsubscribe?token=${token}`;
// FIX: interpolate the string field
const url = `${DOMAIN.url}/api/unsubscribe?token=${token}`;
```

Why it hides: TypeScript does NOT error on `${obj}` in a template literal (it calls
`toString()`). Tests that only assert "an email was sent" never look at the href. Grep the repo
for every config object that is *sometimes* a string and *sometimes* an object and check each
interpolation site.

### Footgun 2 — concatenating query strings → double `?` → downstream param silently undefined

Two code paths each append their own `?`. The second `?` becomes part of the first param's
value, and every param after it is lost.

```ts
// path A builds:  `${base}/success${withTrial ? '?trial=1' : ''}`
// path B appends: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`
// result for a trial: /success?trial=1?session_id=cs_123
// parsed: trial = "1?session_id=cs_123"  and  session_id = undefined  ← breaks a DIFFERENT param
```

The nasty part: the symptom shows up on the param you did NOT touch (`session_id` here → no
purchase tracking fires), so you debug the wrong thing. Note it only triggers on the branch
that adds the *first* `?` (the trial path), so non-trial flows look fine and mask it.

Fix — build the whole query in one place with `URLSearchParams` (or conditional `&`):

```ts
const u = new URL(`${base}/success`);
u.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}'); // payment-provider placeholder: verify it survives encoding
if (withTrial) u.searchParams.set('trial', '1');
// or, when a placeholder must stay literal:
const returnUrl = `${base}/success?session_id={CHECKOUT_SESSION_ID}${withTrial ? '&trial=1' : ''}`;
```

Pass the flag DOWN to the single builder instead of letting two layers each append.

### Footgun 3 — trust-sensitive UI state from a client query param the server disagrees with

The UI decides "free trial / discount / eligible" from a query param (client-controlled),
while the server computes the real answer from user state. They diverge → the user sees one
thing and is charged another (misleading, and a consumer-law and financial risk).

```tsx
// link ALWAYS carries &trial=1; banner shows "first month free" from the param
<Link href={`${checkout}?plan=${slug}&trial=1`}>Try free</Link>
// server grants trial only to first-timers:
withTrial = !user.hasHadSubscription;
// returning customer: sees "free", gets charged immediately.
```

Fix — compute the trust/money-sensitive flag on the **server** (from user/session state) and
pass the real value into the client; never derive it from a client-supplied search param.
Query params are fine for non-sensitive intent (which plan), never for entitlement.

## Verification

- Footgun 1: render/log the final URL (or add a test) and assert it `startsWith('https:')`,
  not `[object Object]`.
- Footgun 2: assert the built URL contains exactly one `?` (`url.split('?').length === 2`);
  round-trip through `new URL(u)` and check every expected `searchParams.get(...)` is present.
- Footgun 3: log in as a user who should NOT get the perk and confirm the UI and the server
  agree (no "free" banner, correct price).

## Example (audit greps for variants)

```bash
# object-interpolation candidates: config barrels interpolated bare
grep -rnE '\$\{(DOMAIN|CONFIG|ROUTES|API|URLS)\}' src/
# query-string concat that can double up a '?'
grep -rnE '\?[a-z_]+=[^`"'\'' ]*`\s*[+,]|returnUrl.*\?|`\$\{[^}]+\}\?' src/ | grep -i 'url\|redirect\|return\|callback'
# trust flags coming from search params
grep -rnE "searchParams|useSearchParams|\?.*trial=|\?.*discount=" src/ | grep -i 'trial\|discount\|eligib\|free\|price'
```

Extend the first pattern with the names of the project's own config objects.

## Notes

- None of the three throw or fail type-check — treat "looks fine, compiles, tests pass" as NO
  evidence of correctness for URL building. Only a real render / round-trip proves it.
- A payment provider's `{CHECKOUT_SESSION_ID}`-style template must reach the provider un-encoded;
  if you use `URLSearchParams`/`new URL`, verify the braces survive (or append that one param by
  hand and build the rest with `URLSearchParams`).
- When one builder owns the URL, these bugs become structurally impossible — the root cause is
  always "two layers each touch the query string."

## References

- MDN — URLSearchParams (developer.mozilla.org/en-US/docs/Web/API/URLSearchParams)
- MDN — URL (developer.mozilla.org/en-US/docs/Web/API/URL)
- Next.js documentation — reading searchParams in pages and route handlers (nextjs.org/docs)
- Derived empirically from a code-to-documentation audit that found all three: an object
  interpolated into e-mail links, a double-`?` return URL that silently disabled purchase
  tracking, and a trial banner driven by `&trial=1` that disagreed with server eligibility.
