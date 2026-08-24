# Changelog

All notable changes to this project are documented here.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**While the version is below `1.0.0`, breaking changes may land in any minor release**.

Because this package is also the reference implementation of the Bot API,
each release provides API changes as well to help developing custom clients.

## [0.4.0] - Unreleased

> [!NOTE]
> Preliminary notes for a release that is still in progress. Everything here may still change.

**Room reads are now per-app.** The single `GET /api/v0/room/{room}/state` endpoint is replaced by
individual endpoints for scratchpad and (later) chat. Internally, the apps barely share anything,
so having a single endpoint can create an illusion of having a single, strictly synchronized, room state, which is not true.

### Server API

#### Breaking

No breaking changes.

#### Deprecated

- `GET /api/v0/room/{room}/state` is replaced by `GET /api/v0/room/{room}/scratchpad/state`.
- `GET /api/v0/room/{room}/preview` is replaced by `GET /api/v0/room/{room}/scratchpad/preview`.

  The endpoint response doesn't change.
  
  **The old paths keep being served until 0.5.0**.

#### New

- `GET /api/v0/room/{room}/scratchpad/state` — the scratchpad state as the `sp.*` events that (re)build it.
  The same body as the endpoint it replaces.
- `GET /api/v0/room/{room}/scratchpad/preview` — the scratchpad canvas as a PNG at a 0.6px scale,
  with the same `Last-Modified` / `If-Modified-Since` handling as before.

### SDK

#### Breaking

No breaking changes.

#### Deprecated

- `bot.getRoomStateMessages(room, options?)` > `bot.getScratchpadStateMessages(room, options?)`.
- `bot.getRoomState(room)` > `bot.getScratchpadState(room)`,
  which returns a `ScratchpadState` rather than a `RoomState` wrapping it, so the `state.scratchpad.` prefix is gone.
- `bot.getRoomPreviewImage(room, options?)` > `bot.getScratchpadPreviewImage(room, options?)`.
- `RoomStateResponse` > `ScratchpadStateResponse`, `GetRoomStateMessagesOptions` > `GetScratchpadStateOptions`,
  `GetRoomPreviewOptions` > `GetScratchpadPreviewOptions`, `RoomPreviewImage` > `ScratchpadPreviewImage`.
- `ScribblePubClient.getRoomState` > `ScribblePubClient.getScratchpadState`,
  `ScribblePubClient.getRoomPreview` > `ScribblePubClient.getScratchpadPreview`.

#### Added

- `bot.getScratchpadStateMessages(room, options?)` — fetches the scratchpad state as the raw
  `ScratchpadMessage` list.
- `bot.getScratchpadState(room)` — the same, reduced into a `ScratchpadState`. Reducing a message
  list you already have is `ScratchpadState.fromMessages(messages)`.
- `bot.getScratchpadPreviewImage(room, options?)` — returns a `ScratchpadPreviewImage`,
  `{ image, lastModified }`, or `null` when the preview was not modified.
- `ScratchpadStateResponse`, `GetScratchpadStateOptions`, and `GetScratchpadPreviewOptions`.

#### Notes

- `RoomState` stays and is not deprecated. It contains one substate per app and is the convenient way
  to keep a whole room as a single value.

## [0.3.0] - 2026-08-20

**Package split**: The package is split into two: `@scribble-pub/api` and `@scribble-pub/bot-sdk`.
- `@scribble-pub/api` defines the protocol itself: messages, their Zod parsers and the signature.
It also includes `ScribblePubClient`, a thin one-method-per-endpoint HTTP client returning raw responses.
- `@scribble-pub/bot-sdk` is the reference implementation of how this protocol should be used,
how the canvas state is built from the messages, edge cases, room host server caching, etc.

### Server API

#### Breaking

No breaking changes.

#### Deprecated

- The action format is changed to reflect the target app name: `chat.addMessage` replaces `addMessage`.
  The unprefixed spelling is still accepted, but deprecated, and is going to be removed before 1.0.

#### New

New endpoints:

- `GET /api/v0/room/{room}/state` — returns `{"messages": [...]}`, the events that define the room state.
  Currently, only the static snapshot is provided: one frame per layer. Full animation timelines will be available later.
  The message types are `sp.sessionMeta`, `sp.layer`, `sp.layerOrder`, `sp.object`, and `sp.lastEventId`.
  Checl [API schemas](packages/api/src/schemas.ts) for details.
- `GET /api/v0/room/{room}/preview` — the room canvas as a PNG, at a 0.6px scale (which is currently always 600 × 420 px),
  the same image the big room list shows. `Last-Modified` can be passed to `If-Modified-Since`,
  so that a `304 Not modified` and no body are returned if it hasn't changed since.
- `GET /api/v0/logo` — the site logo in PNG, drawn by the community pixel by pixel, with the letters carved in.
  `?theme=dark` paints the letter borders white instead of black. Pass the returned `ETag` back as
  `If-None-Match` to receive `304 Not modified` same way as with the room preview.
  The logo is global-scoped, doesn't require providing a room name and having any permissions.

