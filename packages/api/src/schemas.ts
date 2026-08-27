/**
 * The trigger types this package version supports.
 */
export const SUPPORTED_TRIGGER_TYPES = ["chat.addressed"] as const

/**
 * The largest value a local message ID can contain.
 *
 * Local IDs are capped at 2^53-1 (9007199254740991) for JavaScript compatibility.
 * Any higher value (e.g., coming from other languages) is rejected.
 */
export const MAX_LOCAL_ID = Number.MAX_SAFE_INTEGER

export type SupportedTriggerType = (typeof SUPPORTED_TRIGGER_TYPES)[number]

/**
 * A base for events that caused a webhook to fire.
 */
export type TriggerBase = {
    /**
     * The type of trigger that caused this hook to fire.
     */
    type: string

    /**
     * The room where the event occurred.
     */
    room: string

    /**
     * The timestamp of the event, which triggered the hook, in seconds since the Unix epoch.
     */
    timestamp: number

    /**
     * The base API URL for this room's host instance (e.g., "https://eu.scribble.pub").
     * Use it for a faster way to reach the target room, avoiding intermediate redirects.
     */
    directUrl: string
}

/**
 * A base for all chat events that trigger a webhook.
 */
export type ChatTriggerBase = TriggerBase & {
    /**
     * The username of the user who triggered the hook.
     */
    username: string

    /**
     * The ID of the user who triggered the hook.
     *
     * Unlike {@link ChatTriggerBase.username}, which its owner can change, this one is stable.
     * Always key your per-user storage on this ID, not the username.
     *
     * The first letter indicates the author type: `u` (registered user), `g` (guest), or `b` (bot).
     * Treat the ID as a single string, and expect new prefix letters in the future.
     *
     * A guest's identity is tied to their browser session. If their session expires, or they clear
     * their cookies, they will return under a new guest ID.
     *
     * It is 10 characters long today, but this is not part of the contract. Ensure your storage
     * can accommodate longer IDs. Always compare the whole string case-sensitively.
     */
    userId: string

    /**
     * The room-global unique ID of the chat message that triggered the hook.
     *
     * Use it to reply to this message ({@link OutboundReplyTarget.messageId}), to record the message
     * in your own storage, and as a deduplication key — it is stable and unique.
     *
     * IDs rise monotonically, so sorting by it gives chronological order. They come from the chat's global event
     * counter, shared with other events (such as message editing), so expect gaps: consecutive messages rarely
     * have consecutive IDs.
     */
    messageId: number

    /**
     * The text that triggered the hook.
     *
     * When the message opens with your bot's tag, the tag is part of the text — the platform does not strip it.
     */
    text: string
}

/**
 * The message a chat message is a reply to, delivered only while that message is still live.
 *
 * A parent message that was deleted, hidden, or expired is not described here at all: the reply then
 * arrives with {@link ChatAddressedTrigger.replyToMessageId} alone. So whenever this object is
 * present, everything it knows about the parent is present with it, and the optional fields below
 * are optional for their own reasons rather than because the parent message is missing data.
 *
 * Quote offsets are **rune (Unicode code point) indices** into {@link RepliedMessage.text}.
 * JavaScript strings are indexed in UTF-16 code units instead, which differ for anything above
 * U+FFFF (most emoji), so convert with {@link toRuneOffset}/{@link sliceRunes} rather than
 * `slice`/`indexOf` — see {@link quoteRange}.
 */
