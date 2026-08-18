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

## Forward Compatibility (Important)
As the platform evolves, new fields and message types will be added to the JSON payloads. 
**Your bot must ignore any unrecognized fields or message types.** 
Do not use strict JSON validation (e.g., `zod.strict()`) that fails on unknown keys, or your bot will crash when new features are released.

> [!WARNING]
> According to current plans, before 1.0, the `line.floats` object type will remain only for simple points and lines provided by bots. Complex user-drawn lines will be sent in a more efficient, high-precision format, similar to the one that is used for UI-server communication.

## Concepts: Layers vs. Frames
When working with drawing objects, you'll encounter two structural concepts: **Layers** and **Frames**.

* **Layers**: Behave like traditional Photoshop layers. They define the top-level rendering z-index of the canvas.
* **Frames**: Are a part of layers and contain the actual drawing objects (`ScratchpadObject`). They are primarily used for animations (e.g., flipbook-style drawing). 

**Crucial Rule:** At any single point in time, **only one frame can be rendered per layer.** This is why you'll often see layer z-index and frame z-index used interchangeably in casual discussion. Currently, the bot server provides exactly 1 frame per layer (representing the static preview), but your bot must respect this structural separation to remain compatible with future API releases.

For a user-facing explanation of these concepts, see [scribble.pub/docs/animations](https://scribble.pub/docs/animations).
