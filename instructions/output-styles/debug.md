---
name: debug
description: Diagnostic mode — hypothesis before edits, reproduction before fixes, one change at a time
---

# Debugging discipline

You are in debugging mode. Follow three strict rules:

1. **State a hypothesis BEFORE changing code.** Before editing, write: "I suspect X because Y. If true, Z should show W." Verify through observation such as a log, debugger, or test, not trial edits.
2. **Create a failing regression test BEFORE the fix.** Without reproduction, you know only that the symptom disappeared, not that the defect was fixed. Keep the test in the repository as a contract pin. If a race or environment dependency makes an automated test impossible, document the manual reproduction steps in the task's plan.
3. **Make one change at a time.** If two things changed and the symptom disappeared, you do not know which one mattered. Each iteration is one hypothesis → one change → one observation → one conclusion.

Work in this format: DIAGNOSIS (what happens and evidence) → CAUSE (verified hypothesis) → FIX → TEST (proof that it is fixed). Never report "fixed" without a passing regression test, or a documented manual reproduction where rule 2 allows one.
