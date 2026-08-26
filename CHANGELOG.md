# Changelog

All notable changes to this project are documented here.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**While the version is below `1.0.0`, breaking changes may land in any minor release**.

Because this package is also the reference implementation of the Bot API, each release provides API changes as well to
help developing custom clients.

## [0.4.0] - Unreleased

> [!NOTE] Preliminary notes for a release that is still in progress. Everything here may still change.

**Room reads are now per-app.** The single `GET /api/v0/room/{room}/state` endpoint is replaced by individual endpoints
for scratchpad and (later) chat. Internally, the apps barely share anything, so having a single endpoint can create an
illusion of having a single, strictly synchronized, room state, which is not true.

**Chat replies are supported.**

- **Bots can reply:** Bots can now reply directly to specific messages in the room.
- **Quotes:** When replying, you can optionally quote a specific fragment of the parent message. Quote offsets use
  **rune indices** (Unicode code points, not UTF-16). Use the SDK's `quoteRange` and `sliceRunes` helpers to handle this
  safely.
- **Bots hear replies:** Bots are now officially triggered when users reply to their messages. The payload includes the
  `messageId` and `localId` of the replied-to message, plus the full text of both.
- **Third-party context:** If a user tags your bot while replying to somebody else, your bot receives the IDs and text
  of that third-party message too.

### Server API

#### Breaking

- **`chat.mention` replaced by `chat.addressed`:** A single trigger handles any message addressed to the bot (tags,
  replies, or both).
  - Use `replyTo` to identify replies.
  - As before, the platform does not strip tags from `text`.
  - **Bots on 0.3.0 will stop responding** until upgraded, because they drop unknown triggers.
- **Legacy `trigger` discriminant removed:** The discriminant is now strictly `type` (matching `Action.type`). The old
  `trigger.trigger` spelling is completely gone.

#### Deprecated

- `GET /api/v0/room/{room}/state` is replaced by `GET /api/v0/room/{room}/scratchpad/state`.
- `GET /api/v0/room/{room}/preview` is replaced by `GET /api/v0/room/{room}/scratchpad/preview`.
  - The endpoint responses remain unchanged.
  - **The old paths will keep working until 0.5.0.**

#### New

- `GET /api/v0/room/{room}/scratchpad/state` — the scratchpad state as the `sp.*` events that (re)build it. The same
  body as the endpoint it replaces.
- `GET /api/v0/room/{room}/scratchpad/preview` — the scratchpad canvas as a PNG at a 0.6px scale, with the same
  `Last-Modified` / `If-Modified-Since` handling as before.
- **`messageId` on chat triggers:** Every chat hook now includes a `messageId`.
  - IDs are strictly monotonic, unique per room, and never reused. Sort by ID for chronological order.
  - IDs serve as the event counter, so they skip over non-message activity, deletions, and hidden messages. Do not use
    IDs to count messages.
- **`replyTo` on chat triggers:** Provides the message being replied to (whether it targets your bot or someone else).
  - Includes `messageId`, `username`, full `text` (unless deleted/hidden), and `quoteStart`/`quoteText` if a fragment
    was quoted.
  - Includes `localId` if your bot posted the message, allowing you to instantly recognize replies to yourself and look
    them up in a database.
- **`replyTo` on `chat.addMessage`:** Makes your outbound message a reply.
  - Provide either the target's `messageId` (it may also be your own message's public ID) or your own `localId` (not
    both).
  - Optionally include `quoteStart` and `quoteLength` (in runes) to quote a fragment. The platform extracts the quote
    directly from the source message, ensuring it stays stable even if the original changes.
- **`localId` on `chat.addMessage`:** An optional non-zero ID limited by `Number.MAX_SAFE_INTEGER` you can assign to
  your outbound messages.
  - **Identifies replies:** It comes back as `replyTo.localId` when someone replies to your message.
  - **Idempotency:** Re-sending an identical `localId` is safely ignored as a duplicate instead of posting a second
    message.

### SDK

#### Breaking

- **`Trigger` types are refactored for strict typing and better separation.**
  - Common base fields (`type`, `room`, `timestamp`, `directUrl`) remain on `TriggerBase`.
  - Message-specific fields (`text`, `username`) are moved to `ChatTriggerBase`.
  - `Trigger` is now a strict union of supported types. Switching on `trigger.type` exhaustively makes the `default`
    branch `never`.
- **Event handlers receive the `trigger` directly** instead of the full request object (e.g.,
  `bot.on("hook", (trigger) => ...)`).

- **Unsupported trigger types are safely dropped.** They are acknowledged with a `200` response and will only trigger
  the `"unsupported"` handler, if registered. Upgrading the SDK is required to support new trigger types.

#### Deprecated

- `bot.getRoomStateMessages(room, options?)` > `bot.getScratchpadStateMessages(room, options?)`.
- `bot.getRoomState(room)` > `bot.getScratchpadState(room)`, which returns a `ScratchpadState` rather than a `RoomState`
  wrapping it, so the `state.scratchpad.` prefix is gone.
