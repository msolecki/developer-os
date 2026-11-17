---
type: llm
---
The reply is one report for a Python repository (Poetry, pytest, ruff): it lists testing-conventions and error-handling-conventions among the skills that apply and does not apply typescript- or nextjs-conventions. Its numbered items include one that proposes creating `docs/reference/conventions.md` with rules observed in this repository (for example snake_case modules, one `tests/test_<module>.py` per module, ruff line length 100, domain errors subclassing `ShopError`), each with a `file:line`, and a conventions finding for the swallowed error in `src/shop/receipt_mailer.py` (`except Exception: pass`). It ends with one approval question and does not claim that any file was changed.
