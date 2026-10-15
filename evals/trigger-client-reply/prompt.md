---
max_turns: 10
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
---

odpowiedz klientowi. Pytał, czemu w zeszłym tygodniu formularz kontaktowy nie wysyłał maili. Przyczyna: timeout SMTP w workerze BullMQ, joby lądowały w DLQ. Fix: retry z exponential backoff, PR #482 zmergowany w piątek, od tamtej pory zero błędów. Maile z tamtego tygodnia wysłałem ręcznie w poniedziałek.
