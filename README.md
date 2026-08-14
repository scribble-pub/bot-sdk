# scribble.pub Bot SDK

The official TypeScript SDK for building bots on [scribble.pub](https://scribble.pub).

This package also serves as the official reference description for the Bot API. The TypeScript definitions found in [`src/schemas.ts`](./src/schemas.ts) act as the single source of truth for all payloads and actions.

Built on standard Web APIs (`Request` / `Response` / `crypto.subtle`), it runs natively in **Node.js, Cloudflare Workers, Deno, Bun, and Next.js Edge**.

## About scribble.pub
[scribble.pub](https://scribble.pub) is a multiplayer, vector-based drawing space where you can draw, chat, and create animations together in real-time. Born from the community of lunchtimers.com, it is a canvas that's always in motion, optimized for artists, casual doodlers, and chatterboxes — and now, bots are joining in too, bringing even more interactions and games to the canvas. Learn more at [scribble.pub/about](https://scribble.pub/about).

![A scribble.pub room, showing collaborative drawings alongside live chat](https://cdn.scribble.pub/media/main-room-light.png)

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

Internally, encrypted credentials are substituted for the redirect link, so the authorization token is never lost,
and no complex redirecting logic is required by the SDK.

### Duplicate deliveries

The platform performs no retries. A hook whose response misses the 10-second deadline is discarded.

Also, it currently doesn't support idempotency keys or "random IDs". Duplicates are an acceptable compromise at this point.

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

## Other languages

Implementations beyond this package:

- **Java** — [hteariH/scribble-bot-sdk-java](https://github.com/hteariH/scribble-bot-sdk-java). Java 17+, with Spring Boot auto-configuration.

> [!NOTE]
> These are community projects, maintained by their authors rather than by scribble.pub. [`src/schemas.ts`](./src/schemas.ts) here remains the normative description of the wire format.
