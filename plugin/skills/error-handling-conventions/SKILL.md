---
name: error-handling-conventions
description: Handle errors with cause chains, typed results, one API error envelope, no log-and-throw, and no empty catch. Use when writing or reviewing error handling in server and library code.
license: MIT
compatibility: "Claude Code"
---

# Error-handling rules

- Preserve the cause chain: an error raised while handling another carries the original as its cause, in the language's own mechanism (a `cause` field, `raise … from`, `%w` wrapping, a `previous` argument). Never replace the original with a new error built from its message alone.
- Prefer an explicit result over null-as-failure. A function that can fail returns a typed result (a tagged union, a result type, an error return value), or raises. Never use an untyped null, `None`, `false` or zero value as the failure signal.
- Use one API error envelope: `{ error: { code, message, details? } }`. The machine code uses `SCREAMING_SNAKE_CASE`; the message is for humans. Never expose a stack trace to the client.
- Do not log and re-raise the same error. Either handle and log it, or propagate it. Doing both creates duplicate logs and false alerts.
- Do not swallow an error: no empty catch, no bare `except: pass`, no discarded error return. Swallowing requires a one-line comment that explains why it is correct, and it is almost never correct.
- Exceptions are not control flow. An expected missing record is a typed result, not an exception handler around the happy path.
- A convention the project documents (its `docs/reference/conventions.md`, a decision record) wins over a rule here on shape and naming: the error type, the envelope's field names, the logging library. It never permits a swallowed error, a lost cause or internals in a response.

Examples and probes for your language: `references/<lang>.md` beside this file (`typescript`, `python`, `go`, `php`); read the one for the code at hand.