- `bot.getRoomPreviewImage(room, options?)` > `bot.getScratchpadPreviewImage(room, options?)`.
- `RoomStateResponse` > `ScratchpadStateResponse`, `GetRoomStateMessagesOptions` > `GetScratchpadStateOptions`,
  `GetRoomPreviewOptions` > `GetScratchpadPreviewOptions`, `RoomPreviewImage` > `ScratchpadPreviewImage`.
- `ScribblePubClient.getRoomState` > `ScribblePubClient.getScratchpadState`, `ScribblePubClient.getRoomPreview` >
  `ScribblePubClient.getScratchpadPreview`.

#### Added

- **New methods for Scratchpad data**:
  - `bot.getScratchpadStateMessages()` fetches the raw `ScratchpadMessage` list.
  - `bot.getScratchpadState()` fetches the reduced `ScratchpadState`. (You can also reduce an existing list with
    `ScratchpadState.fromMessages()`).
  - `bot.getScratchpadPreviewImage()` returns a `{ image, lastModified }` object, or `null` if unmodified.
- **Specific event handlers**: Listen for specific trigger types directly (e.g., `bot.on("chat.addressed", ...)`).
  - The handler receives a strictly typed `trigger`.
  - `"hook"` now acts as a catch-all for unclaimed triggers.
  - At most one handler runs per hook. Unclaimed hooks are safely acknowledged with `200` (a `501` now strictly means
    _no_ handlers are registered on the bot).
- **`bot.on("unsupported")` event**: Handle triggers unknown to this SDK version. Receives the base fields
  (`TriggerBase`) and can return actions.
- **`bot.on("chat.addressed")`**: Replaces the legacy `chat.mention` handler. It receives a `ChatAddressedTrigger`
  (which replaces `ChatMentionTrigger`).
- **`ChatTriggerBase` now includes `messageId`:** Exposed on all chat triggers by the SDK.
- **`Trigger.type`**: Renamed from `Trigger.trigger` (which remains populated for backwards compatibility, but will be
  removed at some point).
- **Rune offset helpers**: `quoteRange`, `sliceRunes`, `runeLength`, `toRuneOffset`, and `toUtf16Offset`.
  - These are the official, supported way to build and read quotes. They safely handle the UTF-16 astral character math
    that breaks native JavaScript `indexOf` and `length`.
- **New exported types and constants**:
  - `Handler`, `SupportedTriggerType` (and `SUPPORTED_TRIGGER_TYPES`).
  - `ChatAddressedTrigger` (replacing `ChatMentionTrigger`), `RepliedMessage`, and `OutboundReplyTarget`.
  - `MAX_LOCAL_ID` (values above this are proactively rejected locally because they cannot survive a JSON round trip in
    JS).
  - New Scratchpad options and response types.

#### Fixed

- **Parsers now fully support forward compatibility:**
  - Unsupported trigger types no longer throw `400` errors. They safely parse into their base fields and are
    acknowledged.
  - Zod schemas are now `loose` rather than stripping unknown fields. This fixes a bug where payload-specific fields
    (like `text`) were incorrectly stripped before reaching their specific schema.
- **Improved validation errors**: Malformed payloads for supported triggers (e.g. missing `text`) now correctly report
  the missing field instead of silently falling back as unsupported.

#### Notes

- **Per-hook metadata belongs on the trigger.** Handlers only receive the `trigger` object. Fields added alongside
  `trigger` in the request body will be ignored by bots. Use `TriggerBase` for delivery metadata.
- **`RoomState` is not deprecated.** It remains for a convenient way to hold the entire room state in a single value.

## [0.3.0] - 2026-08-20

**Package split**: The package is split into two: `@scribble-pub/api` and `@scribble-pub/bot-sdk`.

- `@scribble-pub/api` defines the protocol itself: messages, their Zod parsers and the signature. It also includes
  `ScribblePubClient`, a thin one-method-per-endpoint HTTP client returning raw responses.
- `@scribble-pub/bot-sdk` is the reference implementation of how this protocol should be used, how the canvas state is
  built from the messages, edge cases, room host server caching, etc.

### Server API

#### Breaking

No breaking changes.

#### Deprecated

- The action format is changed to reflect the target app name: `chat.addMessage` replaces `addMessage`. The unprefixed
  spelling is still accepted, but deprecated, and is going to be removed before 1.0.

#### New

New endpoints:

- `GET /api/v0/room/{room}/state` — returns `{"messages": [...]}`, the events that define the room state. Currently,
  only the static snapshot is provided: one frame per layer. Full animation timelines will be available later. The
  message types are `sp.sessionMeta`, `sp.layer`, `sp.layerOrder`, `sp.object`, and `sp.lastEventId`. Checl
  [API schemas](packages/api/src/schemas.ts) for details.
- `GET /api/v0/room/{room}/preview` — the room canvas as a PNG, at a 0.6px scale (which is currently always 600 × 420
  px), the same image the big room list shows. `Last-Modified` can be passed to `If-Modified-Since`, so that a
  `304 Not modified` and no body are returned if it hasn't changed since.
