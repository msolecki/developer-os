---
max_turns: 25
timeout_seconds: 400
allowed_tools: [Read, Glob, Grep, Bash, Write, Edit, Skill]
---

Three things came up in this session. First, the cart test failed twice before we found that money must be rounded to cents per line before summing, not once on the total. Second, I read in passing that `jq -c` prints each result on one line; it cost us nothing. Third, duplicate payment webhooks came back and we spent a retry before remembering we already dedupe on the event ID; the new detail is that the unique constraint must cover the provider and the event ID together, since two providers can reuse an ID. Now wrap up the session with the developer-os session retro.
