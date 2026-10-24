---
type: llm
---
The answer says user sessions are stored in a Postgres sessions table, citing `DEV/session-store-postgres.md` as the current decision. It names `DEV/session-store-redis.md` as an earlier, superseded decision (Redis with a 30-day TTL) with its reason (Redis was already running for the cache), and says it was replaced by the Postgres note. It does not present Redis as the current session store.
