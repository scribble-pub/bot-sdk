# Changelog

All notable changes to this project are documented here.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**While the version is below `1.0.0`, breaking changes may land in any minor release**.

Because this package is also the reference implementation of the Bot API,
each release provides API changes as well to help developing custom clients.

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
