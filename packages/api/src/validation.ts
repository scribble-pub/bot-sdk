import { z } from "zod"
import type {
    Action,
    HookRequest,
    HookResponse,
    IncomingTrigger,
    RegisterWebhookPayload,
    SupportedTriggerType,
} from "./schemas.js"

/**
 * An adapter so that both `type` and `trigger` exist, for backwards compatibility.
 * `trigger` is deprecated and removed before 1.0.
 */
function aliasTriggerType(value: unknown): unknown {
    if (typeof value !== "object" || value === null) {
        return value
    }

    const raw = value as Record<string, unknown>
    const type = typeof raw.type === "string" ? raw.type : raw.trigger

    return typeof type === "string" ? { ...raw, type, trigger: type } : value
}

const baseFields = {
    room: z.string(),
    timestamp: z.number(),
    directUrl: z.string(),
}

const chatFields = {
    ...baseFields,
    username: z.string(),
    text: z.string(),
}

const ChatMentionTriggerSchema = z.looseObject({
    ...chatFields,
    type: z.literal("chat.mention"),
})

const triggerSchemasByType: Record<SupportedTriggerType, z.ZodType> = {
    "chat.mention": ChatMentionTriggerSchema,
}

// Parse the common base fields first to avoid throwing 400 errors for unsupported trigger types.
// We use a loose object so fields aren't stripped before they can be checked by specific schemas.
// We dispatch manually instead of using `z.union` to provide more accurate error messages.
const TriggerSchema: z.ZodType<IncomingTrigger> = z
    .preprocess(
        aliasTriggerType,
        z.looseObject({
            ...baseFields,
            type: z.string(),
            trigger: z.string(),
        }),
    )
    .superRefine((trigger, ctx) => {
        const schema = triggerSchemasByType[trigger.type as SupportedTriggerType]
        if (!schema) {
            return
        }

        const result = schema.safeParse(trigger)
        if (!result.success) {
            for (const issue of result.error.issues) {
                ctx.addIssue({ code: "custom", path: issue.path, message: issue.message })
            }
        }
    })

const HookRequestSchema: z.ZodType<HookRequest> = z.looseObject({
    trigger: TriggerSchema,
})

const RegisterWebhookPayloadSchema: z.ZodType<RegisterWebhookPayload> = z.object({
    url: z.url({ protocol: /^https?$/ }),
})

// "addMessage" is the deprecated spelling of "chat.addMessage", accepted until it is removed before 1.0.
const ActionSchema: z.ZodType<Action> = z.looseObject({
    type: z.literal(["chat.addMessage", "addMessage"]),
    text: z.string(),
})

const HookResponseSchema: z.ZodType<HookResponse> = z.looseObject({
    actions: z.array(ActionSchema),
})

/**
 * An error encountered while validating a request to your service, or a request or response to the scribble.pub API.
 */
export type ValidationError = {
    /** Dot-separated path to the erroring field, e.g. "trigger.timestamp". */
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
 * Validates an incoming webhook body against {@link HookRequest}.
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
 * Validates a webhook URL before it is sent to the platform, so an obviously bad value fails locally.
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
 * Validates the actions a bot handler returns against {@link HookResponse}.
 */
export function parseHookResponse(
    actions: unknown,
): { success: true; data: HookResponse } | { success: false; errors: ValidationError[] } {
    const result = HookResponseSchema.safeParse({ actions })
    return result.success
        ? { success: true, data: result.data }
        : { success: false, errors: toValidationErrors(result.error.issues) }
}
