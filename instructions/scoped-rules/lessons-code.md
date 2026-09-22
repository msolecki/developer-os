---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.py"
---
# Incident lessons — verified defect classes

Each rule below comes from a real defect. Treat them as checks to run against the change in front of you, not as background reading.

- The persistence condition must equal the validation condition: if a record is stored under flag or branch X, validation MUST run under the same X; otherwise the system can persist a validated but internally inconsistent record.
- Every webhook or event-handler side effect (email, claim, counter) MUST have its own try/catch. The webhook does not retry and an exception is terminal. Check whether adjacent side effects already have error isolation.
- A state-mutation fix MUST enumerate every writer of that state, not only the entry point named in the report. Grep the field, table, or flag — not the function. Two disconnected write paths to the same state are the default, not the exception: a fix lands in a background worker and leaves the identical defect in the web path; one form carries two incompatible number parsers; one app's environment file lacks credentials a sibling app already has.
- A read-side security fix MUST enumerate every reader of the guarded data, not only the route named in the report. Grep the model, association or table name — an ORM association (`include: documents`) is a read path that no route file mentions. Closing a leak in the download route while a lookup function still returns the rows through the association is not a fix; the query layer needs its own filter.
- A status value with more than two outcomes carries more than one semantic dimension. Do not collapse it to a boolean: `partial` can mean "did not succeed" to the retry budget and "made progress" to the blocking gate at the same time, and collapsing it leaves a device on a mix of old and new settings with no retry and no alert.
- A guard that reads external JSON MUST validate shape before arithmetic. `NaN === 0` is false and the process still exits 0, so the guard passes on exactly the input it exists to catch.
- A cost-critical input that nobody measured needs validation or an explicit baseline entry, never a silent default. A hardcoded default passes every test and is wrong first on the customer's invoice.
- Per-clone setup that a package manager can destroy MUST live in a script or hook, never in prose. A dependency install wipes any generated artifact the lockfile does not own — a synthetic package, emitted type declarations, compiled CSS — and a notes-file procedure does not run. If the setup is not reproducible by one command, it is not setup, it is a ritual.
- A build artifact emitted outside its package boundary ships silently degraded. The bundler resolves what it can, drops what it cannot, and exits 0 — a production build with no styles behind a green pipeline. Verify the artifact, not the exit code. Same class as the `NaN === 0` guard above: a wrong artifact and a passing status are independent facts.
- After a platform migration, every numeric promise in the documentation is an untested claim. Enumerate them (retention periods, limits, clock-transition handling) and check each against the new implementation before calling the rewrite done.