export type RepliedMessage = {
    /**
     * The room-global ID of the replied-to message. The same field as {@link ChatTriggerBase.messageId}.
     *
     * Repeats {@link ChatAddressedTrigger.replyToMessageId} so this object identifies its own
     * message wherever you pass or store it.
     */
    messageId: number

    /**
     * The value your bot passed as {@link AddMessagePayload.localId} when it posted this message.
     *
     * Present only when the replied-to message is your bot's own and contains a local ID,
     * which makes it the key to look the message up in your own storage.
     */
    localId?: number | undefined

    /**
     * The username of the author of the replied-to message.
     */
    username: string

    /**
     * The ID of the author of the replied-to message. The same field as
     * {@link ChatTriggerBase.userId}.
     */
    userId: string

    /**
     * The full text of the replied-to message.
     */
    text: string

    /**
     * The rune offset in {@link RepliedMessage.text} where the quoted fragment starts.
     *
     * Present together with {@link RepliedMessage.quoteText} when the reply quotes a fragment
     * rather than refers to the whole message.
     */
    quoteStart?: number | undefined

    /**
     * The quoted fragment, as it read when the reply was posted.
     *
     * The platform stores it with the reply, so it stays stable even if the replied-to message
     * changes later. That also means it may no longer appear at `quoteStart`, or in `text` at all.
     */
    quoteText?: string | undefined
}

/**
 * A chat message addressed to your bot: it opens with the bot's tag (e.g., "@HelloBot"), replies to
 * one of the bot's own messages, or both.
 *
 * - **Replied to.** {@link ChatAddressedTrigger.replyToMessageId} is present. This could be a reply
 *   to your bot's own message, or a reply to somebody else where the user also addressed your bot.
 * - **Tagged.** The tag opens {@link ChatTriggerBase.text}. Match it against your bot's own username.
 *
 * Only an opening tag addresses a bot; naming one mid-sentence is ordinary text. A reply addresses
 * only when the message opens with no bot tag, so a reply to your own message that opens with
 * another bot's tag reaches that bot alone and never arrives here.
 *
 * Messages posted by bots emit no hooks: another bot cannot address yours, and yours never addresses itself.
 * Bot-to-bot messages may become possible later as an explicit opt-in; self-triggering will not.
 */
export type ChatAddressedTrigger = ChatTriggerBase & {
    type: "chat.addressed"

    /**
     * The room-global ID of the message this one replies to.
     *
     * Present whenever the message is a reply, whatever became of its target — this is the one part
     * of a reply that always survives. Use it to reply into the same thread, and see
     * {@link ChatAddressedTrigger.replyTo} for the target itself.
     *
     * Absent when the message is not a reply.
     */
    replyToMessageId?: number | undefined

    /**
     * The message this one replies to, while that message is still live.
     *
     * Present whether the reply targets one of your bot's messages or somebody else's — a user
     * replying to a third party while addressing your bot ("@HelloBot what do you think about it?")
     * delivers that third party's message here.
     *
     * Absent when the message is not a reply, and equally when its target has been deleted, hidden,
     * or expired: {@link ChatAddressedTrigger.replyToMessageId} then arrives on its own. Its
     * presence therefore tells you the target is still readable, not merely that this is a reply.
     */
    replyTo?: RepliedMessage | undefined
}

/**
 * A specific event that caused this webhook to fire, supported by this package version.
 */
export type Trigger = ChatAddressedTrigger

/**
 * A trigger object as it comes from the platform.
 * A superset of `Trigger` that includes placeholders
 * for new trigger types that may not be supported by this version of the SDK.
 * Avoids 400 responses from the bot triggered by Zod.
 */
export type IncomingTrigger =
    | Trigger
    | (TriggerBase & {
          // `string & {}` keeps autocomplete for the supported literals while still accepting anything else.
          type: string & {}
      })

/**
 * The JSON payload sent by a scribble.pub server when a hook-emitting event occurs in a room.
 * This is what your bot's HTTP server receives in the request body.
 */
export type HookRequest = {
    trigger: IncomingTrigger
}

/**
 * Payload to register or update the bot's webhook URL dynamically.
 * This is what the SDK sends to `POST /api/v0/bot/webhook/register`.
 */
export type RegisterWebhookPayload = {
    /**
     * The absolute `http`/`https` URL the platform should POST hooks to.
     */
    url: string
}

