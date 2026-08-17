# scribble.pub Bots

This repository contains the official bot ecosystem for [scribble.pub](https://scribble.pub).

## About scribble.pub
[scribble.pub](https://scribble.pub) is a multiplayer, vector-based drawing space where you can draw, chat, and create animations together in real-time. Born from the community of lunchtimers.com, it is designed for artists, casual doodlers, and chatterboxes, with the focus on common rooms, on the site-global community — and now, bots are joining in too, bringing even more interactions and games to the canvas. Learn more at [scribble.pub/about](https://scribble.pub/about).

![A scribble.pub room, showing collaborative drawings alongside live chat](https://cdn.scribble.pub/media/main-room-light.png)

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

## Packages

* [`@scribble-pub/bot-sdk`](./packages/bot-sdk) - The high-level TypeScript SDK for building bots.

## Other languages

Implementations beyond this package:

- **Java** — [hteariH/scribble-bot-sdk-java](https://github.com/hteariH/scribble-bot-sdk-java). Java 17+, with Spring Boot auto-configuration.

> [!NOTE]
> These are community projects, maintained by their authors rather than by scribble.pub. [`packages/api/src/schemas.ts`](./packages/api/src/schemas.ts) here remains the normative description of the wire format.
