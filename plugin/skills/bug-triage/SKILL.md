---
name: bug-triage
description: Triage a reported defect or incident by setting severity, reproducing it, ranking evidence-backed hypotheses, identifying root cause, and proposing mitigation, permanent fix, and regression test. Use when the user reports a defect or production incident, or asks to diagnose failing behavior.
---

# Bug triage

1. Set severity first: P0 = exploitable security defect, data loss, or production down; P1 = wrong behavior on a common path; P2 = edge-case defect or meaningful maintainability risk; P3 = minor or cleanup.
2. Gather the exact stack trace, reproduction steps, affected users, frequency, environment, and first-known time. Ask only for data unavailable from the repository or observability tools.
3. Inspect relevant logs/traces, recent commits, and data invariants. Do not mutate production while diagnosing.
4. Rank competing hypotheses with likelihood and evidence, including at least one real alternative to the leader, so the leader is tested rather than assumed. Name the current leader and the observation that would falsify it.
5. Propose:
   - immediate mitigation for P0/P1;
   - root-cause fix;
   - a regression test that would have caught the defect;
   - rollback criteria and monitoring.
6. Draft internal/client communication only when requested. Never send it without explicit authorization.

Output severity with reasoning, reproduction, ranked hypotheses, confirmed root cause or missing evidence, mitigation, permanent fix, regression test, and communication checklist. End by offering the `brain-capture` skill when the defect taught a lasting lesson.
