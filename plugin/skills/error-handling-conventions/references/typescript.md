# Error handling in TypeScript

| Rule | Write | Not |
|---|---|---|
| Cause chain | `throw new AppError("charge failed", { cause: err })` | `throw new Error(err.message)` |
| Explicit result | `{ ok: true, data } \| { ok: false, error }`, or throw | `return null` on failure |
| One envelope | `{ error: { code: "CART_EMPTY", message, details? } }` from one helper | a raw `err` or `err.stack` in a response |
| Log or propagate | log in the handler that answers the request | `logger.error(err); throw err` |
| No silent swallow | `catch { /* cache miss: fall through to the database */ }` | an empty `catch {}` |
| Not control flow | `findUser()` returns `User \| undefined` in a typed result | `try { getUser() } catch { createUser() }` |

Probes: `rg -n -U 'catch\s*(\([^)]*\))?\s*\{\s*\}'` for an empty catch; `rg -n 'throw new Error\('` inside a `catch` without `cause`; `rg -n '\.stack'` in response code.
