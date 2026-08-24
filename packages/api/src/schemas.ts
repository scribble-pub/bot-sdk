/**
 * The specific event that caused this webhook to fire.
 * Currently, this only fires when a user explicitly tags your bot (e.g., "@HelloBot").
 */
export type Trigger = {
    /**
     * The type of trigger that caused this hook to fire.
     */
    trigger: "chat.mention"

    /**
     * The room where the event occurred.
     */
    room: string

    /**
     * The timestamp of the event, which triggered the hook, in seconds since the Unix epoch.
     */
    timestamp: number

    /**
     * The text that triggered the hook. Includes the mention itself.
     */
    text: string

    /**
     * The username of the user who triggered the hook.
     */
    username: string

    /**
     * The base API URL for this room's host instance (e.g., "https://eu.scribble.pub").
     * Use it for a faster way to reach the target room, avoiding intermediate redirects.
     */
    directUrl: string
}

/**
 * The exact JSON payload sent by a scribble.pub server when an event occurs in a room.
 * This is what your bot's HTTP server receives in the request body.
 */
export type HookRequest = {
    trigger: Trigger
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
 * Tells the platform to post a new chat message into the room as the bot.
 */
export type AddMessagePayload = {
    text: string
}

/**
 * Posts a chat message into the room as the bot.
 */
export type AddMessageAction = { type: "chat.addMessage" } & AddMessagePayload

/**
 * The unprefixed spelling of {@link AddMessageAction}, still accepted by the platform.
 *
 * @deprecated Use `"chat.addMessage"`. Support for this spelling will be removed before 1.0.
 */
export type LegacyAddMessageAction = { type: "addMessage" } & AddMessagePayload

/**
 * A single operation your bot wants to perform in the room.
 * This is designed as a "Flat Discriminated Union", meaning the 'type' field
 * dictates which payload fields are required next to it.
 */
export type Action = AddMessageAction | LegacyAddMessageAction

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
 * The body returned by a room state fetch.
 *
 * @deprecated since 0.4.0. The single room state endpoint is replaced by per-app endpoints;
 * use {@link ScratchpadStateResponse}. Removed in 0.5.0.
 */
export type RoomStateResponse = {
    /**
     * The messages rebuilding the room state, in the order they must be applied.
     */
    messages: RoomMessage[]
}

/**
 * Options for fetching scratchpad messages, left for future polling/delta parameters.
 */
export type GetScratchpadStateOptions = Record<string, never>

/**
 * Options for fetching room messages, left for future polling/delta parameters.
 *
 * @deprecated since 0.4.0, use {@link GetScratchpadStateOptions}. Removed in 0.5.0.
 */
export type GetRoomStateMessagesOptions = GetScratchpadStateOptions

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
 * Options for fetching a room's raster preview image.
 *
 * @deprecated since 0.4.0, use {@link GetScratchpadPreviewOptions}. Removed in 0.5.0.
 */
export type GetRoomPreviewOptions = GetScratchpadPreviewOptions

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
