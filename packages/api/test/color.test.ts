import { describe, expect, it } from "vitest"
import { rgbaToComponents, rgbaToHex } from "../src/color.js"

describe("rgbaToHex", () => {
    it("should format a color as CSS #rrggbbaa", () => {
        expect(rgbaToHex(0xdbffb9ff)).toBe("#dbffb9ff")
        expect(rgbaToHex(0xff0000ff)).toBe("#ff0000ff")
    })

    it("should not go negative on colors above 2^31", () => {
        expect(rgbaToHex(0xffffffff)).toBe("#ffffffff")
    })

    it("should pad leading zeroes to a fixed width", () => {
        expect(rgbaToHex(0x000000ff)).toBe("#000000ff")
        expect(rgbaToHex(0)).toBe("#00000000")
        expect(rgbaToHex(0x0a0b0c0d)).toBe("#0a0b0c0d")
    })
})

describe("rgbaToComponents", () => {
    it("should split a color into 0-255 components", () => {
        expect(rgbaToComponents(0xdbffb9ff)).toEqual({ r: 0xdb, g: 0xff, b: 0xb9, a: 0xff })
        expect(rgbaToComponents(0x0a0b0c0d)).toEqual({ r: 10, g: 11, b: 12, a: 13 })
    })
})