/**
 * The message an outbound chat message replies to, and which part of it to quote.
 *
 * Give exactly one of {@link OutboundReplyTarget.messageId} or {@link OutboundReplyTarget.localId}.
 */
export type OutboundReplyTarget = {
    /**
     * The room-global ID of the message to reply to, as delivered in
     * {@link ChatTriggerBase.messageId} or {@link RepliedMessage.messageId}.
     */
    messageId?: number | undefined

    /**
     * The {@link AddMessagePayload.localId} of one of your bot's own earlier messages.
     *
     * Lets a bot reply to something it posted without fetching the room-global ID.
     * Mutually exclusive with {@link OutboundReplyTarget.messageId}; passing both is rejected.
     */
    localId?: number | undefined

    /**
     * The rune offset in the target message where the quoted fragment starts.
     *
     * Rune (Unicode code point) indices, not JavaScript's UTF-16 code units — use
     * {@link quoteRange} to derive both quote fields from the text you want to quote.
     * Must be given together with {@link OutboundReplyTarget.quoteLength}.
     */
    quoteStart?: number | undefined

    /**
     * The length of the quoted fragment in runes.
     *
     * The platform slices the fragment out of the target message itself, so a bot can never
     * attribute text to someone who did not write it.
     *
     * The platform clamps rather than fails: a quote running past the end of the target is cut
     * short, and a `quoteStart` at or beyond the end drops the quote entirely while the message
     * still posts as a plain reply.
     */
    quoteLength?: number | undefined
}

/**
 * Tells the platform to post a new chat message into the room as the bot.
 */
export type AddMessagePayload = {
    text: string

    /**
     * Your own ID for this message, unique among your bot's messages in this room's chat.
     *
     * The platform gives it back as {@link RepliedMessage.localId}
     * which can help the bot match a reply against its own records without fetching room-global IDs.
     * It can also serve deduplication: re-sending the same `localId` into the
     * same room drops the new message, as long as the original message exists
     * (chat messages expire after about two days).
     *
     * Send nothing or 0 to have no local ID. 0 or absent values are not deduplicated.
     *
     * We recommend keeping an incremental counter in a DB. For single-instance, memory-only bots,
     * a simple solution with little risks can be setting the local counter to current unix time in milliseconds.
     *
     * Optional; 0 means no local ID. Must not exceed {@link MAX_LOCAL_ID}.
     */
    localId?: number | undefined

    /**
     * Makes this message a reply, optionally quoting part of what it replies to.
     */
    replyTo?: OutboundReplyTarget | undefined
}

/**
 * Posts a chat message into the room as the bot.
 */
export type AddMessageAction = { type: "chat.addMessage" } & AddMessagePayload

/**
 * A single operation your bot wants to perform in the room.
 * This is designed as a "Flat Discriminated Union", meaning the 'type' field
 * dictates which payload fields are required next to it.
 */
export type Action = AddMessageAction

/**
 * The JSON payload your bot server must return to scribble.pub.
 * This tells the platform exactly what actions to execute in the room.
 */
export type HookResponse = {
    actions: Action[]
}

/**
 * The JSON body returned with any non-2xx response from the API.
 */
export type ErrorResponse = {
    /**
     * A human-readable description of what went wrong, e.g. "Room is not found".
     */
    error: string
}

/**
 * Any message for a specific room. Currently only supports some scratchpad events, but will also be used for chat.
 *
 * As the scribble.pub platform evolves, new fields will be added to these payloads.
 * Your bot must ignore any unrecognized fields or message types.
 * Do not use strict JSON validation that fails on unknown keys.
 */
export type RoomMessage = ScratchpadMessage

/**
 * Messages that define and modify the scratchpad state.
 */
export type ScratchpadMessage =
    | ScratchpadSessionMetaMessage
    | ScratchpadLayerMessage
    | ScratchpadSetLayerOrderMessage
    | ScratchpadObjectMessage
    | ScratchpadLastEventIdMessage

