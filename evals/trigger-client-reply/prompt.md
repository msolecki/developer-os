---
max_turns: 10
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
---

reply to the client. He asked why the contact form did not send emails last week. Cause: an SMTP timeout in the BullMQ worker, the jobs ended up in the DLQ. Fix: retry with exponential backoff, PR #482 merged on Friday, zero errors since then. I sent that week's emails by hand on Monday.
