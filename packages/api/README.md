# @scribble-pub/api

The raw typescript API wrapper and schema definitions for the `scribble.pub` platform.

This package provides low-level HTTP clients, cryptographic signature verification, and Zod parsers for the core message types.

This package is the official reference for the Bot API. The TypeScript definitions in [`src/schemas.ts`](./src/schemas.ts) are the single source of truth for all payloads and actions.

> [!NOTE]
> If you are building a bot, we highly recommend using [`@scribble-pub/bot-sdk`](../bot-sdk) instead. It wraps this package and provides a much better Developer Experience.

## Features
- Complete set of Typescript interfaces and Zod schemas for `HookRequest`, `Action`, etc.
- `ScribblePubClient`: A raw authenticated HTTP client.
- `verifySignature`: A `crypto.subtle` helper to validate webhook signatures.

## Important Note on 307 Redirects

Rooms on scribble.pub are served by regional instances (e.g., `https://eu.scribble.pub`). 

Sending actions to the generic `https://scribble.pub` endpoint will often return a `307 Temporary Redirect` pointing to the correct regional instance.

Standard HTTP clients follow these redirects automatically. The platform prevents authentication loss by substituting an encrypted token into the redirect URL, bypassing the standard cross-origin `Authorization` header drop.

To avoid redirect latency, cache the regional instance URL (provided in webhooks as `Trigger.directUrl`) and send subsequent requests there directly.

*(Note: If you use `@scribble-pub/bot-sdk`, this caching is handled automatically via its internal `roomInstanceMap`).*

## Security (HMAC-SHA256 Signatures)

Webhooks are public endpoints, which means anyone can send POST requests to your server.

To guarantee that incoming requests genuinely came from scribble.pub and haven't been tampered with in transit, the platform signs all payloads with **HMAC-SHA256**. The signature is sent in the `X-Scribble-Pub-Signature` header (prefixed with `sha256=`).

You can use the `verifySignature(payload: string, signatureHeader: string, secretToken: string): Promise<boolean>` helper exported by this package to perform a constant-time cryptographic validation of the payload.

## Forward Compatibility (Important)

As the platform evolves, new fields, message types, and trigger types will be added to payloads.
**Your bot must ignore unrecognized data.** Avoid strict JSON validation (e.g. `zod.strict()`), otherwise your bot will crash when new features are released.

Our exported parsers follow this rule to stay usable against newer platform versions:

- **Unsupported triggers still parse:** Unknown trigger types validate successfully by extracting their base fields to avoid returning false `400` errors. (The SDK safely drops these).
- **Graceful deprecations:** The discriminant is `type`, but payloads using the deprecated `trigger` spelling are still accepted and populated on both keys, until it is removed before 1.0.
- **Loose validation:** Schemas accept unknown fields instead of rejecting or stripping them. However, you should not rely on undeclared fields. Upgrade this package instead to use them safely.

> [!WARNING]
> According to current plans, before 1.0, the `line.floats` object type will remain only for simple points and lines provided by bots. Complex user-drawn lines will be sent in a more efficient, high-precision format, similar to the one that is used for UI-server communication.

## Concepts: Layers vs. Frames
When working with drawing objects, you must understand the difference between Layers and Frames:

* **Layers**: Behave like traditional Photoshop layers. They define the top-level rendering z-index of the canvas.
* **Frames**: A part of layers and contain the actual objects to draw (`ScratchpadObject`). They were introduced for animations (e.g., flipbook-style drawing), but even without animations, a single frame will exist for every layer. 

At any single point in time, only one frame can be rendered per layer. This is why layer z-index and frame z-index mean the same.

To simplify rollout, the bot server currently provides only one frame per layer, but your bot must be structurally ready to accept more, i.e., keep layer frames as a map or an array, not as a single object.

For a user-facing explanation of layers and animation frames, see [scribble.pub/docs/animations](https://scribble.pub/docs/animations).
