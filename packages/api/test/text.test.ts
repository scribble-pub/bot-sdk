import { describe, expect, it } from "vitest"
import { quoteRange, runeLength, sliceRunes, toRuneOffset, toUtf16Offset } from "../src/text.js"

/**
 * Three astral emoji push every JavaScript index 3 units ahead of the actual rune offset.
 * A raw `indexOf("reactor")` returns 19, which makes the platform slice from rune 19 — silently quoting "ctor is" instead.
 */
const EMOJI_MESSAGE = "👽👾🤖 Danger! The reactor is melting! Danger!"

describe("runeLength", () => {
    it("should count astral characters once, unlike String.length", () => {
        expect(runeLength("🚀")).toBe(1)
        expect("🚀".length).toBe(2)

        expect(runeLength(EMOJI_MESSAGE)).toBe(43)
        expect(EMOJI_MESSAGE.length).toBe(46)
    })

    it("should match String.length for text within the BMP", () => {
        expect(runeLength("test ololo")).toBe(10)
        expect(runeLength("")).toBe(0)
    })
})

describe("toRuneOffset", () => {
    it("should shift by one per astral character before the index", () => {
        expect(EMOJI_MESSAGE.indexOf("reactor")).toBe(19)
        expect(toRuneOffset(EMOJI_MESSAGE, 19)).toBe(16)
    })

    it("should resolve an index inside a surrogate pair to the rune it forms", () => {
        // Index 1 is the trailing half of the first 👽, which is not a character of its own.
        expect(toRuneOffset(EMOJI_MESSAGE, 1)).toBe(0)
        expect(toRuneOffset(EMOJI_MESSAGE, 2)).toBe(1)
    })

    it("should clamp out-of-range indices", () => {
        expect(toRuneOffset(EMOJI_MESSAGE, -5)).toBe(0)
        expect(toRuneOffset(EMOJI_MESSAGE, 9999)).toBe(runeLength(EMOJI_MESSAGE))
    })
})

describe("toUtf16Offset", () => {
    it("should invert toRuneOffset", () => {
        for (const runeOffset of [0, 1, 3, 16, 19, 43]) {
            expect(toRuneOffset(EMOJI_MESSAGE, toUtf16Offset(EMOJI_MESSAGE, runeOffset))).toBe(
                runeOffset,
            )
        }
    })

    it("should clamp out-of-range offsets", () => {
        expect(toUtf16Offset(EMOJI_MESSAGE, -1)).toBe(0)
        expect(toUtf16Offset(EMOJI_MESSAGE, 9999)).toBe(EMOJI_MESSAGE.length)
    })
})

describe("sliceRunes", () => {
    it("should slice by rune offsets", () => {
        expect(sliceRunes(EMOJI_MESSAGE, 16, 7)).toBe("reactor")
        expect(sliceRunes(EMOJI_MESSAGE, 0, 3)).toBe("👽👾🤖")
    })

    it("should slice to the end when no length is given", () => {
        expect(sliceRunes(EMOJI_MESSAGE, 36)).toBe("Danger!")
        expect(sliceRunes(EMOJI_MESSAGE, 0)).toBe(EMOJI_MESSAGE)
    })
})

describe("quoteRange", () => {
    it("should return rune offsets, not the raw indexOf result", () => {
        expect(quoteRange(EMOJI_MESSAGE, "reactor")).toEqual({ quoteStart: 16, quoteLength: 7 })
    })

    it("should round-trip through sliceRunes", () => {
        const range = quoteRange(EMOJI_MESSAGE, "melting")
        expect(range).toBeDefined()
        expect(sliceRunes(EMOJI_MESSAGE, range?.quoteStart ?? 0, range?.quoteLength)).toBe(
            "melting",
        )
    })

    it("should count an astral quote in runes", () => {
        expect(quoteRange(EMOJI_MESSAGE, "👾🤖")).toEqual({ quoteStart: 1, quoteLength: 2 })
    })

    it("should skip earlier occurrences when given a starting rune offset", () => {
        expect(quoteRange(EMOJI_MESSAGE, "Danger", 10)).toEqual({ quoteStart: 36, quoteLength: 6 })
    })

    it("should not match on the trailing half of a surrogate pair", () => {
        // The low surrogate of 👽 alone is half a character, never an occurrence in its own right.
        expect(quoteRange(EMOJI_MESSAGE, "\udc7d")).toBeUndefined()
    })

    it("should return undefined for an empty or absent quote", () => {
        expect(quoteRange(EMOJI_MESSAGE, "")).toBeUndefined()
        expect(quoteRange(EMOJI_MESSAGE, "nowhere")).toBeUndefined()
    })
})
