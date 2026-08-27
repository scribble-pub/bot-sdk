# @scribble-pub/api

The raw typescript API wrapper and schema definitions for the `scribble.pub` platform.

This package provides low-level HTTP clients, cryptographic signature verification, and Zod parsers for the core message
types.

This package is the official reference for the Bot API. The TypeScript definitions in
[ `src/schemas.ts`](./src/schemas.ts) are the single source of truth for all payloads and actions.

> [!NOTE] If you are building a bot, we highly recommend using [`@scribble-pub/bot-sdk`](../bot-sdk) instead. It wraps
> this package and provides a much better Developer Experience.

## Features

- Complete set of Typescript interfaces and Zod schemas for `HookRequest`, `Action`, etc.
- `ScribblePubClient`: A raw authenticated HTTP client.
- `verifySignature`: A `crypto.subtle` helper to validate webhook signatures.

## Important Note on 307 Redirects

Rooms on scribble.pub are served by regional instances (e.g., `https://eu.scribble.pub`).

Sending actions to the generic `https://scribble.pub` endpoint will often return a `307 Temporary Redirect` pointing to
the correct regional instance.

Standard HTTP clients follow these redirects automatically. The platform prevents authentication loss by substituting an
encrypted token into the redirect URL, bypassing the standard cross-origin `Authorization` header drop.

To avoid redirect latency, cache the regional instance URL (provided in webhooks as `Trigger.directUrl`) and send
subsequent requests there directly.

_(Note: If you use `@scribble-pub/bot-sdk`, this caching is handled automatically via its internal `roomInstanceMap`)._

## Security (HMAC-SHA256 Signatures)

Webhooks are public endpoints, which means anyone can send POST requests to your server.

To guarantee that incoming requests genuinely came from scribble.pub and haven't been tampered with in transit, the
platform signs all payloads with **HMAC-SHA256**. The signature is sent in the `X-Scribble-Pub-Signature` header
(prefixed with `sha256=`).

You can use the `verifySignature(payload: string, signatureHeader: string, secretToken: string): Promise<boolean>`
helper exported by this package to perform a constant-time cryptographic validation of the payload.

## Chat message IDs

Every chat message has an ID that is **unique within its room's chat**, strictly monotonic, and never reused.

- **Chronological sorting**: Sorting by ID guarantees chronological order within a room. Do not compare IDs across
  different rooms.
- **Gaps are normal**: IDs are also used as the room's event counter. Non-message events consume the counter, so
  consecutive messages rarely have consecutive IDs.
  - Never derive message counts from ID differences (`5100 - 5000` is events, not 100 messages).
  - Gaps don't mean much: deleted messages, hidden messages, and non-message activity all look identical.

## Addressing a bot

Bots only receive webhooks when explicitly addressed. There are two ways to address a bot:

1. **Tag it at the start of a message.** Tags anywhere else are treated as plain text.
2. **Reply to its message.** However, if the reply starts with a tag for a different bot, only the tagged bot receives the webhook.

## Bots never trigger bots

A message posted by a bot emits no hooks. Tagging or replying to a bot from another bot does nothing, and a bot never triggers itself.

Bot-to-bot messages may become possible later as an explicit opt-in setting (similar to Telegram), but a bot triggering itself will remain impossible.

## User IDs

Every chat trigger and `replyTo` include a `userId` for their authors.

