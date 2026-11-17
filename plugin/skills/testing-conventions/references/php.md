# Tests in PHP

| Rule | Write | Not |
|---|---|---|
| Absolute instant | `new DateTimeImmutable('2030-01-01T08:00:00Z')` | `new DateTime('2030-01-01 08:00')`, `new DateTime()`, a fixture that relies on `date.timezone` |
| Partial mock on the original | `$this->createPartialMock(Mailer::class, ['send'])`: one method, the rest stays real | `createMock()` of a class with every method configured by hand, or a hand-written stub class |
| Red before the fix | run the new test on the unfixed commit and keep the failing output | a test first seen green |
| Real boundary | a test database (a container or a CI service) behind the real query | a fake repository that returns ready rows |
| Failure message | `self::assertSame(200, $res->getStatusCode(), (string) $res->getBody())` | a bare `assertTrue($ok)` |
| No hidden flake | find the race; wait on the state the test depends on | a retry attribute or extension, `sleep()`, a raised time limit |

Probes: `rg -n "new DateTime(Immutable)?\('[0-9-]+ [0-9:]+'\)" tests` for fixtures without an offset; `rg -n 'createMock\(' tests`; `rg -n 'sleep\(|retry' tests phpunit.xml*`.
