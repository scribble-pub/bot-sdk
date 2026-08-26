# scribble.pub Bots

This repository contains the official bot ecosystem for [scribble.pub](https://scribble.pub).

## About scribble.pub

[scribble.pub](https://scribble.pub) is a multiplayer, vector-based drawing space where you can draw, chat, and create
animations together in real-time. Born from the community of lunchtimers.com, it is designed for artists, casual
doodlers, and chatterboxes, with the focus on common rooms, on the site-global community — and now, bots are joining in
too, bringing even more interactions and games to the canvas. Learn more at
[scribble.pub/about](https://scribble.pub/about).

![A scribble.pub room, showing collaborative drawings alongside live chat](https://cdn.scribble.pub/media/main-room-light.png)

## Packages

- [`@scribble-pub/api`](./packages/api) - The low-level TypeScript API schema definitions and raw HTTP client.
- [`@scribble-pub/bot-sdk`](./packages/bot-sdk) - The high-level TypeScript SDK for building bots.

## Other languages

Implementations beyond this package:

- **Java** — [hteariH/scribble-bot-sdk-java](https://github.com/hteariH/scribble-bot-sdk-java). Java 17+, with Spring
  Boot auto-configuration.

> [!NOTE] These are community projects, maintained by their authors rather than by scribble.pub.
> [`packages/api/src/schemas.ts`](./packages/api/src/schemas.ts) remains the reference description of the message
> format.