### SDK

#### Breaking

No breaking changes. `@scribble-pub/bot-sdk` keeps exporting everything it exported before.

#### Deprecated

- SDK users should respect the underlying API change mentioned above: `chat.addMessage` replaces `addMessage`.

#### Added

- `bot.getRoomStateMessages(room)` — fetches the room state as the raw `RoomMessage` list.
- `bot.getRoomState(room)` — the same, reduced into a `RoomState`. Reducing a message list you already
  have is `RoomState.fromMessages(messages)`. Today it holds a single app, `state.scratchpad`.
  **The state is mutable**: a room can contain tens of thousands of objects, and cloning it on every
  event would cost far more than it gives. From the outside it is read-only, exposed as `ReadonlyMap`s
  and readonly arrays.
- `state.applyMessage(msg)` and `state.applyMessages(messages)` — feed later messages into a state you
  already hold, instead of fetching it again.
- `bot.getRoomPreviewImage(room, options?)` — returns a `RoomPreviewImage`, `{ image, lastModified }`,
  or `null` when the preview was not modified. `lastModified` goes back as `options.ifModifiedSince`
  on the next call.
- `bot.getLogoImage(options?)` — returns a `LogoImage`, `{ image, etag }`, or `null` when the logo was
  not modified. `etag` goes back as `options.ifNoneMatch` on the next call. `options.theme` defines the
  border color.
- `rgbaToHex` and `rgbaToComponents`, for turning a packed color into a canonical form.
- **Hook handlers may be asynchronous again.** `bot.on("hook", …)` accepts a promise once more, so a short
  await — such as registering the hook in a database — can happen inline. The 10-second deadline
  is unchanged, so anything slower should still use `sendActions`.

## [0.2.0] - 2026-08-14

### Server API

#### Breaking

No breaking changes.

#### New

New endpoints:

- `POST /api/v0/bot/webhook/register` — takes `{"url": "https://…"}` and replaces the URL  the platform sends hooks to.
  Authenticated with the bot token as a bearer credential.
- `POST /api/v0/room/{room}/actions` — executes given `{"actions": [...]}` (same format as the response body), 
  and runs those actions in the room. Error codes:
  - `403` when the bot doesn't have permission to execute given actions.
  - `404` when the room does not exist or is not accessible at all.

Also:

- Rooms are served by regional instances, such as `https://eu.scribble.pub` and `https://ap.scribble.pub`.
  A request to an instance that does not host the room is answered with a `307` to the one
  that does. It carries a short-lived credential in the redirect link, so a client that simply
  follows redirects needs no extra work on e.g., preventing Authorization token stripping.
  Although general `https://scribble.pub/api` requests are supported, it's recommended to cache redirect base URLs
  to speed up next requests.
- Hook payloads now contain the room's regional URL in `trigger.directUrl`, which lets a client save it into its cache
  and skip the future the redirects.
- Errors carry a JSON body, `{"error": "Room is not found"}`.

### SDK

#### Breaking

- **Hook handlers are now synchronous.** `bot.on("hook", …)` accepts
  `(request: HookRequest) => Action[] | undefined`; promises are no longer allowed, so a
  hook is always answered on the spot and results can never arrive late. Existing `async`
  handlers must drop the `async` keyword and move any asynchronous work to `sendActions`.
- **Local validation failures now throw `ScribblePubValidationError`** instead of a plain
  `Error`. Code matching on the message still works, since the messages are unchanged.

#### Added

- `bot.registerWebhook(url)` — points the platform at this bot's webhook endpoint via `POST /api/v0/bot/webhook/register`.
- `Trigger` now has `directUrl` field, containing the regional instance that serves the room.
- `bot.sendActions(room, actions)` — sends actions to the specified room, using the same body as the hook response.
- Room-to-instance routing: `sendActions` remembers which regional instance serves each room, 
  using `Trigger.directUrl` and the platform's redirects, so repeat calls go straight to the right instance.
- `ScribblePubApiError`, carrying the HTTP `status` and the error message returned by the API in `body`.
- `ScribblePubValidationError`, thrown by `registerWebhook` and `sendActions` when their
  arguments fail validation locally.
- `BotConfig.baseUrl`, for pointing the SDK at custom instances. Setting it also drops the
  built-in room-to-instance table, which names production origins — without that, a locally
  pointed bot would reach past its own instance into production for any room listed there.
- `ErrorResponse`, the `{ "error": string }` body the API returns with a non-2xx status.
- `packages/bot-sdk/src/schemas.ts` now holds nothing but the wire types, so it now better serves as the Server API definition  
  and can be read by human, script or an agent. Zod and the parsers moved to `packages/bot-sdk/src/internal/validation.ts`, 
  with `ValidationError` still exported from the package root.

## [0.1.0]

- Initial release.
