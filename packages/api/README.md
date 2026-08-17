# @scribble-pub/api

The raw typescript API wrapper and schema definitions for the `scribble.pub` platform.

This package contains low-level HTTP clients, cryptographic signature verification, and Zod parsers for the core wire types.

This package also serves as the official reference description for the Bot API. The TypeScript definitions found in [`src/schemas.ts`](./src/schemas.ts) act as the single source of truth for all payloads and actions.

> [!NOTE]
> If you are building a bot, we highly recommend using [`@scribble-pub/bot-sdk`](../bot-sdk) instead. It wraps this package and provides a much better Developer Experience.

## Features
- Complete set of Typescript interfaces and Zod schemas for `HookRequest`, `Action`, etc.
- `ScribblePubClient`: A raw authenticated HTTP client.
- `verifySignature`: A `crypto.subtle` helper to validate webhook signatures.

## Important Note on 307 Redirects

Rooms on scribble.pub are served by regional instances (e.g., `https://eu.scribble.pub`). 

If you use the raw `ScribblePubClient.post()` to send actions to the generic `https://scribble.pub` endpoint, you will often receive a `307 Temporary Redirect` pointing you to the correct regional instance.

The built-in `fetch` API, as well as other HTTP clients, follows these redirects automatically, since the platform auto-substitutes an encrypted token into the redirect URL. This prevents authentication loss, as standard HTTP clients automatically drop the Authorization header during cross-origin redirects.

However, **we highly recommend caching the regional instance URL** (which is provided in incoming webhooks as `Trigger.directUrl`) and sending your following requests directly to that URL. This avoids the latency penalty of the 307 redirects.

*(Note: If you use `@scribble-pub/bot-sdk`, this caching is handled for you automatically via its internal `roomInstanceMap`).*
