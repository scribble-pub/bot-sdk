# scribble.pub Bot SDK

The official TypeScript SDK for building bots on [scribble.pub](https://scribble.pub).

This package also serves as the official reference description for the canvas and chat state management. See [`src/state.ts`](./src/state.ts) to learn how to correctly reduce incoming room events into a local state.

Built on standard Web APIs (`Request` / `Response` / `crypto.subtle`), it runs natively in **Node.js, Cloudflare Workers, Deno, Bun, and Next.js Edge**.

## Quick Start

> [!NOTE]
> Bot development is currently private. To allocate a bot and receive your secret token, please contact [support@scribble.pub](mailto:support@scribble.pub).

Given you already [provided the hook URL](#registering-your-webhook-url) to scribble.pub, initialize your bot with your secret token,
and listen for the webhook events, responding with an array of actions.

```typescript
import ScribblePubBot from "@scribble-pub/bot-sdk"

// 1. Initialize the bot with your webhook secret
const bot = new ScribblePubBot({ token: process.env.BOT_TOKEN })

// 2. Define your event handler
bot.on("hook", (req) => {
    console.log(`User triggered bot: ${req.trigger.text}`)

    // Return an array of actions for the platform to execute in the room
    return [
        {
            type: "addMessage",
            text: `You said: ${req.trigger.text}`,
        },
    ]
})
```

## Integrating with your HTTP Server

Because `ScribblePubBot` is built on standard Web Fetch APIs, hooking it up to your server is a one-liner. You simply pass the raw HTTP `Request` object into `bot.handleHook(req)`, and it returns an HTTP `Response` object.

### Example with Hono

```typescript
app.post("/webhook", async (c) => {
    return await bot.handleHook(c.req.raw)
})
```

See [`examples/local-server.ts`](./examples/local-server.ts) for a complete, runnable server.

## Registering your webhook URL

Once your server is reachable, tell the platform where to send hooks. `registerWebhook` POSTs to `/api/v0/bot/webhook/register`, authenticating with your bot token, and replaces whatever URL was registered before.

```typescript
await bot.registerWebhook("https://example.com/hook")
```

If the platform rejects the registration, the SDK throws a `ScribblePubApiError` carrying the HTTP `status` and the error message in `body`:

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

A custom `baseUrl` also switches off the built-in room-to-instance table, since those entries name production instances — a local instance starts with an empty table and learns from redirects.

## Sending actions outside a hook

Hook handlers are **synchronous**: they return an `Action[]`, or nothing at all.

Anything that can't be answered immediately goes through `sendActions`, which makes a separate request to the room directly.
The body is identical to a hook response, so the same `Action[]` works in both places.

```typescript
await bot.sendActions("main", [{ type: "addMessage", text: "Good morning!" }])
```

That covers scheduled posts, long-running work, and anything else that happens outside a trigger. A handler may also acknowledge a hook with nothing and let separate work deliver later:

```typescript
bot.on("hook", (req) => {
    // Answered with an empty action list; the render publishes on its own.
    void renderTheThing(req).then((actions) => bot.sendActions(req.trigger.room, actions))
})
```

> [!NOTE]
> On edge runtimes (Cloudflare Workers, Vercel Edge), work started in a handler is killed once the response is returned. Hand the promise to `ctx.waitUntil(...)` so a later `sendActions` survives.

Failures throw `ScribblePubApiError`, most usefully `403` when your bot can't perform one of the given actions in that room
and `404` when the room doesn't exist or is offline:

```typescript
try {
    await bot.sendActions(req.trigger.room, actions)
} catch (err) {
    if (err instanceof ScribblePubApiError && err.status === 403) {
        console.warn(`Bot can't send messages in ${req.trigger.room}`)
        return
    }
    throw err
}
```

### Room routing

Rooms are served by regional instances. The platform and the SDK provide a fully seamless way to handle it:
`sendActions` reaches the instance itself, following the platform's redirects when needed.

Each redirect is remembered, and every hook caches the instance table from `trigger.directUrl`,
so repeat calls to a room go straight to the right instance.

Only mutating actions need this. Reads — such as `getRoomStateMessages` and `getRoomPreviewImage` — are answered by whichever replica takes the request, so they skip the instance table on purpose rather than pinning themselves to one region.

Internally, encrypted credentials are substituted for the redirect link, so the authorization token is never lost,
and no complex redirecting logic is required by the SDK.

### Duplicate deliveries

The platform performs no retries. A hook whose response misses the 10-second deadline is discarded.

Also, it currently doesn't support idempotency keys or "random IDs". Duplicates are an acceptable compromise at this point.

## State Management

When you fetch the room state via `bot.getRoomStateMessages` (or receive it via a websocket in the future), you get a `RoomStateResponse` wrapping the `RoomMessage` events that (re)build the room.

To easily query this event stream, the SDK provides a `RoomState` helper class that reduces the stream into a local state tree:

```typescript
import { RoomState } from "@scribble-pub/bot-sdk"

