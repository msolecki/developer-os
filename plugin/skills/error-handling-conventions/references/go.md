# Error handling in Go

| Rule | Write | Not |
|---|---|---|
| Cause chain | `fmt.Errorf("charge order %s: %w", id, err)` | `errors.New(err.Error())`, or `%v` where the caller needs `errors.Is` |
| Explicit result | `(Order, error)`, with a sentinel or typed error for the expected case | a zero value or `nil` pointer with no error |
| One envelope | one `writeError(w, code, message)` helper that every handler calls | `http.Error(w, err.Error(), 500)` with an internal message |
| Log or propagate | return the wrapped error; log once at the top of the request | `log.Printf(...)` and `return err` in the same branch |
| No silent swallow | `_ = f.Close() // read-only file: a close error loses nothing` | `_ = doWork()`, or `if err != nil { }` with an empty body |
| Not control flow | `errors.Is(err, ErrNotFound)` on a returned error | `panic` and `recover` for an expected miss |

Probes: `rg -n '_ = \w+(\.\w+)*\('` for a dropped error; `rg -n -U 'if err != nil \{\s*\}'` for an empty branch; `rg -n 'err\.Error\(\)'` in handlers that write a response.
