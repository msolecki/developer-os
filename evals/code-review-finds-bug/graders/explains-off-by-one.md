---
type: llm
---
The review reports, as a P0 or P1 finding, that the loop condition `i <= lines.length` in src/cart.js line 4 reads one element past the end of the array, so `lines[lines.length]` is undefined and the function throws a TypeError. It proposes changing `<=` back to `<`.
