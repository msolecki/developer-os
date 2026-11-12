# Error handling in PHP

| Rule | Write | Not |
|---|---|---|
| Cause chain | `throw new ChargeFailed('charge failed', 0, $e)` (the third argument is `$previous`) | `throw new RuntimeException($e->getMessage())` |
| Explicit result | a declared return type (`?Order`, a result object), or throw | `return false` or `return null` from an untyped function on failure |
| One envelope | one exception listener or handler that renders `{"error": {"code": "CART_EMPTY", "message": ...}}` | `getTraceAsString()` or a raw exception message in a response |
| Log or propagate | log in the handler that answers the request | `$logger->error(...); throw $e;` |
| No silent swallow | `catch (CacheMiss $e) { /* fall through to the database */ }` | an empty `catch (\Throwable $e) {}`, or the `@` operator |
| Not control flow | `$repo->find($id)` returns `?Order` and the caller branches | `try { $repo->get($id); } catch (NotFound $e) { ... }` around the happy path of an expected miss |

Probes: `rg -n -U 'catch\s*\([^)]*\)\s*\{\s*\}'` for an empty catch; `rg -n 'getTraceAsString|getTrace\(\)'` in response code; `rg -n '@\$|@\w+\('` for suppressed errors.
