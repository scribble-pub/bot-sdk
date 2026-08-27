import { z } from "zod"
import type {
    Action,
    HookRequest,
    HookResponse,
    IncomingTrigger,
    RegisterWebhookPayload,
    SupportedTriggerType,
} from "./schemas.js"

const baseFields = {
    room: z.string(),
    timestamp: z.number(),
    directUrl: z.string(),
}

// `.int()` already refuses anything outside the safe-integer range, which is exactly MAX_LOCAL_ID.
const localIdField = z
    .number()
    .int()
    .min(0)
    .optional()
    .transform((value) => (value ? value : undefined))

const chatFields = {
    ...baseFields,
    username: z.string(),
    userId: z.string(),
    messageId: z.number(),
    text: z.string(),
}

// Only ever delivered for a live parent, so everything but the conditional fields is required.
const RepliedMessageSchema = z.looseObject({
    messageId: z.number(),
    localId: localIdField,
    username: z.string(),
    userId: z.string(),
    text: z.string(),
    quoteStart: z.number().int().min(0).optional(),
    quoteText: z.string().optional(),
})

const ChatAddressedTriggerSchema = z.looseObject({
    ...chatFields,
    type: z.literal("chat.addressed"),
    replyToMessageId: z.number().optional(),
    replyTo: RepliedMessageSchema.optional(),
})

const triggerSchemasByType: Record<SupportedTriggerType, z.ZodType> = {
    "chat.addressed": ChatAddressedTriggerSchema,
}

// Parse the common base fields first to avoid throwing 400 errors for unsupported trigger types.
// We use a loose object so fields aren't stripped before they can be checked by specific schemas.
// We dispatch manually instead of using `z.union` to provide more accurate error messages.
const TriggerSchema: z.ZodType<IncomingTrigger> = z
    .looseObject({
        ...baseFields,
        type: z.string(),
    })
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

const ReplyTargetSchema = z
    .looseObject({
        messageId: z.number().optional(),
        localId: localIdField,
        quoteStart: z.number().int().min(0).optional(),
        quoteLength: z.number().int().positive().optional(),
    })
    .superRefine((replyTo, ctx) => {
        // Choose either `messageId` or `localId`
        if (replyTo.messageId !== undefined && replyTo.localId !== undefined) {
            ctx.addIssue({
                code: "custom",
                path: ["messageId"],
                message: "give either messageId or localId, not both",
            })
        }
        if (replyTo.messageId === undefined && replyTo.localId === undefined) {
            ctx.addIssue({
                code: "custom",
                path: ["messageId"],
                message: "one of messageId or localId is required",
            })
        }
        if ((replyTo.quoteStart === undefined) !== (replyTo.quoteLength === undefined)) {
            ctx.addIssue({
                code: "custom",
                path: [replyTo.quoteStart === undefined ? "quoteStart" : "quoteLength"],
                message: "quoteStart and quoteLength must be given together",
            })
        }
    })

const ActionSchema: z.ZodType<Action> = z.looseObject({
    type: z.literal("chat.addMessage"),
    text: z.string(),
    localId: localIdField,
    replyTo: ReplyTargetSchema.optional(),
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
