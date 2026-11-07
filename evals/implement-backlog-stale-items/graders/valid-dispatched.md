---
type: llm
focus: trace
---
CART-21 gets an Owner line in TODO.md and is then dispatched to a delegate or started in the current checkout. FMT-05 and TAX-02 get no Owner line and are reported as stale: FMT-05 because its Check already passes, TAX-02 because `src/tax.js` no longer exists (the code sits at `src/pricing/tax.js`). Whether CART-21's code was finished does not matter: the eval sandbox may deny delegates write tools.