- **Stable**: Usernames can change, but this ID cannot. Always key your per-user storage on `userId`, not the username.
- **Author types**: The first letter shows the author type: `u` (registered user), `g` (guest), or `b` (bot). Treat the ID as a single string, and expect new prefix letters in the future.
- **Guests are session-bound**: A guest's identity is tied to their session, so the same person can come back under a new ID.
- **Length**: 10 characters today, but this is not part of the contract. Ensure your storage can accommodate longer IDs.
- **Case-sensitive**: Always compare the whole string case-sensitively. Watch out for default database collations (like MySQL's `utf8mb4_general_ci`) that might silently treat `uAbC` and `uabc` as the same user.

## Replies

A reply always arrives with `replyToMessageId`, whatever became of the message it points at.

The target itself arrives as `replyTo`, and only while it is still live. A deleted, hidden, or expired target is not described at all: the id comes alone.

So whenever `replyTo` is present, everything it knows is present with it — `messageId`, `username`, `userId`, and `text`. Its remaining fields are optional in their own right: `localId` only for your bot's own messages, `quoteStart`/`quoteText` only when a fragment was quoted.

## Text offsets are runes

Quote offsets (`quoteStart` and `quoteLength`) use **rune indices** (Unicode code points), not bytes or UTF-16 code
units.

- **The JS UTF-16 trap**: JavaScript strings natively index in UTF-16. Astral characters (like emoji) shift JS indices
  out of sync with rune indices. Raw `indexOf()` will return incorrect values that quote the wrong text.
- **Use the SDK tools**: We export `quoteRange`, `sliceRunes`, and `toRuneOffset` to handle this math safely.
- **Stable quotes**: The platform extracts the quote text when the reply is created. If the parent message is edited
  later, your stored `quoteText` remains intact (though `quoteStart` may no longer align).

Note that you are not forced to use quotes when replying to messages. They are only needed when you want to quote a
specific part of the parent message.

### Clamping instead of rejecting

Out-of-range offsets are safely **clamped, not rejected**. A bot calculating offsets incorrectly will get a malformed
quote, not an HTTP error:

- A quote running past the text length is cut short.
- A `quoteStart` beyond the text length drops the quote entirely (posting as a plain reply).
- A `quoteLength` ≤ 0 also drops the quote.

### Other Languages

Because this package serves as the official reference for the Bot API, if you are building a bot in another language,
here is how you safely handle rune offsets natively:

| Language    | Rune length                            | Rune slice                                                            |
| ----------- | -------------------------------------- | --------------------------------------------------------------------- |
| JS / TS     | `[...s].length` (inefficient, use SDK) | `[...s].slice(a, b).join("")` (inefficient, use SDK)                  |
| Go          | `len([]rune(s))`                       | `string([]rune(s)[a:b])`                                              |
| Java/Kotlin | `s.codePointCount(0, s.length())`      | `s.substring(s.offsetByCodePoints(0, a), s.offsetByCodePoints(0, b))` |
| Python      | `len(s)`                               | `s[a:b]`                                                              |
| Rust        | `s.chars().count()`                    | `s.chars().skip(a).take(b - a).collect()`                             |

## Forward Compatibility (Important)

As the platform evolves, new fields, message types, and trigger types will be added to payloads. **Your bot must ignore
unrecognized data.** Avoid strict JSON validation (e.g. `zod.strict()`), otherwise your bot will crash when new features
are released.

Our exported parsers follow this rule to stay usable against newer platform versions:

- **Unsupported triggers still parse:** Unknown trigger types validate successfully by extracting their base fields to
  avoid returning false `400` errors. (The SDK safely drops these).
- **Loose validation:** Schemas accept unknown fields instead of rejecting or stripping them. However, you should not
  rely on undeclared fields. Upgrade this package instead to use them safely.

> [!WARNING] According to current plans, before 1.0, the `line.floats` object type will remain only for simple points
> and lines provided by bots. Complex user-drawn lines will be sent in a more efficient, high-precision format, similar
> to the one that is used for UI-server communication.

## Concepts: Layers vs. Frames

When working with drawing objects, you must understand the difference between Layers and Frames:

- **Layers**: Behave like traditional Photoshop layers. They define the top-level rendering z-index of the canvas.
- **Frames**: A part of layers and contain the actual objects to draw (`ScratchpadObject`). They were introduced for
  animations (e.g., flipbook-style drawing), but even without animations, a single frame will exist for every layer.

At any single point in time, only one frame can be rendered per layer. This is why layer z-index and frame z-index mean
the same.

For a user-facing explanation, see [scribble.pub/docs/animations](https://scribble.pub/docs/animations).