const state = RoomState.fromMessages(response.messages)

// Query the state tree
console.log(`There are ${state.scratchpad.layers.size} layers in the room!`)
```

`RoomState` holds one substate per room subsystem and routes each message to the one that owns it. Today that is only `state.scratchpad`, a `ScratchpadState` covering the drawing surface.

`bot.getRoomState` does both steps in one call:

```typescript
const state = await bot.getRoomState("main")
```

The tree is read-only from the outside: `layers`, `frames`, `objects`, and `layerOrder` are exposed as `ReadonlyMap`s and readonly arrays.

### State entities vs. messages

The state tree is built from `ScratchpadLayer`, `ScratchpadFrame`, and `ScratchpadObject`. Their wire counterparts carry the same names with a `Message` suffix — `ScratchpadLayerMessage` and friends — so the two are never confused for each other. The wire format is free to grow without dragging the state shape along with it, and the state is free to carry things the wire doesn't send.

The one structural rule worth knowing: **layers own frames.** A frame exists because a layer declared it in `frames`, and disappears — along with its objects — as soon as no layer declares it.

### High-Performance Mutable State
**The state tree is intentionally mutable.** 

Unlike React/Redux where state is strictly immutable, a `scribble.pub` room can contain tens of thousands of drawing objects. Re-allocating the state tree for every single drawing event would cause massive Garbage Collection overhead and destroy Node.js performance. 

Instead, this SDK borrows from Game Engine architectures: `state.applyMessage` modifies the internal `Map`s directly. This guarantees virtually zero GC thrashing and allows a single bot to track state for hundreds of high-traffic rooms simultaneously.

### Concepts: Layers vs. Frames
When building your bot's rendering or state logic, you must understand the structural separation between Layers and Frames:

* **Layers**: Behave like traditional Photoshop layers. They define the top-level rendering z-index of the canvas.
* **Frames**: Are a part of layers and contain the actual drawing objects (`ScratchpadObject`). They are primarily used for animations (e.g., flipbook-style drawing). 

**Crucial Rule:** At any single point in time, **only one frame can be rendered per layer.** This is why you'll often see layer z-index and frame z-index used interchangeably in casual discussion. Currently, the bot server provides exactly 1 frame per layer (representing the static preview), but your bot must respect this structural separation to remain compatible with future API releases.

For a user-facing explanation of these concepts, see [scribble.pub/docs/animations](https://scribble.pub/docs/animations).

### Concepts: the canvas

Every coordinate you receive lives in a `canvasWidth` × `canvasHeight` space (provided in the `sp.sessionMeta` event) — currently only 1000 × 700 but may change or become dynamic in the future — with the origin in the top-left. The raster preview from `getRoomPreviewImage` is that same canvas at a 0.6 scale (so typically 600 × 420).

Colors are packed into a single integer as `R << 24 | G << 16 | B << 8 | A`, reflecting the CSS RGBA HEX notation. The alpha is the **lowest** byte, which is the opposite of the ARGB layout most people assume: `0xff0000ff` is opaque red.

That is byte for byte the CSS `#rrggbbaa` notation, so `rgbaToHex` just formats the number as HEX prefixed by "#". Use `rgbaToComponents` when you need the components instead.

```typescript
import { rgbaToHex, rgbaToComponents } from "@scribble-pub/bot-sdk"

ctx.strokeStyle = rgbaToHex(object.rgba)   // "#dbffb9ff"
const { r, g, b, a } = rgbaToComponents(object.rgba)
```

