# Tests in Go

| Rule | Write | Not |
|---|---|---|
| Absolute instant | `time.Date(2030, 1, 1, 8, 0, 0, 0, time.UTC)`, `time.Parse(time.RFC3339, "2030-01-01T08:00:00Z")` | `time.Local` in a fixture, `time.Now()` |
| Partial mock on the original | a fake that embeds the real implementation and overrides one method, behind a small consumer-side interface | a generated or hand-written mock of a wide interface with every method stubbed |
| Red before the fix | run the new test on the unfixed commit and keep the failing output | a test first seen green |
| Real boundary | a test database (a container or a CI service) behind the real query | a fake store that returns ready rows |
| Failure message | `t.Fatalf("status = %d, body = %s", res.StatusCode, body)` | `t.Fail()`, or `if !ok { t.Fatal() }` |
| No hidden flake | find the race with `go test -race`; wait on a channel or a condition | `time.Sleep` to wait, a retry loop around the assertion, a raised `-timeout` |

Probes: `rg -n 'time\.Local|time\.Now\(\)' --glob '*_test.go'` for ambient time; `rg -n 'time\.Sleep\(' --glob '*_test.go'`; `rg -n 'timeout' Makefile .github/workflows`.