/**
 * The scratchpad's global event counter value, closing a state snapshot.
 *
 * Since some events may have been skipped (such as, object removal),
 * it may be larger than the event IDs received by other means.
 * Keep it as the cursor to resume partial updates from.
 */
export type ScratchpadLastEventIdMessage = {
    type: "sp.lastEventId"

    lastEventId: number
}

/**
 * Global metadata about the current drawing session in the room.
 *
 * Receiving this event begins a new drawing session, usually due to a room clear.
 * Bots should reset their local state (layers, frames, objects, last event ID) when receiving this to a complete empty state.
 * The default layers will be provided additionally with the standard {@link ScratchpadLayerMessage} message.
 */
export type ScratchpadSessionMetaMessage = {
    type: "sp.sessionMeta"

    /**
     * An identifier for the current drawing.
     *
     * In theory, an old state can be restored in the same or even another room,
     * and it will have the same identifier as when the original drawing started,
     * but this is an exceptional behavior as for now.
     */
    currentSession: number

    /**
     * The ID of the event that created this metadata.
     *
     * Shares the counter over every `eventId`/`lastEventId` you receive.
     */
    eventId: number

    /**
     * Session's sequential ID for a room which has its gallery enabled.
     *
     * This is used for permalinks like https://scribble.pub/main/167 where 167 is the seqId.
     */
    seqId: number

    /**
     * The width of the room canvas. Every object coordinate is expressed in this space.
     */
    canvasWidth: number

    /**
     * The height of the room canvas. Every object coordinate is expressed in this space.
     */
    canvasHeight: number
}

/**
 * A message that creates, updates, or deletes a scratchpad layer.
 *
 * The bot is expected to maintain a local state of layers. When this message arrives,
 * it should upsert the layer by its `layerId`, and also upsert/delete its frames accordingly.
 * If the `frames` array is empty, the layer was deleted.
 *
 * **Layers vs. Frames**:
 * - **Layers** define the top-level rendering z-index.
 * - **Frames** are a part of layers and contain the actual drawing objects.
 * At any single point in time, only one frame can be rendered per layer.
 * Currently, the server only provides 1 frame per layer (the static preview).
 *
 * The rendering order of the objects on a layer/frame is by `objectId`, ascending.
 *
 * Read more about client-facing layers and animation frames at https://scribble.pub/docs/animations.
 */
export type ScratchpadLayerMessage = {
    type: "sp.layer"

    /**
     * A unique session-scoped identifier for the layer.
     *
     * Note: Layers, frames, and objects each have their own independent ID counters.
     */
    layerId: number

    /**
     * The IDs of the frames in this layer.
     * Frame IDs are room-global, and a specific frame ID belongs exclusively to one layer.
     *
     * If a new frame ID arrives, it should be created in the state.
     * If a layer arrives with an empty `frames` array, it means the layer was deleted.
     *
     * Currently, this only returns a single frame ID for the static preview.
     * For most layers, this is the first frame. For layers in "Roll" mode
     * (https://scribble.pub/docs/animations#animation-modes), the currently rolled frame ID is returned instead.
     */
    frames: number[]

    /**
     * The last ID of the event that created or modified this layer.
     * This is a shared counter across all scratchpad events in the room, within the session.
     */
    lastEventId: number
}

export type ScratchpadSetLayerOrderMessage = {
    type: "sp.layerOrder"

    /**
     * The order of layer IDs in the room.
     * Layers are ordered from bottom to top, with the first layer being the bottommost.
     * The bottommost layer is drawn on top of a white background.
     */
    order: number[]

    /**
     * The ID of the event that set this layer order.
     *
     * It is -1 in a state snapshot, where the order is defined only once when all layers are received.
     */
    lastEventId: number
}