## The site logo

The logo at the top of scribble.pub [is drawn by the community](https://scribble.pub/docs/getting-started#logo-top-left), pixel by pixel. Use `getLogoImage` to get it as a PNG:

```typescript
const png = await bot.getLogoImage()
```

It arrives in the same form as users see it in the browser: masked to the letter shapes, with the letter borders painted in. Areas between the letters are transparent. Pass `{ theme: "dark" }` for white borders instead of black.

It is currently 350 × 60, but read the dimensions from the PNG rather than hardcoding them, since it can be resized in the future.

The logo is not room-scoped, so this call takes no room and needs no room permissions.

The response carries an `ETag` that changes only when someone draws on the logo. Passing it back as `ifNoneMatch` makes the platform answer `304` and `getLogoImage` return `null`, meaning the copy you already have is still current.

## Security (HMAC-SHA256 Signatures)

Webhooks are public endpoints, which means anyone can send POST requests to your server. 

To guarantee that incoming requests genuinely came from scribble.pub and haven't been tampered with in transit, the platform signs all payloads with **HMAC-SHA256**.

You do not need to write any cryptographic validation code yourself. When you call `bot.handleHook(req)`, the SDK automatically:
1. Extracts the `X-Scribble-Pub-Signature` header (which uses the `sha256=` prefix for cryptographic agility).
2. Uses the native `crypto.subtle.verify` API to recalculate the HMAC hash using your secret token.
3. Performs a constant-time cryptographic comparison to prevent timing attacks.

If the signature is invalid or missing, `bot.handleHook` immediately returns a `401 Unauthorized` HTTP Response with a JSON body: `{ "error": "invalid signature" }`.

## Validation

`handleHook` validates both directions of the exchange automatically. Every error response is JSON, shaped as `{ error: string, details?: ValidationError[] }`, where each `ValidationError` is `{ path: string, message: string }`:

- An incoming payload that doesn't match the expected shape returns `400 Bad Request` before your handler ever runs, with `details` describing which field failed and why.
- If your handler returns actions that don't match the expected shape, `handleHook` returns `500` instead of forwarding bad data to the platform — again with `details`.
- If no handler is registered for `"hook"`, it returns `501 Not Implemented`.

```json
{
  "error": "invalid payload",
  "details": [
    { "path": "trigger.timestamp", "message": "Invalid input: expected number, received string" }
  ]
}
```

Calls you make *to* the platform are checked the same way, before anything goes over the network.
`registerWebhook` and `sendActions` throw a `ScribblePubValidationError` whose `errors` array holds the same `ValidationError` values, 
so you can react to the field that failed rather than parsing the message:

```typescript
import { ScribblePubValidationError } from "@scribble-pub/bot-sdk"

try {
    await bot.sendActions(room, actions)
} catch (err) {
    if (err instanceof ScribblePubValidationError) {
        for (const { path, message } of err.errors) {
            console.warn(`${path}: ${message}`)
        }
        return
    }
    throw err
}
```

That makes the two failures distinguishable: `ScribblePubValidationError` never reached the network, while `ScribblePubApiError` means the platform saw the request and refused it.

## Types & Actions

Contrary to many other bot APIs, this API uses flat discriminated unions for its actions, giving you clean autocomplete and type-narrowing on `type`.

```typescript
const actions = [
    {
        type: "addMessage",
        text: "Hello!",
    }
]
```

Every payload type is exported, so you can annotate a standalone handler instead of relying on inference:

```typescript
import type { HookRequest, HookResult } from "@scribble-pub/bot-sdk"

function onMention(req: HookRequest): HookResult {
    return [{ type: "addMessage", text: `Hi, ${req.trigger.username}!` }]
}

bot.on("hook", onMention)
```
## Forward Compatibility (Important)
As the platform evolves, new fields and message types will be added to the JSON payloads. 
**Your bot must ignore any unrecognized fields or message types.** 
Do not use strict JSON validation (e.g., `zod.strict()`) that fails on unknown keys, or your bot will crash when new features are released.

> [!WARNING]
> According to current plans, before 1.0, the `line.floats` object type will remain only for simple points and lines provided by bots. Complex user-drawn lines will be sent in a more efficient, high-precision format, similar to the one that is used for UI-server communication.
