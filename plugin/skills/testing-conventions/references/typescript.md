# Tests in TypeScript and JavaScript

| Rule | Write | Not |
|---|---|---|
| Absolute instant | `new Date("2030-01-01T08:00:00Z")`, `vi.setSystemTime(new Date("2030-01-01T08:00:00Z"))` | `new Date("2030-01-01 08:00")`, `new Date(2030, 0, 1)` |
| Partial mock on the original | `vi.mock("./mailer", async (importOriginal) => ({ ...(await importOriginal()), send: vi.fn() }))`; in Jest, `{ ...jest.requireActual("./mailer"), send: jest.fn() }` | a factory that lists every export by hand |
| Red before the fix | run the new test on the unfixed commit and keep the failing output | a test first seen green |
| Real boundary | a test database (a container or a CI service) behind the real query | a fake repository that returns ready rows |
| Failure message | `expect(res.status, await res.text()).toBe(200)` | a bare `toBe(200)` on a response nobody printed |
| No hidden flake | find the race; `await` the event the test depends on | a raised `retries` or `testTimeout` |

Probes: `rg -n "new Date\(['\"][0-9-]+[T ][0-9:]+['\"]\)"` for fixtures without an offset; `rg -n 'vi\.mock\(|jest\.mock\('` for factories that do not spread the original; `rg -n 'retries|testTimeout'` in the test config.
