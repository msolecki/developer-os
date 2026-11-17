# Tests in Python

| Rule | Write | Not |
|---|---|---|
| Absolute instant | `datetime(2030, 1, 1, 8, 0, tzinfo=timezone.utc)`, `datetime.fromisoformat("2030-01-01T08:00:00+00:00")` | a naive `datetime(2030, 1, 1, 8, 0)`, `datetime.now()` |
| Partial mock on the original | `mocker.patch.object(mailer, "send")`, `patch("app.mailer.send", autospec=True)`: one attribute, the rest of the module stays real | replacing the whole module with a `MagicMock()` or a hand-written stub class |
| Red before the fix | run the new test on the unfixed commit and keep the failing output | a test first seen green |
| Real boundary | a test database (a container or a CI service) behind the real query | a fake session that returns ready rows |
| Failure message | `assert res.status_code == 200, res.text` | a bare `assert res.ok` |
| No hidden flake | find the race; wait on the event the test depends on | `@pytest.mark.flaky`, `--reruns`, a raised `timeout` |

Probes: `rg -n 'datetime\([0-9, ]+\)'` for naive fixtures; `rg -n 'MagicMock\(\)|sys\.modules\['` for whole-module stubs; `rg -n 'reruns|flaky|timeout' pyproject.toml pytest.ini setup.cfg tox.ini`.
