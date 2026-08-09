# scribble.pub Bot SDK

The official TypeScript SDK for building bots on [scribble.pub](https://scribble.pub).

This package also serves as the official reference description for the Bot API. The TypeScript definitions found in [`src/schemas.ts`](./src/schemas.ts) act as the single source of truth for all webhook payloads and actions.

Built on standard Web APIs (`Request` / `Response` / `crypto.subtle`), it runs natively in **Node.js, Cloudflare Workers, Deno, Bun, and Next.js Edge**.

## About scribble.pub
[scribble.pub](https://scribble.pub) is a multiplayer, vector-based drawing space where you can draw, chat, and create animations together in real-time. Born from the community of lunchtimers.com, it is a canvas that's always in motion, optimized for artists, casual doodlers, and chatterboxes — and now, bots are joining in too, bringing even more interactions and games to the canvas. Learn more at [scribble.pub/about](https://scribble.pub/about).

![A scribble.pub room, showing collaborative drawings alongside live chat](https://cdn.scribble.pub/media/main-room-light.png)

## Quick Start

> [!NOTE]
> Bot development is currently private. To allocate a bot and receive your secret token, please contact [support@scribble.pub](mailto:support@scribble.pub).

Initialize your bot with your secret token, listen for webhook events, and respond with an array of strongly-typed actions. Hooks are the only interaction type supported today — take a look around the project, more are on the way.

```typescript
import ScribblePubBot from "@scribble-pub/bot-sdk"

// 1. Initialize the bot with your webhook secret
const bot = new ScribblePubBot({ token: process.env.BOT_TOKEN })

// 2. Define your event handler
bot.on("hook", async (req) => {
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
import type { Action, HookRequest } from "@scribble-pub/bot-sdk"

async function onMention(req: HookRequest): Promise<Action[]> {
    return [{ type: "addMessage", text: `Hi, ${req.trigger.username}!` }]
}

bot.on("hook", onMention)
```
