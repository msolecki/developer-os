/**
 * **Moved here from `packages/brain/src/schema/note.ts` on its second call site, not
 * copied.** This module's own rule is that a screen must not exist twice, because two
 * copies drift — and NEW-11 is what a second call site looks like: `title` had the
 * predicate, `tags` and `summary` did not, and the fix is to share the one that exists
 * rather than write a second.
 */

/**
 * At least one visible character, spelled out as a character class rather than as a
 * screen-and-check.
 *
 * **The first fix screened the title and asked whether anything survived, and that was too
 * narrow.** `screenControlCharacters` deletes `\p{Cf}` and nothing else, so U+3164 HANGUL
 * FILLER — the character people actually use to make an invisible name — still passed,
 * along with the Hangul fillers, a lone variation selector, a combining grapheme joiner
 * and every unassigned code point. The message said "at least one visible character"
 * while the predicate meant "at least one non-format character", which is a claim the
 * code did not honour. Found by fresh-context review, 2026-08-11 (BACKLOG NEW-10).
 *
 * So the class is spelled out: format characters, everything default-ignorable,
 * non-spacing and enclosing marks, controls, unassigned code points, whitespace, and
 * U+2800 BRAILLE PATTERN BLANK — the one blank glyph in none of those categories. A value
 * needs one character outside all of them.
 *
 * It costs a value made *only* of combining marks, which renders as a stray diacritic over
 * nothing, and that is intended. It costs nothing else: an emoji, a ZWJ sequence, a heart
 * plus its variation selector, and any script's letters all carry a base character and
 * pass. U+200D ZERO WIDTH JOINER needs no special case because it is itself
 * default-ignorable — the joined emoji survives on the strength of the two faces around it.
 *
 * **One drift worth naming, because `screen.ts` names the same one for `Intl.Segmenter`:**
 * `\p{Cn}` is unassigned *in this runtime's ICU*, so validity is a function of the ICU
 * version. The direction is the safe one and only the safe one — Unicode never un-assigns
 * a code point, so a value that validates today cannot start failing, while one that fails
 * today may start passing on a future Node. `engines.node` bounds it in practice. Nothing
 * on a vault already on disk breaks either way.
 */
const INVISIBLE_ONLY =
  /^[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Mn}\p{Me}\p{Cc}\p{Cn}\s\u2800]*$/u;

export function isVisuallyBlank(value: string): boolean {
  return INVISIBLE_ONLY.test(value);
}

/**
 * The invisibles a **grouping** key removes.
 *
 * **U+200D ZERO WIDTH JOINER is exempt, and it is not an edge case.** It is `Cf` *and*
 * default-ignorable, so it was matched twice over by the first version of this class —
 * which grouped `Team \u{1F468}\u200D\u{1F469}\u200D\u{1F467}` with
 * `Team \u{1F468}\u{1F469}\u{1F467}`, a family against three separate people, and
 * Devanagari's explicit half-form `\u0915\u094D\u200D\u0937` with the conjunct
 * `\u0915\u094D\u0937`. Those are different glyphs on screen, which is the whole of what
 * a *perceptual* key is supposed to measure.
 *
 * **Every other screen in this repository carves it out**, each with its own docblock —
 * `screen.ts`'s `screenControlCharacters`, `brain`'s renderer, its capture builder, and
 * the CLI's path renderer. Three of the four also pin it with a test; `brain`'s renderer
 * has the docblock and no assertion, which is worth knowing rather than rounding up. A
 * joiner is part of a grapheme cluster rather than an attack on one, and this class is
 * the same rule reached by the same argument.
 *
 * **Whitespace and the `\p{Mn}`/`\p{Me}` classes are absent, and their absence is the
 * contract** — but "marks are untouched" would be too strong a claim, so it is not made:
 * the default-ignorable set *contains* marks, and this class removes **263** of them.
 * Enumerated rather than asserted, because the enumeration is what makes the guarantee
 * below checkable: U+034F COMBINING GRAPHEME JOINER, U+17B4..U+17B5 (Khmer inherent
 * vowels, which Unicode defines as non-rendering), U+180B..U+180D and U+180F (Mongolian
 * free variation selectors), U+FE00..U+FE0F, and U+E0100..U+E01EF. **Every one is a
 * variation selector, a composition control, or a mark defined not to render — none is a
 * diacritic**, which is why the guarantee holds. What is guaranteed is narrower and is
 * the thing
 * that matters: **no diacritic is removed**, so `Caf\u00E9` never groups with `Cafe`. Two
 * consequences follow and are accepted for a grouping key — an
 * emoji and its text presentation group (they differ only by U+FE0F), and a title relying
 * on U+034F to *block* a composition keys as though it had composed.
 */
const INVISIBLE = /(?!\u200D)[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Cc}]/gu;

/**
 * **A grouping key, not a predicate, and not `isVisuallyBlank` with a different return
 * type.** `duplicates` asks whether two titles are the *same* to a reader;
 * `isVisuallyBlank` asks whether one title is *empty* to a reader. The two need different
 * character sets, and conflating them is the mistake this docblock exists to prevent
 * (BACKLOG NEW-11).
 *
 * **Invisibles are removed, except the joiner; no diacritic is.** Removing `\p{Cf}` and
 * the default-ignorable set — U+200D aside, see `INVISIBLE` above — makes a title
 * carrying U+3164 group with `Deploykeys`, which is the defect: `lint.ts` keyed on the
 * *screened* title, the screen deletes `\p{Cf}` only, and
 * `catalog.md` showed two rows a human reads as identical while `duplicates` reported
 * nothing. Removing `\p{Mn}` or `\p{Me}` as well would group `Café` with `Cafe` — two
 * genuinely different titles in every language that uses a diacritic to distinguish
 * words, and the same corruption `screenControlCharacters` is forbidden to introduce.
 *
 * **Whitespace stays** for the same reason: two titles differing by a real space are two
 * titles, and a reader can see the difference.
 *
 * NFC-folded last, so a decomposed and a precomposed spelling of one title produce one
 * key. The fold is after the removal rather than before it, because removing a format
 * character can leave a base and a combining mark adjacent that were not adjacent before.
 */
export function perceptualKey(value: string): string {
  return value.replace(INVISIBLE, "").normalize("NFC");
}
