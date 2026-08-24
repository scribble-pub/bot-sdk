# scribble.pub Bot SDK

The official TypeScript SDK for building bots on [scribble.pub](https://scribble.pub).

This package also serves as the official reference description for the canvas and chat state management. See [`src/state.ts`](./src/state.ts) to learn how to correctly reduce incoming room events into a local state.

Built on standard Web APIs (`Request` / `Response` / `crypto.subtle`), it runs natively in **Node.js, Cloudflare Workers, Deno, Bun, and Next.js Edge**.

## Quick Start: Hooks

> [!NOTE]
> Bot development is currently private. To allocate a bot and receive your secret token, please contact [support@scribble.pub](mailto:support@scribble.pub).

After [registering your webhook URL](#registering-your-webhook-url), initialize the bot with your secret token and listen for webhook events:

```typescript
import ScribblePubBot from "@scribble-pub/bot-sdk"

// 1. Initialize the bot with your webhook secret
const bot = new ScribblePubBot({ token: process.env.BOT_TOKEN })

// 2. Define a handler per trigger type you care about
bot.on("chat.mention", (trigger) => {
    console.log(`${trigger.username} tagged the bot: ${trigger.text}`)

    // Return an array of actions for the platform to execute in the room
    return [
        {
            type: "chat.addMessage",
            text: `You said: ${trigger.text}`,
        },
    ]
})
```

### Trigger types

A hook goes to the handler registered for its trigger type, already narrowed to it:

| Trigger | Fires when | Fields |
| --- | --- | --- |
| `chat.mention` | A user tags your bot (e.g. `@HelloBot`) | `username`, and `text`, which includes the mention itself |

Every trigger also contains `type`, `room`, `timestamp`, and `directUrl`, which describe the hook
itself rather than what happened.

> [!NOTE]
> The discriminant used to be spelled `trigger.trigger`. It is `trigger.type` now, matching `Action.type`.
> Both spellings are filled in with the same value; `trigger` is deprecated and goes away before 1.0.

`bot.on("hook", …)` catches any trigger without a defined named handler. It receives `Trigger`,
which lists every type the SDK delivers, so a `switch` over `trigger.type` covers all of them:

```typescript
bot.on("hook", (trigger) => {
    switch (trigger.type) {
        case "chat.mention":
            console.log(trigger.text)
            break
    }
})
```

Exactly one handler runs per hook — the named one if there is one, `"hook"` otherwise — and a hook
that matches neither is acknowledged with no actions.

**Trigger types this SDK version doesn't support are safely excluded from standard handlers**,
so `Trigger` never holds a type the SDK can't describe. To properly support a new trigger type, you must upgrade the SDK.

However, you can use `bot.on("unsupported", …)` to detect when this happens.
It fires exclusively for unknown triggers and receives the base fields — `type`, `room`, `timestamp`, `directUrl` — so a bot can log that it is behind instead of discarding them silently:

```typescript
bot.on("unsupported", (trigger) => {
    logger.warn(`Unsupported trigger type ${trigger.type} in ${trigger.room}. Please update the SDK.`)
})
```

It may return actions like any other handler. The base fields are all it gets. To support the new trigger type,
upgrade to the SDK version that supports it.

**The hook calls have a 10-second timeout**. In complex cases requiring additional work, you should send the result as a separate request instead: see [Sending actions outside a hook](#sending-actions-outside-a-hook).

Currently, no retries are attempted if the hook fails. Retries and idempotency are planned to be added later.

### Security (HMAC-SHA256 Signatures)

Webhooks are public endpoints, which means anyone can send POST requests to your server.

To guarantee that incoming requests genuinely came from scribble.pub and haven't been tampered with in transit, the platform signs all payloads with **HMAC-SHA256**.

You do not need to write any cryptographic validation code yourself. When you call `bot.handleHook(req)`, the SDK automatically:
1. Extracts the `X-Scribble-Pub-Signature` header (which uses the `sha256=` prefix for cryptographic agility).
2. Uses the native `crypto.subtle.verify` API to recalculate the HMAC hash using your secret token.
3. Performs a constant-time cryptographic comparison to prevent timing attacks.

If the signature is invalid or missing, `bot.handleHook` immediately returns a `401 Unauthorized` HTTP Response with a JSON body: `{ "error": "invalid signature" }`.

## Integrating with your HTTP server

`ScribblePubBot` is built on standard Web Fetch APIs. To serve the webhook, you pass the raw HTTP `Request` object into `bot.handleHook(req)`, and it returns an HTTP `Response` object.

### Example with Hono

```typescript
app.post("/webhook", async (c) => {
    return await bot.handleHook(c.req.raw)
})
```

See [`examples/local-server.ts`](./examples/local-server.ts) for a complete, runnable server.

## Registering your webhook URL

To tell the platform where to send hooks, use `registerWebhook`. This replaces any previously registered URL.

```typescript
await bot.registerWebhook("https://example.com/hook")
```

If the platform rejects the registration, the SDK throws a `ScribblePubApiError`:

```typescript
import ScribblePubBot, { ScribblePubApiError } from "@scribble-pub/bot-sdk"

try {
    await bot.registerWebhook(process.env.PUBLIC_URL)
} catch (err) {
    if (err instanceof ScribblePubApiError) {
        // e.g. 400 "Bad Request: url must start with http:// or https://"
        console.error(`Registration failed (${err.status}): ${err.body}`)
    }
    throw err
}
```

Calls to the platform go to `https://scribble.pub` by default. Use `baseUrl` to point them anywhere else.

```typescript
const bot = new ScribblePubBot({ token: process.env.BOT_TOKEN, baseUrl: "http://localhost:8080" })
```

A custom `baseUrl` also switches off the built-in room-to-instance table, which only makes sense in production.

## Sending actions outside a hook

You can send actions proactively:

```typescript
await bot.sendActions("main", [{ type: "chat.addMessage", text: "Good morning!" }])
```

If your bot requires longer work such as media processing or LLM querying, you must give the hook response as soon as possible. When the work is done, send the result by using `sendActions`, which makes a separate request to the room directly.

```typescript
bot.on("chat.mention", (trigger) => {
    // Answered with an empty action list; the render publishes on its own.
    void renderTheThing(trigger).then((actions) => bot.sendActions(trigger.room, actions))
})
```

> [!NOTE]
> On edge runtimes (Cloudflare Workers, Vercel Edge), work started in a handler is killed once the response is returned. Hand the promise to `ctx.waitUntil(...)` so a later `sendActions` survives. Work you `await` inside the handler is unaffected, since the response has not been returned yet.

Failures throw `ScribblePubApiError`, most usefully `403` when your bot can't perform one of the given actions in that room
and `404` when the room doesn't exist or is offline:

```typescript
try {
    await bot.sendActions(trigger.room, actions)
} catch (err) {
    if (err instanceof ScribblePubApiError && err.status === 403) {
        console.warn(`Bot can't send messages in ${trigger.room}`)
        return
    }
    throw err
}
```

### Room routing

Rooms are served by regional instances. The platform and the SDK provide a fully seamless way to handle it:
`sendActions` reaches the instance itself, following the platform's redirects when needed.

Each redirect is cached, and every hook caches the instance address from `trigger.directUrl`, so repeat calls to a room go straight to the right instance.

Only mutating actions need this. Reads (such as `getScratchpadStateMessages`) are served by all instances.

Internally, encrypted credentials are substituted for the redirect link, so the authorization token is never lost, and no complex redirecting logic is required by the SDK.

## State Management

State is fetched **per room app**. When you fetch the scratchpad via `bot.getScratchpadStateMessages` (or receive it via a websocket in the future), you get a `ScratchpadStateResponse` wrapping the `ScratchpadMessage` events that (re)build the drawing surface.

The SDK provides a `ScratchpadState` helper class that reduces the message stream into a local state:

```typescript
import { ScratchpadState } from "@scribble-pub/bot-sdk"

const state = ScratchpadState.fromMessages(response.messages)

// Query the state
console.log(`There are ${state.layers.size} layers in the room!`)
```

`bot.getScratchpadState` does both steps in one call:

```typescript
const state = await bot.getScratchpadState("main")
```

The state is read-only from the outside: local fields are exposed as `ReadonlyMap`s and readonly arrays.

### Why per-app, and not per-room?

The scratchpad and chat are entirely separate apps that only share a room name. Fetching them separately is necessary because:
- **Different lifecycles**: Clearing the canvas resets the scratchpad (archiving the old session) but leaves the chat untouched. Chat messages expire on their own after two days.
- **Independent state**: They maintain separate event counters and locks. A combined fetch would artificially stitch two independent snapshots together.
- **Efficiency**: Fetching per-app costs nothing. Most bots only need one app, and those needing both can fetch in parallel.

If you need to track the whole room as a single value (e.g. for multi-room tracking), use `RoomState`, which holds one substate per app:

```typescript
const room = RoomState.fromMessages(response.messages)
console.log(room.scratchpad.layers.size)
```

This is purely for convenience. Bots that only care about drawing can use `ScratchpadState` directly.

> [!NOTE]
> **No cross-app ordering**: Messages from different apps are never strictly ordered. A chat message announcing a canvas clear may arrive before or after the actual `sp.sessionMeta` event. Never correlate the two streams by arrival order or timestamp. Always read canvas facts from the typed scratchpad stream.

### State entities vs. messages

The state is built from `ScratchpadLayer`, `ScratchpadFrame`, and `ScratchpadObject`. Their transfer counterparts have the same names with a `Message` suffix, like `ScratchpadLayerMessage`.

### Mutable State
**The state is mutable.** 

A `scribble.pub` room can contain tens of thousands of drawing objects. Cloning the state for every single drawing event would cause massive Garbage Collection overhead and destroy Node.js performance. 

To keep working efficiently, instead of taking the immutable React/Redux approach, this SDK mutates the state: `state.applyMessage` modifies the internal objects directly.

### Concepts: Layers vs. Frames
When building your bot's state and rendering logic, you must understand the difference between Layers and Frames:

* **Layers**: Behave like traditional Photoshop layers. They define the top-level rendering z-index of the canvas.
* **Frames**: A part of layers and contain the actual objects to draw (`ScratchpadObject`). They were introduced for animations (e.g., flipbook-style drawing), but even without animations, a single frame will exist for every layer. 

At any single point in time, only one frame can be rendered per layer. This is why layer z-index and frame z-index mean the same.

To simplify rollout, the bot server currently provides only one frame per layer, but your bot must be structurally ready to accept more, i.e., keep layer frames as a map or an array, not as a single object.

For a user-facing explanation of layers and animation frames, see [scribble.pub/docs/animations](https://scribble.pub/docs/animations).

### Concepts: the canvas

The coordinates you receive are in the `canvasWidth` × `canvasHeight` space (provided in the `sp.sessionMeta` event), which is currently 1000 × 700 but may change or become dynamic in the future. (0,0) represents top-left. The [raster preview](#the-scratchpad-preview) is the same canvas at a 0.6px scale (so typically 600 × 420 px), the same used in the big room list from UI.

Colors are transfered as a single RGBA integer, 1 byte each component: `R << 24 | G << 16 | B << 8 | A`, reflecting the CSS RGBA HEX notation. This is not ARGB that is also commonly used: `0xff0000ff` is opaque red.

That is byte for byte the CSS `#rrggbbaa` notation, so `rgbaToHex` just formats the number as HEX prefixed by "#". Use `rgbaToComponents` when you need the components instead.

```typescript
import { rgbaToHex, rgbaToComponents } from "@scribble-pub/bot-sdk"

ctx.strokeStyle = rgbaToHex(object.rgba)   // "#dbffb9ff"
const { r, g, b, a } = rgbaToComponents(object.rgba)
```

## The scratchpad preview

`getScratchpadPreviewImage` returns the scratchpad's raster preview as a PNG — the same image the big room list shows in the UI:

```typescript
const preview = await bot.getScratchpadPreviewImage("main")
if (preview) {
    drawSomehow(preview.image)   // an ArrayBuffer of PNG bytes
}
```

It is the canvas at a 0.6px scale, resulting in a 600 × 420 px image. As with the canvas itself, read the dimensions from the PNG because they may change.

Unlike a full state fetch, this costs you one small image of a relatively predictable size instead of every object in the room. It suits bots that only need a surface look rather than inspect its content.

The result contains the response's `Last-Modified` date, which changes when the room is drawn on. You can provide it as `ifModifiedSince` next request: the platform will answer `304` and `getScratchpadPreviewImage` return `null` if nothing has changed.

```typescript
let preview = await bot.getScratchpadPreviewImage("main")

// Later, e.g. on the next hook:
const fresh = await bot.getScratchpadPreviewImage("main", { ifModifiedSince: preview?.lastModified })
if (fresh) preview = fresh   // null means the preview has not changed
```

`lastModified` is optional, and skipping it just fetches the image again.

## The site logo

The logo at the top of scribble.pub [is drawn by the community](https://scribble.pub/docs/getting-started#logo-top-left), pixel by pixel. Use `getLogoImage` to get it as a PNG:

```typescript
const logo = await bot.getLogoImage()
if (logo) {
    drawSomehow(logo.image)   // an ArrayBuffer of PNG bytes
}
```

It arrives in the same form as users see it in the browser: masked to the letter shapes, with the letter borders painted in. Areas between the letters are transparent. Pass `{ theme: "dark" }` for white borders instead of black.

It is currently 350 × 60, but read the dimensions from the PNG rather than hardcoding them, since it can be resized in the future.

The logo is not room-scoped, so this call takes no room and needs no room permissions.

The result contains the response's `ETag`, which changes only when someone draws on the logo. You can provide it as `ifNoneMatch` next request: the platform will answer `304` and `getLogoImage` return `null` if nothing has changed.

```typescript
let logo = await bot.getLogoImage()

// Later, e.g. on the next hook:
const fresh = await bot.getLogoImage({ ifNoneMatch: logo?.etag })
if (fresh) logo = fresh   // null means the logo has not changed
```

As with the scratchpad preview, `etag` is optional, and skipping it just fetches the full logo again.

## Validation

All inputs and outputs are strictly validated. If validation fails, details are provided as `{ path: string, message: string }` objects:

- `handleHook` returns `400 Bad Request` for invalid incoming payloads, and `500 Internal Server Error` if your handler returns invalid actions.
- `sendActions` and `registerWebhook` throw a `ScribblePubValidationError` before making the network request.

```typescript
import { ScribblePubValidationError } from "@scribble-pub/bot-sdk"

try {
    await bot.sendActions(room, actions)
} catch (e) {
    if (e instanceof ScribblePubValidationError) {
        console.error(e.errors[0].path, e.errors[0].message)
    }
}
```

That makes the two failures distinguishable: `ScribblePubValidationError` never reached the network, while `ScribblePubApiError` means the platform saw the request and refused it.

## Forward Compatibility (Important)
As the platform evolves, new fields and message types will be added to the JSON payloads. 
**Your bot must ignore any unrecognized fields or message types.** 
Do not use strict JSON validation (e.g., `zod.strict()`) that fails on unknown keys, or your bot will crash when new features are released.

> [!WARNING]
> According to current plans, before 1.0, the `line.floats` object type will remain only for simple points and lines provided by bots. Complex user-drawn lines will be sent in a more efficient, high-precision format, similar to the one that is used for UI-server communication.