/**
 * Represents a drawn line on a frame.
 *
 * These messages are delivered in ascending `objectId` order,
 * representing the order in which they were drawn.
 * Since this matches the rendering order within a frame,
 * you can safely append incoming objects to your local state without sorting them,
 * and you can immediately draw them on top of the frame canvas as they arrive.
 *
 * Expect missed object IDs. Erased objects keep their IDs but are never delivered.
 *
 * A fallback note: if the frame is not found, don't add the object.
 * This is not expected to happen, but it's better to handle it gracefully.
 */
export type ScratchpadObjectMessage = {
    type: "sp.object"

    /**
     * A unique session-scoped identifier for the object.
     *
     * Note: Layers, frames, and objects each have their own independent ID counters.
     */
    objectId: number

    /**
     * The ID of the frame that this object belongs to.
     */
    frameId: number

    /**
     * The ID of the event that last modified this object.
     */
    eventId: number
} & ScratchpadObjectPayload

export type ScratchpadObjectPayloadLineFloats = {
    /**
     * Simple lines.
     *
     * The server mostly uses viewport pos/delta-based lines with custom point serialization,
     * but currently, they will be converted for you to this simplified format by the server.
     *
     * Before 1.0, expect losing compatibility here.
     * It is planned to stop converting the lines to simplified format for precision and wire size efficiency.
     * The lines that are received as "line.floats" now will be received under a different type.
     */
    objectType: "line.floats"

    /**
     * The color of the line packed as `R << 24 | G << 16 | B << 8 | A`,
     * which is the same order as the CSS `#rrggbbaa` notation.
     *
     * Note that alpha is the *lowest* byte, not the highest: 0xff0000ff is opaque red.
     *
     * Use {@link rgbaToHex} for a ready-to-draw CSS string, or {@link rgbaToComponents} for the channels.
     */
    rgba: number

    /**
     * The width of the line.
     *
     * If 0, the polygon should be drawn as a filled polygon,
     * implicitly closed from the last point back to the first.
     *
     * Otherwise, the line should be drawn as a stroked line with the given width, round caps, and round joins.
     * (See https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/lineCap)
     */
    lineWidth: number

    /**
     * A flat array of coordinates `[x1, y1, x2, y2, ...]`.
     *
     * If there are fewer than 4 coordinates, the line should be drawn as a filled circle of radius `lineWidth / 2` around `[x1, y1]`.
     * It's worth explicitly handling this case because many APIs/libraries omit calls to moveTo/lineTo on the same point even with `lineCap` set to `"round"`.
     */
    points: number[]
}

export type ScratchpadObjectPayload = ScratchpadObjectPayloadLineFloats

/**
 * The body returned by a scratchpad state fetch.
 *
 * The messages (re)build the scratchpad state and are closed by the session event counter,
 * {@link ScratchpadLastEventIdMessage}.
 */
export type ScratchpadStateResponse = {
    /**
     * The messages building the scratchpad state, in the order they must be applied.
     */
    messages: ScratchpadMessage[]
}

/**
 * Options for fetching scratchpad messages, left for future polling/delta parameters.
 */
export type GetScratchpadStateOptions = Record<string, never>

/**
 * Options for fetching a scratchpad's raster preview image.
 */
export interface GetScratchpadPreviewOptions {
    /**
     * A standard HTTP Date string (e.g., "Mon, 17 Aug 2026 13:43:50 GMT").
     * If provided, the server will return a 304 Not Modified if the image hasn't changed,
     * saving bandwidth.
     */
    ifModifiedSince?: string
}

/**
 * Options for fetching the site logo image.
 */
export interface GetLogoOptions {
    /**
     * Defines the color of the letter borders. Defaults to `"light"`, which draws them black to be shown over a light background.
     */
    theme?: "light" | "dark"

    /**
     * An `ETag` from a previous response. If provided, the server returns a 304 Not Modified when
     * nobody has drawn on the logo since, saving bandwidth.
     */
    ifNoneMatch?: string
}
