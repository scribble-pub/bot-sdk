import { z } from "zod"

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
}

/**
 * The exact JSON payload sent by the scribble.pub server when an event occurs in a room.
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

const TriggerSchema: z.ZodType<Trigger> = z.object({
    trigger: z.literal("chat.mention"),
    room: z.string(),
    timestamp: z.number(),
    text: z.string(),
    username: z.string(),
})

const HookRequestSchema: z.ZodType<HookRequest> = z.object({
    trigger: TriggerSchema,
})

const RegisterWebhookPayloadSchema: z.ZodType<RegisterWebhookPayload> = z.object({
    // `http` stays allowed so a local platform instance can be pointed at localhost without a tunnel.
    url: z.url({ protocol: /^https?$/ }),
})

const ActionSchema: z.ZodType<Action> = z.object({
    type: z.literal("addMessage"),
    text: z.string(),
})

const HookResponseSchema: z.ZodType<HookResponse> = z.object({
    actions: z.array(ActionSchema),
})

/**
 * A single validation failure, in a plain shape independent of the underlying
 * validation library — consumers never need to know it's produced by Zod.
 */
export type ValidationError = {
    /** Dot-separated path to the offending field, e.g. "trigger.timestamp". */
    path: string
    message: string
}

function toValidationErrors(issues: z.core.$ZodIssue[]): ValidationError[] {
    return issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
    }))
}

/**
 * Validates an incoming webhook body against the {@link HookRequest} shape.
 * Kept as a plain function (rather than exporting the Zod schema) so consumers
 * never need `zod` in their own code — it stays an internal implementation detail.
 */
export function parseHookRequest(
    data: unknown,
): { success: true; data: HookRequest } | { success: false; errors: ValidationError[] } {
    const result = HookRequestSchema.safeParse(data)
    return result.success
        ? { success: true, data: result.data }
        : { success: false, errors: toValidationErrors(result.error.issues) }
}

/**
 * Validates a webhook URL before it is sent to the platform, so an obviously bad
 * value fails locally with a clear message instead of as an opaque 400 from the API.
 */
export function parseRegisterWebhookPayload(
    data: unknown,
): { success: true; data: RegisterWebhookPayload } | { success: false; errors: ValidationError[] } {
    const result = RegisterWebhookPayloadSchema.safeParse(data)
    return result.success
        ? { success: true, data: result.data }
        : { success: false, errors: toValidationErrors(result.error.issues) }
}

/**
 * Validates the actions a bot handler returns against the {@link HookResponse} shape.
 */
export function parseHookResponse(
    actions: unknown,
): { success: true; data: HookResponse } | { success: false; errors: ValidationError[] } {
    const result = HookResponseSchema.safeParse({ actions })
    return result.success
        ? { success: true, data: result.data }
        : { success: false, errors: toValidationErrors(result.error.issues) }
}
