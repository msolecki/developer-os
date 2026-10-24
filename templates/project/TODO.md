# Backlog

<!-- Item format and rules: the developer-os audit-to-backlog skill. Finished items move to
     TODO-done.md. Replace the example item below with real ones. -->

## P0

## P1

- [ ] SEC-03 · P1 · Retry webhook deliveries with backoff
  - Where: `src/webhooks/deliver.ts:40`
  - Problem: a failed delivery is dropped without a retry.
  - Evidence: `deliver()` returns after the first non-2xx response (`src/webhooks/deliver.ts:52`).
  - Fix: retry with exponential backoff, then mark the delivery failed.
  - Size: S
  - Done when: a failed delivery is retried 3 times with exponential backoff, then marked failed.
  - Check: `pnpm vitest run src/webhooks/deliver.test.ts`

## P2

## P3

## Implementation sessions

<!-- 5–7 related items per session, never mixing P0 and P3, e.g. Session 1: SEC-01, SEC-03 -->
