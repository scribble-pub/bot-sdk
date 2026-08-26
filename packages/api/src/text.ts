/**
 * Utilities for translating between JavaScript string indices (UTF-16) and platform offsets (runes).
 *
 * Quote offsets such as {@link RepliedMessage.quoteStart} use **rune indices** (Unicode code points, as in Go).
 * Because JavaScript strings are indexed in UTF-16, astral characters (like emoji) count as 2 units instead of 1.
 * Native methods like `indexOf()` will return incorrect offsets that drift further right for every emoji present.
 *
 * - Use {@link quoteRange} and {@link sliceRunes} for safe quote extraction.
 * - Use {@link toRuneOffset} and {@link toUtf16Offset} for direct offset translation.
 */

function isTrailingSurrogate(code: number): boolean {
    return code >= 0xdc00 && code <= 0xdfff
}

/**
 * Returns the true length of `text` in runes (code points).
 *
 * Unlike `text.length`, this correctly counts astral characters as 1 instead of 2.
 * E.g., `runeLength("🚀")` is 1, while `"🚀".length` is 2.
 */
export function runeLength(text: string): number {
    return toRuneOffset(text, text.length)
}

/**
 * Translates a JavaScript (UTF-16) index into a rune offset.
 *
 * Out-of-range indices are clamped. Indices landing mid-surrogate-pair safely resolve to the rune.
 */
export function toRuneOffset(text: string, utf16Offset: number): number {
    const end = Math.min(Math.max(utf16Offset, 0), text.length)

    let runes = 0
    for (let i = 0; i < end; i++) {
        // Every code unit starts a rune except the trailing half of a surrogate pair.
        if (!isTrailingSurrogate(text.charCodeAt(i))) {
            runes++
        }
    }

    // An index landing inside a surrogate pair belongs to the rune that pair forms, so undo the
    // lead half counted above rather than reporting the rune after it.
    if (end < text.length && isTrailingSurrogate(text.charCodeAt(end))) {
        runes--
    }
    return runes
}

/**
 * Translates a rune offset into a JavaScript (UTF-16) string index.
 *
 * The inverse of {@link toRuneOffset}. Offsets past the end of `text` resolve to `text.length`.
 */
export function toUtf16Offset(text: string, runeOffset: number): number {
    if (runeOffset <= 0) {
        return 0
    }

    let i = 0
    for (let rune = 0; rune < runeOffset && i < text.length; rune++) {
        // Astral characters occupy two code units; everything else occupies one.
        i += (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1
    }
    return Math.min(i, text.length)
}

/**
 * Slices `text` using rune offsets (platform-native indexing).
 *
 * - Use this to extract a quote: `sliceRunes(replyTo.text, quoteStart, quoteLength)`.
 * - Omit `length` to slice to the end.
 */
export function sliceRunes(text: string, start: number, length?: number): string {
    const from = toUtf16Offset(text, start)
    if (length === undefined) {
        return text.slice(from)
    }
    return text.slice(from, toUtf16Offset(text, start + Math.max(length, 0)))
}

/**
 * Finds `quote` inside `text` and returns safe rune offsets for {@link ReplyTarget}.
 *
 * This safely bypasses the UTF-16 issues of a raw `indexOf()`.
 *
 * ```typescript
 * const range = quoteRange(trigger.replyTo.text ?? "", "the interesting part")
 * if (range) {
 *     return [{ type: "chat.addMessage", text: "About that…", replyTo: { messageId, ...range } }]
 * }
 * ```
 *
 * - Pass `from` (a rune offset) to skip earlier occurrences.
 * - Returns `undefined` if `quote` is empty or not found.
 */
export function quoteRange(
    text: string,
    quote: string,
    from = 0,
): { quoteStart: number; quoteLength: number } | undefined {
    if (!quote) {
        return undefined
    }

    let at = text.indexOf(quote, toUtf16Offset(text, from))

    // A match may begin on the trailing half of a surrogate pair, which is half of a character
    // rather than a real occurrence. Keep looking from the next code unit.
    while (at >= 0 && isTrailingSurrogate(text.charCodeAt(at))) {
        at = text.indexOf(quote, at + 1)
    }

    if (at < 0) {
        return undefined
    }

    return { quoteStart: toRuneOffset(text, at), quoteLength: runeLength(quote) }
}
