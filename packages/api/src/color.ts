/**
 * The channels of a packed RGBA color, each 0-255 exactly as they appear on the wire.
 */
export type RgbaComponents = {
    r: number
    g: number
    b: number

    /**
     * Opacity, 0-255. Divide by 255 for the 0-1 alpha that CSS and canvas expect.
     */
    a: number
}

/**
 * Formats a packed RGBA color as CSS hex, e.g. `0xdbffb9ff` becomes `"#dbffb9ff"`.
 *
 * Colors are packed as `R << 24 | G << 16 | B << 8 | A`, which is byte for byte the same order as
 * the CSS `#rrggbbaa` notation — so this reinterprets the number rather than converting it.
 * The result is directly assignable to `fillStyle`, `strokeStyle`, or any CSS color property.
 *
 * Alpha is always included, even when opaque.
 */
export function rgbaToHex(rgba: number): string {
    return `#${(rgba >>> 0).toString(16).padStart(8, "0")}`
}

/**
 * Splits a packed RGBA color into its channels, for pixel math or custom compositing.
 * Use {@link rgbaToHex} to just draw it.
 */
export function rgbaToComponents(rgba: number): RgbaComponents {
    return {
        r: (rgba >>> 24) & 0xff,
        g: (rgba >>> 16) & 0xff,
        b: (rgba >>> 8) & 0xff,
        a: rgba & 0xff,
    }
}
