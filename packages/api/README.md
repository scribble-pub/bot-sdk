# @scribble-pub/api

The raw TypeScript API wrapper and schema definitions for the `scribble.pub` platform.

This package provides low-level HTTP clients, cryptographic signature verification, and Zod parsers for the core message types. The TypeScript definitions in [`src/schemas.ts`](./src/schemas.ts) serve as the single source of truth for all payloads and actions.

> [!NOTE]  
> If you are building a bot in Node.js, Cloudflare Workers, Deno, or Bun, **you should use the official [`@scribble-pub/bot-sdk`](../bot-sdk) instead.** It wraps this package, abstracting away cryptographic validation and HTTP routing, and provides a much better Developer Experience.
> 
> **For full conceptual documentation** (including how addressing works, message IDs, and quote offsets), please read the [Bot SDK Developer Guide](../bot-sdk/README.md).

## Non-JavaScript Environments

Because this package serves as the official reference for the Bot API protocol, you may be reading this to build a bot in another language. Here are two critical protocol details to keep in mind:

### Rune Offsets

Quote offsets (`quoteStart` and `quoteLength`) use **rune indices** (Unicode code points), not bytes or UTF-16 code units. Out-of-range offsets are safely truncated or ignored by the platform, not rejected.

Here is how you safely handle rune offsets natively in various languages:

| Language    | Rune length                       | Rune slice                                                            |
| ----------- | --------------------------------- | --------------------------------------------------------------------- |
| JS / TS     | `[...s].length`                   | `[...s].slice(a, b).join("")`                                         |
| Go          | `len([]rune(s))`                  | `string([]rune(s)[a:b])`                                              |
| Java/Kotlin | `s.codePointCount(0, s.length())` | `s.substring(s.offsetByCodePoints(0, a), s.offsetByCodePoints(0, b))` |
| Python      | `len(s)`                          | `s[a:b]`                                                              |
| Rust        | `s.chars().count()`               | `s.chars().skip(a).take(b - a).collect()`                             |

### Forward Compatibility

As the platform evolves, new fields, message types, and trigger types will be added to JSON payloads. **Your bot must ignore unrecognized data.** If you use strict JSON deserialization that throws errors on unknown keys, your bot will crash when new features are released.
