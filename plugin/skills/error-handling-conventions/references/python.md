# Error handling in Python

| Rule | Write | Not |
|---|---|---|
| Cause chain | `raise ChargeError("charge failed") from err` | `raise ChargeError(str(err))`, or `from None` without a reason |
| Explicit result | a typed return (`Order \| None` checked by the type checker, a result dataclass), or raise | `return None` or `return False` from an untyped function on failure |
| One envelope | one exception handler that returns `{"error": {"code": "CART_EMPTY", "message": ...}}` | `traceback.format_exc()` or `str(exc)` in a response |
| Log or propagate | `logger.exception(...)` where the error is handled | `logger.exception(...)` followed by `raise` |
| No silent swallow | `except KeyError:  # cache miss: fall through to the database` | a bare `except:` or `except Exception:` whose body is `pass` |
| Not control flow | `orders.get(order_id)` and a branch on the result | `try: orders[order_id]` / `except KeyError:` around the happy path of an expected miss |

Probes: `rg -n -U 'except[^\n]*:\s*\n\s*(pass|\.\.\.)\s*$'` for a swallowed error; `rg -n '^\s*except\s*:'` for a bare except; `rg -n 'format_exc|print_exc'` in response code.
