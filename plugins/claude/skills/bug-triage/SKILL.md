---
name: bug-triage
description: Triage a reported defect or outage by setting severity, reproducing it, ranking evidence-backed hypotheses, identifying root cause, and proposing mitigation, permanent fix, and regression test. Use when the user reports a bug, production outage, client issue, error, or stack trace, or asks to investigate an incident.
---

# Triage a defect

1. Set severity first: P0 production unavailable or all users blocked; P1 major feature broken with a workaround; P2 ordinary defect; P3 minor/cosmetic.
2. Gather the exact stack trace, reproduction steps, affected users, frequency, environment, and first-known time. Ask only for data unavailable from the repository or observability tools.
3. Inspect relevant logs/traces, recent commits, and data invariants. Do not mutate production while diagnosing.
4. Rank at least three hypotheses with likelihood and evidence. Name the current leader and the observation that would falsify it.
5. Propose:
   - immediate mitigation for P0/P1;
   - root-cause fix;
   - a regression test that would have caught the defect;
   - rollback criteria and monitoring.
6. Draft internal/client communication only when requested. Never send it without explicit authorization.

Output severity with reasoning, reproduction, ranked hypotheses, confirmed root cause or missing evidence, mitigation, permanent fix, regression test, and communication checklist.