- `GET /api/v0/logo` — the site logo in PNG, drawn by the community pixel by pixel, with the letters carved in.
  `?theme=dark` paints the letter borders white instead of black. Pass the returned `ETag` back as `If-None-Match` to
  receive `304 Not modified` same way as with the room preview. The logo is global-scoped, doesn't require providing a
  room name and having any permissions.

### SDK

#### Breaking

No breaking changes. `@scribble-pub/bot-sdk` keeps exporting everything it exported before.

#### Deprecated

- SDK users should respect the underlying API change mentioned above: `chat.addMessage` replaces `addMessage`.

#### Added

- `bot.getRoomStateMessages(room)` — fetches the room state as the raw `RoomMessage` list.
- `bot.getRoomState(room)` — the same, reduced into a `RoomState`. Reducing a message list you already have is
  `RoomState.fromMessages(messages)`. Today it holds a single app, `state.scratchpad`. **The state is mutable**: a room
  can contain tens of thousands of objects, and cloning it on every event would cost far more than it gives. From the
  outside it is read-only, exposed as `ReadonlyMap`s and readonly arrays.
- `state.applyMessage(msg)` and `state.applyMessages(messages)` — feed later messages into a state you already hold,
  instead of fetching it again.
- `bot.getRoomPreviewImage(room, options?)` — returns a `RoomPreviewImage`, `{ image, lastModified }`, or `null` when
  the preview was not modified. `lastModified` goes back as `options.ifModifiedSince` on the next call.
- `bot.getLogoImage(options?)` — returns a `LogoImage`, `{ image, etag }`, or `null` when the logo was not modified.
  `etag` goes back as `options.ifNoneMatch` on the next call. `options.theme` defines the border color.
- `rgbaToHex` and `rgbaToComponents`, for turning a packed color into a canonical form.
- **Hook handlers may be asynchronous again.** `bot.on("hook", …)` accepts a promise once more, so a short await — such
  as registering the hook in a database — can happen inline. The 10-second deadline is unchanged, so anything slower
  should still use `sendActions`.

## [0.2.0] - 2026-08-14

### Server API

#### Breaking

No breaking changes.

#### New

New endpoints:

- `POST /api/v0/bot/webhook/register` — takes `{"url": "https://…"}` and replaces the URL the platform sends hooks to.
  Authenticated with the bot token as a bearer credential.
- `POST /api/v0/room/{room}/actions` — executes given `{"actions": [...]}` (same format as the response body), and runs
  those actions in the room. Error codes:
  - `403` when the bot doesn't have permission to execute given actions.
  - `404` when the room does not exist or is not accessible at all.

Also:

- Rooms are served by regional instances, such as `https://eu.scribble.pub` and `https://ap.scribble.pub`. A request to
  an instance that does not host the room is answered with a `307` to the one that does. It carries a short-lived
  credential in the redirect link, so a client that simply follows redirects needs no extra work on e.g., preventing
  Authorization token stripping. Although general `https://scribble.pub/api` requests are supported, it's recommended to
  cache redirect base URLs to speed up next requests.
- Hook payloads now contain the room's regional URL in `trigger.directUrl`, which lets a client save it into its cache
  and skip the future the redirects.
- Errors carry a JSON body, `{"error": "Room is not found"}`.

### SDK

#### Breaking

- **Hook handlers are now synchronous.** `bot.on("hook", …)` accepts `(request: HookRequest) => Action[] | undefined`;
  promises are no longer allowed, so a hook is always answered on the spot and results can never arrive late. Existing
  `async` handlers must drop the `async` keyword and move any asynchronous work to `sendActions`.
- **Local validation failures now throw `ScribblePubValidationError`** instead of a plain `Error`. Code matching on the
  message still works, since the messages are unchanged.

#### Added

- `bot.registerWebhook(url)` — points the platform at this bot's webhook endpoint via
  `POST /api/v0/bot/webhook/register`.
- `Trigger` now has `directUrl` field, containing the regional instance that serves the room.
- `bot.sendActions(room, actions)` — sends actions to the specified room, using the same body as the hook response.
- Room-to-instance routing: `sendActions` remembers which regional instance serves each room, using `Trigger.directUrl`
  and the platform's redirects, so repeat calls go straight to the right instance.
- `ScribblePubApiError`, carrying the HTTP `status` and the error message returned by the API in `body`.
- `ScribblePubValidationError`, thrown by `registerWebhook` and `sendActions` when their arguments fail validation
  locally.
- `BotConfig.baseUrl`, for pointing the SDK at custom instances. Setting it also drops the built-in room-to-instance
  table, which names production origins — without that, a locally pointed bot would reach past its own instance into
  production for any room listed there.
- `ErrorResponse`, the `{ "error": string }` body the API returns with a non-2xx status.
- `packages/bot-sdk/src/schemas.ts` now holds nothing but the wire types, so it now better serves as the Server API
  definition  
  and can be read by human, script or an agent. Zod and the parsers moved to
  `packages/bot-sdk/src/internal/validation.ts`, with `ValidationError` still exported from the package root.

## [0.1.0]

- Initial release.
