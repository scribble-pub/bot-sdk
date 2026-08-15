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
 * A single operation your bot wants to perform in the room.
 * This is designed as a "Flat Discriminated Union", meaning the 'type' field
 * dictates which payload fields are required next to it.
 */
export type Action = { type: "addMessage" } & AddMessagePayload

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
